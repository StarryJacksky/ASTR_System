"""回复拟人化（P1-W6，借鉴 MaiBot process_llm_response 的思路，clean-room 实现）。

把一句回复按概率拆成 1~N 条短消息，并给每条算一个"打字时长"——平台适配器据此分条、带停顿地发，
模拟真人在手机上一句一句敲。零 LLM、平台无关。
"""

from __future__ import annotations

import random
import re

# 句内可切分的标点（切分后标点不保留在分句里）
_SPLIT_RE = re.compile(r"[，。！？；\n、]+")
_TRAILING_PERIOD = re.compile(r"。$")


def split_reply(
    text: str,
    *,
    max_segments: int = 3,
    merge_prob: float = 0.5,
    rng: random.Random | None = None,
) -> list[str]:
    """把回复拆成多条短消息。短回复（≤1 句）原样返回；越短越倾向不拆。

    merge_prob：相邻分句合并的概率（越高越少拆条）。max_segments：最多发几条。
    """
    rng = rng or random
    text = text.strip()
    if not text:
        return []
    parts = [p.strip() for p in _SPLIT_RE.split(text) if p.strip()]
    if len(parts) <= 1:
        return [text]

    # 概率合并相邻分句
    merged: list[str] = [parts[0]]
    for p in parts[1:]:
        if rng.random() < merge_prob:
            merged[-1] = merged[-1] + "，" + p
        else:
            merged.append(p)

    # 超出上限的尾部并回最后一条
    if len(merged) > max_segments:
        head = merged[: max_segments - 1]
        tail = "，".join(merged[max_segments - 1 :])
        merged = head + [tail]

    # 末尾句号 90% 删除（口语感），其余轻度软化
    out = []
    for seg in merged:
        if rng.random() < 0.9:
            seg = _TRAILING_PERIOD.sub("", seg)
        out.append(seg)
    return out


def typing_delay_s(text: str, *, cps: float = 9.0, floor: float = 0.4, cap: float = 4.0) -> float:
    """估算"打字"这条消息要多久（秒）。中文按字算，约 cps 字/秒，带上下限。"""
    n = len(text)
    return max(floor, min(cap, n / cps))
