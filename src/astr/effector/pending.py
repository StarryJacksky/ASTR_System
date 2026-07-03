"""待确认动作存储（P2 危险动作 L3 流程的会话侧）。

护栏判 confirm 后不弹系统窗——她在对话里问你（"确定哈，确定我就发了哦"），
你回一句肯定（"确认/发吧/删吧"）就执行、否定（"算了/取消"）就撤。
单进程内存表 + TTL：确认必须发生在提出后 10 分钟内，过期作废（防隔夜误触发）。
"""

from __future__ import annotations

import time

from pydantic import BaseModel

from astr.effector.toolkit import ToolCall

TTL_S = 600

_AFFIRM = (
    "确认",
    "确定",
    "发吧",
    "删吧",
    "可以",
    "行",
    "好",
    "嗯",
    "是的",
    "ok",
    "OK",
    "干吧",
    "动手",
)
_DENY = ("算了", "取消", "别", "不用", "不要", "先不", "停")


class PendingAction(BaseModel):
    call: ToolCall
    summary: str  # 她向主人复述的动作描述
    ts: float
    trace_id: str


_pending: dict[str, PendingAction] = {}  # speaker → 待确认动作（一人同时只挂一件）


def put(speaker: str, action: PendingAction) -> None:
    _pending[speaker] = action


def get(speaker: str) -> PendingAction | None:
    a = _pending.get(speaker)
    if a and time.time() - a.ts > TTL_S:
        _pending.pop(speaker, None)
        return None
    return a


def pop(speaker: str) -> PendingAction | None:
    a = get(speaker)
    _pending.pop(speaker, None)
    return a


def clear() -> None:
    _pending.clear()


def classify_reply(text: str) -> str:
    """主人对待确认动作的答复 → confirm / deny / other。只对短句判定（长句是新话题）。"""
    t = text.strip().lower()
    if len(t) > 12:
        return "other"
    if any(w in t for w in _DENY):
        return "deny"
    if any(w.lower() in t for w in _AFFIRM):
        return "confirm"
    return "other"


__all__ = ["PendingAction", "classify_reply", "clear", "get", "pop", "put"]
