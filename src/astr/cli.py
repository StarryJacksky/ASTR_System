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
