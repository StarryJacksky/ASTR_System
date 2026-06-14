"""心跳引擎 v1（P1-W5）：随机间隔触发"内心独白"，只想不说。

本期硬编码 should_speak=False（永不外发）——独白只落盘 memory/chunks/monologues/ + 发 monologue 事件（网页可看）。
主动发声 P5 才解锁：先攒 3 个月独白，观察她"想说什么"。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog
from ulid import ULID

from astr.bus.core import Bus
from astr.contracts.events import (
    AgentThoughtPayload,
    AuthContext,
    Event,
    EventType,
    HeartbeatTickPayload,
)
from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import get_settings
from astr.soul import emotion

log = structlog.get_logger("astr.soul.heartbeat")

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]
DEFAULT_INTERVAL_MIN = 30
DEFAULT_JITTER_S = 900  # ±15 分钟随机

_SYSTEM = AuthContext(astr_user_id="system", level=0)


def _time_phase(now: datetime) -> str:
    h = now.astimezone().hour
    return (
        "深夜"
        if h < 5
        else "清晨"
        if h < 9
        else "上午"
        if h < 12
        else "下午"
        if h < 18
        else "晚上"
        if h < 23
        else "深夜"
    )


def _monologue_prompt(mood: emotion.EmotionVector, now: datetime, recent: list[str]) -> str:
    mem = "；".join(recent[:3]) if recent else "没什么新鲜事"
    return (
        f"现在是{_time_phase(now)}。{mood.to_prompt_line()} 最近：{mem}。\n"
        "以露怀秋的口吻，写一句此刻心里冒出来的念头——是内心独白，不是说给谁听的。"
        "一句话，别超过30字，别用星号动作。"
    )


async def generate_monologue(soul_name: str, route_fn: RouteFn, *, adapter=None) -> dict:
    """生成一条内心独白并落盘。should_speak 恒 False。返回记录 dict。"""
    now = datetime.now(UTC)
    mood = emotion.decayed(emotion.load(soul_name))
    recent = adapter.recall("最近发生的事", k=3) if adapter is not None else []

    content = ""
    try:
        resp = await route_fn(
            RouteRequest(
                task="soul_reply",
                messages=[{"role": "user", "content": _monologue_prompt(mood, now, recent)}],
                cost_tier="free",
                trace_id=f"trc_{ULID()}",
                require_local=True,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        content = resp.content.strip().splitlines()[0][:120] if resp.content.strip() else ""
    except Exception as e:  # noqa: BLE001
        log.warning("monologue_gen_failed", error=str(e))

    record = {
        "id": f"mono_{ULID()}",
        "ts": now.isoformat(),
        "content": content,
        "should_speak": False,  # 本期硬编码：永不外发
        "emotion": mood.model_dump(mode="json"),
    }
    if content:
        d = (
            get_settings().soul_package_dir
            / soul_name
            / "memory"
            / "chunks"
            / "monologues"
            / now.strftime("%Y-%m")
        )
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{record['id']}.md").write_text(
            f"<!-- ts={record['ts']} should_speak=false -->\n内心独白：{content}\n",
            encoding="utf-8",
        )
        log.info("monologue", content=content)
    return record


async def tick(bus: Bus, soul_name: str, route_fn: RouteFn, *, adapter=None) -> dict:
    """一次心跳：生成独白 → 发 heartbeat.tick + agent.thought(monologue) 到总线。"""
    record = await generate_monologue(soul_name, route_fn, adapter=adapter)
    trace = f"trc_{ULID()}"
    await bus.publish(
        Event(
            source="soul.heartbeat",
            type=EventType.HEARTBEAT_TICK,
            payload=HeartbeatTickPayload(reason="periodic").model_dump(),
            auth=_SYSTEM,
            trace_id=trace,
        )
    )
    if record["content"]:
        await bus.publish(
            Event(
                source="soul.heartbeat",
                type=EventType.AGENT_THOUGHT,
                payload=AgentThoughtPayload(text=record["content"], stage="monologue").model_dump(),
                auth=_SYSTEM,
                trace_id=trace,
            )
        )
    return record


class Heartbeat:
    """APScheduler 包一层：随机间隔跳动。daemon 启动时 start，关闭时 shutdown。"""

    def __init__(self, bus: Bus, route_fn: RouteFn, *, soul_name: str = "justin", adapter=None):
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        self.bus = bus
        self.route_fn = route_fn
        self.soul_name = soul_name
        self.adapter = adapter
        self.scheduler = AsyncIOScheduler()

    async def _job(self) -> None:
        try:
            await tick(self.bus, self.soul_name, self.route_fn, adapter=self.adapter)
        except Exception:  # noqa: BLE001
            log.exception("heartbeat_job_failed")

    def start(
        self, interval_min: int = DEFAULT_INTERVAL_MIN, jitter_s: int = DEFAULT_JITTER_S
    ) -> None:
        self.scheduler.add_job(self._job, "interval", minutes=interval_min, jitter=jitter_s)
        self.scheduler.start()
        log.info("heartbeat_started", interval_min=interval_min, jitter_s=jitter_s)

    def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
