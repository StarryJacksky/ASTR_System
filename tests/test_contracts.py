"""锁住事件/灵魂契约的 schema —— 破坏性改名/删字段会在 CI 当场暴露。"""

from __future__ import annotations

from datetime import UTC, datetime

from astr.contracts.events import (
    PAYLOAD_MODELS,
    AuthContext,
    Event,
    EventType,
    ExpressChannel,
    ExpressPayload,
    UserUtterancePayload,
    new_trace_id,
)
from astr.contracts.soul import SoulManifest, default_soul_version


def test_event_roundtrip() -> None:
    payload = UserUtterancePayload(text="秋秋", platform="cli")
    evt = Event(
        source="sensor.cli",
        type=EventType.USER_UTTERANCE,
        payload=payload.model_dump(),
        auth=AuthContext(astr_user_id="jacksky", level=2),
        trace_id=new_trace_id(),
    )
    assert evt.id.startswith("evt_")
    assert evt.trace_id.startswith("trc_")
    assert evt.schema_version == "1.0"
    # JSON 可序列化（总线落盘要求）
    dumped = evt.model_dump_json()
    assert "user.utterance" in dumped


def test_all_event_types_have_payload_model() -> None:
    for et in EventType:
        assert et in PAYLOAD_MODELS, f"{et} 缺 payload 模型"


def test_express_payload_fallback_field() -> None:
    # 永不丢消息：每个通道都有 fallback_text 字段
    ch = ExpressChannel(kind="sticker", emotion="傲娇", fallback_text="哼。")
    p = ExpressPayload(channels=[ch])
    assert p.channels[0].fallback_text == "哼。"


def test_soul_manifest_schema() -> None:
    m = SoulManifest(
        soul_version=default_soul_version("justin"),
        created_at=datetime.now(UTC),
        current_embodiment="prompt_boot:qwen3-8b-q4",
    )
    assert m.soul_name == "justin"
    assert m.display_name == "露怀秋"
    assert m.nickname == "秋秋"
    assert m.soul_version.startswith("justin-")
