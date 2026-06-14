"""astr 命令行入口。子命令随任务卡逐步挂载（soul/cost/chat）。

设计：handler 内部惰性 import 各自实现模块，避免 `astr --version` 也要拉起 litellm/chromadb。
"""

from __future__ import annotations

import argparse
import os
import sys
from importlib.metadata import version


def _cmd_version(_: argparse.Namespace) -> int:
    print(f"astr {version('astr')}")
    return 0


def _cmd_soul(args: argparse.Namespace) -> int:
    if args.soul_action == "validate":
        from astr.ops.soul_validate import validate_cli

        return validate_cli(soul_name=args.soul_name)
    print("用法: astr soul validate [--soul-name justin]", file=sys.stderr)
    return 2


def _cmd_cost(args: argparse.Namespace) -> int:
    if args.cost_action == "today":
        from astr.ops.ledger import cost_today_cli

        return cost_today_cli()
    print("用法: astr cost today", file=sys.stderr)
    return 2


def _cmd_chat(_: argparse.Namespace) -> int:
    from astr.soul.chat_cli import chat_loop

    return chat_loop()


def _cmd_core(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("astr.core.app:app", host="127.0.0.1", port=args.port, log_level="info")
    return 0


def _cmd_heartbeat(args: argparse.Namespace) -> int:
    import asyncio

    from astr.bus.core import Bus
    from astr.router.core import route
    from astr.soul.heartbeat import tick

    async def _run() -> dict:
        return await tick(Bus.from_url(), args.soul_name, route)

    rec = asyncio.run(_run())
    print(f"内心独白：{rec['content'] or '(空)'}  | should_speak={rec['should_speak']}")
    return 0


def _cmd_memory(args: argparse.Namespace) -> int:
    from astr.memory import semantic

    if args.memory_action == "review":
        return semantic.review_cli(soul_name=args.soul_name)
    if args.memory_action == "add":
        semantic.add_pending(args.soul_name, args.fact)
        print(f"已加入待批：{args.fact}")
        return 0
    print("用法: astr memory review | astr memory add <事实>", file=sys.stderr)
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="astr", description="ASTR System CLI（露怀秋内核）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("version", help="打印版本").set_defaults(func=_cmd_version)

    p_soul = sub.add_parser("soul", help="灵魂包操作")
    p_soul.add_argument("soul_action", choices=["validate"])
    p_soul.add_argument("--soul-name", default="justin")
    p_soul.set_defaults(func=_cmd_soul)

    p_cost = sub.add_parser("cost", help="成本账本")
    p_cost.add_argument("cost_action", choices=["today"])
    p_cost.set_defaults(func=_cmd_cost)

    p_chat = sub.add_parser("chat", help="终端对话循环（soul_demo）")
    p_chat.set_defaults(func=_cmd_chat)

    p_core = sub.add_parser("core", help="启动 ASTR Core 守护进程（FastAPI :8300）")
    p_core.add_argument("--port", type=int, default=8300)
    p_core.set_defaults(func=_cmd_core)

    p_mem = sub.add_parser("memory", help="语义记忆（待批队列）")
    p_mem.add_argument("memory_action", choices=["review", "add"])
    p_mem.add_argument("fact", nargs="?", default="")
    p_mem.add_argument("--soul-name", default="justin")
    p_mem.set_defaults(func=_cmd_memory)

    p_hb = sub.add_parser("heartbeat", help="手动触发一次心跳独白（调试）")
    p_hb.add_argument("--soul-name", default="justin")
    p_hb.set_defaults(func=_cmd_heartbeat)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    rc = args.func(args)
    # chromadb/onnxruntime 在 Windows 解释器退出清理阶段会 native 崩溃（0xC0000005）。
    # 工作已完成（账本已 commit、CBG 已 flush），用 os._exit 跳过有问题的 atexit/native 清理。
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(rc if isinstance(rc, int) else 0)


if __name__ == "__main__":
    main()
