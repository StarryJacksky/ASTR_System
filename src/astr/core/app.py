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
    mentioned: bool = False  # 被 @/点名（桥可探测；ASTR 也按名字兜底）
    timeout_s: int = 60


class RespondResponse(BaseModel):
    reply: str
    segments: list[str]  # 分条打字用（拟人化拆分）；向后兼容旧桥
    express: list[dict] = []  # 表达通道（W6-c 降级后）：[{kind,content,...}]，新桥按 kind 发
    emotion_tag: str | None = None
    intent: str | None = None
    trace_id: str
    timed_out: bool = False


class EventRequest(BaseModel):
    kind: str  # group_invite / notice / reaction / social_sync
    inviter_id: str | None = None
    group_id: str | None = None
    group_name: str | None = None
    notice_type: str | None = None  # kicked/muted/unmuted/friend_removed/friend_added/group_left
    where: str = ""  # 群名
    who: str = ""  # 人名
    who_id: str | None = None  # 贴表情的人平台 id（reaction 用，更新好感）
    emoji_id: str | None = None  # 消息表情回应的 emoji/face id（reaction 用）
    friends: list[dict] = []
    groups: list[dict] = []


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
    app.state.engagement = {}  # session_key -> [近期回复时间戳]，给选择性回复门控算冷场/退避
    with contextlib.suppress(Exception):
        from astr.sensors.platform.caps import probe

        probe()  # 启动时落 platform_caps.json（W6-d）
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


def _engagement_decision(req: RespondRequest, settings) -> tuple[bool, str]:
    """选择性回复门控：群里没被点名就按概率决定回不回。返回 (是否回复, session_key)。"""
    import time

    from astr.memory import people
    from astr.soul import emotion, life
    from astr.soul.engagement import EngagementInput, interest_score, should_reply

    is_group = bool(req.group_id)
    prof = people.load(settings.soul_name, req.user_id)
    session_key = (
        f"{req.platform}:group:{req.group_id}" if is_group else f"{req.platform}:{req.user_id}"
    )
    history: list[float] = app.state.engagement.setdefault(session_key, [])
    now = time.time()
    history[:] = [t for t in history if now - t < 120.0]  # 只看近 2 分钟
    since_last = (now - max(history)) if history else 1e9
    mood = emotion.decayed(emotion.load(settings.soul_name))
    mentioned = req.mentioned or any(n in req.text for n in ("秋秋", "露怀秋"))
    ok, _p, _reason = should_reply(
        EngagementInput(
            is_group=is_group,
            mentioned=mentioned,
            level=settings.resolve_level(req.user_id),
            text=req.text,
            talkativeness=mood.talkativeness,
            irritation=mood.irritation,
            loneliness=mood.loneliness,
            seconds_since_last_reply=since_last,
            recent_replies=len(history),
            interest=interest_score(req.text),
            availability=life.availability_now(settings.soul_name),
            familiarity=float(prof.get("familiarity", 0.05)),
            affinity=float(prof.get("affinity", 0.0)),
        )
    )
    return ok, session_key


def _render_express(
    reply: str, emotion_tag: str | None, platform: str, reaction_emoji: str | None = None
) -> list[dict]:
    """灵魂层回复 → 表达意图 → 按平台能力降级后的通道列表（W6-b/c）。"""
    if not reply:
        return []
    from astr.presentation.express import build_express
    from astr.sensors.platform.base import BaseAdapter
    from astr.sensors.platform.caps import load_caps
    from astr.sensors.platform.qq import QQAdapter

    expr = build_express(reply, emotion_tag, platform_hint=platform, reaction_emoji=reaction_emoji)
    adapter = QQAdapter(load_caps(platform)) if platform == "qq" else BaseAdapter()
    return [seg.as_dict() for seg in adapter.render(expr)]


