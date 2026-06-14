"""astr soul validate —— SoulPackage 的随时可跑的体检（03 §2 不变量 3）。

检查四项：① manifest schema 合法；② 目录完整性；③ 文件纯度（禁权重，复用 check_soul_purity）；
④ git 状态干净。任一不过 → 退出码 1。
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import yaml
from pydantic import ValidationError

from astr.contracts.settings import get_settings
from astr.contracts.soul import SOUL_SUBDIRS, SoulManifest


def _force_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass


def _repo_root() -> Path:
    # ops -> astr -> src -> repo_root
    return Path(__file__).resolve().parents[3]


def _load_purity() -> ModuleType:
    """按文件路径加载独立的 check_soul_purity.py（单一真源，避免逻辑漂移）。"""
    script = _repo_root() / "scripts" / "check_soul_purity.py"
    spec = importlib.util.spec_from_file_location("_soul_purity", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载纯度脚本：{script}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _git_status_porcelain(soul_dir: Path) -> tuple[bool, str]:
    """返回 (is_clean, detail)。非 git 仓库视为不通过。"""
    if not (soul_dir / ".git").exists():
        return False, "不是 git 仓库（P0-T05 要求 soul_package 独立 git init）"
    try:
        out = subprocess.run(
            ["git", "-C", str(soul_dir), "status", "--porcelain"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        return False, f"git 调用失败：{e}"
    dirty = out.stdout.strip()
    if dirty:
        return False, f"工作区有未提交改动：\n{dirty}"
    return True, "clean"


def validate(soul_name: str = "justin") -> tuple[bool, list[str], str | None]:
    """返回 (ok, errors, soul_version)。供 CLI 与 FastAPI /v1/soul/validate 复用。"""
    settings = get_settings()
    soul_dir = settings.soul_package_dir / soul_name
    errors: list[str] = []
    soul_version: str | None = None

    if not soul_dir.exists():
        return False, [f"灵魂目录不存在：{soul_dir}（先跑 init_soul.py）"], None

    # ① manifest schema
    manifest_path = soul_dir / "manifest.yaml"
    if not manifest_path.exists():
        errors.append(f"缺少 manifest.yaml：{manifest_path}")
    else:
        try:
            data = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            manifest = SoulManifest.model_validate(data)
            soul_version = manifest.soul_version
        except (yaml.YAMLError, ValidationError) as e:
            errors.append(f"manifest schema 不合法：{e}")

    # ② 目录完整性
    for sub in SOUL_SUBDIRS:
        if not (soul_dir / sub).is_dir():
            errors.append(f"缺少子目录：{sub}")

    # ③ 文件纯度
    purity = _load_purity()
    violations = purity.scan_root(soul_dir)
    for v in violations:
        errors.append(f"禁权重文件：{v}")

    # ④ git 干净
    clean, detail = _git_status_porcelain(soul_dir)
    if not clean:
        errors.append(f"git 状态：{detail}")

    return (len(errors) == 0, errors, soul_version)


def validate_cli(soul_name: str = "justin") -> int:
    _force_utf8_output()
    ok, errors, soul_version = validate(soul_name)
    if ok:
        print(f"OK soul_version={soul_version}")
        return 0
    print("✗ soul validate 失败：", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    return 1
