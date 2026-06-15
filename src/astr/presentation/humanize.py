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
# 破折号是作文腔/AI 腔，真人打字几乎不用——规整成自然停顿（逗号），不丢内容、不强拆长段
_DASH_RE = re.compile(r"[—–－ー]{1,3}")


def strip_dashes(text: str) -> str:
    """把破折号换成逗号停顿，并清掉因此产生的多余逗号/首尾标点。"""
    text = _DASH_RE.sub("，", text)
    text = re.sub(r"，{2,}", "，", text)  # 合并连续逗号
    text = re.sub(r"，+([。！？；])", r"\1", text)  # 逗号紧贴句末标点 → 去逗号
    return text.strip("，")


# 中英文引号（聊天里少用），分号同理 → 口语化掉
_QUOTES = re.compile(r"[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]")


def casualize_punct(text: str) -> str:
    """口语化标点：分号→逗号、去引号。真人打字少用书面标点，多用逗号（句号在分句时已处理）。"""
    text = text.replace("；", "，").replace(";", "，")
    text = _QUOTES.sub("", text)
    return re.sub(r"，{2,}", "，", text)


def split_reply(
    text: str,
    *,
    max_segments: int = 3,
    merge_prob: float = 0.5,
    min_split_chars: int = 18,
    whole_prob: float = 0.4,
    rng: random.Random | None = None,
) -> list[str]:
    """把回复拆成多条短消息——但不是每次都拆。短回复/相当概率下就发一整条。

    规则：① 短于 min_split_chars 或只有一句 → 一条；② 否则有 whole_prob 概率整条发；
    ③ 其余情况按 merge_prob 概率合并相邻句，最多 max_segments 条。这样有时一句、有时两三句，像真人。
    """
    rng = rng or random
    text = casualize_punct(strip_dashes(text.strip()))
    if not text:
        return []
    parts = [p.strip() for p in _SPLIT_RE.split(text) if p.strip()]
    # 短回复或单句：直接一条（软化末尾句号）
    if len(parts) <= 1 or len(text) < min_split_chars:
        return [_TRAILING_PERIOD.sub("", text) if rng.random() < 0.9 else text]
    # 相当概率整条发（不是非得拆）
    if rng.random() < whole_prob:
        return [_TRAILING_PERIOD.sub("", text) if rng.random() < 0.9 else text]

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

    # 末尾句号 90% 删除（口语感）
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
