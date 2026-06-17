"""后台教学圆桌（总规 §2.9 学习 / §4 自训练矿藏的真正源头）。

现状的 MoA 是"六个管家并行各写小抄 → 秋秋独答"——没讨论、她不在场、产不出学习数据。
这里补上真正的"教学"：她秒回的那条回复当作**草稿**，回完后在后台跑一轮——
  ① 几位管家**针对她这版草稿**批评（漏了啥/更好的角度/会不会伤主人；彼此能看到对方开局观点）；
  ② 秋秋**吸收批评、改出修订版**。
关键产物：(草稿 → 批评 → 修订) 三元组，天生是 P4 的 DPO 数据（rejected=草稿，chosen=修订，reason=教学），
也是"她为什么这么想/怎么被教会的"的真身。后台跑，不卡回复——日常不卡顿，金矿照挖。
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import structlog

from astr.contracts.router import RouteRequest
from astr.contracts.settings import get_settings
from astr.soul.moa import _ROLE_NAMES, SEAT_TASKS, RouteFn

log = structlog.get_logger("astr.soul.teaching")

# 批评席位优先级：红队（挑刺）→ 逻辑 → 情感。取前 N 个。
_CRITIC_ORDER = ["devil", "logic", "emotion", "zeitgeist", "librarian", "retrieval"]

_CRITIQUE_SYS = (
    "你是 露怀秋（秋秋）的幕后{role}。她刚对一条消息给了一版**草稿**回复。"
    "别替她重写——只针对这版草稿，一句话点出最关键的一处：她漏了什么 / 有没有更好的角度 / "
    "有没有风险或会伤到主人之处。其他参谋的开局观点：{openings}。"
    "只输出这一句教学，不要客套、不要 JSON、不要复述她的话。"
)

_REVISE_SYS = (
    "你是秋秋。下面是你刚才的草稿，和几位参谋对你的教学。结合教学改出更好的一版——"
    "保持你自己的腔（短、有态度、不端着、不解释自己、不背设定），不是照抄教学。只输出改后的那句话。"
)


async def _critique(
    seat: str, user_text: str, draft: str, openings: str, route_fn: RouteFn, trace_id: str
) -> str:
    """一个管家针对草稿给一句教学。失败返回空串。"""
    try:
        resp = await asyncio.wait_for(
            route_fn(
                RouteRequest(
                    task=SEAT_TASKS[seat],
                    messages=[
                        {
                            "role": "system",
                            "content": _CRITIQUE_SYS.format(
                                role=_ROLE_NAMES[seat], openings=openings[:400] or "（无）"
                            ),
                        },
                        {"role": "user", "content": f"用户说：{user_text}\n秋秋的草稿：{draft}"},
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


async def _revise(
    user_text: str, draft: str, critiques: list[str], route_fn: RouteFn, trace_id: str
) -> str:
    """秋秋（本地）吸收教学、改出修订版。"""
    from astr.soul.orchestrator import sanitize_reply  # 延迟导入避免循环

    teaching = "\n".join(f"- {c}" for c in critiques)
    try:
        resp = await route_fn(
            RouteRequest(
                task="soul_reply",
                messages=[
                    {"role": "system", "content": _REVISE_SYS},
                    {
                        "role": "user",
                        "content": f"你的草稿：{draft}\n\n参谋教学：\n{teaching}\n\n用户原话：{user_text}",
                    },
                ],
                cost_tier="free",
                trace_id=trace_id,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        return sanitize_reply(resp.content)
    except Exception as e:  # noqa: BLE001
        log.warning("revise_failed", error=str(e))
        return ""


def _append_jsonl(soul_name: str, rel: str, row: dict) -> None:
    p = get_settings().soul_package_dir / soul_name / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


async def teach(
    soul_name: str,
    user_text: str,
    draft: str,
    report: dict,
    *,
    route_fn: RouteFn,
    trace_id: str,
) -> dict:
    """后台教学一轮：批评草稿 → 修订 → 落学习数据。返回 {revision, changed, critiques}。"""
    s = get_settings()
    # 批评 = 同一桌圆桌：让②里给过开局理解的那帮管家来看她的草稿（而非另挑一批）。
    seat_names = [
        str(x.get("seat")) for x in (report.get("seats") or []) if x.get("seat") in SEAT_TASKS
    ]
    critics = (seat_names or _CRITIC_ORDER)[: max(1, s.teaching_critics)]
    openings = report.get("summary", "")
    results = await asyncio.gather(
        *(_critique(seat, user_text, draft, openings, route_fn, trace_id) for seat in critics)
    )
    critiques = [c for c in results if c]
    if not critiques:
        return {}
    revision = await _revise(user_text, draft, critiques, route_fn, trace_id)
    changed = bool(revision) and revision.strip() != draft.strip()
    ts = datetime.now(UTC).isoformat()

    # 全量教学痕迹（行为胶囊）——她被教的完整过程
    _append_jsonl(
        soul_name,
        "behavior_capsules/teaching.jsonl",
        {
            "ts": ts,
            "trace_id": trace_id,
            "prompt": user_text,
            "draft": draft,
            "critiques": critiques,
            "revision": revision,
            "changed": changed,
        },
    )
    # DPO 训练对（仅当修订确有改动）——P4 的现成金矿
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
                "reason": "；".join(critiques),
                "source": "teaching",
            },
        )
    log.info("teaching_done", trace_id=trace_id, critics=len(critiques), changed=changed)
    return {"revision": revision, "changed": changed, "critiques": critiques}


# 供测试与编排器引用
__all__ = ["teach"]
