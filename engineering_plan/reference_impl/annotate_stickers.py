"""表情包库标注 / 校验工具（参考实现骨架）。

地位
----
本文件是 `05_PLATFORM_CAPABILITIES.md` §4 的"可直接落盘的代码"参考实现。
P5-W2 时拷入 `astr/memory/stickers/`，把 `Labeler` / `Embedder` 两个注入点
接到 ModelRouter（VLM 打标）与 CLIP（嵌入）即可——核心遍历/合并/落盘逻辑不必改动。

为什么是"接口先写、实现后跟"（02 §3 编码规范、99 #4）
----------------------------------------------------------
打标用什么 VLM、嵌入用哪版 CLIP，都会随时间变。把这两件易变的事抽成 Protocol，
默认给会"礼貌报错"的 stub。这样骨架今天就能跑（annotate --dry-run / validate），
而真正花钱、依赖模型的部分留到 P5 接线时再填，不污染稳定逻辑。

宪法约束（§0.4 灵魂可迁移）
----------------------------
- 表情包文件 + index.jsonl 属于身份资产，住 SoulPackage（world/stickers/），跟着灵魂迁移。
- embedding 是缓存，住 runtime_cache/，可删可重算——本工具默认不把向量写进 index。
- 标注文本里禁止出现主人 PII（真名/地址/账号）；meme 字段只描述梗本身。

CLI
---
    python annotate_stickers.py annotate <stickers_dir> [--dry-run]
    python annotate_stickers.py validate <stickers_dir>

其中 <stickers_dir> 形如 D:/ASTR/soul_package/justin/world/stickers，
其下应有 files/ 子目录存放表情包，index.jsonl 为产出/校验目标。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable, Protocol

try:
    from pydantic import BaseModel, Field, ValidationError
except ImportError as exc:  # 让骨架在未装依赖时给出可执行的指引，而不是裸 traceback
    raise SystemExit("需要 pydantic：`uv add pydantic` 或 `pip install pydantic`") from exc


IMAGE_SUFFIXES = {".gif", ".png", ".jpg", ".jpeg", ".webp"}


# --------------------------------------------------------------------------- #
# 数据模型（与 05 §4.1 schema 一一对应；validate 命令复用它）
# --------------------------------------------------------------------------- #
class StickerEntry(BaseModel):
    """表情包库中的一条记录。字段含义见 05 §4.1。"""

    id: str
    file: str                              # 相对 stickers_dir 的路径，如 "files/stk_0042.gif"
    emotion: list[str] = Field(default_factory=list)   # 情绪标签：tsundere/excited/...
    context: list[str] = Field(default_factory=list)   # 适用语境：邀功/嘴硬/对主人/...
    meme: str = ""                         # 梗含义（人类可读，禁含 PII）
    embedding_ref: str | None = None       # 形如 "clip://stk_0042"，向量本体住 runtime_cache
    use_count: int = 0                     # 运行时累积，标注时保留旧值
    last_used: str | None = None           # ISO date，标注时保留旧值


class StickerLabel(BaseModel):
    """Labeler 的产物：只负责语义标签，不碰运行时统计字段。"""

    emotion: list[str]
    context: list[str]
    meme: str


# --------------------------------------------------------------------------- #
# 两个注入点（Protocol）。P5-W2 接 ModelRouter / CLIP，替换默认 stub 即可。
# --------------------------------------------------------------------------- #
class Labeler(Protocol):
    """把一张表情包图像翻译成情绪/语境/梗标签。实现侧应走 ModelRouter 的 VLM。"""

    def label(self, image_path: Path) -> StickerLabel: ...


class Embedder(Protocol):
    """产出可检索向量。实现侧用 CLIP/VLM；向量本体写 runtime_cache，本工具只存引用。"""

    def embed(self, image_path: Path) -> list[float]: ...


class _StubLabeler:
    """默认占位：礼貌报错，指明接线位置。让 --dry-run 仍可跑通遍历逻辑。"""

    def label(self, image_path: Path) -> StickerLabel:
        raise NotImplementedError(
            f"接入 VLM 打标后再实现 Labeler.label（待标注：{image_path.name}）。"
            " P5-W2：在 astr/memory/stickers/ 用 ModelRouter 的 VLM 实现它。"
        )


class _StubEmbedder:
    def embed(self, image_path: Path) -> list[float]:
        raise NotImplementedError(
            f"接入 CLIP 后再实现 Embedder.embed（待嵌入：{image_path.name}）。"
        )


# --------------------------------------------------------------------------- #
# 核心逻辑（稳定，接线后无需改动）
# --------------------------------------------------------------------------- #
def _index_path(stickers_dir: Path) -> Path:
    return stickers_dir / "index.jsonl"


def _iter_sticker_files(stickers_dir: Path) -> Iterable[Path]:
    """遍历 files/ 下所有表情包，按文件名排序保证产出稳定可 diff。"""
    files_dir = stickers_dir / "files"
    if not files_dir.is_dir():
        raise FileNotFoundError(f"缺少表情包目录：{files_dir}")
    yield from sorted(p for p in files_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)


def _load_existing(index_path: Path) -> dict[str, StickerEntry]:
    """读旧 index，用于增量合并时保留 use_count / last_used。"""
    if not index_path.exists():
        return {}
    out: dict[str, StickerEntry] = {}
    for line in index_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            entry = StickerEntry.model_validate_json(line)
            out[entry.id] = entry
    return out


def annotate_library(
    stickers_dir: Path,
    labeler: Labeler | None = None,
    embedder: Embedder | None = None,
    *,
    dry_run: bool = False,
) -> list[StickerEntry]:
    """为 stickers_dir/files/ 下每张表情包生成/更新一条 index 记录。

    幂等：已存在的 id 保留其 use_count/last_used，只刷新语义标签与嵌入引用。
    dry_run：只遍历并对未标注项报告，不调用模型、不写盘——用于先验证目录结构。
    """
    labeler = labeler or _StubLabeler()
    embedder = embedder or _StubEmbedder()
    existing = _load_existing(_index_path(stickers_dir))

    entries: list[StickerEntry] = []
    for img in _iter_sticker_files(stickers_dir):
        sticker_id = img.stem  # 约定文件名即 id，如 stk_0042
        prior = existing.get(sticker_id)
        if dry_run:
            print(f"[dry-run] {sticker_id}: {'已标注' if prior else '待标注'}")
            continue

        label = labeler.label(img)
        embedder.embed(img)  # 副作用：把向量写 runtime_cache（实现侧负责）
        entries.append(
            StickerEntry(
                id=sticker_id,
                file=f"files/{img.name}",
                emotion=label.emotion,
                context=label.context,
                meme=label.meme,
                embedding_ref=f"clip://{sticker_id}",
                use_count=prior.use_count if prior else 0,
                last_used=prior.last_used if prior else None,
            )
        )

    if not dry_run:
        _write_index(_index_path(stickers_dir), entries)
        print(f"已写入 {len(entries)} 条 → {_index_path(stickers_dir)}")
    return entries


def _write_index(index_path: Path, entries: list[StickerEntry]) -> None:
    """逐行 JSON 落盘（utf-8, ensure_ascii=False 保留中文梗可读性）。"""
    lines = [e.model_dump_json() for e in entries]
    index_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def validate_library(stickers_dir: Path) -> list[str]:
    """校验 index.jsonl：schema 合法 + 引用文件真实存在。返回错误列表（空=通过）。

    对应 05 §8-2 的验收命令。
    """
    index_path = _index_path(stickers_dir)
    errors: list[str] = []
    if not index_path.exists():
        return [f"缺少 {index_path}"]

    seen: set[str] = set()
    for lineno, raw in enumerate(index_path.read_text(encoding="utf-8").splitlines(), 1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            entry = StickerEntry.model_validate_json(raw)
        except ValidationError as err:
            errors.append(f"L{lineno}: schema 不合法 — {err}")
            continue
        if entry.id in seen:
            errors.append(f"L{lineno}: 重复 id {entry.id}")
        seen.add(entry.id)
        if not (stickers_dir / entry.file).exists():
            errors.append(f"L{lineno}: 引用文件缺失 {entry.file}")
        if not entry.emotion:
            errors.append(f"L{lineno}: {entry.id} 无 emotion 标签")
    return errors


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="表情包库标注 / 校验（参考实现骨架）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ann = sub.add_parser("annotate", help="为 files/ 下表情包生成 index.jsonl")
    p_ann.add_argument("stickers_dir", type=Path)
    p_ann.add_argument("--dry-run", action="store_true", help="只遍历报告，不调模型不写盘")

    p_val = sub.add_parser("validate", help="校验 index.jsonl（05 §8-2）")
    p_val.add_argument("stickers_dir", type=Path)

    args = parser.parse_args(argv)

    if args.cmd == "annotate":
        # P5-W2 接线点：把下面两行替换成真实实现
        #   from astr.memory.stickers.backends import RouterLabeler, ClipEmbedder
        #   annotate_library(args.stickers_dir, RouterLabeler(), ClipEmbedder(), dry_run=args.dry_run)
        annotate_library(args.stickers_dir, dry_run=args.dry_run)
        return 0

    if args.cmd == "validate":
        errs = validate_library(args.stickers_dir)
        if errs:
            print("\n".join(errs), file=sys.stderr)
            print(f"FAIL: {len(errs)} 个问题", file=sys.stderr)
            return 1
        print("OK: 表情包库校验通过")
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
