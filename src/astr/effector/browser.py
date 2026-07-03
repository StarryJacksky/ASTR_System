"""浏览器交互层（P2-W4~W5）：接口优先原则的旗舰插件。

分工：只读抓取用 toolkit.fetch_url（httpx，零依赖）；需要点击/表单/登录态的交互
才走本模块（Playwright，懒加载——未安装时给明确指引，不拦别的轨）。
DOM 优先：accessibility/文本定位 → 失败 ≥2 次由上层转视觉轨兜底（两轨融合）。
登录态：独立用户目录 D:/ASTR/effector/browsers/，站点必须过 guard 白名单。
"""

from __future__ import annotations

from pathlib import Path

import structlog

from astr.effector.guard import ActionRequest, Guard

log = structlog.get_logger("astr.effector.browser")

_INSTALL_HINT = (
    "Playwright 未就位：`uv add playwright && uv run playwright install chromium`。"
    "只读抓取不受影响（toolkit.fetch_url 走 httpx）。"
)

_PROFILE_DIR = Path("D:/ASTR/effector/browsers/chromium")


class Browser:
    """常驻 Chromium（懒启动）。每个动作先过 guard 的 browser 轨。"""

    def __init__(self, guard: Guard | None = None) -> None:
        self.guard = guard or Guard()
        self._pw = None
        self._ctx = None
        self._page = None

    async def _ensure(self):
        if self._page is not None:
            return self._page
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise RuntimeError(_INSTALL_HINT) from e
        self._pw = await async_playwright().start()
        _PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        self._ctx = await self._pw.chromium.launch_persistent_context(
            str(_PROFILE_DIR), headless=False
        )
        self._page = self._ctx.pages[0] if self._ctx.pages else await self._ctx.new_page()
        return self._page

    def _gate(self, description: str, site: str | None, *, uses_login: bool, trace_id: str):
        req = ActionRequest(
            track="browser",
            description=description,
            site=site,
            uses_login=uses_login,
            trace_id=trace_id,
        )
        verdict = self.guard.decide(req)
        self.guard.audit(req, verdict, {"module": "browser"})
        return verdict

    async def goto(self, url: str, *, uses_login: bool = False, trace_id: str = "") -> str:
        import httpx

        host = httpx.URL(url).host
        v = self._gate(f"打开 {url}", host, uses_login=uses_login, trace_id=trace_id)
        if v.decision == "deny":
            raise PermissionError(v.reason)
        page = await self._ensure()
        await page.goto(url, timeout=30_000)
        return await page.title()

    async def read_page(self, *, trace_id: str = "") -> str:
        """当前页可见文本（DOM 优先的"眼睛"）。"""
        page = await self._ensure()
        v = self._gate("读取当前页文本", None, uses_login=False, trace_id=trace_id)
        if v.decision == "deny":
            raise PermissionError(v.reason)
        return (await page.inner_text("body"))[:5000]

    async def click_text(self, text: str, *, trace_id: str = "") -> bool:
        """按可见文本定位并点击。失败返回 False（上层计数 ≥2 转视觉轨）。"""
        page = await self._ensure()
        v = self._gate(f"点击文本 {text}", None, uses_login=False, trace_id=trace_id)
        if v.decision == "deny":
            raise PermissionError(v.reason)
        try:
            await page.get_by_text(text, exact=False).first.click(timeout=5000)
            return True
        except Exception:  # noqa: BLE001
            log.warning("browser_click_miss", text=text)
            return False

    async def fill(self, label: str, value: str, *, trace_id: str = "") -> bool:
        page = await self._ensure()
        v = self._gate(f"填写 {label}", None, uses_login=False, trace_id=trace_id)
        if v.decision == "deny":
            raise PermissionError(v.reason)
        try:
            await page.get_by_label(label).fill(value, timeout=5000)
            return True
        except Exception:  # noqa: BLE001
            try:
                await page.get_by_placeholder(label).fill(value, timeout=3000)
                return True
            except Exception:  # noqa: BLE001
                return False

    async def close(self) -> None:
        if self._ctx:
            await self._ctx.close()
        if self._pw:
            await self._pw.stop()
        self._page = self._ctx = self._pw = None


__all__ = ["Browser"]
