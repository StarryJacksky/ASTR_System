"""事件总线单测（fakeredis，无需真 Redis）：往返 / 回放 / 类型过滤。"""

from __future__ import annotations

import asyncio

import fakeredis.aioredis

from astr.bus.core import Bus
from astr.contracts.events import AuthContext, Event, EventType, new_trace_id


def _event(et: EventType, text: str = "hi") -> Event:
    return Event(
        source="test",
        type=et,
        payload={"text": text},
        auth=AuthContext(astr_user_id="jacksky", level=2),
        trace_id=new_trace_id(),
    )


def _client() -> fakeredis.aioredis.FakeRedis:
    return fakeredis.aioredis.FakeRedis(decode_responses=True)


async def test_publish_read_roundtrip() -> None:
    bus = Bus(_client())
    evt = _event(EventType.USER_UTTERANCE, "秋秋在吗")
    await bus.publish(evt)
    received = await bus.read_once("cg.soul", block_ms=50)
    assert len(received) == 1
    msg_id, got = received[0]
    assert got.id == evt.id
    assert got.payload["text"] == "秋秋在吗"
    await bus.ack("cg.soul", msg_id)


async def test_replay_returns_all() -> None:
    bus = Bus(_client())
    await bus.publish(_event(EventType.USER_UTTERANCE, "a"))
    await bus.publish(_event(EventType.AGENT_THOUGHT, "b"))
    history = await bus.replay()
    assert len(history) == 2
    assert [e.payload["text"] for e in history] == ["a", "b"]


async def test_subscribe_filters_types() -> None:
    bus = Bus(_client())
    await bus.publish(_event(EventType.USER_UTTERANCE, "keep"))
    await bus.publish(_event(EventType.AGENT_THOUGHT, "drop"))

    got: list[Event] = []
    stop = asyncio.Event()

    async def handler(e: Event) -> None:
        got.append(e)

    task = asyncio.create_task(
        bus.subscribe("cg.test", [EventType.USER_UTTERANCE], handler, stop=stop)
    )
    await asyncio.sleep(0.3)
    stop.set()
    await asyncio.wait_for(task, timeout=3)

    assert len(got) == 1
    assert got[0].type == EventType.USER_UTTERANCE
    assert got[0].payload["text"] == "keep"
