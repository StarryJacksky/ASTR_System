"""教学环（兼容垫片）→ 已升级为 L2 研讨引擎 `soul/discussion.py`（08 §3）。

旧的"并行批评→单向修订"不再存在：现在是线索式讨论（管家看得见彼此）+
她的答辩（异议权）+ 只按她服了的意见修订 + 师承档案。本模块仅保留 teach()
入口签名，委托 discussion.discuss()，既有引用与测试不破。
"""

from __future__ import annotations

from astr.soul.discussion import discuss
from astr.soul.moa import RouteFn


async def teach(
    soul_name: str,
    user_text: str,
    draft: str,
    report: dict,
    *,
    route_fn: RouteFn,
    trace_id: str,
) -> dict:
    """兼容入口：委托 L2 研讨。返回 {revision, changed, critiques, dissent}。"""
    return await discuss(
        soul_name, user_text, draft, report, route_fn=route_fn, trace_id=trace_id
    )


__all__ = ["teach"]
