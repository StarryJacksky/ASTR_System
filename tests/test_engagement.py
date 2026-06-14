"""选择性回复门控单测（P1-W6）。"""

from __future__ import annotations

import random

from astr.soul.engagement import EngagementInput, reply_probability, should_reply


def test_private_always_replies() -> None:
    inp = EngagementInput(is_group=False, mentioned=False, level=0, text="随便说")
    ok, p, reason = should_reply(inp)
    assert ok and p == 1.0 and reason == "private"


def test_group_mentioned_always_replies() -> None:
    inp = EngagementInput(is_group=True, mentioned=True, level=0, text="秋秋在吗")
    ok, p, reason = should_reply(inp)
    assert ok and p == 1.0 and reason == "mentioned"


def test_owner_question_more_likely_than_stranger_chatter() -> None:
    owner_q = EngagementInput(
        is_group=True,
        mentioned=False,
        level=2,
        text="这事你怎么看？",
        seconds_since_last_reply=1200,
        talkativeness=0.5,
    )
    stranger = EngagementInput(is_group=True, mentioned=False, level=0, text="哦")
    assert reply_probability(owner_q) > reply_probability(stranger)


def test_backoff_suppresses_after_recent_replies() -> None:
    base = EngagementInput(is_group=True, mentioned=False, level=2, text="有意思吗？")
    spammed = EngagementInput(
        is_group=True, mentioned=False, level=2, text="有意思吗？", recent_replies=5
    )
    assert reply_probability(spammed) < reply_probability(base)


def test_group_stranger_noise_usually_silent() -> None:
    inp = EngagementInput(is_group=True, mentioned=False, level=0, text="哈")
    replies = sum(should_reply(inp, rng=random.Random(i))[0] for i in range(100))
    assert replies < 20  # 群里陌生人的废话，绝大多数沉默
