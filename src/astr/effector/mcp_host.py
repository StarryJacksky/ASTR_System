"""MCP 客户端宿主（P2-W2）：把外部 MCP server 的工具注册进统一工具箱。

配置：.env 的 MCP_SERVERS（JSON 数组）：
  [{"name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/ASTR"]}]
不配置 = 不启动（内置工具箱已覆盖日常）。连接失败只告警不拦 Core——外部工具是增益不是依赖。
外部工具统一走 guard 的 mcp 轨（三档审批照管；危险类可在注册时标记）。
"""

from __future__ import annotations

import json
from contextlib import AsyncExitStack

import structlog

from astr.contracts.settings import get_settings
from astr.effector.toolkit import Toolkit, ToolSpec

log = structlog.get_logger("astr.effector.mcp")


class McpHost:
    def __init__(self, toolkit: Toolkit) -> None:
        self.toolkit = toolkit
        self._stack = AsyncExitStack()
        self.connected: list[str] = []

    async def start(self) -> int:
        """按配置连所有 server，注册其工具。返回注册的工具数。"""
        raw = get_settings().mcp_servers.strip()
        if not raw:
            return 0
        try:
            servers = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("mcp_servers_config_invalid")
            return 0
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
        except ImportError:
            log.warning("mcp_sdk_missing", hint="uv add mcp")
            return 0
        count = 0
        for srv in servers:
            name = srv.get("name", "mcp")
            try:
                params = StdioServerParameters(
                    command=srv["command"], args=srv.get("args", []), env=srv.get("env")
                )
                read, write = await self._stack.enter_async_context(stdio_client(params))
                session = await self._stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                tools = await session.list_tools()
                for t in tools.tools:
                    spec = ToolSpec(
                        name=f"{name}.{t.name}",
                        description=(t.description or t.name)[:200] + " args: 按该工具 schema",
                        dangerous_category=srv.get("dangerous_category"),
                    )

                    def _make(sess: ClientSession, tool_name: str):
                        async def _call(args: dict) -> str:
                            result = await sess.call_tool(tool_name, args)
                            parts = [c.text for c in result.content if getattr(c, "text", None)]
                            return "\n".join(parts)[:3000]

                        return _call

                    self.toolkit.register_external(spec, _make(session, t.name))
                    count += 1
                self.connected.append(name)
                log.info("mcp_server_connected", server=name, tools=count)
            except Exception as e:  # noqa: BLE001 —— 单个 server 挂了不拦其它
                log.warning("mcp_server_failed", server=name, error=str(e))
        return count

    async def stop(self) -> None:
        await self._stack.aclose()


__all__ = ["McpHost"]
