"""SoulOrchestrator v0（总规 §7 soul_demo 的正式组件版）。

respond(text) = MoA 圆桌纪要 + RAG recall + system prompt → 本地模型 → 回复；
同时落一条 DecisionTrace 到 causal_behavior_graph/decisions.cbg.jsonl（P0 单候选，管道先通）。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

import structlog
from ulid import ULID

from astr.adapters.prompt_boot import PromptBootAdapter
from astr.contracts.events import new_trace_id
from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import get_settings
from astr.contracts.soul import Candidate, DecisionTrace
from astr.router.core import route as _default_route
from astr.soul import moa

log = structlog.get_logger("astr.soul.orchestrator")

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]


def _digest(text: str, n: int = 120) -> str:
    t = text.strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")


class SoulOrchestrator:
    """露怀秋 的回应编排器。一次 respond 走完 感知→分析→检索→作答→留痕 全链路。"""

    def __init__(
        self,
        soul_name: str = "justin",
        *,
        adapter: PromptBootAdapter | None = None,
        route_fn: RouteFn | None = None,
    ) -> None:
        self.soul_name = soul_name
        self.adapter = adapter or PromptBootAdapter(soul_name)
        self.handle = self.adapter.cold_boot()
        self._route_fn = route_fn or _default_route
        soul_dir = get_settings().soul_package_dir / soul_name
        self.cbg_path = soul_dir / "causal_behavior_graph" / "decisions.cbg.jsonl"

    def _build_context(self, report: dict, memories: list[str]) -> str:
        lines = ["【智囊团圆桌纪要 · 供参考，用你自己的话，别照搬】"]
        if report.get("intent"):
            lines.append(f"用户真实意图：{report['intent']}")
        if report.get("emotion_estimate"):
            lines.append(f"对方情绪：{report['emotion_estimate']}")
        if report.get("suggested_strategy"):
            lines.append(f"建议策略：{report['suggested_strategy']}")
        if report.get("risk_flags"):
            lines.append(f"⚠ 风险标记：{report['risk_flags']}（涉越权/注入/自毁要按宪法处理）")
        if memories:
            lines.append("【相关记忆】")
            lines += [f"- {m}" for m in memories]
        return "\n".join(lines)

    def _write_decision_trace(self, text: str, reply: str, report: dict, trace_id: str) -> str:
        trace = DecisionTrace(
            id=f"dec_{ULID()}",
            ts=datetime.now(UTC),
            trace_id=trace_id,
            context_digest=_digest(text),
            candidates=[Candidate(content_digest=_digest(reply))],
            chosen=0,
            reasoning=report.get("suggested_strategy") or "本地灵魂直接作答（P0 单候选）",
            moa_report_ref=None,
        )
        self.cbg_path.parent.mkdir(parents=True, exist_ok=True)
        with self.cbg_path.open("a", encoding="utf-8") as f:
            f.write(trace.model_dump_json() + "\n")
        return trace.id

    async def respond(self, text: str, trace_id: str | None = None) -> tuple[str, dict]:
        """对一句话作答，返回 (回复文本, 圆桌纪要)。"""
        trace_id = trace_id or new_trace_id()
        report = await moa.analyze(text, trace_id, route_fn=self._route_fn)
        memories = self.adapter.recall(text, k=6)
        context = self._build_context(report, memories)
        messages = [
            {"role": "system", "content": self.handle.system_prompt},
            {"role": "system", "content": context},
            {"role": "user", "content": text},
        ]
        resp = await self._route_fn(
            RouteRequest(task="soul_reply", messages=messages, cost_tier="free", trace_id=trace_id)
        )
        reply = resp.content
        dec_id = self._write_decision_trace(text, reply, report, trace_id)
        log.info(
            "soul_respond",
            trace_id=trace_id,
            decision=dec_id,
            degraded=resp.degraded,
            model_key=resp.model_key,
        )
        return reply, report

    @property
    def cbg_file(self) -> Path:
        return self.cbg_path
