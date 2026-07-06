"""键盘注入地基验证（cua 转向第一步，HANDOFF 第七轮 §下一任优先级 #1）。

背景：本地里程碑 12 轮未过，其中一堵墙是"本机 explorer 对注入 ctrl+shift+n 全聋"
（run4 实测三种注入均无效）。cua 调研裁定采纳其 driver 作底座——但精读
cua-driver/platform-windows 源码后发现关键事实：

  * cua 的 PostMessage 键盘路径（post_key）自己承认对加速键不可靠：
    PostMessage(WM_KEYDOWN, VK_CONTROL) 不更新 GetKeyState 的系统修饰键状态，
    TranslateAccelerator 系应用（绝大多数 Win32 原生程序）里 Ctrl+S 永远不触发。
  * cua 对热键的真实路径是 send_key_synthesized：AttachThreadInput 借前台线程的
    foreground-lock 令牌强切前台 → **验证前台确实切成** → SendInput（scancode 化）
    → 恢复原前台。失败则报错而非静默——这是它与我们旧 backend 的本质区别：
    pyautogui 直接 SendInput，从不验证前台，事件落在谁身上听天由命。

据此本脚本对沙箱 explorer 实测四条路径，成功判据 = 沙箱目录出现新文件夹：

  A  PostMessage WM_KEYDOWN+修饰键（cua post_key 复刻）——预期失败（GetKeyState 问题）
  B1 强切前台(验证) + SendInput VK 模式（pyautogui 同款事件、但有前台验证）
  B2 强切前台(验证) + SendInput scancode 模式（cua send_key_synthesized 复刻）
  C  对照组：pyautogui.hotkey（旧 backend 原样）

用法（约 30 秒）：
    uv run --no-sync python scripts/keyboard_probe.py
"""

from __future__ import annotations

import ctypes
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path

SANDBOX = Path("D:/ASTR/effector/sandbox")

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32

# ── Win32 常量 ────────────────────────────────────────────────────────────────
WM_KEYDOWN, WM_KEYUP = 0x0100, 0x0101
VK_CONTROL, VK_SHIFT, VK_N, VK_ESCAPE = 0x11, 0x10, 0x4E, 0x1B
MAPVK_VK_TO_VSC = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x0002, 0x0008


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _INPUT(ctypes.Structure):
    class