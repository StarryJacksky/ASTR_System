"""API 成本账本（03 §4 规则 2）。SQLite WAL，每次云调用记一行；预算闸读它算当日累计。"""

from __future__ import annotations

import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from astr.contracts.settings import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS api_ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT    NOT NULL,
    trace_id   TEXT    NOT NULL,
    task       TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd   REAL    NOT NULL DEFAULT 0.0,
    degraded   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON api_ledger(ts);
"""


def _db_path() -> Path:
    return get_settings().ledger_db


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript(_SCHEMA)
    return conn


def record(
    *,
    trace_id: str,
    task: str,
    model: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: float = 0.0,
    degraded: bool = False,
    db_path: Path | None = None,
) -> None:
    """写一条账本记录。每个对外花钱的调用都要落一条（02 §3-4）。"""
    conn = _connect(db_path)
    try:
        conn.execute(
            "INSERT INTO api_ledger (ts, trace_id, task, model, tokens_in, tokens_out, cost_usd, degraded)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                datetime.now(UTC).isoformat(),
                trace_id,
                task,
                model,
                tokens_in,
                tokens_out,
                cost_usd,
                int(degraded),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def today_total_usd(db_path: Path | None = None) -> float:
    """当日（UTC）累计花费。预算闸用它判断降档。"""
    conn = _connect(db_path)
    try:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        cur = conn.execute(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM api_ledger WHERE ts LIKE ?",
            (f"{today}%",),
        )
        return float(cur.fetchone()[0])
    finally:
        conn.close()


def today_rows(db_path: Path | None = None) -> list[tuple]:
    conn = _connect(db_path)
    try:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        cur = conn.execute(
            "SELECT ts, task, model, tokens_in, tokens_out, cost_usd, degraded"
            " FROM api_ledger WHERE ts LIKE ? ORDER BY ts",
            (f"{today}%",),
        )
        return cur.fetchall()
    finally:
        conn.close()


def cost_today_cli() -> int:
    """astr cost today —— 打印当日每条记录与累计。"""
    for stream in (sys.stdout, sys.stderr):
        rc = getattr(stream, "reconfigure", None)
        if rc is not None:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass

    rows = today_rows()
    budget = get_settings().astr_daily_budget_usd
    total = sum(r[5] for r in rows)
    print(f"=== ASTR 当日成本（预算 ${budget:.2f}）===")
    if not rows:
        print("（今日暂无记录）")
    for ts, task, model, ti, to, cost, degraded in rows:
        flag = " [degraded]" if degraded else ""
        print(f"  {ts}  {task:<20} {model:<24} in={ti:<6} out={to:<6} ${cost:.6f}{flag}")
    print(
        f"--- 合计 ${total:.6f}  /  预算 ${budget:.2f}  ({total / budget * 100:.1f}%) ---"
        if budget > 0
        else f"--- 合计 ${total:.6f} ---"
    )
    return 0
