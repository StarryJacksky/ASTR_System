"""经验联想记忆（统一基座，赶超 MaiBot）。

MaiBot 把"关系图谱"和"行为学习"做成两套子系统。这里反过来：只维护一份**经验**——
每轮 {上下文, 实体(说话人+话题), 回复, 评分}，落 behavior_capsules/experience.jsonl。
在它之上有两种**查询**，二者都是这一份经验的副产品：

  relations(entity)      —— 实体共现统计 → 图谱关系（人↔话题↔人 的边自动浮现）
  behavior_recall(text)  —— 检索相似过往经验里高分的应对 → 行为学习（非参数、即时、无遗忘）

评分（human/judge）由 P4 回填；回填后 behavior_recall 自然偏向"她以前效果好的应对"，行为学习闭环。
P1 只负责攒经验 + 检索式行为参考；训练（参数化）仍是 P4。
v1 用关键词/实体重合做检索；v2 可换 bge-m3 向量检索（基座不变，只换相似度）。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import structlog

from astr.contracts.settings import get_settings
from astr.soul.engagement import INTEREST_TERMS

log = structlog.get_logger("astr.memory.experience")


def _log_path(soul_name: str):
    return get_settings().soul_package_dir / soul_name / "behavior_capsules" / "experience.jsonl"


def extract_entities(text: str, speaker: str | None = None) -> list[str]:
    """廉价实体抽取（无 LLM）：说话人 + 命中的兴趣话题。共现即成图谱的边。"""
    ents: list[str] = []
    if speaker:
        ents.append(f"person:{speaker}")
    low = text.lower()
    ents += [f"topic:{kw}" for kw in INTEREST_TERMS if kw in low]
    return ents


def record(
    soul_name: str,
    trace_id: str,
    text: str,
    speaker: str | None,
    response: str,
    *,
    score: float | None = None,
) -> None:
    """记一条经验（基座的唯一写入口）。图谱与行为学习都从这里长出来。"""
    row = {
        "ts": datetime.now(UTC).isoformat(),
        "trace_id": trace_id,
        "text": text,
        "entities": extract_entities(text, speaker),
        "response": response,
        "score": score,  # P4 回填
    }
    p = _log_path(soul_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read(soul_name: str, limit: int = 2000) -> list[dict]:
    p = _log_path(soul_name)
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()[-limit:]
    return [json.loads(line) for line in lines if line.strip()]


def relations(soul_name: str, entity: str, k: int = 5) -> list[tuple[str, int]]:
    """图谱关系查询：与 entity 共现最多的其它实体 top-k（边权=共现次数）。"""
    counts: dict[str, int] = {}
    for row in _read(soul_name):
        ents = row.get("entities", [])
        if entity in ents:
            for e in ents:
                if e != entity:
                    counts[e] = counts.get(e, 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])[:k]


def behavior_recall(soul_name: str, text: str, speaker: str | None = None, k: int = 3) -> list[str]:
    """行为学习查询：检索相似过往经验里（高分优先）她的应对，作为"我以前这么做过"的参考。"""
    cur = set(extract_entities(text, speaker))
    scored: list[tuple[float, str]] = []
    for row in _read(soul_name):
        if not row.get("response"):
            continue
        overlap = len(cur & set(row.get("entities", [])))
        if overlap <= 0:
            continue
        # 相似度(实体重合) × (1 + 评分)；P4 未回填时 score=None 当 0
        s = float(row.get("score") or 0.0)
        scored.append((overlap * (1.0 + max(0.0, s)), row["response"]))
    scored.sort(key=lambda x: -x[0])
    # 去重保序
    seen: set[str] = set()
    out: list[str] = []
    for _w, resp in scored:
        if resp not in seen:
            seen.add(resp)
            out.append(resp)
        if len(out) >= k:
            break
    return out
