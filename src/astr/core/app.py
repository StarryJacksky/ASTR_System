"""ASTR Core 守护进程（P1-W1-a，FastAPI :8300）。实现 03 §5 的 /v1/ingest /v1/status /v1/stream。

ingest 收文本 → 造 user.utterance 事件 → 总线；后台 worker 消费并发回 thought/decision/tts；
stream 把 agent.thought / soul.decision 以 SSE 推给网页。
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

import structlog
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from astr.bus.core import Bus
from astr.contracts.events import (
    AuthContext,
    Event,
    EventType,
    UserUtterancePayload,
    new_trace_id,
)
from astr.contracts.settings import get_settings
from astr.core.worker import run_worker
from astr.ops import ledger

log = structlog.get_logger("astr.core")

SSE_TYPES = [EventType.AGENT_THOUGHT, EventType.SOUL_DECISION, EventType.PRESENTATION_EXPRESS]


class IngestRequest(BaseModel):
    text: str
    platform: str = "cli"
    lang: str = "zh"
    user_id: str = "jacksky"  # 等级由白名单解析，不信任客户端自报


class IngestResponse(BaseModel):
    event_id: str
    trace_id: str


class RespondRequest(BaseModel):
    text: str
    platform: str = "qq"
    lang: str = "zh"
    user_id: str = "jacksky"  # 统一会话键；等级由白名单解析
    group_id: str | None = None
    timeout_s: int = 60


class RespondResponse(BaseModel):
    reply: str
    segments: list[str]  # 分条打字用（拟人化拆分）
    emotion_tag: str | None = None
    intent: str | None = None
    trace_id: str
    timed_out: bool = False


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from astr.router.core import route as route_fn
    from astr.soul.heartbeat import Heartbeat

    bus = Bus.from_url()
    stop = asyncio.Event()
    app.state.bus = bus
    app.state.stop = stop
    app.state.worker = asyncio.create_task(run_worker(bus, stop=stop))
    app.state.heartbeat = Heartbeat(bus, route_fn, soul_name=get_settings().soul_name)
    app.state.heartbeat.start()
    log.info("astr_core_started", port=8300)
    try:
        yield
    finally:
        stop.set()
        app.state.heartbeat.shutdown()
        app.state.worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.worker


app = FastAPI(title="ASTR Core", version="0.1.0", lifespan=lifespan)


@app.post("/v1/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """注入一条用户发言（平台桥/调试用）。"""
    evt = Event(
        source=f"sensor.{req.platform}",
        type=EventType.USER_UTTERANCE,
        payload=UserUtterancePayload(
            text=req.text, platform=req.platform, lang=req.lang
        ).model_dump(),
        auth=AuthContext(astr_user_id=req.user_id, level=get_settings().resolve_level(req.user_id)),
        trace_id=new_trace_id(),
    )
    await app.state.bus.publish(evt)
    return IngestResponse(event_id=evt.id, trace_id=evt.trace_id)


@app.post("/v1/respond", response_model=RespondResponse)
async def respond(req: RespondRequest) -> RespondResponse:
    """同步：注入发言并等待这条因果链的 soul.decision，返回分条好的回复（AstrBot 桥用）。"""
    from astr.presentation.humanize import split_reply

    bus: Bus = app.state.bus
    trace = new_trace_id()
    # 先锚定当前流末尾，避免发布后再订阅丢事件
    last = await bus.r.xrevrange(bus.stream, count=1)
    start_id = last[0][0] if last else "0"

    evt = Event(
        source=f"sensor.{req.platform}",
        type=EventType.USER_UTTERANCE,
        payload=UserUtterancePayload(
            text=req.text, platform=req.platform, lang=req.lang
        ).model_dump(),
        auth=AuthContext(astr_user_id=req.user_id, level=get_settings().resolve_level(req.user_id)),
        trace_id=trace,
    )
    await bus.publish(evt)

    async def _wait() -> Event | None:
        async for d in bus.tail([EventType.SOUL_DECISION], last_id=start_id):
            if d.trace_id == trace:
                return d
        return None

    try:
        decision = await asyncio.wait_for(_wait(), timeout=req.timeout_s)
    except TimeoutError:
        decision = None

    if decision is None:
        return RespondResponse(reply="", segments=[], trace_id=trace, timed_out=True)
    reply = decision.payload.get("reply_text", "")
    return RespondResponse(
        reply=reply,
        segments=split_reply(reply),
        emotion_tag=decision.payload.get("emotion_tag"),
        intent=decision.payload.get("intent"),
        trace_id=trace,
    )


@app.get("/v1/stream")
async def stream() -> StreamingResponse:
    """SSE：把思考片段与最终决断实时推给网页。"""
    bus: Bus = app.state.bus

    async def gen() -> AsyncIterator[str]:
        yield ": connected\n\n"
        async for evt in bus.tail(SSE_TYPES):
            yield f"event: {evt.type.value}\ndata: {evt.model_dump_json()}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/v1/status")
async def status() -> dict:
    """当前躯壳、当日花费、预算（情绪向量 P1-W4 接入）。"""
    from astr.soul import emotion

    s = get_settings()
    mood = emotion.decayed(emotion.load(s.soul_name))
    return {
        "soul_name": s.soul_name,
        "local_llm_model": s.local_llm_model,
        "cost_today_usd": round(ledger.today_total_usd(), 6),
        "daily_budget_usd": s.astr_daily_budget_usd,
        "emotion": mood.model_dump(mode="json"),
    }
