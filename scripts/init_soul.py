"""P0-T05：在 D:/ASTR/soul_package/<soul_name>/ 创建 露怀秋 的真身骨架。

幂等：已存在的目录/文件不覆盖（除非 --force）。身份种子从 engineering_plan/reference_impl/soul_seed 拷入。
用法：
    uv run python scripts/init_soul.py            # 默认 soul_name=justin
    uv run python scripts/init_soul.py --force     # 覆盖 identity 种子文件
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

# 让脚本能 import astr 包（dev 模式下 src 布局）
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from astr.contracts.settings import get_settings  # noqa: E402
from astr.contracts.soul import (  # noqa: E402
    SOUL_SUBDIRS,
    SoulManifest,
    default_soul_version,
)

# 身份种子文件：reference_impl/soul_seed/<src> → identity/<dst>
SEED_FILES: dict[str, str] = {
    "constitution.yaml": "constitution.yaml",
    "voice_profile.json": "voice_profile.json",
    "persona_bazi.md": "persona_bazi.md",
    "narrative.md": "narrative.md",
}

CURRENT_EMBODIMENT = "prompt_boot:qwen3-8b-q4"


def _force_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass


def _seed_dir() -> Path:
    # repo_root.parent / engineering_plan / reference_impl / soul_seed
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root.parent / "engineering_plan" / "reference_impl" / "soul_seed"


def _dir_is_empty(d: Path) -> bool:
    return not any(p.is_file() for p in d.rglob("*"))


def init_soul(soul_name: str, force: bool) -> int:
    _force_utf8_output()
    settings = get_settings()
    soul_dir = settings.soul_package_dir / soul_name
    soul_dir.mkdir(parents=True, exist_ok=True)

    # ① 子目录
    for sub in SOUL_SUBDIRS:
        (soul_dir / sub).mkdir(parents=True, exist_ok=True)

    # ② 身份种子
    seed = _seed_dir()
    if not seed.is_dir():
        print(f"✗ 找不到种子目录：{seed}", file=sys.stderr)
        return 1
    identity = soul_dir / "identity"
    for src, dst in SEED_FILES.items():
        src_path = seed / src
        dst_path = identity / dst
        if not src_path.is_file():
            print(f"✗ 种子缺失：{src_path}", file=sys.stderr)
            return 1
        if dst_path.exists() and not force:
            print(f"· 跳过已存在：identity/{dst}")
            continue
        shutil.copy2(src_path, dst_path)
        print(f"+ 拷入 identity/{dst}")

    # ③ manifest.yaml
    manifest_path = soul_dir / "manifest.yaml"
    if manifest_path.exists() and not force:
        print("· manifest.yaml 已存在，跳过")
    else:
        manifest = SoulManifest(
            soul_name=soul_name,
            soul_version=default_soul_version(soul_name),
            created_at=datetime.now(UTC),
            current_embodiment=CURRENT_EMBODIMENT,
        )
        manifest_path.write_text(
            yaml.safe_dump(
                manifest.model_dump(mode="json"),
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        print(f"+ 写 manifest.yaml（soul_version={manifest.soul_version}）")

    # ④ 空目录补 .gitkeep（保证 git 跟踪空骨架）
    for sub in SOUL_SUBDIRS:
        d = soul_dir / sub
        keep = d / ".gitkeep"
        if _dir_is_empty(d) and not keep.exists():
            keep.touch()

    print(f"\n灵魂骨架就绪：{soul_dir}")
    print("下一步：cd 进该目录 git init + commit；然后 uv run astr soul validate")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="初始化 SoulPackage 骨架")
    parser.add_argument("--soul-name", default="justin")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的种子/manifest")
    args = parser.parse_args(argv)
    return init_soul(args.soul_name, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
