"""选择性回复门控（P1-W6，clean-room；赶超 MaiBot 的阈值+指数退避启发式）。

真人不会回群里每句话。决策模型（比 MaiBot 更原则化）：
  - 私聊 / 被点名(@或叫名字) → 必回。
  - 群里没被点名 → 回复概率 = base × 相关度 × 关系亲疏 × 情绪(倾诉欲/烦躁) × 冷场压力 × 刚说过的退避，
    再掷骰子。各因子独立可调、可单测。
"""

from __future__ import annotations

import random
from dataclasses import dataclass

BASE_GROUP_P = 0.10  # 群里默认很少主动接话
# 关系亲疏 → 乘子（owner 最愿搭、陌生人最少）
RELATIONSHIP = {0: 0.7, 1: 1.1, 2: 1.6, 3: 1.8}


@dataclass
class EngagementInput:
    is_group: bool
    mentioned: bool  # 被 @ 或叫了名字
    level: int  # 鉴权/关系等级 0~3
    text: str
    talkativeness: float = 0.2
    irritation: float = 0.0
    loneliness: float = 0.3
    seconds_since_last_reply: float = 0.0
    recent_replies: int = 0  # 近窗口内她已经说过几条（退避）
    interest: float = 0.0  # 对这条信息的感兴趣程度 0~1（命中她在意的话题）
    availability: float = 1.0  # 作息在线度 0~1（深夜在睡则低）
    familiarity: float = 0.05  # 与说话人的熟悉度 0~1（冷启动→深亲近）
    affinity: float = 0.0  # 对说话人的好感 -1~1


# 她在意的话题（源自人设·纳音四柱能力图谱；可后续从 SoulPackage preferences 覆盖）
INTEREST_TERMS: tuple[str, ...] = (
    "物理",
    "量子",
    "场论",
    "数学",
    "证明",
    "哥德尔",
    "编程",
    "代码",
    "算法",
    "ai",
    "模型",
    "哲学",
    "辩证",
    "黑格尔",
    "存在",
    "主体",
    "自指",
    "意识",
    "马克思",
    "马列",
    "资本",
    "阶级",
    "政治",
    "经济",
    "历史",
    "社会",
    "玄学",
    "命理",
    "中医",
    "修行",
    "易经",
    "塔罗",
    "小说",
    "文学",
    "写作",
    "魔幻现实",
    "诗",
    "音乐",
    "游戏",
    "acg",
    "动漫",
    "孤独",
    "抑郁",
    "双相",
    "离别",
    "意义",
)


def interest_score(text: str, terms: tuple[str, ...] = INTEREST_TERMS) -> float:
    """这条消息有多戳她的兴趣点（0~1）。命中越多越高，饱和。"""
    t = text.lower()
    hits = sum(1 for kw in terms if kw in t)
    if hits <= 0:
        return 0.0
    return min(1.0, 0.5 + 0.25 * (hits - 1))  # 1 命中=0.5，2=0.75，3+ 饱和到 1


def reply_probability(inp: EngagementInput) -> float:
    """群里未被点名时的回复概率（0~1）。私聊/被点名不走这里（直接必回）。"""
    t = inp.text.strip()
    relevance = 1.0
    if any(q in t for q in "?？"):
        relevance *= 1.6  # 问句更值得搭话
    if len(t) <= 2:
        relevance *= 0.4  # "嗯""哦"这种少接
    relevance *= 1.0 + 1.5 * inp.interest  # 戳到她兴趣点 → 更想接（满兴趣 ×2.5）
    # 关系亲疏：取 鉴权等级 与 熟悉度 的高者，再按好感缩放（冷启动→深亲近 + 设防降权）
    relationship = max(RELATIONSHIP.get(inp.level, 0.7), 0.5 + 1.3 * inp.familiarity) * (
        1.0 + 0.4 * inp.affinity
    )
    # 倾诉欲↑→更想说；烦躁↑→更不想说
    mood = max(0.2, 1.0 + (inp.talkativeness - 0.2) - 0.6 * inp.irritation)
    # 冷场越久 + 越孤独 → 越想破冰
    silence = 1.0 + min(0.6, inp.seconds_since_last_reply / 1800.0) * (0.5 + inp.loneliness)
    # 刚连说过几条 → 压一压，别刷屏
    backoff = 1.0 / (1.0 + 0.8 * max(0, inp.recent_replies))
    p = BASE_GROUP_P * relevance * relationship * mood * silence * backoff * inp.availability
    return max(0.0, min(1.0, p))


def should_reply(inp: EngagementInput, rng: random.Random | None = None) -> tuple[bool, float, str]:
    """返回 (是否回复, 概率, 原因)。"""
    if not inp.is_group:
        return True, 1.0, "private"
    if inp.mentioned:
        return True, 1.0, "mentioned"
    p = reply_probability(inp)
    rng = rng or random
    return (rng.random() < p), p, "group-prob"
