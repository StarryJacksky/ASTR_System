"""情感状态机（P1-W4，借鉴 MaiBot 情感数值模型的 clean-room 实现）。

四个数值（0~1）：孤独 loneliness / 倾诉欲 talkativeness / 烦躁 irritation / 兴奋 excitement。
随时间衰减（孤独无互动时上涨，其余回落到基线）；事件按映射表给增量。
持久化到 soul_package/<soul>/memory/emotion_state.json，进 system prompt，soul.decision 带 emotion_delta。
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from astr.contracts.settings import get_settings

DIMS = ("loneliness", "talkativeness", "irritation", "excitement")

# 基线（均值回归目标）。孤独基线略高于 0：独处久了会寂寞。
BASELINE = {"loneliness": 0.3, "talkativeness": 0.2, "irritation": 0.0, "excitement": 0.1}
# 各维半衰期（秒）。孤独衰减慢（慢慢累积），烦躁/兴奋来得快去得也快。
HALF_LIFE_S = {
    "loneliness": 3600.0,
    "talkativeness": 1800.0,
    "irritation": 900.0,
    "excitement": 1200.0,
}

# 情绪耦合矩阵 C[i][j] = 维 j 偏离基线对维 i「有效目标」的牵引系数（赶超 MaiBot 的关键：情绪互相影响，非各自独立衰减）。
# 解读：孤独↑→更想倾诉、略微更不兴奋；烦躁↑→压低兴奋与倾诉欲；兴奋↑→更想说话。
COUPLING: dict[str, dict[str, float]] = {
    "loneliness": {},
    "talkativeness": {"loneliness": 0.35, "irritation": -0.20, "excitement": 0.20},
    "irritation": {"loneliness": 0.10},
    "excitement": {"loneliness": -0.10, "irritation": -0.35},
}
# 昼夜节律：深夜孤独基线抬高的幅度（与心跳深夜独白呼应）。
CIRCADIAN_LONELINESS_AMP = 0.15


class EmotionVector(BaseModel):
    loneliness: float = 0.3
    talkativeness: float = 0.2
    irritation: float = 0.0
    excitement: float = 0.1
    updated_at: datetime = None  # type: ignore[assignment]

    def clamp(self) -> None:
        for k in ("loneliness", "talkativeness", "irritation", "excitement"):
            setattr(self, k, max(0.0, min(1.0, getattr(self, k))))

    def to_prompt_line(self) -> str:
        """给 system prompt 用的一句心情描述（只在明显时提，避免每句都演情绪）。"""
        notes = []
        if self.loneliness >= 0.6:
            notes.append("有点闷/想找人说话")
        if self.irritation >= 0.5:
            notes.append("有点烦躁，话会更冲")
        if self.excitement >= 0.6:
            notes.append("情绪上头/比较亢奋")
        if not notes:
            return "你现在心情平稳。"
        return "你现在的心情：" + "、".join(notes) + "（自然体现在语气里，别直接报数值）。"


# 事件 → 情绪增量映射（intent / 情绪标签 / 时间流逝）
def event_delta(*, intent: str | None, user_emotion: str | None) -> dict[str, float]:
    """一次互动对情绪的增量。被理睬→孤独降；愉快→兴奋升；负面/挑衅→烦躁升。"""
    d = {"loneliness": -0.25, "talkativeness": -0.1, "irritation": 0.0, "excitement": 0.05}
    pos = {"升温/亲近", "高燃/兴奋", "开心", "愉快", "平淡"}
    neg = {"塌陷/低落", "烦躁", "困惑或烦躁", "愤怒"}
    if user_emotion:
        if any(p in user_emotion for p in pos):
            d["excitement"] += 0.2
        if any(n in user_emotion for n in neg):
            d["irritation"] += 0.15
    if intent in ("tool", "research", "coding"):
        d["excitement"] += 0.05  # 有正事做，来劲
    return d


def _decay_value(current: float, baseline: float, half_life_s: float, elapsed_s: float) -> float:
    if elapsed_s <= 0:
        return current
    factor = math.pow(0.5, elapsed_s / half_life_s)
    return baseline + (current - baseline) * factor


def _state_path(soul_name: str) -> Path:
    return get_settings().soul_package_dir / soul_name / "memory" / "emotion_state.json"


def load(soul_name: str = "justin") -> EmotionVector:
    p = _state_path(soul_name)
    if p.exists():
        try:
            return EmotionVector.model_validate_json(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 —— 损坏则重置
            pass
    return EmotionVector(updated_at=datetime.now(UTC))


def save(state: EmotionVector, soul_name: str = "justin") -> None:
    p = _state_path(soul_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(state.model_dump_json(indent=2), encoding="utf-8")


def _circadian_loneliness(now: datetime) -> float:
    """深夜孤独基线抬高，0~CIRCADIAN_LONELINESS_AMP（余弦在 03:00 取峰、15:00 取谷）。"""
    hour = now.astimezone().hour + now.astimezone().minute / 60.0
    night = (math.cos((hour - 3.0) / 24.0 * 2.0 * math.pi) + 1.0) / 2.0
    return CIRCADIAN_LONELINESS_AMP * night


def _effective_targets(state: EmotionVector, now: datetime) -> dict[str, float]:
    """有效回归目标 = 基线 + 昼夜节律 + 情绪耦合（其它维偏离基线的牵引）。"""
    base = dict(BASELINE)
    base["loneliness"] += _circadian_loneliness(now)
    dev = {k: getattr(state, k) - BASELINE[k] for k in DIMS}
    targets: dict[str, float] = {}
    for i in DIMS:
        shift = sum(c * dev[j] for j, c in COUPLING[i].items())
        targets[i] = max(0.0, min(1.0, base[i] + shift))
    return targets


def decayed(state: EmotionVector, now: datetime | None = None) -> EmotionVector:
    """连续时间均值回归（OU 精确解）+ 情绪耦合 + 昼夜节律。

    每维 X(t+Δ)=μ_eff+(X−μ_eff)·e^(−θΔ)，θ=ln2/半衰期，与采样间隔无关；
    μ_eff 含昼夜节律与其它情绪的耦合牵引——相对 MaiBot 朴素逐 tick 衰减的升级。
    """
    now = now or datetime.now(UTC)
    last = state.updated_at or now
    elapsed = max(0.0, (now - last).total_seconds())
    targets = _effective_targets(state, now)
    vals = {k: _decay_value(getattr(state, k), targets[k], HALF_LIFE_S[k], elapsed) for k in DIMS}
    new = EmotionVector(**vals, updated_at=now)
    new.clamp()
    return new


def apply(
    state: EmotionVector, delta: dict[str, float], now: datetime | None = None
) -> EmotionVector:
    """把一次互动的增量加到（已衰减的）状态上。"""
    for k, v in delta.items():
        setattr(state, k, getattr(state, k) + v)
    state.updated_at = now or datetime.now(UTC)
    state.clamp()
    return state
