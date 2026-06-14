"""P0-T04 验收 smoke：对 本地 / DeepSeek / Claude 各发一条 ping，验证三路通 + 入账。

    uv run python -m astr.router.smoke

需要 .env 里相应 key（本地路只需 llama-server 在跑）。任一路失败会打印原因但不中断其余。
"""

from __future__ import annotations

import asyncio
import sys

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
    cases = [
        (
            "本地 qwen3-8b",
            RouteRequest(
                task="soul_reply",
                cost_tier="free",
                messages=[{"role": "user", "content": "用一个字回复：ping"}],
                trace_id=new_trace_id(),
            ),
        ),
        (
            "DeepSeek",
            RouteRequest(
                task="emotion_analysis",
                cost_tier="cheap",
                messages=[{"role": "user", "content": "ping"}],
                trace_id=new_trace_id(),
            ),
        ),
        (
            "Claude",
            RouteRequest(
                task="soul_reply",
                cost_tier="max",
                messages=[{"role": "user", "content": "ping"}],
                trace_id=new_trace_id(),
            ),
        ),
    ]
    ok = 0
    for label, req in cases:
        try:
            resp = await route(req)
            ok += 1
            print(
                f"[OK] {label:<14} model={resp.model_key:<16} "
                f"tokens={resp.tokens_in}+{resp.tokens_out} ${resp.cost_usd:.6f}"
                f"{' degraded' if resp.degraded else ''}"
            )
            print(f"     → {resp.content[:60]!r}")
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {label:<14} {type(e).__name__}: {e}")
    print(f"\n{ok}/{len(cases)} 路通。明细见 `uv run astr cost today`。")
    return 0 if ok == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
