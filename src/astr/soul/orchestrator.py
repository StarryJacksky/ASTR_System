"""SoulOrchestrator v0（总规 §7 soul_demo 的正式组件版）。

respond(text) = MoA 圆桌纪要 + RAG recall + system prompt → 本地模型 → 回复；
同时落一条 DecisionTrace 到 causal_behavior_graph/decisions.cbg.jsonl（P0 单候选，管道先通）。
"""

from __future__ import annotations

import re
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
from astr.memory import episodic_writer, experience, people
from astr.router.core import route as _default_route
from astr.soul import emotion, life, moa

# 互动可改写她当晚作息的触发词（群友/主人邀约熬夜，她可能选择陪）
_STAYUP_HINTS = ("熬夜", "通宵", "别睡", "陪我写", "陪我肝", "一起肝", "陪我熬")

log = structlog.get_logger("astr.soul.orchestrator")

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]


def _digest(text: str, n: int = 120) -> str:
    t = text.strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")


# 清洗 8B 偶发漏出的"名字："前缀与 *动作* 旁白（聊天腔不要这些）
_NAME_PREFIX = re.compile(r"^\s*(露怀秋|秋秋)\s*[:：]\s*")
_ROLEPLAY_ASTERISK = re.compile(r"\*[^*\n]{1,40}\*")


def sanitize_reply(text: str) -> str:
    """剥掉名字前缀与星号动作旁白，让本地小模型的回复更像真人聊天。"""
    text = _NAME_PREFIX.sub("", text.strip())
    text = _ROLEPLAY_ASTERISK.sub("", text)
    # 去掉因删除留下的多余空白
    return re.sub(r"[ \t]{2,}", " ", text).strip()


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

    def _build_context(self, report: dict, memories: list[str], intent: str | None = None) -> str:
        lines = ["【智囊团圆桌纪要 · 供参考，用你自己的话，别照搬】"]
        if intent in ("tool", "research", "coding"):
            lines.append(
                f"⚠ 用户意图疑似需要动手（{intent}），但执行层还没上线（P2 才有）——"
                "口头回应就行，真要动手的明说现在还做不到，别假装能做。"
            )
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

    def _write_decision_trace(
        self, text: str, reply: str, report: dict, trace_id: str, moa_report_ref: str | None = None
    ) -> str:
        trace = DecisionTrace(
            id=f"dec_{ULID()}",
            ts=datetime.now(UTC),
            trace_id=trace_id,
            context_digest=_digest(text),
            candidates=[Candidate(content_digest=_digest(reply))],
            chosen=0,
            reasoning=report.get("suggested_strategy") or "本地灵魂直接作答（P0 单候选）",
            moa_report_ref=moa_report_ref,
        )
        self.cbg_path.parent.mkdir(parents=True, exist_ok=True)
        with self.cbg_path.open("a", encoding="utf-8") as f:
            f.write(trace.model_dump_json() + "\n")
        return trace.id

    async def respond(
        self,
        text: str,
        trace_id: str | None = None,
        intent: str | None = None,
        *,
        speaker: str | None = None,
        speaker_name: str | None = None,
        speaker_level: int = 0,
    ) -> tuple[str, dict]:
        """对一句话作答，返回 (回复文本, 圆桌纪要)。speaker 是说话人 id（群成员上下文用）。"""
        trace_id = trace_id or new_trace_id()
        # 群成员上下文：记一次互动，取对方画像
        person_line = ""
        if speaker:
            try:
                prof = people.touch(self.soul_name, speaker, speaker_name, speaker_level)
                person_line = people.profile_line(prof)
            except Exception:  # noqa: BLE001
                log.exception("people_touch_failed", speaker=speaker)
        # 互动改写作息：被邀约熬夜 → 她选择陪（只在本该睡的时段才真正生效）
        if any(h in text for h in _STAYUP_HINTS):
            try:
                life.override_stay_up(self.soul_name, reason="被拉着熬夜")
            except Exception:  # noqa: BLE001
                log.exception("life_override_failed")
        # 条件式 MoA（赶超 #4）：琐碎闲聊跳过云端管家团，本地秒回、零云成本
        if moa.should_analyze(text, intent):
            report = await moa.analyze(text, trace_id, route_fn=self._route_fn)
        else:
            report = {
                "summary": "",
                "seats": [],
                "intent": intent,
                "emotion_estimate": "",
                "suggested_strategy": "",
                "risk_flags": [],
            }
        memories = self.adapter.recall(text, k=6)
        # 情感状态：载入并按时间衰减，注入 system prompt
        mood = emotion.decayed(emotion.load(self.soul_name))
        context = self._build_context(report, memories, intent)
        messages = [
            {"role": "system", "content": self.handle.system_prompt},
            {"role": "system", "content": mood.to_prompt_line()},
            {"role": "system", "content": life.to_prompt_line(self.soul_name)},
        ]
        if person_line:
            messages.append({"role": "system", "content": person_line})
        # 行为学习（检索式）：把"她过去类似情形的应对"作为参考自己的范例注入
        try:
            past = experience.behavior_recall(self.soul_name, text, speaker, k=2)
        except Exception:  # noqa: BLE001
            past = []
        if past:
            ref = "；".join(p[:40] for p in past)
            messages.append(
                {
                    "role": "system",
                    "content": f"（你过去遇到类似的会这么应对，参考你自己的风格、别照抄）：{ref}",
                }
            )
        messages += [
            {"role": "system", "content": context},
            {"role": "user", "content": text},
        ]
        resp = await self._route_fn(
            RouteRequest(
                task="soul_reply",
                messages=messages,
                cost_tier="free",
                trace_id=trace_id,
                # 聊天不需要长篇内心戏：关掉 Qwen3 思考模式，回复更像真人、更快
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        reply = sanitize_reply(resp.content)
        # 情感更新（P1-W4）：按本轮意图/对方情绪给增量并落盘
        delta = emotion.event_delta(intent=intent, user_emotion=report.get("emotion_estimate"))
        emotion.save(emotion.apply(mood, delta), self.soul_name)
        report["emotion_delta"] = delta
        report["emotion_state"] = mood.model_dump(mode="json")
        # 管家纪要回填 SoulPackage（总规 §4：不流失；P4 自训练的原始矿藏，P1 只攒不训）
        moa_ref: str | None = None
        try:
            moa_ref = moa.save_report(self.soul_name, trace_id, report)
        except Exception:  # noqa: BLE001
            log.exception("moa_report_save_failed", trace_id=trace_id)
        dec_id = self._write_decision_trace(text, reply, report, trace_id, moa_report_ref=moa_ref)
        # 情景记忆写入（P1-W3）：失败不影响回复
        try:
            await episodic_writer.write_turn(
                self.soul_name,
                text,
                reply,
                trace_id,
                route_fn=self._route_fn,
                adapter=self.adapter,
            )
        except Exception:  # noqa: BLE001
            log.exception("episodic_write_failed", trace_id=trace_id)
        # 经验联想记忆（统一基座：图谱关系 + 行为学习的源）+ 按互动性质调对方好感
        try:
            experience.record(self.soul_name, trace_id, text, speaker, reply)
            if speaker:
                risks = report.get("risk_flags") or []
                people.apply_valence(self.soul_name, speaker, -0.3 if risks else 0.06)
        except Exception:  # noqa: BLE001
            log.exception("experience_record_failed", trace_id=trace_id)
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
