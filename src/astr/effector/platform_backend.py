"""平台抽象层（P2 跨平台策略）：视觉轨里只有这三件事是平台相关的——
截屏、输入注入、窗口枚举。其余（状态机/护栏/审计/感知）全平台共用。

Windows 本阶段落地（mss/pyautogui/pygetwindow，懒加载）；
mac(Quartz)/linux(X11/Wayland) 留接口，P6 随 M5 Max 补 mac backend（配合迁移剧本）。
"""

from __future__ import annotations

import sys
from abc import ABC, abstractmethod

import structlog

log = structlog.get_logger("astr.effector.platform")


class PlatformBackend(ABC):
    """视觉轨的"手和眼"。所有动作由 cu_engine 调用（那里已过护栏）。"""

    @abstractmethod
    def screenshot(self) -> bytes:  # PNG bytes
        ...

    @abstractmethod
    def click(self, x: int, y: int, *, double: bool = False) -> None: ...

    @abstractmethod
    def type_text(self, text: str) -> None: ...

    @abstractmethod
    def key(self, combo: str) -> None:  # 如 "enter" / "ctrl+s"
        ...

    @abstractmethod
    def active_window(self) -> str:
        """前台窗口的进程名（如 explorer.exe，guard 的应用白名单校验用）。"""

    @abstractmethod
    def screen_size(self) -> tuple[int, int]: ...

    def activate_title(self, title_substr: str) -> bool:
        """把标题含 title_substr 的窗口切到前台（焦点被夺时 cu_engine 回切用）。"""
        return False

    def input_idle_s(self) -> float | None:
        """距系统最后一次键鼠输入过了几秒。None=平台不支持。
        cu_engine 用它区分"我们注入的输入"和"主人碰了键鼠"——主人永远赢席位。"""
        return None

    def active_window_title(self) -> str:
        """前台窗口标题（资源管理器标题=当前文件夹，给规划器"我在哪"的本体感）。"""
        return ""


class WindowsBackend(PlatformBackend):
    """Windows 实现。依赖懒加载：mss（截屏）/ pyautogui（输入）/ pygetwindow（窗口）。"""

    def __init__(self) -> None:
        import mss  # 懒加载：缺依赖时在此报清楚，而不是 import astr 就炸

        self._mss = mss.mss()

    def screenshot(self) -> bytes:
        import mss.tools

        mon = self._mss.monitors[1]
        shot = self._mss.grab(mon)
        return mss.tools.to_png(shot.rgb, shot.size)

    def click(self, x: int, y: int, *, double: bool = False) -> None:
        import pyautogui

        pyautogui.click(x, y, clicks=2 if double else 1, interval=0.08)

    def type_text(self, text: str) -> None:
        import pyautogui
        import pyperclip

        # 中文用剪贴板粘贴（pyautogui.write 不支持 IME 字符）
        pyperclip.copy(text)
        pyautogui.hotkey("ctrl", "v")

    def key(self, combo: str) -> None:
        import pyautogui

        keys = [k.strip() for k in combo.lower().split("+") if k.strip()]
        if len(keys) > 1:
            # 组合键按太快资源管理器会漏识别（实测 ctrl+shift+n 不生效）——放慢键程
            pyautogui.hotkey(*keys, interval=0.12)
        else:
            pyautogui.press(keys[0])

    def active_window(self) -> str:
        # guard 的应用白名单按进程名（explorer.exe）匹配——窗口标题随内容变
        # （"sandbox - 文件资源管理器"），拿标题去精确匹配永远对不上。
        try:
            import ctypes
            from ctypes import wintypes

            u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
            hwnd = u32.GetForegroundWindow()
            if not hwnd:
                return ""
            pid = wintypes.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            h = k32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return ""
            try:
                buf = ctypes.create_unicode_buffer(260)
                size = wintypes.DWORD(260)
                if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                    return buf.value.rsplit("\\", 1)[-1]
                return ""
            finally:
                k32.CloseHandle(h)
        except Exception:  # noqa: BLE001
            return ""

    def screen_size(self) -> tuple[int, int]:
        mon = self._mss.monitors[1]
        return mon["width"], mon["height"]

    def activate_title(self, title_substr: str) -> bool:
        # SetForegroundWindow 对后台进程默认失效（只闪任务栏）——ALT 空击解锁是
        # 微软认可的老方案；pygetwindow.activate 不带它，实测拉不起已存在的窗口。
        try:
            import ctypes
            import time as _time

            import pygetwindow

            wins = pygetwindow.getWindowsWithTitle(title_substr)
            if not wins:
                return False
            w = wins[0]
            if w.isMinimized:
                w.restore()
            u32 = ctypes.windll.user32
            u32.keybd_event(0x12, 0, 0, 0)  # ALT down
            u32.keybd_event(0x12, 0, 2, 0)  # ALT up
            u32.SetForegroundWindow(w._hWnd)
            _time.sleep(0.3)
            return u32.GetForegroundWindow() == w._hWnd
        except Exception:  # noqa: BLE001
            return False

    def active_window_title(self) -> str:
        try:
            import ctypes

            u32 = ctypes.windll.user32
            hwnd = u32.GetForegroundWindow()
            if not hwnd:
                return ""
            buf = ctypes.create_unicode_buffer(256)
            u32.GetWindowTextW(hwnd, buf, 256)
            return buf.value
        except Exception:  # noqa: BLE001
            return ""

    def input_idle_s(self) -> float | None:
        try:
            import ctypes

            class _LII(ctypes.Structure):
                _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

            lii = _LII(cbSize=ctypes.sizeof(_LII))
            if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
                return None
            # 同为 GetTickCount 刻度（ms），相减天然回绕安全（49.7 天周期内）
            age = (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) & 0xFFFFFFFF
            return age / 1000.0
        except Exception:  # noqa: BLE001
            return None


def get_backend() -> PlatformBackend:
    if sys.platform == "win32":
        return WindowsBackend()
    raise NotImplementedError(
        f"平台 {sys.platform} 的视觉轨 backend 未实现（mac 随 M5 Max 在 P6 落地，"
        "见 P2 跨平台策略）——headless 轨不受影响，天然跨平台。"
    )


__all__ = ["PlatformBackend", "WindowsBackend", "get_backend"]
