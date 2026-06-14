"""ASTR Core 单测（fakeredis）：worker 消费 user.utterance 后发回 thought/decision/tts；tail 转发。"""

from __future__ import annotations

import asyncio

import fakeredis.aioredis

from astr.bus.core import Bus
from astr.contracts.events import AuthContext, Event, EventType, new_trace_id
from astr.contracts.router import RouteRequest, RouteResponse
from astr.core.worker import handle_utterance


async def _fake_route(req: RouteRequest) -> RouteResponse:
    # 意图分类兜底时返回 chat
    return RouteResponse(
        content="chat", task=req.task, model_key="local-qwen3-8b",
        model="openai/qwen3-8b", tier_used="free", trace_id=req.trace_id,
    )


class _FakeOrch:
    _route_fn = staticmethod(_fake_route)

    async def respond(self, text: str, trace_id: str | None = None, intent: str | None = None):
        return "……行吧，知道了。", {"summary": "[emotion] 安抚", "emotion_estimate": "平淡"}


def _utterance() -> Event:
    return Event(
        source="sensor.cli",
        type=EventType.USER_UTTERANCE,
        payload={"text": "秋秋在吗"},
        auth=AuthContext(astr_user_id="jacksky", level=2),
        trace_id=new_trace_id(),
    )


async def test_worker_emits_decision_and_tts() -> None:
    bus = Bus(fakeredis.aioredis.FakeRedis(decode_responses=True))
    utter = _utterance()
    await handle_utterance(bus, _FakeOrch(), utter)

    history = await bus.replay()
    types = [e.type for e in history]
    assert EventType.SOUL_DECISION in types
    assert EventType.PRESENTATION_TTS in types
    assert EventType.AGENT_THOUGHT in types

    decision = next(e for e in history if e.type == EventType.SOUL_DECISION)
    assert decision.payload["reply_text"] == "……行吧，知道了。"
    assert decision.payload["emotion_tag"] == "平淡"
    assert decision.trace_id == utter.trace_id  # 同一因果链


async def test_tail_forwards_new_events() -> None:
    bus = Bus(fakeredis.aioredis.FakeRedis(decode_responses=True))
    collected: list[Event] = []

    async def consume() -> None:
        async for evt in bus.tail([EventType.SOUL_DECISION], last_id="0", block_ms=50):
            collected.append(evt)
            if len(collected) >= 1:
                return

    await handle_utterance(bus, _FakeOrch(), _utterance())
    await asyncio.wait_for(consume(), timeout=3)
    assert collected[0].type == EventType.SOUL_DECISION
