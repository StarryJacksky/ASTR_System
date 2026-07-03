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
    MoaReportPayload,
    PresentationTtsPayload,
    SoulDecisionPayload,
    SoulStreamPayload,
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

    # 流式增量帧（99 #19①）：网页气泡逐字生长、Live2D 嘴型随流动；终稿仍以 soul.decision 为准
    seq = 0

    async def _stream_sink(delta: str) -> None:
        nonlocal seq
        seq += 1
        await _emit(
            bus, event, EventType.SOUL_STREAM, SoulStreamPayload(delta=delta, seq=seq).model_dump()
        )

    # L2 研讨实时外发（08 §3）：管家与她的每条讨论发言流进生活区
    async def _discussion_emit(seat: str, text_: str) -> None:
        await _emit(
            bus,
            event,
            EventType.AGENT_THOUGHT,
            AgentThoughtPayload(text=text_, stage="discussion", seat=seat).model_dump(),
        )

    reply, report = await orch.respond(
        text,
        trace_id=event.trace_id,
        intent=intent,
        speaker=event.auth.astr_user_id,
        speaker_level=event.auth.level,
        is_group=bool(event.payload.get("is_group")),
        recent=event.payload.get("recent") or None,
        stream_sink=_stream_sink,
        discussion_emit=_discussion_emit,
    )
    if seq:  # 发过流帧才补终帧（告诉前端"这句说完了"）
        await _emit(
            bus, event, EventType.SOUL_STREAM, SoulStreamPayload(seq=seq + 1, done=True).model_dump()
        )

    if report.get("summary"):
        await _emit(
            bus,
            event,
            EventType.AGENT_THOUGHT,
            AgentThoughtPayload(text=report["summary"], stage="moa").model_dump(),
        )
    if report.get("seats"):  # 管家团各席发言 → 网页圆桌面板
        await _emit(
            bus,
            event,
            EventType.MOA_REPORT,
            MoaReportPayload(
                summary=report.get("summary", ""),
                seats=report.get("seats", []),
                intent=report.get("intent"),
                emotion_estimate=report.get("emotion_estimate"),
                suggested_strategy=report.get("suggested_strategy", ""),
                risk_flags=report.get("risk_flags", []),
            ).model_dump(),
        )

    emotion = report.get("emotion_estimate")
    await _emit(
        bus,
        event,
        EventType.SOUL_DECISION,
        SoulDecisionPayload(
            reply_text=reply,
            emotion_tag=emotion,
            intent=intent,
            emotion_delta=report.get("emotion_delta"),
        ).model_dump(),
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
    max_concurrency: int = 4,
) -> None:
    """长驻：消费 user.utterance，并行交给 orchestrator（多条同时各跑完整 MoA，跟得上群聊快节奏）。

    并发上限 max_concurrency 防止云调用爆量；情绪/关系文件的读改写在 orchestrator 内有锁保护。
    """
    orch = orch or SoulOrchestrator("justin")
    sem = asyncio.Semaphore(max_concurrency)
    await bus.ensure_group(SOUL_GROUP)
    tasks: set[asyncio.Task] = set()

    async def _process(msg_id: str, event: Event) -> None:
        async with sem:
            try:
                await handle_utterance(bus, orch, event)
            except Exception:  # noqa: BLE001 —— 单条失败不拖垮其它并行回复
                log.exception("utterance_handler_failed", trace_id=event.trace_id)
            finally:
                await bus.ack(SOUL_GROUP, msg_id)

    log.info("soul_worker_started", group=SOUL_GROUP, max_concurrency=max_concurrency)
    while stop is None or not stop.is_set():
        batch = await bus.read_once(SOUL_GROUP, block_ms=1000)
        for msg_id, event in batch:
            if event.type != EventType.USER_UTTERANCE:
                await bus.ack(SOUL_GROUP, msg_id)
                continue
            t = asyncio.create_task(_process(msg_id, event))
            tasks.add(t)
            t.add_done_callback(tasks.discard)
    if tasks:  # 收尾：等在途的并行回复跑完
        await asyncio.gather(*tasks, return_exceptions=True)
