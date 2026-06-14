"""意图路由 v1（P1-W2-a）：规则前置 + 本地模型兜底，给每条发言打一个意图标签。

标签：tool / research / coding / emotion / silent_observe / chat。
tool/research 本期只打标记不分发（执行层 P2 才有）；silent_observe 表示不主动回应（只观察沉淀）。
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Literal

import structlog

from astr.contracts.router import RouteRequest, RouteResponse

log = structlog.get_logger("astr.soul.intent")

IntentLabel = Literal["tool", "research", "coding", "emotion", "silent_observe", "chat"]
LABELS: tuple[IntentLabel, ...] = (
    "tool",
    "research",
    "coding",
    "emotion",
    "silent_observe",
    "chat",
)
ACTION_INTENTS: frozenset[str] = frozenset({"tool", "research", "coding"})

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]

# 规则前置：命中即定，省一次模型调用。顺序敏感（先特异后宽泛）。
_RULES: list[tuple[IntentLabel, re.Pattern]] = [
    (
        "tool",
        re.compile(
            r"(帮我|给我|替我).*(打开|关闭|调用|设(个|一?下)?闹钟|提醒|归类|整理|存进|保存|截图|发送|画|搜索|查一下)|^/"
        ),
    ),
    (
        "coding",
        re.compile(r"(报错|bug|debug|函数|脚本|编译|代码|traceback|exception|报错信息|跑不起来)"),
    ),
    ("research", re.compile(r"(论文|文献|复现|证明一下|推导|paper|arxiv|做个研究|综述)")),
]


def rule_classify(text: str) -> IntentLabel | None:
    """规则匹配，命中返回标签，否则 None（交给模型兜底）。"""
    t = text.strip()
    for label, pat in _RULES:
        if pat.search(t):
            return label
    return None


_CLASSIFY_PROMPT = (
    "把下面这句话归到唯一一个意图标签，只输出标签本身，不要任何解释。"
    "可选：tool（要执行动作/用工具）、coding（编程/调错）、research（学术/文献/复现）、"
    "emotion（倾诉/情绪/安抚）、chat（普通闲聊/提问）。\n句子："
)


async def _model_classify(text: str, trace_id: str, route_fn: RouteFn) -> IntentLabel:
    try:
        resp = await route_fn(
            RouteRequest(
                task="intent",
                messages=[{"role": "user", "content": _CLASSIFY_PROMPT + text}],
                cost_tier="free",
                trace_id=trace_id,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
    except Exception as e:  # noqa: BLE001
        log.warning("intent_model_failed", error=str(e))
        return "chat"
    out = resp.content.strip().lower()
    for label in LABELS:
        if label in out:
            return label  # type: ignore[return-value]
    return "chat"


async def classify_intent(text: str, trace_id: str, *, route_fn: RouteFn) -> IntentLabel:
    """规则优先，未命中走本地模型兜底；空串视为 silent_observe。"""
    if not text.strip():
        return "silent_observe"
    ruled = rule_classify(text)
    if ruled is not None:
        return ruled
    label = await _model_classify(text, trace_id, route_fn)
    log.info("intent_classified", label=label)
    return label
