"""消息表情回应单测（P1-W6 社交层）：发出决策 + 收到感知。"""

from __future__ import annotations

import random

from astr.soul import social
from astr.soul.reaction import pick_reaction


def test_no_reaction_without_emotion() -> None:
    assert pick_reaction(None) is None
    assert pick_reaction("平淡") is None  # 平淡映射不到表情 → 不贴


def test_reaction_restrained_for_stranger() -> None:
    # 生人、低话痨：贴表情概率低，多数次数不贴
    hits = sum(
        1
        for i in range(200)
        if pick_reaction("高燃", familiarity=0.05, talkativeness=0.2, rng=random.Random(i)) is not None
    )
    assert hits < 100  # 克制：不到一半


def test_reaction_more_likely_for_close_friend() -> None:
    stranger = sum(
        1
        for i in range(200)
        if pick_reaction("高燃", familiarity=0.05, talkativeness=0.5, rng=random.Random(i))
    )
    friend = sum(
        1
        for i in range(200)
        if pick_reaction("高燃", familiarity=0.9, talkativeness=0.5, rng=random.Random(i))
    )
    assert friend > stranger


def test_react_to_positive_reaction() -> None:
    r = social.react_to_reaction("76", who="A")
    assert r["affinity_delta"] > 0
    assert r["emotion_delta"]["excitement"] > 0


def test_react_to_negative_reaction() -> None:
    r = social.react_to_reaction("77", who="B")
    assert r["affinity_delta"] < 0
    assert r["emotion_delta"]["irritation"] > 0


def test_react_to_neutral_reaction() -> None:
    r = social.react_to_reaction("99999", who="C")
    assert r["affinity_delta"] >= 0  # 有人理我，微正
