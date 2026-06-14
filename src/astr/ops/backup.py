"""P0-T10：每日备份 soul_package（真身）。robocopy 起步，可换 restic。

用法：
    uv run python -m astr.ops.backup            # 备份到 ASTR_BACKUP_DIR 或默认
环境：ASTR_BACKUP_DIR=（第二块盘/NAS 路径，强烈建议异盘）。任务计划程序注册每日 23:00 执行。
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from astr.contracts.settings import get_settings


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


def backup_dir() -> Path:
    env = os.environ.get("ASTR_BACKUP_DIR")
    if env:
        return Path(env)
    # 默认落同盘 backups/（P0 起步；生产请用异盘/NAS）
    return get_settings().astr_data_dir / "backups"


def run_backup() -> int:
    _utf8()
    settings = get_settings()
    src = settings.soul_package_dir
    if not src.exists():
        print(f"✗ 源不存在：{src}", file=sys.stderr)
        return 1

    stamp = datetime.now(UTC).strftime("%Y%m%d")
    dest = backup_dir() / f"soul_package_{stamp}"
    dest.mkdir(parents=True, exist_ok=True)
    log = settings.logs_dir / f"backup_{stamp}.log"
    log.parent.mkdir(parents=True, exist_ok=True)

    print(f"备份 {src} → {dest}")
    # robocopy /MIR 镜像；/XD .git 可选保留（这里保留 .git 以便恢复完整 git 历史）
    result = subprocess.run(
        [
            "robocopy",
            str(src),
            str(dest),
            "/MIR",
            "/R:2",
            "/W:2",
            "/NP",
            "/LOG+:" + str(log),
            "/TEE",
        ],
        capture_output=False,
    )
    # robocopy 退出码 <8 = 成功（0=无变化, 1=有拷贝, ...）；>=8 = 出错
    rc = result.returncode
    if rc >= 8:
        print(f"✗ robocopy 出错（exit={rc}），见 {log}", file=sys.stderr)
        return 1
    print(f"✓ 备份完成（robocopy exit={rc}，<8 即成功）。日志：{log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_backup())
