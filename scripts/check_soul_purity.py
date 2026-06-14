"""灵魂纯度检查 —— §0.4 灵魂可迁移宪法的机器执行形式。

地位
----
本脚本是整个项目最重要的一道 CI 闸：`soul_package/` 内永远不允许出现模型权重文件。
它在两处被调用（见 P0-T02 / P0-T05）：
  1. pre-commit hook：每次提交前扫描，拦住"不小心把 .gguf 拖进灵魂目录"。
  2. `astr soul validate`：复用本模块的 `find_violations()` 做纯度检查。

为什么是 P0 红线（总规 §0.4 / §5.1 / 03 §2 不变量 1）
----------------------------------------------------
SoulPackage 是 露怀秋 的"真身"，必须模型架构无关。一旦权重混进去，灵魂就被悄悄
绑死到某代躯壳——这正是项目要消灭的反面。所以这条不是代码洁癖，是宪法。

落点（重要：装在哪个 repo）
----------------------------
soul_package 是**独立 git 仓库**（P0-T05），权重文件只会在那里被提交。所以：
  - pre-commit hook 装进 **soul_package 仓库**的 `.pre-commit-config.yaml`（pass_filenames 模式，下方示例）。
  - 代码仓库的 CI 另跑一次**全量扫描**兜底：`uv run python scripts/check_soul_purity.py`（无参数 = 扫 --root 默认根）。
脚本本身拷到代码仓库 `scripts/check_soul_purity.py`，两个仓库都引用它。

pre-commit 配置示例（soul_package/.pre-commit-config.yaml）：

    - repo: local
      hooks:
        - id: soul-purity
          name: soul purity (no weights in soul_package)
          entry: uv run python scripts/check_soul_purity.py
          language: system
          pass_filenames: true

CLI
---
    python check_soul_purity.py                 # 扫描默认 soul_package 根（env ASTR_DATA_DIR）
    python check_soul_purity.py <file> [<file>] # 检查指定文件（pre-commit 传入暂存文件名）
    python check_soul_purity.py --root D:/ASTR/soul_package
退出码：0 = 干净；1 = 发现权重文件（并打印清单）。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 与 03_CONTRACTS.md §2 不变量 1 严格一致。新增禁用扩展名两边同步。
FORBIDDEN_SUFFIXES: frozenset[str] = frozenset(
    {".safetensors", ".gguf", ".bin", ".pt", ".pth", ".onnx", ".ckpt", ".h5"}
)

# 只有路径里含这一段才算"灵魂目录"，避免误伤 runtime_cache / base_models 里的合法权重。
SOUL_MARKER = "soul_package"


def _default_root() -> Path:
    """默认扫描根：<ASTR_DATA_DIR>/soul_package，ASTR_DATA_DIR 缺省 D:/ASTR。"""
    data_dir = os.environ.get("ASTR_DATA_DIR", "D:/ASTR")
    return Path(data_dir) / "soul_package"


def _is_weight(path: Path) -> bool:
    return path.suffix.lower() in FORBIDDEN_SUFFIXES


def _under_soul(path: Path) -> bool:
    return SOUL_MARKER in path.as_posix().lower()


def find_violations(paths: list[Path]) -> list[Path]:
    """返回 paths 中位于 soul_package 内且为权重文件的清单。供 `astr soul validate` 复用。"""
    return [p for p in paths if p.is_file() and _under_soul(p) and _is_weight(p)]


def scan_root(root: Path) -> list[Path]:
    """递归扫描一个目录，返回其中所有权重文件。"""
    if not root.exists():
        return []
    return [p for p in root.rglob("*") if p.is_file() and _is_weight(p)]


def _force_utf8_output() -> None:
    """Windows 控制台默认 GBK，无法输出 ✓/✗ 与中文；统一强制 UTF-8（CI/Linux 本就 UTF-8，无副作用）。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass


def main(argv: list[str] | None = None) -> int:
    _force_utf8_output()
    parser = argparse.ArgumentParser(description="灵魂纯度检查（soul_package 禁权重）")
    parser.add_argument("files", nargs="*", type=Path, help="待检查文件（pre-commit 传入）")
    parser.add_argument("--root", type=Path, default=None, help="扫描根目录，默认 soul_package")
    args = parser.parse_args(argv)

    if args.files:
        # pre-commit 模式：只看传进来的、落在 soul_package 内的暂存文件
        violations = find_violations(args.files)
    else:
        # 全量扫描模式
        violations = scan_root(args.root or _default_root())

    if violations:
        print(
            "✗ 灵魂纯度检查失败：soul_package 内禁止出现模型权重（违反总规 §0.4 宪法）",
            file=sys.stderr,
        )
        for p in violations:
            print(f"  - {p}", file=sys.stderr)
        print(
            "处理：把权重移出 soul_package（应在 embodiments/），灵魂里只留模型无关数据。",
            file=sys.stderr,
        )
        return 1

    print("✓ 灵魂纯度检查通过：soul_package 无权重文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
