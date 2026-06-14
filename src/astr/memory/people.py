"""群成员上下文（P1-W3/W6 赶超项，clean-room）：她记得"谁是谁"。

每个说话对象一份画像（见过几次、关系、印象笔记），落到 identity_atlas/people/<id>.json（人物图谱，模型无关身份资产）。
说话时把对方画像注入上下文，让她对不同人有不同反应——而不是把所有人当同一个陌生人。
印象笔记可由 MoA/语义记忆后续enrich（"他最近在迁移工作环境"之类）。
"""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, datetime

import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.memory.people")

_SAFE = re.compile(r"[^0-9A-Za-z_.-]+")

# 关系动力学（赶超 MaiBot：它无数值亲密度/好感 FSM）。扣人设"冷启动→深亲近"。
FAMILIARITY_FLOOR = 0.1  # 久不联系回落的残值——认识过就不会变回纯陌生人
FAMILIARITY_HALF_LIFE_DAYS = 30.0  # 熟悉度衰减半衰期（很慢）
AFFINITY_HALF_LIFE_DAYS = 14.0  # 好感向 0 回落半衰期
FAMILIARITY_GAIN = 0.08  # 每次互动熟悉度增益（递减：×(1-familiarity)，所以"难熟但认定后深"）


def _dir(soul_name: str):
    return get_settings().soul_package_dir / soul_name / "identity_atlas" / "people"


def _path(soul_name: str, user_id: str):
    return _dir(soul_name) / f"{_SAFE.sub('_', user_id)}.json"


def load(soul_name: str, user_id: str) -> dict:
    p = _path(soul_name, user_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    now = datetime.now(UTC).isoformat()
    return {
        "user_id": user_id,
        "display_name": user_id,
        "level": 0,
        "first_seen": now,
        "last_seen": now,
        "msg_count": 0,
        "familiarity": 0.05,  # 冷启动：一上来很生
        "affinity": 0.0,  # 好感 -1~1
        "notes": [],
    }


def _half_life_factor(elapsed_days: float, half_life_days: float) -> float:
    return math.pow(0.5, elapsed_days / half_life_days) if elapsed_days > 0 else 1.0


def _decay_relationship(prof: dict, now: datetime) -> None:
    """按距上次互动的天数衰减：熟悉度回落到残值、好感回落到 0（均值回归）。"""
    try:
        last = datetime.fromisoformat(prof.get("last_seen"))
    except (TypeError, ValueError):
        return
    days = max(0.0, (now - last).total_seconds() / 86400.0)
    fam = float(prof.get("familiarity", 0.05))
    aff = float(prof.get("affinity", 0.0))
    ff = _half_life_factor(days, FAMILIARITY_HALF_LIFE_DAYS)
    af = _half_life_factor(days, AFFINITY_HALF_LIFE_DAYS)
    prof["familiarity"] = FAMILIARITY_FLOOR + (fam - FAMILIARITY_FLOOR) * ff
    prof["affinity"] = aff * af


def _save(soul_name: str, prof: dict) -> None:
    p = _path(soul_name, prof["user_id"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(prof, ensure_ascii=False, indent=2), encoding="utf-8")


def touch(soul_name: str, user_id: str, display_name: str | None = None, level: int = 0) -> dict:
    """记一次互动：先按时长衰减关系，再涨熟悉度（递减增益），更新 last_seen/计数。返回画像。"""
    prof = load(soul_name, user_id)
    now = datetime.now(UTC)
    _decay_relationship(prof, now)
    fam = float(prof.get("familiarity", 0.05))
    prof["familiarity"] = min(1.0, fam + FAMILIARITY_GAIN * (1.0 - fam))  # 难熟、认定后深
    prof["last_seen"] = now.isoformat()
    prof["msg_count"] = int(prof.get("msg_count", 0)) + 1
    if display_name:
        prof["display_name"] = display_name
    if level:
        prof["level"] = level
    _save(soul_name, prof)
    return prof


def apply_valence(soul_name: str, user_id: str, valence: float) -> None:
    """按本轮互动性质调好感：同频/戳兴趣为正、越界/敌意为负。"""
    prof = load(soul_name, user_id)
    prof["affinity"] = max(-1.0, min(1.0, float(prof.get("affinity", 0.0)) + valence))
    _save(soul_name, prof)


def relationship_factor(prof: dict) -> float:
    """给 engagement 的关系亲疏乘子：熟人/高好感更愿搭话，生人/设防压低。"""
    fam = float(prof.get("familiarity", 0.05))
    aff = float(prof.get("affinity", 0.0))
    return max(0.3, (0.5 + 1.3 * fam) * (1.0 + 0.4 * aff))


def add_note(soul_name: str, user_id: str, note: str) -> None:
    """给某人补一条印象笔记（去重，最多留最近 20 条）。"""
    prof = load(soul_name, user_id)
    notes = prof.get("notes", [])
    if note and note not in notes:
        notes.append(note)
        prof["notes"] = notes[-20:]
        _save(soul_name, prof)


def profile_line(prof: dict) -> str:
    """给 system prompt 的一句"对方是谁 + 你跟ta多熟"。冷启动→深亲近的语气依据。"""
    name = prof.get("display_name") or prof.get("user_id")
    fam = float(prof.get("familiarity", 0.05))
    aff = float(prof.get("affinity", 0.0))
    if fam < 0.2:
        rel = "生面孔，你还在冷启动、先把人过一遍审，别轻易掏心窝"
    elif fam < 0.55:
        rel = "算半熟，开始有点放松，但还没完全卸甲"
    else:
        rel = "你认定的同频者，可以贫、可以抽象、可以交底"
    base = f"和你说话的是「{name}」——{rel}。"
    if aff <= -0.3:
        base += "（你对ta有点设防/没好感，语气会更冲更短。）"
    elif aff >= 0.4:
        base += "（你挺待见ta。）"
    notes = prof.get("notes") or []
    if notes:
        base += f"印象：{'；'.join(notes[-3:])}。"
    return base
