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
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

import structlog
from pydantic import BaseModel, ValidationError, field_validator

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
    target: str | None = None  # 元素 label（两段式）/ 元素描述（grounded，仅记录用）
    text: str | None = None  # type/key 的内容
    x: int | None = None  # grounded：屏幕千分比坐标（0-1000），engine 换算像素
    y: int | None = None
    reason: str = ""

    @field_validator("target", "text", mode="before")
    @classmethod
    def _null_str(cls, v: object) -> object:
        # 弱模型会把 null 写成字符串 "null"（dispatcher 同款 bug，红队实测出）——
        # 不归一的话 type 动作真的会把 "null" 四个字母打进文件名里（实测出过事故）
        if isinstance(v, str) and v.strip().lower() in ("null", "none", ""):
            return None
        return v


class CuReport(BaseModel):
    ok: bool
    steps_taken: int
    transcript: list[str] = []
    error: str | None = None


def _match_element(elements: list[UIElement], target: str | None) -> UIElement | None:
    """规划器给的 label 和 OCR 原文常差几个字符（空格/大小写/截断）——精确→归一→唯一包含。"""
    if not target:
        return None
    exact = next((e for e in elements if e.label == target), None)
    if exact:
        return exact
    norm = target.casefold().replace(" ", "")
    folded = [(e, e.label.casefold().replace(" ", "")) for e in elements]
    normed = next((e for e, lab in folded if lab == norm), None)
    if normed:
        return normed
    # 前缀且尾差小才算：宽松的"包含即中"实测会把日期文本 "2026-05-03 0:00"
    # 当成文件夹 "2026-05" 点下去（双击文件行=用记事本打开，事故）。
    near = [
        e
        for e, lab in folded
        if (lab.startswith(norm) or norm.startswith(lab)) and abs(len(lab) - len(norm)) <= 4
    ]
    return near[0] if len(near) == 1 else None


_PLAN_SYS = (
    "你是桌面操作规划器。给定任务目标、当前屏幕元素清单和已执行步骤，输出下一步动作。"
    '只输出 JSON：{"action":"click|double_click|type|key|done|abort","target":"元素label或null",'
    '"text":"输入内容或null","reason":"一句话"}。任务完成输出 done；无法完成输出 abort。'
)

