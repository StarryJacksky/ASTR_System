"""P0-T09 验收：发布一条事件并由消费组读回（需真 Redis：docker compose up -d redis）。

uv run python -m astr.bus.demo
"""

from __future__ import annotations

import asyncio
import sys

from astr.bus.core import Bus
from astr.contracts.events import AuthContext, Event, EventType, new_trace_id


async def main() -> int:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass

    bus = Bus.from_url()
    evt = Event(
        source="bus.demo",
        type=EventType.USER_UTTERANCE,
        payload={"text": "总线自检：秋秋你听得见吗"},
        auth=AuthContext(astr_user_id="jacksky", level=2),
        trace_id=new_trace_id(),
    )
    await bus.publish(evt)
    received = await bus.read_once("cg.soul", block_ms=500)
    for msg_id, _got in received:
        await bus.ack("cg.soul", msg_id)
    ok = any(g.id == evt.id for _, g in received)
    print(f"发布 id={evt.id}")
    print(f"读回 {len(received)} 条；命中自己发的事件：{ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
