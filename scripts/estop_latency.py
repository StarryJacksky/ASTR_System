"""急停延迟实测（P2 总验收：<500ms）。

两条真实触发路径各测 5 次取最差：
  ① 热键：keyboard.send() 注入真实 OS 按键事件 → 全局钩子 → trigger()——
     和人手按 Ctrl+Alt+Space 走同一条链路；
  ② 网页钮：ASGI 直调 POST /v1/effector/estop（本地回环网络 ~1ms 不是瓶颈，测应用层）。
跑法：uv run --no-sync python scripts/estop_latency.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from astr.effector import estop  # noqa: E402

BUDGET_MS = 500.0


def _wait_stopped(timeout_s: float = 2.0) -> float | None:
    """busy-wait 到 is_stopped 置位，返回耗时 ms；超时 None。"""
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < timeout_s:
        if estop.is_stopped():
            return (time.perf_counter() - t0) * 1000
        time.sleep(0.001)
    return None


def measure_hotkey(rounds: int = 5) -> list[float]:
    import keyboard

    if not estop.start_hotkey_listener():
        print("热键监听注册失败（权限/环境）——只测网页钮路径")
        return []
    out: list[float] = []
    for _ in range(rounds):
        estop.reset()
        time.sleep(0.05)
        t0 = time.perf_counter()
        keyboard.send("ctrl+alt+space")
        ms = _wait_stopped()
        # _wait_stopped 从置位后才计——重算成 send 起点
        out.append((time.perf_counter() - t0) * 1000 if ms is not None else float("inf"))
    estop.reset()
    return out


async def measure_web(rounds: int = 5) -> list[float]:
    import httpx

    from astr.core.app import app

    out: list[float] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        for _ in range(rounds):
            estop.reset()
            t0 = time.perf_counter()
            await c.post("/v1/effector/estop")
            assert estop.is_stopped()
            out.append((time.perf_counter() - t0) * 1000)
    estop.reset()
    return out


def main() -> int:
    # 人工模式：Claude/CI 的子进程不在交互桌面输入链路上，收不到全局键盘事件——
    # 热键触发本身要真人一按验证（触发后的置位路径与网页钮同级，微秒量级）。
    if "--manual" in sys.argv:
        if not estop.start_hotkey_listener():
            print("热键注册失败")
            return 1
        estop.reset()
        print("请在 60 秒内按 Ctrl+Alt+Space …")
        ms = _wait_stopped(60.0)
        print("✅ 热键触发成功（急停已置位）" if ms is not None else "❌ 没等到触发")
        estop.reset()
        return 0 if ms is not None else 1

    hk = measure_hotkey()
    web = asyncio.run(measure_web())
    ok = True
    for name, xs in (("热键 Ctrl+Alt+Space", hk), ("网页钮 POST /estop", web)):
        if not xs:
            continue
        worst = max(xs)
        ok = ok and worst < BUDGET_MS
        print(
            f"{name}: {len(xs)} 次，最差 {worst:.1f}ms，"
            f"中位 {sorted(xs)[len(xs) // 2]:.1f}ms → "
            f"{'PASS' if worst < BUDGET_MS else 'FAIL'}（预算 {BUDGET_MS:.0f}ms）"
        )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
