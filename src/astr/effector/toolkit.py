"""内置工具箱（P2-W2/W4）：接口优先原则下的第一批"手"。

每个工具 = 一份说明（给规划器看）+ 一个执行函数（全部过护栏）。
文件类走 Headless（范围三档在那里执法）；网络类（fetch/arxiv）走 guard 的 browser 轨。
外部 MCP 工具由 mcp_host 在运行期注册进同一张表——灵魂层只看到统一的工具清单。
"""

from __future__ import annotations

import shutil
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import structlog
from pydantic import BaseModel

from astr.effector.guard import ActionRequest, Guard
from astr.effector.headless import Headless, OpResult

log = structlog.get_logger("astr.effector.toolkit")


class ToolSpec(BaseModel):
    name: str
    description: str  # 给规划器的人话说明（含参数说明）
    dangerous_category: str | None = None  # 天生危险类（发送/删除等），guard 强制 L3
    external: bool = False  # 来自 MCP server 的外部工具


class ToolCall(BaseModel):
    tool: str
    args: dict[str, Any] = {}


class Toolkit:
    """工具注册表 + 统一执行入口。"""

    def __init__(self, guard: Guard | None = None) -> None:
        self.guard = guard or Guard()
        self.headless = Headless(self.guard)
        self._external: dict[str, Callable[[dict], Awaitable[str]]] = {}
        self.specs: dict[str, ToolSpec] = {
            s.name: s
            for s in [
                ToolSpec(
                    name="list_dir",
                    description="列目录内容。args: {path}",
                ),
                ToolSpec(
                    name="read_file",
                    description="读文本文件，可选只看最后几行。args: {path, tail?}",
                ),
                ToolSpec(
                    name="write_file",
                    description="写文本文件（覆盖）。args: {path, content}",
                ),
                ToolSpec(
                    name="move",
                    description="移动/重命名文件或目录。args: {path, dest}",
                ),
                ToolSpec(
                    name="organize_by_date",
                    description="把目录下的文件按修改日期归入 YYYY-MM-DD 子文件夹。args: {path}",
                ),
                ToolSpec(
                    name="disk_usage",
                    description="查磁盘剩余空间。args: {drive}（如 'D:'）",
                ),
                ToolSpec(
                    name="fetch_url",
                    description="抓取网页正文（只读，不带登录态）。args: {url}",
                ),
                ToolSpec(
                    name="arxiv_search",
                    description="搜 arXiv 论文，返回标题+摘要首句+链接。args: {query, k?}",
                ),
            ]
        }

    def register_external(self, spec: ToolSpec, fn: Callable[[dict], Awaitable[str]]) -> None:
        """MCP 外部工具注册（mcp_host 调用）。"""
        spec.external = True
        self.specs[spec.name] = spec
        self._external[spec.name] = fn

    def catalog(self) -> str:
        """给规划器的工具清单（一行一个）。"""
        return "\n".join(f"- {s.name}: {s.description}" for s in self.specs.values())

    # ---------- 统一执行 ----------

    async def execute(
        self, call: ToolCall, *, confirmed: bool = False, trace_id: str = ""
    ) -> OpResult:
        spec = self.specs.get(call.tool)
        if spec is None:
            return OpResult(ok=False, error=f"没有 {call.tool} 这个工具")
        if spec.external:
            return await self._run_external(spec, call, confirmed=confirmed, trace_id=trace_id)
        fn = getattr(self, f"_tool_{call.tool}", None)
        if fn is None:
            return OpResult(ok=False, error=f"工具 {call.tool} 未实现")
        return await fn(call.args, confirmed=confirmed, trace_id=trace_id)

    async def _run_external(
        self, spec: ToolSpec, call: ToolCall, *, confirmed: bool, trace_id: str
    ) -> OpResult:
        req = ActionRequest(
            track="mcp",
            description=f"MCP 工具 {spec.name}: {call.args}",
            category=spec.dangerous_category,
            trace_id=trace_id,
        )
        verdict = self.guard.decide(req)
        if verdict.decision == "deny":
            self.guard.audit(req, verdict, {"tool": spec.name, "executed": False})
            return OpResult(ok=False, verdict=verdict, error=verdict.reason)
        if verdict.decision == "confirm" and not confirmed:
            return OpResult(ok=False, needs_confirmation=True, verdict=verdict)
        try:
            out = await self._external[spec.name](call.args)
        except Exception as e:  # noqa: BLE001
            self.guard.audit(req, verdict, {"tool": spec.name, "executed": False, "error": str(e)})
            return OpResult(ok=False, verdict=verdict, error=str(e))
        self.guard.audit(req, verdict, {"tool": spec.name, "executed": True})
        return OpResult(ok=True, verdict=verdict, result=out)

    # ---------- 文件类（走 Headless，范围三档执法）----------

    async def _tool_list_dir(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        return self.headless.run(
            "list_dir",
            target=str(a.get("path", "")),
            description=f"列目录 {a.get('path')}",
            confirmed=confirmed,
            trace_id=trace_id,
        )

    async def _tool_read_file(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        return self.headless.run(
            "read_text",
            target=str(a.get("path", "")),
            tail=a.get("tail"),
            description=f"读文件 {a.get('path')}",
            confirmed=confirmed,
            trace_id=trace_id,
        )

    async def _tool_write_file(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        return self.headless.run(
            "write_text",
            target=str(a.get("path", "")),
            content=str(a.get("content", "")),
            description=f"写文件 {a.get('path')}",
            confirmed=confirmed,
            trace_id=trace_id,
        )

    async def _tool_move(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        return self.headless.run(
            "move",
            target=str(a.get("path", "")),
            dest=str(a.get("dest", "")),
            description=f"移动 {a.get('path')} → {a.get('dest')}",
            confirmed=confirmed,
            trace_id=trace_id,
        )

    async def _tool_organize_by_date(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        return self.headless.run(
            "organize_by_date",
            target=str(a.get("path", "")),
            description=f"按日期归类 {a.get('path')}",
            confirmed=confirmed,
            trace_id=trace_id,
        )

    # ---------- 系统/网络类（browser/mcp 轨）----------

    async def _tool_disk_usage(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        drive = str(a.get("drive", "D:")).rstrip("\\/") + "\\"
        req = ActionRequest(track="mcp", description=f"查磁盘空间 {drive}", trace_id=trace_id)
        verdict = self.guard.decide(req)
        if verdict.decision == "deny":
            return OpResult(ok=False, verdict=verdict, error=verdict.reason)
        if verdict.decision == "confirm" and not confirmed:
            return OpResult(ok=False, needs_confirmation=True, verdict=verdict)
        try:
            u = shutil.disk_usage(drive)
        except OSError as e:
            return OpResult(ok=False, verdict=verdict, error=str(e))
        self.guard.audit(req, verdict, {"tool": "disk_usage", "executed": True})
        free_gb, total_gb = u.free / 2**30, u.total / 2**30
        return OpResult(
            ok=True, verdict=verdict, result=f"{drive} 剩余 {free_gb:.1f}GB / 共 {total_gb:.1f}GB"
        )

    async def _tool_fetch_url(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        url = str(a.get("url", ""))
        req = ActionRequest(
            track="browser", description=f"抓取网页 {url}", site=_host(url), trace_id=trace_id
        )
        verdict = self.guard.decide(req)
        if verdict.decision == "deny":
            return OpResult(ok=False, verdict=verdict, error=verdict.reason)
        if verdict.decision == "confirm" and not confirmed:
            return OpResult(ok=False, needs_confirmation=True, verdict=verdict)
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
                r = await c.get(url)
            text = _strip_html(r.text)[:3000]
        except Exception as e:  # noqa: BLE001
            self.guard.audit(
                req, verdict, {"tool": "fetch_url", "executed": False, "error": str(e)}
            )
            return OpResult(ok=False, verdict=verdict, error=str(e))
        self.guard.audit(req, verdict, {"tool": "fetch_url", "executed": True})
        return OpResult(ok=True, verdict=verdict, result=text)

    async def _tool_arxiv_search(self, a: dict, *, confirmed: bool, trace_id: str) -> OpResult:
        query, k = str(a.get("query", "")), int(a.get("k", 5))
        req = ActionRequest(
            track="browser", description=f"arXiv 搜索 {query}", site="arxiv.org", trace_id=trace_id
        )
        verdict = self.guard.decide(req)
        if verdict.decision == "deny":
            return OpResult(ok=False, verdict=verdict, error=verdict.reason)
        if verdict.decision == "confirm" and not confirmed:
            return OpResult(ok=False, needs_confirmation=True, verdict=verdict)
        url = "https://export.arxiv.org/api/query"
        params = {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": k,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.get(url, params=params)
            items = _parse_arxiv(r.text)
        except Exception as e:  # noqa: BLE001
            self.guard.audit(
                req, verdict, {"tool": "arxiv_search", "executed": False, "error": str(e)}
            )
            return OpResult(ok=False, verdict=verdict, error=str(e))
        self.guard.audit(req, verdict, {"tool": "arxiv_search", "executed": True})
        lines = [f"{i + 1}. {t} —— {s}（{link}）" for i, (t, s, link) in enumerate(items)]
        return OpResult(ok=True, verdict=verdict, result="\n".join(lines) or "没搜到")


def _host(url: str) -> str | None:
    try:
        return httpx.URL(url).host
    except Exception:  # noqa: BLE001
        return None


def _strip_html(html: str) -> str:
    import re

    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


_ATOM = "{http://www.w3.org/2005/Atom}"


def _parse_arxiv(xml_text: str) -> list[tuple[str, str, str]]:
    """Atom feed → [(标题, 摘要首句, 链接)]。"""
    out: list[tuple[str, str, str]] = []
    root = ET.fromstring(xml_text)
    for e in root.findall(f"{_ATOM}entry"):
        title = " ".join((e.findtext(f"{_ATOM}title") or "").split())
        summary = " ".join((e.findtext(f"{_ATOM}summary") or "").split())
        first = summary.split(". ")[0][:160]
        link = e.findtext(f"{_ATOM}id") or ""
        out.append((title, first, link))
    return out


__all__ = ["ToolCall", "ToolSpec", "Toolkit"]
