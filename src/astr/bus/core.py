"""事件总线（02 §1：Redis Streams）。跨层通信的唯一通道——五层解耦的物理实现。

stream key = astr:events；消费组按层命名：cg.soul / cg.effector / cg.presentation / cg.train。
publish / subscribe / replay 三个原语。单测用 fakeredis，无需真 Redis。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

import structlog

from astr.contracts.events import Event, EventType

log = structlog.get_logger("astr.bus")

STREAM_KEY = "astr:events"
Handler = Callable[[Event], Awaitable[None]]


class Bus:
    """Redis Streams 封装。传入任意 redis.asyncio 兼容客户端（真 Redis 或 fakeredis）。"""

    def __init__(self, client: Any, stream: str = STREAM_KEY) -> None:
        self.r = client
        self.stream = stream

    @classmethod
    def from_url(cls, url: str = "redis://127.0.0.1:6379", stream: str = STREAM_KEY) -> Bus:
        import redis.asyncio as aioredis

        return cls(aioredis.Redis.from_url(url, decode_responses=True), stream)

    async def publish(self, event: Event) -> str:
        """发布一条事件，返回 stream 消息 id。"""
        msg_id = await self.r.xadd(self.stream, {"data": event.model_dump_json()})
        log.info("event_published", id=event.id, type=str(event.type), trace_id=event.trace_id)
        return msg_id

    async def ensure_group(self, group: str) -> None:
        """幂等创建消费组（从头消费 id=0）。"""
        try:
            await self.r.xgroup_create(self.stream, group, id="0", mkstream=True)
        except Exception as e:  # noqa: BLE001 —— BUSYGROUP = 已存在，忽略
            if "BUSYGROUP" not in str(e):
                raise

    async def read_once(
        self,
        group: str,
        consumer: str = "c1",
        *,
        count: int = 10,
        block_ms: int = 1000,
    ) -> list[tuple[str, Event]]:
        """读一批未消费消息，返回 [(msg_id, Event)]。供 subscribe 循环与测试复用。"""
        await self.ensure_group(group)
        resp = await self.r.xreadgroup(
            group, consumer, {self.stream: ">"}, count=count, block=block_ms
        )
        out: list[tuple[str, Event]] = []
        for _stream, messages in resp or []:
            for msg_id, fields in messages:
                data = fields.get("data") if isinstance(fields, dict) else fields[b"data"]
                out.append((msg_id, Event.model_validate_json(data)))
        return out

    async def ack(self, group: str, msg_id: str) -> None:
        await self.r.xack(self.stream, group, msg_id)

    async def subscribe(
        self,
        group: str,
        types: Iterable[EventType] | None,
        handler: Handler,
        *,
        consumer: str = "c1",
        stop: asyncio.Event | None = None,
    ) -> None:
        """长驻订阅循环：按 type 过滤后调 handler，处理完 XACK。types=None 收全部。"""
        wanted = set(types) if types else None
        await self.ensure_group(group)
        while stop is None or not stop.is_set():
            batch = await self.read_once(group, consumer, block_ms=1000)
            for msg_id, event in batch:
                if wanted is not None and event.type not in wanted:
                    await self.ack(group, msg_id)
                    continue
                try:
                    await handler(event)
                finally:
                    await self.ack(group, msg_id)

    async def replay(self, since: str = "-", until: str = "+") -> list[Event]:
        """回放历史事件（审计/重建用）。since/until 为 stream id，默认全量。"""
        entries = await self.r.xrange(self.stream, min=since, max=until)
        events: list[Event] = []
        for _msg_id, fields in entries:
            data = fields.get("data") if isinstance(fields, dict) else fields[b"data"]
            events.append(Event.model_validate_json(data))
        return events
