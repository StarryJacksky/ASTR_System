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


def test_coupling_irritation_suppresses_excitement() -> None:
    # 高烦躁应把"兴奋"的有效回归目标压到基线以下（情绪互相影响）
    now = datetime.now(UTC)
    state = emotion.EmotionVector(irritation=1.0, excitement=0.1, updated_at=now)
    targets = emotion._effective_targets(state, now)
    assert targets["excitement"] < emotion.BASELINE["excitement"]


def test_coupling_loneliness_raises_talkativeness() -> None:
    # 孤独应抬高"倾诉欲"的目标（孤独→更想说话）
    now = datetime.now(UTC)
    state = emotion.EmotionVector(loneliness=1.0, updated_at=now)
    targets = emotion._effective_targets(state, now)
    assert targets["talkativeness"] > emotion.BASELINE["talkativeness"]


def test_circadian_night_higher_than_day() -> None:
    from datetime import datetime as _dt

    local_tz = _dt.now().astimezone().tzinfo  # 本地时区，保证构造的本地小时不被偏移
    night = emotion._circadian_loneliness(_dt(2026, 6, 15, 3, 0, tzinfo=local_tz))
    day = emotion._circadian_loneliness(_dt(2026, 6, 15, 15, 0, tzinfo=local_tz))
    assert night > day
