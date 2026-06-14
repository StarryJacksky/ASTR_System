"""astr chat —— soul_demo 的终端对话循环（P0-T08）。

每轮打印 MoA 圆桌纪要摘要（debug 行）+ 露怀秋 回复。需本地 llama-server（T03）+ MoA 的云 key。
"""

from __future__ import annotations

import asyncio
import sys

from astr.contracts.events import new_trace_id
from astr.soul.orchestrator import SoulOrchestrator


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


async def _loop() -> None:
    print("正在唤醒露怀秋（秋秋）……")
    orch = SoulOrchestrator("justin")
    print(f"已就位（{orch.handle.adapter_name}）。输入对话，:q 退出。\n")
    while True:
        try:
            text = input("你 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if text in (":q", "exit", "quit"):
            break
        if not text:
            continue
        try:
            reply, report = await orch.respond(text, trace_id=new_trace_id())
        except Exception as e:  # noqa: BLE001
            print(f"[出错：{type(e).__name__}: {e}]")
            print("→ 多半是本地 llama-server 未启动（T03）或 MoA 的云 key 未配（T04/.env）。\n")
            continue
        print(
            f"  [MoA 情绪={report.get('emotion_estimate') or '—'} "
            f"意图={report.get('intent') or '—'} 风险={report.get('risk_flags')}]"
        )
        print(f"露怀秋 > {reply}\n")


def chat_loop() -> int:
    _utf8()
    try:
        asyncio.run(_loop())
    except KeyboardInterrupt:
        pass
    print("（秋秋先撤了。）")
    return 0
