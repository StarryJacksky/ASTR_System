"""急停（P2-W8）：物理可达的"住手"。

三个触发面：① 全局热键（keyboard 库，默认 Ctrl+Alt+Space——不依赖她正占用的鼠标）；
② Core 端点 POST /v1/effector/estop（网页红钮）；③ 对话里喊停（pending.classify_reply 的 deny 路）。
所有执行循环（dispatcher / cu_engine）每步开工前必须 check()——置位后 <1 步内停手。
"""

from __future__ import annotations

import threading
import time

import structlog

log = structlog.get_logger("astr.effector.estop")

_stopped = threading.Event()
_stopped_at: float = 0.0
_hotkey_started = False


def trigger(source: str = "unknown") -> None:
    global _stopped_at
    _stopped_at = time.time()
    _stopped.set()
    log.warning("emergency_stop_triggered", source=source)


def reset() -> None:
    _stopped.clear()
    log.info("emergency_stop_reset")


def is_stopped() -> bool:
    return _stopped.is_set()


def check() -> None:
    """执行循环每步调用：已急停则抛异常中断当前任务。"""
    if _stopped.is_set():
        raise EmergencyStop("急停已触发，任务中止")


class EmergencyStop(RuntimeError):
    pass


def start_hotkey_listener(hotkey: str | None = None) -> bool:
    """注册全局热键（幂等）。keyboard 库缺失/无权限时降级为 False（网页钮仍可用）。"""
    global _hotkey_started
    if _hotkey_started:
        return True
    from astr.contracts.settings import get_settings

    combo = hotkey or get_settings().estop_hotkey
    try:
        import keyboard  # 懒加载：无此依赖不拦 Core 启动

        keyboard.add_hotkey(combo, lambda: trigger("hotkey"))
        _hotkey_started = True
        log.info("estop_hotkey_registered", hotkey=combo)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("estop_hotkey_unavailable", error=str(e))
        return False


__all__ = ["EmergencyStop", "check", "is_stopped", "reset", "start_hotkey_listener", "trigger"]
