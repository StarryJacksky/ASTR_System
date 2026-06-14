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


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    bus = Bus.from_url()
    stop = asyncio.Event()
    app.state.bus = bus
    app.state.stop = stop
    app.state.worker = asyncio.create_task(run_worker(bus, stop=stop))
    log.info("astr_core_started", port=8300)
    try:
        yield
    finally:
        stop.set()
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
    s = get_settings()
    return {
        "soul_name": s.soul_name,
        "local_llm_model": s.local_llm_model,
        "cost_today_usd": round(ledger.today_total_usd(), 6),
        "daily_budget_usd": s.astr_daily_budget_usd,
        "emotion": None,  # P1-W4
    }
