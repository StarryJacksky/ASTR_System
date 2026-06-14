"""心跳引擎单测（P1-W5）：生成独白落盘（should_speak=False）+ tick 发总线事件。"""

from __future__ import annotations

import fakeredis.aioredis

from astr.bus.core import Bus
from astr.contracts.events import EventType
from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import Settings
from astr.soul import emotion, heartbeat


async def _fake_route(req: RouteRequest) -> RouteResponse:
    return RouteResponse(
        content="夜深了，懒得理人，但脑子停不下来。",
        task=req.task,
        model_key="local-qwen3-8b",
        model="openai/qwen3-8b",
        tier_used="free",
        trace_id=req.trace_id,
    )


async def test_generate_monologue_persists(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        heartbeat, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    monkeypatch.setattr(emotion, "load", lambda *a, **k: emotion.EmotionVector(loneliness=0.7))

    rec = await heartbeat.generate_monologue("justin", _fake_route)
    assert rec["should_speak"] is False  # 本期永不外发
    assert "懒得理人" in rec["content"]

    mono_dir = tmp_path / "soul_package" / "justin" / "memory" / "chunks" / "monologues"
    files = list(mono_dir.rglob("*.md"))
    assert files and "内心独白" in files[0].read_text(encoding="utf-8")


async def test_tick_publishes_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        heartbeat, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    monkeypatch.setattr(emotion, "load", lambda *a, **k: emotion.EmotionVector())

    bus = Bus(fakeredis.aioredis.FakeRedis(decode_responses=True))
    await heartbeat.tick(bus, "justin", _fake_route)

    history = await bus.replay()
    types = [e.type for e in history]
    assert EventType.HEARTBEAT_TICK in types
    assert EventType.AGENT_THOUGHT in types
    thought = next(e for e in history if e.type == EventType.AGENT_THOUGHT)
    assert thought.payload["stage"] == "monologue"
