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
        """前台窗口的进程/标题（guard 的应用白名单校验用）。"""

    @abstractmethod
    def screen_size(self) -> tuple[int, int]: ...


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
        pyautogui.hotkey(*keys) if len(keys) > 1 else pyautogui.press(keys[0])

    def active_window(self) -> str:
        try:
            import pygetwindow

            w = pygetwindow.getActiveWindow()
            return w.title if w else ""
        except Exception:  # noqa: BLE001
            return ""

    def screen_size(self) -> tuple[int, int]:
        mon = self._mss.monitors[1]
        return mon["width"], mon["height"]


def get_backend() -> PlatformBackend:
    if sys.platform == "win32":
        return WindowsBackend()
    raise NotImplementedError(
        f"平台 {sys.platform} 的视觉轨 backend 未实现（mac 随 M5 Max 在 P6 落地，"
        "见 P2 跨平台策略）——headless 轨不受影响，天然跨平台。"
    )


__all__ = ["PlatformBackend", "WindowsBackend", "get_backend"]