# 端到端 grounding（调研裁定 2026-07-05）：截图直入、坐标直出，
# 没有元素解析中间层——与 Operator/CUA、Claude computer use 同构。
_PLAN_SYS_GROUNDED = (
    "你是桌面操作代理。看这张屏幕截图，给定任务目标和已执行步骤，输出下一步动作。"
    "只输出 JSON："
    '{"action":"click|double_click|type|key|done|abort","x":0-1000,"y":0-1000,'
    '"target":"你点的东西叫什么","text":"输入内容或null","reason":"一句话"}。'
    "x/y 是屏幕宽高的千分比（0-1000），必须指在目标元素中心。"
    "type 会把 text 打进当前焦点；key 发组合键（如 ctrl+x、enter、alt+up）。"
    "任务完成输出 done；确认无法完成才输出 abort。"
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

    async def _plan_step_grounded(
        self, goal: str, png: bytes, history: list[str], trace_id: str, window_title: str
    ) -> CuStep | None:
        """端到端：降采样截图 → VLM 直出千分比坐标动作。异常返回 None（调用方回落两段式）。"""
        try:
            import base64
            import io as _io

            from PIL import Image

            img = Image.open(_io.BytesIO(png))
            if img.width > 1440:  # 压 token：千分比坐标与分辨率无关，降采样不损协议
                img = img.resize((1440, round(img.height * 1440 / img.width)))
            buf = _io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=80)
            b64 = base64.b64encode(buf.getvalue()).decode()
            user_text = (
                f"目标：{goal}\n当前前台窗口标题：{window_title}"
                f"（资源管理器标题=当前所在文件夹）\n已执行：{history or '（无）'}"
            )
            resp = await self.route_fn(
                RouteRequest(
                    task="cu_grounding",
                    messages=[
                        {"role": "system", "content": _PLAN_SYS_GROUNDED},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": user_text},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                                },
                            ],
                        },
                    ],
                    cost_tier=get_settings().cu_grounding_tier,  # type: ignore[arg-type]
                    trace_id=trace_id,
                )
            )
            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = raw[raw.find("{") : raw.rfind("}") + 1]
            return CuStep.model_validate(json.loads(raw))
        except Exception:  # noqa: BLE001 —— grounding 失败回落两段式，不拖垮任务
            log.warning("cu_grounded_plan_failed", trace_id=trace_id)
            return None

    async def _plan_step(
        self,
        goal: str,
        elements: list[UIElement],
        history: list[str],
        trace_id: str,
        window_title: str = "",
    ) -> CuStep | None:
        # 阅读序（上→下、左→右）+ 上限 150：实测一屏资源管理器 186 元素、
        # 图标排在文本前——截前 60 个会把文件名全截掉，规划器等于瞎的。
        ordered = sorted(elements, key=lambda e: (e.y // 40, e.x))[:150]
        catalog = "\n".join(f"- {e.label} @({e.x},{e.y})" for e in ordered)
        # 窗口标题=位置本体感：实测没有它，规划器进了空文件夹还以为在原地，
        # 对着面包屑重复双击到步数耗尽。
        loc = f"当前前台窗口标题：{window_title}（资源管理器标题=你当前所在的文件夹）\n"
        user = f"目标：{goal}\n{loc}屏幕元素：\n{catalog}\n已执行：{history or '（无）'}"
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

    async def run_task(
        self,
        goal: str,
        *,
        trace_id: str,
        confirmed: bool = False,
        refocus_title: str | None = None,
    ) -> CuReport:
        """跑一个视觉任务。每步：急停查 → 白名单查 → 感知 → 规划 → 执行 → 审计。

        refocus_title：目标窗口标题片段。前台被第三方窗口抢走时（通知弹窗等，
        实测 1 次就撞上）回切目标窗口重查一次，而不是直接判死；回切失败仍拒——
        护栏语义不变：绝不在非白名单窗口上动手。
        """
        max_steps = self.guard.policy.max_steps_per_task
        transcript: list[str] = []
        refocus_left = 3
        last_action_mono: float | None = None
        last_sig: tuple | None = None
        repeats = 0
        for step_no in range(1, max_steps + 1):
            try:
                estop.check()
            except estop.EmergencyStop as e:
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error=str(e)
                )
            # 礼让：主人碰了键鼠（有比我们上次注入更晚的输入）→ 暂停等安静，主人永远赢席位
            idle = self.backend.input_idle_s()
            if (
                idle is not None
                and last_action_mono is not None
                and idle + 0.5 < time.monotonic() - last_action_mono
            ):
                transcript.append("⏸ 检测到主人在用键鼠，礼让等待")
                log.info("cu_yield_to_user", trace_id=trace_id, step=step_no)
                while (self.backend.input_idle_s() or 99.0) < 2.0:
                    try:
                        estop.check()
                    except estop.EmergencyStop as e:
                        return CuReport(
                            ok=False, steps_taken=step_no - 1, transcript=transcript, error=str(e)
                        )
                    time.sleep(0.5)
                if refocus_title:
                    self.backend.activate_title(refocus_title)
                    time.sleep(0.3)
            # 白名单：前台窗口必须在册（每步都查——窗口可能中途切换）
            req = ActionRequest(
                track="visual",
                description=f"CU 步骤 {step_no}: {goal}",
                app=self.backend.active_window(),
                trace_id=trace_id,
            )
            verdict = self.guard.decide(req)
            if (
                verdict.decision == "deny"
                and refocus_title
                and refocus_left > 0
                and self.backend.activate_title(refocus_title)
            ):
                refocus_left -= 1
                time.sleep(0.6)
                transcript.append(f"↻ 前台被 {req.app or '未知'} 抢走，已切回 {refocus_title}")
                req = req.model_copy(update={"app": self.backend.active_window()})
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
            # 感知 → 规划：grounded 优先（截图直出坐标，单步 2-5s），两段式兜底
            png = self.backend.screenshot()
            shot_ref = self._save_shot(png, trace_id, step_no)
            title = self.backend.active_window_title()
            elements: list[UIElement] = []
            plan: CuStep | None = None
            if get_settings().cu_planner == "grounded":
                plan = await self._plan_step_grounded(goal, png, transcript, trace_id, title)
            if plan is None:
                try:
                    elements = self.perceiver.parse(png)
                except RuntimeError as e:
                    return CuReport(
                        ok=False, steps_taken=step_no - 1, transcript=transcript, error=str(e)
                    )
                plan = await self._plan_step(goal, elements, transcript, trace_id, title)
            if plan is None:
                return CuReport(
                    ok=False, steps_taken=step_no - 1, transcript=transcript, error="规划失败"
                )
            # 复读机刹车：同一(动作,目标)连三次——前两次已证明无效，拒执行并把原因
            # 写进履历让规划器看见（实测没有它，会对着面包屑双击 9 次直到步数耗尽）
            # grounded 坐标按 2.5% 桶粗化，抖动几像素仍算同一动作
            sig = (
                plan.action,
                plan.target,
                plan.text,
                None if plan.x is None else plan.x // 25,
                None if plan.y is None else plan.y // 25,
            )
            repeats = repeats + 1 if sig == last_sig else 1
            last_sig = sig
            if plan.action not in ("done", "abort") and repeats >= 3:
                transcript.append(
                    f"🚫 动作 {plan.action} {plan.target or plan.text or ''} 已连续 {repeats} 次"
                    "且无进展，已被引擎拒绝——必须换一种做法"
                )
                continue
            shown = plan.text if plan.action in ("type", "key") else plan.target
            transcript.append(f"{plan.action} {shown or plan.target or ''}（{plan.reason}）")
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
                if plan.x is not None and plan.y is not None:  # grounded：千分比→像素
                    w, h = self.backend.screen_size()
                    self.backend.click(
                        round(plan.x * w / 1000),
                        round(plan.y * h / 1000),
                        double=plan.action == "double_click",
                    )
                else:
                    el = _match_element(elements, plan.target)
                    if el is None:
                        transcript.append(f"⚠ 找不到元素 {plan.target}")
                        continue
                    self.backend.click(el.x, el.y, double=plan.action == "double_click")
            elif plan.action == "type" and plan.text:
                self.backend.type_text(plan.text)
            elif plan.action == "key" and plan.text:
                self.backend.key(plan.text)
            last_action_mono = time.monotonic()
            time.sleep(0.8)  # UI 稳定窗：新建文件夹编辑框/粘贴刷新都要缓一拍再截屏
        return CuReport(
            ok=False, steps_taken=max_steps, transcript=transcript, error="达到单任务步数上限"
        )


__all__ = ["CuEngine", "CuReport", "CuStep", "Perceiver", "StubPerceiver", "UIElement"]
