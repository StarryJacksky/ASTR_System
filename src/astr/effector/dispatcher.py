"""执行调度器（P2-W2/W3）：灵魂层与工具箱之间的那只手。

流程：主人委托（intent=tool）→ 规划（tool_planning 任务：强模型选工具填参数，8B 兜底）
→ 护栏判 → allow 执行 / confirm 挂 pending 由她在对话里要确认 / deny 如实说 →
结果作为【执行结果】回填她的上下文，她的回复据实说话（不假装干了）。
工具选择也是决策：每次 dispatch 落一行 CBG。急停每步先查。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

import structlog
from pydantic import BaseModel, ValidationError
from ulid import ULID

from astr.contracts.router import RouteRequest
from astr.contracts.settings import get_settings
from astr.contracts.soul import Candidate, DecisionTrace
from astr.effector import estop, pending
from astr.effector.toolkit import ToolCall, Toolkit
from astr.soul.moa import RouteFn

log = structlog.get_logger("astr.effector.dispatcher")

_toolkit: Toolkit | None = None


def get_toolkit() -> Toolkit:
    """进程级单例（audit 链要连续，别每次新建）。"""
    global _toolkit
    if _toolkit is None:
        _toolkit = Toolkit()
    return _toolkit


class ToolOutcome(BaseModel):
    status: Literal["executed", "needs_confirmation", "denied", "no_tool", "failed", "disabled"]
    summary: str = ""  # 给她上下文的一句话（真实结果/该问什么/为何拒）
    tool: str | None = None


_PLAN_SYS = (
    "你是执行规划器。根据用户委托，从工具清单里选一个工具并填好参数。"
    '只输出一个 JSON 对象：{{"tool": "工具名或null", "args": {{...}}, "why": "一句话"}}。'
    "没有合适工具、或委托只是聊天不需要动手，tool 填 null。路径一律用绝对路径。\n"
    "可用工具：\n{catalog}\n提示：沙箱目录是 {sandbox}；diary 在 D:/ASTR/ops/diary.md。"
)


class _Plan(BaseModel):
    tool: str | None = None
    args: dict = {}
    why: str = ""


async def _plan(text: str, trace_id: str, route_fn: RouteFn, tk: Toolkit) -> _Plan | None:
    s = get_settings()
    sys = _PLAN_SYS.format(catalog=tk.catalog(), sandbox=tk.guard.policy.sandbox_dir)
    for attempt in range(2):
        try:
            resp = await route_fn(
                RouteRequest(
                    task="tool_planning",
                    messages=[
                        {"role": "system", "content": sys},
                        {"role": "user", "content": text},
                    ],
                    cost_tier=s.tool_planning_tier,  # type: ignore[arg-type]
                    trace_id=trace_id,
                )
            )
            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = raw[raw.find("{") : raw.rfind("}") + 1]
            return _Plan.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError):
            log.warning("tool_plan_parse_failed", attempt=attempt)
        except Exception as e:  # noqa: BLE001
            log.warning("tool_plan_route_failed", attempt=attempt, error=str(e))
    return None


def _write_cbg(soul_name: str, trace_id: str, text: str, plan: _Plan, outcome: ToolOutcome) -> None:
    """工具选择也是决策（P2-W2）：选了什么工具、为什么、结局如何。"""

    def _d(t: str, n: int = 120) -> str:
        t = t.strip().replace("\n", " ")
        return t[:n] + ("…" if len(t) > n else "")

    trace = DecisionTrace(
        id=f"dec_{ULID()}",
        ts=datetime.now(UTC),
        trace_id=trace_id,
        context_digest=_d(f"委托：{text}"),
        candidates=[Candidate(content_digest=_d(f"{plan.tool or '不动手'}({plan.args})"))],
        chosen=0,
        reasoning=_d(f"{plan.why}；结局：{outcome.status}"),
    )
    p = (
        get_settings().soul_package_dir
        / soul_name
        / "causal_behavior_graph"
        / "decisions.cbg.jsonl"
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(trace.model_dump_json() + "\n")


async def _run(
    tk: Toolkit, call: ToolCall, *, confirmed: bool, trace_id: str, summary: str
) -> ToolOutcome:
    r = await tk.execute(call, confirmed=confirmed, trace_id=trace_id)
    if r.needs_confirmation:
        return ToolOutcome(status="needs_confirmation", summary=summary, tool=call.tool)
    if not r.ok:
        reason = r.error or (r.verdict.reason if r.verdict else "未知原因")
        status = "denied" if (r.verdict and r.verdict.decision == "deny") else "failed"
        return ToolOutcome(status=status, summary=reason, tool=call.tool)
    out = str(r.result)
    return ToolOutcome(status="executed", summary=out[:800], tool=call.tool)


async def dispatch(
    text: str,
    *,
    trace_id: str,
    route_fn: RouteFn,
    speaker: str | None,
    speaker_level: int,
    soul_name: str = "justin",
) -> ToolOutcome:
    """一次工具委托的完整调度。她的回复只据 outcome.summary 说话。"""
    s = get_settings()
    if not s.effector_enabled:
        return ToolOutcome(status="disabled", summary="执行层被关掉了")
    if estop.is_stopped():
        return ToolOutcome(status="denied", summary="急停未复位，先跟主人确认再干活")
    if speaker_level < 2:
        return ToolOutcome(status="denied", summary="执行层是 L2（主人）权限，这位使唤不动")

    tk = get_toolkit()
    plan = await _plan(text, trace_id, route_fn, tk)
    if plan is None:
        return ToolOutcome(status="failed", summary="规划器没给出可用方案")
    if not plan.tool:
        outcome = ToolOutcome(status="no_tool", summary=plan.why or "这事不用动手")
        _write_cbg(soul_name, trace_id, text, plan, outcome)
        return outcome

    call = ToolCall(tool=plan.tool, args=plan.args)
    human = f"{plan.tool} {plan.args}"
    outcome = await _run(tk, call, confirmed=False, trace_id=trace_id, summary=human)
    if outcome.status == "needs_confirmation" and speaker:
        import time

        pending.put(
            speaker,
            pending.PendingAction(call=call, summary=human, ts=time.time(), trace_id=trace_id),
        )
    _write_cbg(soul_name, trace_id, text, plan, outcome)
    log.info("tool_dispatch", tool=plan.tool, status=outcome.status, trace_id=trace_id)
    return outcome


async def resolve_pending(speaker: str, reply_text: str, *, trace_id: str) -> ToolOutcome | None:
    """主人对待确认动作的答复处理。无 pending 或答复无关返回 None（走正常聊天）。"""
    act = pending.get(speaker)
    if act is None:
        return None
    kind = pending.classify_reply(reply_text)
    if kind == "other":
        return None
    pending.pop(speaker)
    if kind == "deny":
        return ToolOutcome(
            status="no_tool", summary=f"主人叫停了：{act.summary}", tool=act.call.tool
        )
    tk = get_toolkit()
    outcome = await _run(
        tk, act.call, confirmed=True, trace_id=act.trace_id or trace_id, summary=act.summary
    )
    log.info("pending_confirmed", tool=act.call.tool, status=outcome.status)
    return outcome


__all__ = ["ToolOutcome", "dispatch", "get_toolkit", "resolve_pending"]
