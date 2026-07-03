"""视觉 Computer Use 引擎（P2-W6~W7）：截屏 → 感知 → 规划 → 单步 → 验证 的状态机。

设计要点：
- Perceiver 可插拔：OmniParser-v2 权重就位后接 OmniPerceiver；未就位时 StubPerceiver
  给出明确指引而不是装死——引擎结构先立正，感知件按需插。
- 每步开工前：estop.check()（急停 <1 步停手）+ guard 应用白名单（前台窗口必须在册）。
- 每步落审计（hash 链）+ 截图存档；步数硬上限（guard_policy.max_steps_per_task）。
- 规划走 tool_planning 任务（强模型），输出单步动作 JSON；显存分时由 vram_broker 包住。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

import structlog
from pydantic import BaseModel, ValidationError

from astr.contracts.router import RouteRequest
from astr.contracts.settings import get_settings
from astr.effector import estop
from astr.effector.guard import ActionRequest, Guard
from astr.effector.platform_backend import PlatformBackend
from astr.soul.moa import RouteFn

log = structlog.get_logger("astr.effector.cu")


class UIElement(BaseModel):
    label: str  # 元素语义（"开始菜单"/"发送按钮"…）
    x: int
    y: int
    w: int = 0
    h: int = 0


class Perceiver(Protocol):
    def parse(self, png: bytes) -> list[UIElement]: ...


class StubPerceiver:
    """占位感知器：权重未就位时给明确指引（引擎可测，感知件按需插）。"""

    HINT = (
        "视觉感知件未就位：需下载 OmniParser-v2 权重到 D:/ASTR/embodiments/vision/ "
        "并接 OmniPerceiver（P2-W6 卡）。headless 轨不受影响。"
    )

    def parse(self, png: bytes) -> list[UIElement]:  # noqa: ARG002
        raise RuntimeError(self.HINT)


class CuStep(BaseModel):
    action: Literal["click", "double_click", "type", "key", "done", "abort"]
    target: str | None = None  # 元素 label（click 类）
    text: str | None = None  # type/key 的内容
    reason: str = ""


class CuReport(BaseModel):
    ok: bool
    steps_taken: int
    transcript: list[str] = []
    error: str | None = None


_PLAN_SYS = (
    "你是桌面操作规划器。给定任务目标、当前屏幕元素清单和已执行步骤，输出下一步动作。"
    '只输出 JSON：{"action":"click|double_click|type|key|done|abort","target":"元素label或null",'
    '"text":"输入内容或null","reason":"一句话"}。任务完成输出 done；无法完成输出 abort。'
)


class CuEngine:
    def __init__(
        self,
        backend: PlatformBackend,
        perceiver: Perceiver,
        *,
        guard: Guard | None = None,
        route_fn: RouteFn,
    ) -> None:
        self.backend = backend
        self.perceiver = perceiver
        self.guard = guard or Guard()
        self.route_fn = route_fn
        self.shots_dir = Path(str(self.guard.policy.audit.get("log_dir", "D:/ASTR/effector/logs")))

    async def _plan_step(
        self, goal: str, elements: list[UIElement], history: list[str], trace_id: str
    ) -> CuStep | None:
        catalog = "\n".join(f"- {e.label} @({e.x},{e.y})" for e in elements[:60])
        user = f"目标：{goal}\n屏幕元素：\n{catalog}\n已执行：{history or '（无）'}"
        try:
            resp = await self.route_fn(
                RouteRequest(
                    task="tool_planning",
                    messages=[
                        {"role": "system", "content": _PLAN_SYS},
                        {"role": "user", "content": user},
                    ],
                    cost_tier=get_settings().tool_planning_tier,  # type: ignore[arg-type]
                    trace_id=trace_id,
                )
            )
            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = raw[raw.find("{") : raw.rfind("}") + 1]
            return CuStep.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError):
            log.warning("cu_plan_parse_failed", trace_id=trace_id)
            return None
        except Exception:  # noqa: BLE001 —— 供应商异常不拖垮任务，规划失败即中止
            log.warning("cu_plan_route_failed", trace_id=trace_id)
            return None

    def _save_shot(self, png: bytes, trace_id: str, step: int) -> str:
        d = self.shots_dir / "shots"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{trace_id}_{step:02d}_{datetime.now(UTC):%H%M%S}.png"
        p.write_bytes(png)
        return str(p)

    async def run_task(self, goal: str, *, trace_id: str, confirmed: bool = False) -> CuReport:
        """跑一个视觉任务。每步：急停查 → 白名单查 → 感知 → 规划 → 执行 → 审计。"""
        max_steps = self.guard.policy.max_steps_per_task
        transcript: list[str] = []
        for step_no in range(1, max_steps + 1):
            try:
                estop.check()
            except estop.EmergencyStop as e:
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error=str(e)
                )
            # 白名单：前台窗口必须在册（每步都查——窗口可能中途切换）
            req = ActionRequest(
                track="visual",
                description=f"CU 步骤 {step_no}: {goal}",
                app=self.backend.active_window(),
                trace_id=trace_id,
            )
            verdict = self.guard.decide(req)
            if verdict.decision == "deny":
                self.guard.audit(req, verdict, {"step": step_no, "executed": False})
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error=verdict.reason
                )
            if verdict.decision == "confirm" and not confirmed:
                return CuReport(
                    ok=False,
                    steps_taken=step_no - 1,
                    transcript=transcript,
                    error="任务含危险动作，需主人确认后带 confirmed=True 重跑",
                )
            # 感知 → 规划
            png = self.backend.screenshot()
            shot_ref = self._save_shot(png, trace_id, step_no)
            try:
                elements = self.perceiver.parse(png)
            except RuntimeError as e:
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error=str(e)
                )
            plan = await self._plan_step(goal, elements, transcript, trace_id)
            if plan is None:
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error="规划失败"
                )
            transcript.append(f"{plan.action} {plan.target or plan.text or ''}（{plan.reason}）")
            self.guard.audit(
                req, verdict, {"step": step_no, "plan": plan.model_dump(), "shot": shot_ref}
            )
            # 执行
            if plan.action == "done":
                return CuReport(ok=True, steps_taken=step_no, transcript=transcript)
            if plan.action == "abort":
                return CuReport(
                    ok=False, steps_taken=step_no, transcript=transcript, error=plan.reason
                )
            if plan.action in ("click", "double_click"):
                el = next((e for e in elements if e.label == plan.target), None)
                if el is None:
                    transcript.append(f"⚠ 找不到元素 {plan.target}")
                    continue
                self.backend.click(el.x, el.y, double=plan.action == "double_click")
            elif plan.action == "type" and plan.text:
                self.backend.type_text(plan.text)
            elif plan.action == "key" and plan.text:
                self.backend.key(plan.text)
        return CuReport(
            ok=False, steps_taken=max_steps, transcript=transcript, error="达到单任务步数上限"
        )


__all__ = ["CuEngine", "CuReport", "CuStep", "Perceiver", "StubPerceiver", "UIElement"]
