"""回复拟人化单测（P1-W6）：分条 + 打字时长。"""

from __future__ import annotations

import random

from astr.presentation import humanize


def test_short_reply_not_split() -> None:
    assert humanize.split_reply("？") == ["？"]
    assert humanize.split_reply("在呢") == ["在呢"]


def test_long_reply_splits_and_caps() -> None:
    rng = random.Random(0)
    text = "怕孤独？那是进化给你的警告，群居动物的本能。可你偏偏活成了反骨，硬把它当成浪漫。"
    segs = humanize.split_reply(text, max_segments=3, merge_prob=0.0, rng=rng)
    assert 1 < len(segs) <= 3
    assert "".join(s.replace("，", "") for s in segs)  # 非空


def test_typing_delay_bounds() -> None:
    assert humanize.typing_delay_s("") >= 0.4
    assert humanize.typing_delay_s("字" * 1000) <= 4.0
    assert humanize.typing_delay_s("八个字的一句话啊") > 0.4
