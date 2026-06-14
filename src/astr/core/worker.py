"""灵魂消费者（P1-W1-b）：把 orchestrator 接到总线上。

订阅 user.utterance → 跑一次 respond → 把"思考片段 / 最终决断 / 待合成语音"作为事件发回总线。
网页 SSE 订阅 agent.thought / soul.decision；TTS 管线（P1-W8）订阅 presentation.tts。
"""

from __future__ import annotations

import asyncio

import structlog

from astr.bus.core import Bus
from astr.contracts.events import (
    AgentThoughtPayload,
    Event,
    EventType,
    PresentationTtsPayload,
    SoulDecisionPayload,
)
from astr.soul.intent import classify_intent
from astr.soul.orchestrator import SoulOrchestrator

log = structlog.get_logger("astr.core.worker")

SOUL_GROUP = "cg.soul"


def _emit(bus: Bus, src_event: Event, etype: EventType, payload: dict) -> asyncio.Future:
    """基于来访事件的 auth/trace_id 派生一条新事件并发布（同一因果链）。"""
    evt = Event(
        source="soul.orchestrator",
        type=etype,
        payload=payload,
        auth=src_event.auth,
        trace_id=src_event.trace_id,
    )
    return bus.publish(evt)


async def handle_utterance(bus: Bus, orch: SoulOrchestrator, event: Event) -> None:
    """处理一条用户发言：分析→作答→把过程与结果发回总线。"""
    text = event.payload.get("text", "")
    if not text:
        return

    intent = await classify_intent(text, event.trace_id, route_fn=orch._route_fn)
    await _emit(
        bus,
        event,
        EventType.AGENT_THOUGHT,
        AgentThoughtPayload(text=f"（意图：{intent}）", stage="intent").model_dump(),
    )
    if intent == "silent_observe":
        log.info("utterance_observed_silently", trace_id=event.trace_id)
        return

    reply, report = await orch.respond(text, trace_id=event.trace_id, intent=intent)

    if report.get("summary"):
        await _emit(
            bus,
            event,
            EventType.AGENT_THOUGHT,
            AgentThoughtPayload(text=report["summary"], stage="moa").model_dump(),
        )

    emotion = report.get("emotion_estimate")
    await _emit(
        bus,
        event,
        EventType.SOUL_DECISION,
        SoulDecisionPayload(reply_text=reply, emotion_tag=emotion, intent=intent).model_dump(),
    )
    await _emit(
        bus,
        event,
        EventType.PRESENTATION_TTS,
        PresentationTtsPayload(text=reply, emotion_tag=emotion).model_dump(),
    )
    log.info("utterance_handled", trace_id=event.trace_id, intent=intent, reply_chars=len(reply))


async def run_worker(
    bus: Bus,
    orch: SoulOrchestrator | None = None,
    *,
    stop: asyncio.Event | None = None,
) -> None:
    """长驻：订阅 user.utterance，逐条交给 orchestrator 处理。"""
    orch = orch or SoulOrchestrator("justin")

    async def handler(event: Event) -> None:
        try:
            await handle_utterance(bus, orch, event)
        except Exception:  # noqa: BLE001 —— 单条失败不拖垮消费循环
            log.exception("utterance_handler_failed", trace_id=event.trace_id)

    log.info("soul_worker_started", group=SOUL_GROUP)
    await bus.subscribe(SOUL_GROUP, [EventType.USER_UTTERANCE], handler, stop=stop)
