"""情感状态机单测（P1-W4）：衰减 / 事件增量 / 钳制。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from astr.soul import emotion


def test_decay_toward_baseline() -> None:
    now = datetime.now(UTC)
    # 高兴奋，1 小时后应明显回落（半衰期 1200s）
    state = emotion.EmotionVector(excitement=1.0, updated_at=now - timedelta(hours=1))
    decayed = emotion.decayed(state, now=now)
    assert decayed.excitement < 0.3


def test_loneliness_rises_when_idle() -> None:
    now = datetime.now(UTC)
    state = emotion.EmotionVector(loneliness=0.3, updated_at=now - timedelta(hours=3))
    decayed = emotion.decayed(state, now=now)
    assert decayed.loneliness >= 0.3  # 久不互动更孤独


def test_event_delta_signs() -> None:
    pos = emotion.event_delta(intent="chat", user_emotion="高燃/兴奋")
    assert pos["excitement"] > 0
    assert pos["loneliness"] < 0  # 被理睬，孤独降
    neg = emotion.event_delta(intent="chat", user_emotion="烦躁")
    assert neg["irritation"] > 0


def test_clamp_bounds() -> None:
    s = emotion.EmotionVector(loneliness=2.0, irritation=-1.0)
    s.clamp()
    assert s.loneliness == 1.0
    assert s.irritation == 0.0
