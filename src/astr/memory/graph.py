"""图记忆 v0（P1-W3）：把 experience.jsonl 里的实体共现物化成 relations.graphml。

经验基座（experience.py）每轮已抽实体（person:/topic:）。这里把"谁和谁/什么 常一起出现"
累成一张无向带权图，落 soul_package/memory/relations.graphml（GraphML，开放标准，住真身）。
P1 只建图、持续更新；检索/推理留 P3。零新增依赖——GraphML 就是 XML，手写即可。
"""

from __future__ import annotations

import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.memory.graph")


def _exp_path(soul_name: str) -> Path:
    return get_settings().soul_package_dir / soul_name / "behavior_capsules" / "experience.jsonl"


def graphml_path(soul_name: str = "justin") -> Path:
    return get_settings().soul_package_dir / soul_name / "memory" / "relations.graphml"


def _read_rows(soul_name: str, limit: int = 5000) -> list[dict]:
    p = _exp_path(soul_name)
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()[-limit:]
    return [json.loads(line) for line in lines if line.strip()]


def build_graphml(soul_name: str = "justin") -> Path:
    """读经验流 → 累计节点频次 + 边共现 → 写 relations.graphml。返回路径。"""
    node_w: dict[str, int] = defaultdict(int)
    edge_w: dict[tuple[str, str], int] = defaultdict(int)
    for row in _read_rows(soul_name):
        ents = sorted({e for e in (row.get("entities") or []) if e})
        for e in ents:
            node_w[e] += 1
        for a, b in combinations(ents, 2):
            edge_w[(a, b)] += 1

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        '  <key id="w" for="node" attr.name="weight" attr.type="int"/>',
        '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
        '  <key id="ew" for="edge" attr.name="weight" attr.type="int"/>',
        '  <graph edgedefault="undirected">',
    ]
    for node, w in sorted(node_w.items()):
        kind = node.split(":", 1)[0] if ":" in node else "other"
        lines.append(
            f"    <node id={quoteattr(node)}>"
            f'<data key="w">{w}</data>'
            f'<data key="kind">{escape(kind)}</data></node>'
        )
    for i, ((a, b), w) in enumerate(sorted(edge_w.items())):
        lines.append(
            f'    <edge id="e{i}" source={quoteattr(a)} target={quoteattr(b)}>'
            f'<data key="ew">{w}</data></edge>'
        )
    lines += ["  </graph>", "</graphml>", ""]

    out = graphml_path(soul_name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8")
    log.info("graphml_built", nodes=len(node_w), edges=len(edge_w), path=str(out))
    return out
