"""显存分时（P2-W6，01 §1）：8GB 卡上 LLM 与视觉模型不能共驻。

CU 会话开始：停 llama-server（灵魂自动经 routes.yaml fallback 走 PromptOnlyAdapter/云端，
soul 层无感知）→ 视觉模型占卡；会话结束：反向恢复。
用法：`async with vram_session(): await cu.run_task(...)`。
"""

from __future__ import annotations

import asyncio
import contextlib
import subprocess

import httpx
import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.effector.vram")


async def llama_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(get_settings().llama_models_url)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


def stop_llama() -> bool:
    """按进程名停 llama-server（Windows taskkill；非 win 用 pkill）。"""
    s = get_settings()
    import sys

    cmd = (
        ["taskkill", "/IM", s.llama_process_name, "/F"]
        if sys.platform == "win32"
        else ["pkill", "-f", s.llama_process_name]
    )
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=15, check=False)
        ok = r.returncode == 0
        log.info("llama_stopped" if ok else "llama_stop_noop", rc=r.returncode)
        return ok
    except Exception as e:  # noqa: BLE001
        log.warning("llama_stop_failed", error=str(e))
        return False


def start_llama() -> bool:
    """经启动脚本拉起 llama-server（后台分离进程）。"""
    s = get_settings()
    if not s.llama_start_script.exists():
        log.warning("llama_start_script_missing", path=str(s.llama_start_script))
        return False
    try:
        subprocess.Popen(  # noqa: S603 —— 路径来自 Settings，非用户输入
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(s.llama_start_script)],
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log.info("llama_start_spawned")
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("llama_start_failed", error=str(e))
        return False


@contextlib.asynccontextmanager
async def vram_session(wait_recover_s: float = 60.0):
    """CU 期间独占显存；退出时恢复本地 LLM 并等它活过来（最多 wait_recover_s）。"""
    was_alive = await llama_alive()
    if was_alive:
        stop_llama()
        await asyncio.sleep(1.5)  # 等显存真正释放
    try:
        yield
    finally:
        if was_alive:
            start_llama()
            deadline = asyncio.get_event_loop().time() + wait_recover_s
            while asyncio.get_event_loop().time() < deadline:
                if await llama_alive():
                    log.info("llama_recovered")
                    break
                await asyncio.sleep(2.0)
            else:
                log.warning("llama_recover_timeout")


__all__ = ["llama_alive", "start_llama", "stop_llama", "vram_session"]
