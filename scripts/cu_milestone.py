"""P2 里程碑·纯视觉轨："把沙箱文件夹按日期归类"端到端（headless 轨已另测）。

流程：种子文件（三个文件、两个月份）→ 打开资源管理器到沙箱并最大化 →
CuEngine 截屏→OmniPerceiver 感知→云规划→pyautogui 执行，每步过 guard
（app_whitelist=explorer.exe）+ 急停查 + 审计 hash 链 + 截图存档。

跑法：uv run --no-sync python scripts/cu_milestone.py
跑前：把手从键鼠上拿开；急停 Ctrl+Alt+Space 随时可按（已实测）。
耗时：每步含感知 5-15s + 规划 2-10s，全程约 3-15 分钟。
confirmed=True 的依据：主人明示继续 P2 里程碑实测（2026-07-05），任务发生在沙箱。
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# --local：本地 UI-TARS 端到端（隐私不出网）。必须在 import astr 前设 env——Settings 启动即读
if "--local" in sys.argv:
    os.environ["CU_GROUNDING_TIER"] = "free"
    os.environ["CU_GROUNDING_DIALECT"] = "ui_tars"

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

SANDBOX = Path("D:/ASTR/effector/sandbox")

GOAL = (
    "资源管理器已打开在 sandbox 文件夹，文件列表在屏幕上——不要切换驱动器或进别的文件夹。"
    "注意：屏幕上形如 2026-05-03 0:00 的是文件的修改日期文本，不是文件夹；"
    "2026-04、2026-05 两个文件夹现在还不存在，必须先由你创建。"
    '任务分两段：①建文件夹：click 工具栏的"新建文件夹"按钮 → type 2026-04 → key enter；'
    "再重复一次建 2026-05。②逐个移文件（4 月的进 2026-04，5 月的进 2026-05）："
    "click 文件名 → key ctrl+x → double_click 目标文件夹（点它的名字，不是日期）→ "
    "key ctrl+v → key alt+up 回上级。"
    "纪律：不要 type 任何不是文件夹名的内容；同一做法失败两次就换一种（比如键换点击）；"
    "看到意外窗口就 key alt+f4 关掉它；粘贴后看一眼文件确实出现在列表里再回上级，"
    "没出现就回上级重新剪切。三个文件都归位后输出 done。"
)


# 本地 UI-TARS-7B 专用 GOAL：应用知识已外置到《Windows 系统操作指南》（effector/os_skills，
# 引擎按任务自动注入）——GOAL 只说任务本身。这是 enikk 取经 #3 的落地：可教性 > 模型能力，
# 别让 7B 每轮从零发明"资源管理器怎么用"。
GOAL_LOCAL = (
    "资源管理器已打开在 sandbox 文件夹并最大化。文件列表里有三个文件："
    "report_apr.txt、photo_apr.txt、notes_may.txt。"
    "任务：①建两个文件夹 2026-04 和 2026-05（现在还不存在，各建一次）；"
    "②把文件名带 apr 的两个文件移进 2026-04，带 may 的移进 2026-05。"
    "严格按注入的操作指南做。全程留在 sandbox 里；三个文件都归位后 finished。"
)

SEED_NAMES = {"report_apr.txt", "photo_apr.txt", "notes_may.txt"}


def _clean_quick_access() -> None:
    """清掉快速访问里指向沙箱的死链。上轮建过的 2026-04 会被 Windows 记进"常用文件夹"，
    实体删了左侧死链还在——run2 实测 UI-TARS 点它撞出"位置不可用"弹窗，整个任务由此脱轨。"""
    ps = (
        "$qa = (New-Object -ComObject shell.application)"
        ".Namespace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}');"
        "$qa.Items() | Where-Object { $_.Path -like 'D:\\ASTR\\effector\\sandbox*' } | "
        "ForEach-Object { $_.InvokeVerb('removefromhome'); $_.InvokeVerb('unpinfromhome') }"
    )
    try:
        subprocess.run(  # noqa: S603
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except Exception:  # noqa: BLE001 —— 清理失败不拦任务（只是环境更脏一点）
        pass


def seed() -> None:
    """三个文件、两个月份——步数上限 25 内可完成的最小真实任务。幂等：清掉上轮一切残留
    （上轮实测产生过改名事故 ".txt" 和残余文件夹——沙箱里的东西只有种子有资格留下）。"""
    import shutil

    _clean_quick_access()
    SANDBOX.mkdir(parents=True, exist_ok=True)
    for sub in SANDBOX.iterdir():
        if sub.name not in SEED_NAMES:
            shutil.rmtree(sub) if sub.is_dir() else sub.unlink()
    for name, stamp in (
        ("report_apr.txt", datetime(2026, 4, 12)),
        ("photo_apr.txt", datetime(2026, 4, 20)),
        ("notes_may.txt", datetime(2026, 5, 3)),
    ):
        p = SANDBOX / name
        p.write_text(f"seed {name}\n", encoding="utf-8")
        t = stamp.timestamp()
        os.utime(p, (t, t))
    print(f"沙箱就绪：{[p.name for p in SANDBOX.iterdir()]}")


def _start_local_server() -> subprocess.Popen | None:
    """起本地 UI-TARS llama-server（:8081），等 /health 就绪（首次加载 ~30-90s）。"""
    import httpx

    script = Path(__file__).parent / "start_ui_tars.ps1"
    proc = subprocess.Popen(  # noqa: S603
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            if httpx.get("http://127.0.0.1:8081/health", timeout=2).status_code == 200:
                print("本地 UI-TARS 服务就绪 :8081")
                return proc
        except Exception:  # noqa: BLE001
            pass
        if proc.poll() is not None:
            print("UI-TARS 服务进程退出（权重没下完/显存不足？）")
            return None
        time.sleep(2)
    proc.terminate()
    print("UI-TARS 服务 180s 未就绪")
    return None


async def main() -> int:
    from astr.effector.cu_engine import CuEngine
    from astr.effector.omni_perceiver import build_perceiver
    from astr.effector.platform_backend import WindowsBackend
    from astr.effector.vram_broker import vram_session
    from astr.router.core import route

    seed()
    backend = WindowsBackend()
    perceiver = build_perceiver()
    if type(perceiver).__name__ == "StubPerceiver":
        print("感知件未就绪")
        return 1

    os.startfile(SANDBOX)  # noqa: S606 —— 打开资源管理器到沙箱
    time.sleep(2.5)
    # 预聚焦：主人在打字时 Windows 不给前台（席位属于主人）——等安静再上，最多 90s
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if (backend.input_idle_s() or 99.0) < 2.0:
            time.sleep(0.5)
            continue
        backend.activate_title("sandbox")
        time.sleep(0.5)
        if backend.active_window() == "explorer.exe":
            break
        time.sleep(1.0)
    else:
        print(f"预聚焦失败（90s 内主人一直在用键鼠或窗口拉不起）：前台 {backend.active_window()}")
        return 1
    backend.key("win+up")  # 最大化：桌面图标不进感知，元素清单干净
    time.sleep(1.0)

    trace_id = f"cu_milestone_{datetime.now():%Y%m%d_%H%M%S}"
    engine = CuEngine(backend, perceiver, route_fn=route)
    local_srv: subprocess.Popen | None = None
    try:
        async with vram_session():  # 先停 qwen 腾显存，再起 UI-TARS
            if "--local" in sys.argv:
                local_srv = _start_local_server()
                if local_srv is None:
                    return 1
            goal = GOAL_LOCAL if "--local" in sys.argv else GOAL
            report = await engine.run_task(
                goal,
                trace_id=trace_id,
                confirmed=True,
                refocus_title="sandbox",
                # 地盘围栏：她只被允许出现在沙箱和两个目标文件夹里（run6 逃出沙箱
                # 剪走了主人桌面的真实文件——围栏之后位置不对就不执行、自动返航）
                title_fence=("sandbox", "2026-04", "2026-05", "新建文件夹"),
            )
    finally:
        if local_srv is not None:
            local_srv.terminate()

    print(f"\n=== 结果 ok={report.ok} steps={report.steps_taken} ===")
    for i, line in enumerate(report.transcript, 1):
        print(f"  {i:02d}. {line}")
    if report.error:
        print("error:", report.error)
    final = sorted(str(p.relative_to(SANDBOX)) for p in SANDBOX.rglob("*"))
    print("沙箱终态：", final)
    return 0 if report.ok else 1


if __name__ == "__main__":
    code = asyncio.run(main())
    sys.stdout.flush()
    os._exit(code)  # CUDA/onnxruntime 拆卸竞态会在解释器正常退出时 segfault——结果已落盘，硬退
