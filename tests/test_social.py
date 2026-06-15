"""社交自主与感知单测（P1-W6 → 朝 P5）：入群自主决策 + 平台事件反应 + 自我社交认知。"""

from __future__ import annotations

import random

from astr.contracts.settings import Settings
from astr.soul import social


def _patch(monkeypatch, tmp_path):
    monkeypatch.setattr(
        social, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )


def test_trusted_inviter_always_joins() -> None:
    accept, p, _ = social.should_join_group(inviter_level=2)
    assert accept and p == 1.0  # 主人/信任者邀请，必进


def test_lonely_more_likely_than_irritated() -> None:
    # 同一邀请人，孤独时入群概率 > 烦躁时
    _, p_lonely, _ = social.should_join_group(loneliness=0.9, irritation=0.0)
    _, p_irritated, _ = social.should_join_group(loneliness=0.1, irritation=0.9)
    assert p_lonely > p_irritated


def test_known_liked_inviter_raises_p() -> None:
    _, p_stranger, _ = social.should_join_group(inviter_familiarity=0.05, inviter_affinity=0.0)
    _, p_friend, _ = social.should_join_group(inviter_familiarity=0.8, inviter_affinity=0.6)
    assert p_friend > p_stranger  # 认识且有好感的人邀请更愿进


def test_join_decision_deterministic_with_seed() -> None:
    rng = random.Random(42)
    accept, p, _ = social.should_join_group(loneliness=0.5, rng=rng)
    assert isinstance(accept, bool) and 0.0 <= p <= 1.0


def test_react_to_kicked_and_muted() -> None:
    kicked = social.react_to_notice("kicked", where="测试群")
    assert kicked["emotion_delta"]["irritation"] > 0
    assert "测试群" in kicked["note"]
    muted = social.react_to_notice("muted", where="测试群")
    assert muted["emotion_delta"]["irritation"] > 0


def test_react_unknown_notice_is_empty() -> None:
    r = social.react_to_notice("supernova")
    assert r == {"emotion_delta": {}, "note": ""}


def test_sync_and_load_social(tmp_path, monkeypatch) -> None:
    _patch(monkeypatch, tmp_path)
    friends = [{"id": "qq:1", "name": "A"}, {"id": "qq:2", "name": "B"}]
    groups = [{"id": "g:1", "name": "群一"}]
    social.sync_social("justin", friends, groups)
    loaded = social.load_social("justin")
    assert len(loaded["friends"]) == 2
    assert len(loaded["groups"]) == 1
    assert loaded["updated_at"] is not None


def test_record_social_note_persists(tmp_path, monkeypatch) -> None:
    _patch(monkeypatch, tmp_path)
    social.record_social_note("justin", "被「某群」踢了。")
    base = tmp_path / "soul_package" / "justin" / "memory" / "chunks" / "monologues"
    hits = list(base.rglob("social_*.md"))
    assert hits and "踢" in hits[0].read_text(encoding="utf-8")
