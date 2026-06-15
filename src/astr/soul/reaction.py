"""消息表情回应·发出决策（P1-W6 社交层）：她要不要给你这条消息贴个表情、贴哪个。

克制是关键（05 §4.3 / 99 #8）：默认不贴，只有情绪命中且掷中才贴一个；熟人、话痨时概率略升。
复用 emotion_to_face 的情绪到 QQ 表情映射（reaction 的 emoji 与 face 同一套 id）。
"""

from __future__ import annotations

import random

from astr.presentation.express import emotion_to_face

BASE_REACT_P = 0.12  # 基础贴表情意愿（低，克制）


def pick_reaction(
    emotion_tag: str | None,
    *,
    familiarity: float = 0.05,
    talkativeness: float = 0.5,
    rng: random.Random | None = None,
) -> str | None:
    """返回要贴的 QQ emoji id，或 None（不贴）。没情绪不贴；有情绪也只是有概率贴。"""
    face = emotion_to_face(emotion_tag)
    if not face:
        return None
    rng = rng or random
    p = min(0.6, BASE_REACT_P * (1.0 + 1.5 * familiarity) * (0.6 + talkativeness))
    return face if rng.random() < p else None
