"""情景记忆写入（P1-W3）：每轮对话 → 摘要 + 原文 chunk 落盘 + 增量嵌入。

原始文本永远是真身（soul_package/memory/chunks/YYYY-MM/），向量是可重建缓存。
摘要用本地模型（≤100 字），失败则用截断兜底。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog

from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.memory.episodic")

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]

_SUMMARY_PROMPT = "用不超过40字、第三人称客观地概括下面这轮对话的要点（只输出概括，不要引号）：\n"


async def _summarize(user_text: str, reply: str, trace_id: str, route_fn: RouteFn) -> str:
    convo = f"用户：{user_text}\n露怀秋：{reply}"
    try:
        resp = await route_fn(
            RouteRequest(
                task="soul_reply",  # 本地免费档
                messages=[{"role": "user", "content": _SUMMARY_PROMPT + convo}],
                cost_tier="free",
                trace_id=trace_id,
                require_local=True,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        s = resp.content.strip().replace("\n", " ")
        return s[:100] if s else user_text[:100]
    except Exception as e:  # noqa: BLE001
        log.warning("summary_failed", error=str(e))
        return user_text[:100]


def _chunk_text(
    summary: str, user_text: str, reply: str, ts: datetime, visibility: str, origin: str
) -> str:
    # 出处写进 chunk 首部注释（真身），向量库重建据此还原（chunks_loader.parse_provenance）
    prov = f"ts={ts.isoformat()} visibility={visibility}"
    if origin:
        prov += f" origin={origin}"
    return f"<!-- {prov} -->\n摘要：{summary}\n\n用户：{user_text}\n露怀秋：{reply}\n"


async def write_turn(
    soul_name: str,
    user_text: str,
    reply: str,
    trace_id: str,
    *,
    route_fn: RouteFn,
    adapter=None,
    visibility: str = "private",
    origin: str = "",
) -> str:
    """记一轮对话：摘要 + 落 chunk 文件 + 增量入向量库。返回 chunk 路径。
    visibility: private（私聊/主人/网页）/ group（群里）——群里检索到 private 记忆会被提示谨慎。
    origin: 出处标识（平台:群/人），供日后主体性板块判断分寸。"""
    ts = datetime.now(UTC)
    summary = await _summarize(user_text, reply, trace_id, route_fn)

    chunks_root = get_settings().soul_package_dir / soul_name / "memory" / "chunks"
    month_dir = chunks_root / ts.strftime("%Y-%m")
    month_dir.mkdir(parents=True, exist_ok=True)
    doc_id = f"{soul_name}:episodic:{trace_id}"
    path = month_dir / f"{trace_id}.md"
    text = _chunk_text(summary, user_text, reply, ts, visibility, origin)
    path.write_text(text, encoding="utf-8")

    if adapter is not None:
        meta = {"visibility": visibility, "ts": ts.isoformat()}
        if origin:
            meta["origin"] = origin
        # 摘要+原文一起入库，检索时短查询也能命中
        adapter.add_memory(f"{summary}。{user_text} {reply}", doc_id, metadata=meta)

    log.info(
        "episodic_written",
        trace_id=trace_id,
        summary=summary[:40],
        visibility=visibility,
        path=str(path),
    )
    return str(path)
