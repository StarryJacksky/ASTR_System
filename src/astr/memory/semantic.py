"""语义记忆（P1-W3）：关于主人的"事实"先进待批队列，经本人 `astr memory review` 确认后入库。

事实是高价值长期记忆（如"他在迁移工作环境"），必须人确认，避免模型把臆测写成事实。
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from astr.contracts.settings import get_settings


def _mem_dir(soul_name: str) -> Path:
    return get_settings().soul_package_dir / soul_name / "memory"


def pending_path(soul_name: str = "justin") -> Path:
    return _mem_dir(soul_name) / "semantic_pending.jsonl"


def kv_path(soul_name: str = "justin") -> Path:
    return _mem_dir(soul_name) / "semantic.kv.jsonl"


def add_pending(soul_name: str, fact: str, *, source_trace: str | None = None) -> None:
    """把一条候选事实加入待批队列。"""
    p = pending_path(soul_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "fact": fact,
        "source_trace": source_trace,
        "created_at": datetime.now(UTC).isoformat(),
    }
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def list_pending(soul_name: str = "justin") -> list[dict]:
    return _read_jsonl(pending_path(soul_name))


def _approve(soul_name: str, row: dict) -> None:
    kp = kv_path(soul_name)
    kp.parent.mkdir(parents=True, exist_ok=True)
    row = {**row, "approved_at": datetime.now(UTC).isoformat()}
    with kp.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def review_cli(soul_name: str = "justin") -> int:
    """astr memory review —— 逐条批准/丢弃待批事实。"""
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass

    pending = list_pending(soul_name)
    if not pending:
        print("（没有待批的语义事实）")
        return 0

    kept: list[dict] = []
    approved = 0
    for i, row in enumerate(pending, 1):
        print(f"\n[{i}/{len(pending)}] {row['fact']}")
        try:
            ans = input("  入库?(y=批准 / n=丢弃 / s=保留待批 / q=退出) ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            ans = "q"
        if ans == "q":
            kept.extend(pending[i - 1 :])
            break
        if ans == "y":
            _approve(soul_name, row)
            approved += 1
        elif ans == "s":
            kept.append(row)
        # n = 丢弃（不保留）

    # 重写待批队列（去掉已处理的）
    pp = pending_path(soul_name)
    if kept:
        pp.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in kept) + "\n", encoding="utf-8"
        )
    elif pp.exists():
        pp.unlink()
    print(f"\n已批准 {approved} 条入库（{kv_path(soul_name)}）。")
    return 0
