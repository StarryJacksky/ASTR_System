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


def _cmd_voice(args: argparse.Namespace) -> int:
    from astr.sensors import voice

    return voice.main(["--download"] if args.download else [])


def _cmd_tts(_: argparse.Namespace) -> int:
    from astr.presentation import tts

    return tts.main()


def _cmd_watch(args: argparse.Namespace) -> int:
    from astr.ops import watchdog

    argv = []
    if args.interval is not None:
        argv += ["--interval", str(args.interval)]
    if args.once:
        argv += ["--once"]
    return watchdog.main(argv)


def _cmd_voiceprint(args: argparse.Namespace) -> int:
    from astr.sensors import voiceprint

    if args.vp_action == "download":
        from astr.sensors.voice_models import download_speaker_model

        return download_speaker_model()
    if args.vp_action == "enroll":
        if not args.wavs:
            print("用法: astr voiceprint enroll <你的录音1.wav> [录音2.wav ...]", file=sys.stderr)
            return 2
        name = args.name or voiceprint.get_settings().astr_owner_id
        return voiceprint.enroll(name, args.wavs)
    if args.vp_action == "enroll-mic":
        name = args.name or voiceprint.get_settings().astr_owner_id
        return voiceprint.enroll_mic(name, n=args.samples, seconds=args.seconds)
    if args.vp_action == "verify":
        if not args.wavs:
            print("用法: astr voiceprint verify <录音.wav>", file=sys.stderr)
            return 2
        samples, sr = voiceprint.read_wave(args.wavs[0])
        matched, score = voiceprint.verify(samples, sr, args.name)
        print(
            f"匹配={'是' if matched else '否'}  相似度={score:.3f}  阈值={voiceprint.get_settings().voiceprint_threshold}"
        )
        return 0 if matched else 1
    print("用法: astr voiceprint download|enroll|verify", file=sys.stderr)
    return 2


def _cmd_platform(args: argparse.Namespace) -> int:
    if args.platform_action == "probe":
        from astr.sensors.platform.caps import caps_path, probe

        data = probe()
        for name, caps in data["platforms"].items():
            print(f"{name}: {len(caps)} 能力 -> {', '.join(caps)}")
        print(f"已写入 {caps_path()}")
        return 0
    print("用法: astr platform probe", file=sys.stderr)
    return 2


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

    p_plat = sub.add_parser("platform", help="平台能力探测（落 platform_caps.json）")
    p_plat.add_argument("platform_action", choices=["probe"])
    p_plat.set_defaults(func=_cmd_platform)

    p_voice = sub.add_parser("voice", help="语音输入监听（喊唤醒词→转写→ingest）")
    p_voice.add_argument(
        "--download", action="store_true", help="下载 SenseVoice + silero_vad 模型"
    )
    p_voice.set_defaults(func=_cmd_voice)

    p_tts = sub.add_parser("tts", help="语音输出（订阅 presentation.tts → 合成播放）")
    p_tts.set_defaults(func=_cmd_tts)

    p_watch = sub.add_parser("watch", help="全栈看门狗/浸泡监控（健康巡检 + 掉线告警）")
    p_watch.add_argument("--interval", type=int, default=None, help="巡检间隔秒")
    p_watch.add_argument("--once", action="store_true", help="只巡检一轮、打印、退出")
    p_watch.set_defaults(func=_cmd_watch)

    p_vp = sub.add_parser("voiceprint", help="声纹鉴权（注册主人，语音入口升 L2）")
    p_vp.add_argument("vp_action", choices=["download", "enroll", "enroll-mic", "verify"])
    p_vp.add_argument("wavs", nargs="*", help="录音 wav 路径（enroll 可多段，verify 取第一段）")
    p_vp.add_argument("--name", default=None, help="声纹归属（默认 owner_id）")
    p_vp.add_argument("--samples", type=int, default=5, help="enroll-mic 录几段（默认5）")
    p_vp.add_argument("--seconds", type=float, default=4.0, help="enroll-mic 每段秒数（默认4）")
    p_vp.set_defaults(func=_cmd_voiceprint)

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