@app.post("/v1/respond", response_model=RespondResponse)
async def respond(req: RespondRequest) -> RespondResponse:
    """同步：注入发言并等待这条因果链的 soul.decision，返回分条好的回复（AstrBot 桥用）。"""
    import time

    from astr.presentation.humanize import split_reply

    settings = get_settings()
    # 选择性回复门控：群里没被点名且掷骰子不中 → 静默（真人不回群里每句话）
    will_reply, session_key = _engagement_decision(req, settings)
    if not will_reply:
        return RespondResponse(reply="", segments=[], trace_id="", timed_out=False)

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
    if reply:
        app.state.engagement.setdefault(session_key, []).append(time.time())  # 记一次回复（退避用）

    emotion_tag = decision.payload.get("emotion_tag")
    reaction_emoji = None
    if reply:
        from astr.memory import people
        from astr.soul import emotion as emo
        from astr.soul.reaction import pick_reaction

        _prof = people.load(settings.soul_name, req.user_id)
        _mood = emo.decayed(emo.load(settings.soul_name))
        reaction_emoji = pick_reaction(
            emotion_tag,
            familiarity=float(_prof.get("familiarity", 0.05)),
            talkativeness=_mood.talkativeness,
        )
    express = _render_express(reply, emotion_tag, req.platform, reaction_emoji)
    return RespondResponse(
        reply=reply,
        segments=split_reply(reply),
        express=express,
        emotion_tag=emotion_tag,
        intent=decision.payload.get("intent"),
        trace_id=trace,
    )


@app.post("/v1/event")
async def platform_event(req: EventRequest) -> dict:
    """平台社交事件入口（AstrBot 桥用）：入群邀请→她自己决策；被踢/禁言/删好友→情绪反应+记忆；好友/群同步。"""
    from astr.memory import people
    from astr.soul import emotion, social

    s = get_settings()

    if req.kind == "group_invite":
        prof = people.load(s.soul_name, req.inviter_id or "")
        mood = emotion.decayed(emotion.load(s.soul_name))
        accept, p, reason = social.should_join_group(
            inviter_level=s.resolve_level(req.inviter_id or ""),
            inviter_familiarity=float(prof.get("familiarity", 0.05)),
            inviter_affinity=float(prof.get("affinity", 0.0)),
            loneliness=mood.loneliness,
            irritation=mood.irritation,
        )
        social.record_social_note(
            s.soul_name,
            f"{'接受' if accept else '拒绝'}了「{req.group_name or req.group_id}」的入群邀请（{reason}，p={p:.2f}）。",
        )
        return {"accept": accept, "p": round(p, 3), "reason": reason}

    if req.kind == "notice":
        r = social.react_to_notice(req.notice_type or "", where=req.where, who=req.who)
        if r["emotion_delta"]:
            new = emotion.apply(emotion.decayed(emotion.load(s.soul_name)), r["emotion_delta"])
            emotion.save(new, s.soul_name)
        social.record_social_note(s.soul_name, r["note"])
        return {"ok": True, "note": r["note"], "emotion_delta": r["emotion_delta"]}

    if req.kind == "reaction":
        r = social.react_to_reaction(req.emoji_id or "", who=req.who)
        if r["emotion_delta"]:
            new = emotion.apply(emotion.decayed(emotion.load(s.soul_name)), r["emotion_delta"])
            emotion.save(new, s.soul_name)
        if req.who_id and r.get("affinity_delta"):
            people.touch(s.soul_name, req.who_id)
            people.apply_valence(s.soul_name, req.who_id, r["affinity_delta"])
        social.record_social_note(s.soul_name, r["note"])
        return {"ok": True, "note": r["note"], "emotion_delta": r["emotion_delta"]}

    if req.kind == "social_sync":
        data = social.sync_social(s.soul_name, req.friends, req.groups)
        return {"ok": True, "friends": len(data["friends"]), "groups": len(data["groups"])}

    return {"ok": False, "error": f"unknown kind: {req.kind}"}


@app.get("/v1/social")
async def social_self() -> dict:
    """她的自我社交认知：有哪些好友、哪些群。"""
    from astr.soul import social

    return social.load_social(get_settings().soul_name)


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
