"""回复拟人化单测（P1-W6）：分条 + 打字时长。"""

from __future__ import annotations

import random

from astr.presentation import humanize


def test_short_reply_not_split() -> None:
    assert humanize.split_reply("？") == ["？"]
    assert humanize.split_reply("在呢") == ["在呢"]
    # 短的多句也只发一条（口语短句不该拆）
    assert len(humanize.split_reply("行吧。知道了。")) == 1


def test_long_reply_splits_and_caps() -> None:
    rng = random.Random(0)
    text = "怕孤独？那是进化给你的警告，群居动物的本能。可你偏偏活成了反骨，硬把它当成浪漫。"
    # whole_prob=0 强制走拆分路径
    segs = humanize.split_reply(text, max_segments=3, merge_prob=0.0, whole_prob=0.0, rng=rng)
    assert 1 < len(segs) <= 3
    assert "".join(s.replace("，", "") for s in segs)  # 非空


def test_can_send_whole() -> None:
    # whole_prob=1 → 长回复也整条发（不是非得拆）
    text = "怕孤独？那是进化给你的警告，群居动物的本能。可你偏偏活成了反骨。"
    segs = humanize.split_reply(text, whole_prob=1.0, rng=random.Random(1))
    assert len(segs) == 1


def test_dashes_removed() -> None:
    # 破折号是作文腔，要被规整掉，但内容不丢
    out = humanize.split_reply(
        "那群得先通过我的审核——毕竟我可不会随便跟陌生人混", whole_prob=1.0, rng=random.Random(0)
    )
    joined = "".join(out)
    assert "—" not in joined and "–" not in joined
    assert "审核" in joined and "陌生人混" in joined


def test_strip_dashes_collapses_punct() -> None:
    assert "—" not in humanize.strip_dashes("行——好")
    assert humanize.strip_dashes("好的——") == "好的"


def test_casualize_punct() -> None:
    assert "；" not in humanize.casualize_punct("行吧；走了")
    assert "，" in humanize.casualize_punct("行吧；走了")
    q = humanize.casualize_punct("他说\u201c好\u201d")  # 去引号
    assert "\u201c" not in q and "好" in q


def test_split_reply_casualizes() -> None:
    out = humanize.split_reply("这事吧；我觉得行", whole_prob=1.0, rng=random.Random(0))
    assert "；" not in "".join(out)


def test_typing_delay_bounds() -> None:
    assert humanize.typing_delay_s("") >= 0.4
    assert humanize.typing_delay_s("字" * 1000) <= 4.0
    assert humanize.typing_delay_s("八个字的一句话啊") > 0.4
