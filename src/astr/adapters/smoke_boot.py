"""P0-T07 验收：打印完整 system prompt + 一次本地模型对话。

    uv run python -m astr.adapters.smoke_boot

对话部分需要本地 llama-server 在跑（T03）；端点不通会打印错误但仍先展示 system prompt。
"""

from __future__ import annotations

import asyncio
import sys

from astr.adapters.prompt_boot import PromptBootAdapter
from astr.contracts.events import new_trace_id
from astr.contracts.router import RouteRequest
from astr.router.core import route


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


async def main() -> int:
    _utf8()
    adapter = PromptBootAdapter("justin")
    handle = adapter.cold_boot()

    print("=" * 70)
    print(f"ADAPTER: {handle.adapter_name}   ENDPOINT: {handle.endpoint}")
    print("=" * 70)
    print(handle.system_prompt)
    print("=" * 70)

    req = RouteRequest(
        task="soul_reply",
        cost_tier="free",
        require_local=True,
        messages=[
            {"role": "system", "content": handle.system_prompt},
            {"role": "user", "content": "秋秋，第一次见面，简单介绍下你自己。"},
        ],
        trace_id=new_trace_id(),
    )
    try:
        resp = await route(req)
        print("露怀秋：", resp.content)
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"[本地对话失败，预计因 llama-server 未启动] {type(e).__name__}: {e}")
        print("→ 先完成 P0-T03（起本地端点）后再跑本 smoke 的对话部分。")
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
