"""L2 研讨（08 §3）：从"发小抄"到"真讨论"的核心实现。

替代旧教学环的单向"批评→修订"。协议（全程后台，不卡回复）：
  ① 线索式批评：管家**依次**发言，每人看得见开局观点+她的草稿+前面所有批评，
     可附议/反对前面的人——调用次数与并行相同，信息流却成了讨论（贵的是轮数不是可见性）；
  ② 她的答辩（本地 ¥0）：逐条表态，接受哪条为什么、反驳哪条为什么——**异议权**。
     管家说什么她就改什么=人格被灌输；她反驳且有理=人格在形成；
  ③ 修订（本地 ¥0）：只按她**接受**的意见改稿，反驳掉的不采纳；
  ④ 落数据：teaching.jsonl（全程）+ DPO（changed 才写，reason 含她的取舍）
     + CBG 补充行（candidates=[草稿,修订]，答辩即 reasoning——极品决策数据）
     + 师承档案（各管家记住这次交手，管家由此越来越懂她——互相学习的另一半）。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog
from ulid import ULID

from astr.contracts.router import RouteRequest
from astr.contracts.settings import get_settings
from astr.contracts.soul import Candidate, DecisionTrace
from astr.soul.moa import _ROLE_NAMES, SEAT_STYLE, SEAT_TASKS, RouteFn

log = structlog.get_logger("astr.soul.discussion")

# 讨论过程实时外发（生活区绷字）：async (seat, text) -> None
EmitFn = Callable[[str, str], Awaitable[None]]

# 批评席位优先级（report 无席位时兜底）：红队（挑刺）→ 逻辑 → 情感。
_CRITIC_ORDER = ["devil", "logic", "emotion", "zeitgeist", "librarian", "retrieval"]

_CRITIQUE_SYS = (
    "你是 露怀秋（秋秋）的幕后{role}。你的气质：{style}。"
    "她刚对一条消息给了一版**草稿**回复，几位参谋正在依次讨论。"
    "别替她重写——只用一两句话点出最关键的一处：她漏了什么 / 有没有更好的角度 / "
    "有没有风险或会伤到主人之处。前面参谋已说的观点你看得见，"
    "同意就明说附议并补充新东西，不同意就直接反对并说为什么——别重复别人说过的。"
    "{advisor_note}只输出你这一两句发言，不要客套、不要 JSON、不要复述她的话。"
)

_DISSENT_SYS = (
    "你是秋秋。几位参谋刚才批评了你那版草稿。逐条表态：哪条你服、一句为什么；"
    "哪条你不服、一句为什么——不服就顶回去，别装乖。保持你自己的腔（短、有态度、不端着）。"
    "每条一行，格式如「1 服：…」或「2 不服：…」。只输出表态。"
)

_REVISE_SYS = (
    "你是秋秋。下面是你的草稿、参谋们的批评、和你自己刚才的表态。"
    "只按你**表态里服了**的那些意见改稿；你顶回去的意见一概不采纳。"
    "保持你自己的腔（短、有态度、不端着、不解释自己、不背设定）。只输出改后的那句话。"
)


async def _critique_seat(
    seat: str,
    user_text: str,
    draft: str,
    openings: str,
    thread: list[tuple[str, str]],
    route_fn: RouteFn,
    trace_id: str,
    advisor_note: str,
) -> str:
    """一个管家在线索里发言（看得见前面所有人）。失败返回空串。"""
    prior = "\n".join(f"[{s}] {t}" for s, t in thread) or "（你是第一个发言的）"
    note = f"你与她的师承：{advisor_note}。" if advisor_note else ""
    try:
        resp = await asyncio.wait_for(
            route_fn(
                RouteRequest(
                    task=SEAT_TASKS[seat],
                    messages=[
                        {
                            "role": "system",
                            "content": _CRITIQUE_SYS.format(
                                role=_ROLE_NAMES[seat],
                                style=SEAT_STYLE.get(seat, ""),
                                advisor_note=note,
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"用户说：{user_text}\n秋秋的草稿：{draft}\n"
                                f"各参谋开局观点：{openings[:400] or '（无）'}\n"
                                f"讨论线索（按发言顺序）：\n{prior}"
                            ),
                        },
                    ],
                    cost_tier="cheap",  # 背景数据用便宜档
                    trace_id=trace_id,
                )
            ),
            timeout=30.0,
        )
        return resp.content.strip().replace("\n", " ")[:200]
    except Exception as e:  # noqa: BLE001
        log.warning("critique_failed", seat=seat, error=str(e))
        return ""


async def _local(route_fn: RouteFn, sys: str, user: str, trace_id: str) -> str:
    """本地免费档一跳（答辩/修订共用）。失败返回空串。"""
    try:
        resp = await route_fn(
            RouteRequest(
                task="soul_reply",
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user},
                ],
                cost_tier="free",
                trace_id=trace_id,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        return resp.content.strip()
    except Exception as e:  # noqa: BLE001
        log.warning("discussion_local_failed", error=str(e))
        return ""


def _append_jsonl(soul_name: str, rel: str, row: dict) -> None:
    p = get_settings().soul_package_dir / soul_name / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _write_cbg(
    soul_name: str,
    trace_id: str,
    user_text: str,
    draft: str,
    revision: str,
    dissent: str,
    changed: bool,
) -> None:
    """研讨补充决策：candidates=[草稿,修订]、chosen 反映她最终留了哪版、reasoning=答辩。

    这行是 CBG 里最贵的一类数据——"我为什么（不）听你的"。
    """

    def _d(t: str, n: int = 120) -> str:
        t = t.strip().replace("\n", " ")
        return t[:n] + ("…" if len(t) > n else "")

    trace = DecisionTrace(
        id=f"dec_{ULID()}",
        ts=datetime.now(UTC),
        trace_id=trace_id,
        context_digest=_d(f"研讨：{user_text}"),
        candidates=[
            Candidate(content_digest=_d(draft)),
            Candidate(content_digest=_d(revision or draft)),
        ],
        chosen=1 if changed else 0,
        reasoning=f"答辩：{_d(dissent, 200)}",
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


async def discuss(
    soul_name: str,
    user_text: str,
    draft: str,
    report: dict,
    *,
    route_fn: RouteFn,
    trace_id: str,
    emit: EmitFn | None = None,
) -> dict:
    """后台 L2 研讨一轮。返回 {revision, changed, critiques, dissent}。"""
    from astr.soul import advisors
    from astr.soul.orchestrator import sanitize_reply  # 延迟导入避免循环

    s = get_settings()
    # 批评 = 同一桌圆桌：L1 里给过开局理解的那帮管家来讨论她的草稿（而非另挑一批）
    seat_names = [
        str(x.get("seat")) for x in (report.get("seats") or []) if x.get("seat") in SEAT_TASKS
    ]
    critics = (seat_names or _CRITIC_ORDER)[: max(1, s.teaching_critics)]
    openings = report.get("summary", "")

    async def _say(seat: str, text: str) -> None:
        if emit is not None:
            try:
                await emit(seat, text)
            except Exception:  # noqa: BLE001 —— 外发失败不拦讨论
                log.warning("discussion_emit_failed", seat=seat)

    # ① 线索式批评（串行可见——真讨论的最小结构）
    thread: list[tuple[str, str]] = []
    for seat in critics:
        note = advisors.memory_line(soul_name, seat) if s.advisor_memory_enabled else ""
        c = await _critique_seat(seat, user_text, draft, openings, thread, route_fn, trace_id, note)
        if c:
            thread.append((seat, c))
            await _say(seat, c)
    if not thread:
        return {}
    critiques = [f"【{seat}】{text}" for seat, text in thread]

    # ② 她的答辩（异议权，本地 ¥0）
    numbered = "\n".join(f"{i + 1}. [{seat}] {text}" for i, (seat, text) in enumerate(thread))
    dissent = await _local(
        route_fn,
        _DISSENT_SYS,
        f"用户原话：{user_text}\n你的草稿：{draft}\n参谋批评：\n{numbered}",
        trace_id,
    )
    if dissent:
        await _say("秋秋", dissent)

    # ③ 修订：只采纳她服了的意见
    revision_raw = await _local(
        route_fn,
        _REVISE_SYS,
        f"用户原话：{user_text}\n你的草稿：{draft}\n参谋批评：\n{numbered}\n你的表态：\n{dissent or '（全部照单接受）'}",
        trace_id,
    )
    revision = sanitize_reply(revision_raw)
    changed = bool(revision) and revision.strip() != draft.strip()
    ts = datetime.now(UTC).isoformat()

    # ④ 落数据
    _append_jsonl(
        soul_name,
        "behavior_capsules/teaching.jsonl",
        {
            "ts": ts,
            "trace_id": trace_id,
            "prompt": user_text,
            "draft": draft,
            "critiques": critiques,
            "dissent": dissent,
            "revision": revision,
            "changed": changed,
        },
    )
    if changed:
        _append_jsonl(
            soul_name,
            "preferences/dpo_dataset.jsonl",
            {
                "ts": ts,
                "trace_id": trace_id,
                "prompt": user_text,
                "chosen": revision,
                "rejected": draft,
                "reason": "；".join(critiques)
                + (f"；她的取舍：{dissent[:200]}" if dissent else ""),
                "source": "discussion",
            },
        )
    try:
        _write_cbg(soul_name, trace_id, user_text, draft, revision, dissent, changed)
    except Exception:  # noqa: BLE001
        log.exception("discussion_cbg_failed", trace_id=trace_id)

    # 师承档案：各管家记住这次交手（她的答辩里有他们最该学的东西）
    if s.advisor_memory_enabled:
        for seat, text in thread:
            try:
                advisors.record(
                    soul_name,
                    seat,
                    f"我点评「{text[:50]}」；她答辩「{(dissent or '未表态')[:50]}」",
                )
                await advisors.distill_if_needed(soul_name, seat, route_fn, trace_id)
            except Exception:  # noqa: BLE001
                log.warning("advisor_record_failed", seat=seat)

    log.info(
        "discussion_done",
        trace_id=trace_id,
        critics=len(thread),
        changed=changed,
        dissented=bool(dissent),
    )
    return {"revision": revision, "changed": changed, "critiques": critiques, "dissent": dissent}


__all__ = ["discuss"]
