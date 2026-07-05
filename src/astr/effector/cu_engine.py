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
import re
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
    action: Literal[
        "click",
        "double_click",
        "right_click",
        "hover",
        "scroll",
        "drag",
        "type",
        "key",
        "done",
        "abort",
    ]
    target: str | None = None  # 元素 label（两段式）/ 元素描述（grounded，仅记录用）
    text: str | None = None  # type/key 的内容；scroll 时是方向（up/down）
    x: int | None = None  # grounded：屏幕千分比坐标（0-1000），engine 换算像素
    y: int | None = None
    x2: int | None = None  # drag 终点（千分比）
    y2: int | None = None
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

# UI-TARS 原生动作格式（P2.5 本地 grounding）：它按自己的 SFT 模板输出
# Thought/Action，坐标是"发给它的那张图"的像素——发图前定死尺寸，回来换算千分比。
_PLAN_SYS_UI_TARS = """You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.
## Output Format
```
Thought: ...
Action: ...
```
## Action Space
click(start_box='<|box_start|>(x1,y1)<|box_end|>')
left_double(start_box='<|box_start|>(x1,y1)<|box_end|>')
right_single(start_box='<|box_start|>(x1,y1)<|box_end|>')
hover(start_box='<|box_start|>(x1,y1)<|box_end|>')
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up')
drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>')
hotkey(key='')
type(content='') #If you want to submit your input, use "\\n" at the end of `content`.
wait() #Sleep for 1s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format.
## Note
- Use Chinese in `Thought` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in `Thought` part.
## User Instruction
"""

_UI_TARS_COORD = re.compile(r"\((\d+)\s*,\s*(\d+)\)")


def _parse_ui_tars(raw: str, img_w: int, img_h: int) -> CuStep | None:
    """UI-TARS 输出 → CuStep。坐标从发送图像素换算成屏幕千分比（CuStep 协议）。"""
    m = re.search(r"Action\s*[:：]\s*(.+)", raw, re.DOTALL)
    if not m:
        return None
    act = m.group(1).strip()
    thought = re.search(r"Thought\s*[:：]\s*(.*?)(?:Action\s*[:：])", raw, re.DOTALL)
    reason = (thought.group(1).strip() if thought else "")[:120]

    def coords() -> tuple[int, int] | None:
        c = _UI_TARS_COORD.search(act)
        if not c:
            return None
        return round(int(c.group(1)) / img_w * 1000), round(int(c.group(2)) / img_h * 1000)

    def content(key: str) -> str:
        c = re.search(rf"{key}='(.*?)'\s*\)", act, re.DOTALL)
        return c.group(1).replace("\\n", "\n").replace("\\'", "'").replace('\\"', '"') if c else ""

    if act.startswith("click") or act.startswith("left_single"):
        xy = coords()
        return CuStep(action="click", x=xy[0], y=xy[1], reason=reason) if xy else None
    if act.startswith("left_double"):
        xy = coords()
        return CuStep(action="double_click", x=xy[0], y=xy[1], reason=reason) if xy else None
    if act.startswith("right_single"):
        # 右键在 UI-TARS 的训练分布里（右键空白→新建），run3 实测硬拦它只会空转到步数耗尽
        xy = coords()
        return CuStep(action="right_click", x=xy[0], y=xy[1], reason=reason) if xy else None
    if act.startswith("hover"):
        xy = coords()
        return CuStep(action="hover", x=xy[0], y=xy[1], reason=reason) if xy else None
    if act.startswith("scroll"):
        xy = coords()
        direction = "up" if "up" in content("direction").lower() else "down"
        if xy:
            return CuStep(action="scroll", x=xy[0], y=xy[1], text=direction, reason=reason)
        return CuStep(action="scroll", x=500, y=500, text=direction, reason=reason)
    if act.startswith("drag"):
        pts = _UI_TARS_COORD.findall(act)
        if len(pts) >= 2:
            (x1, y1), (x2, y2) = pts[0], pts[1]
            return CuStep(
                action="drag",
                x=round(int(x1) / img_w * 1000),
                y=round(int(y1) / img_h * 1000),
                x2=round(int(x2) / img_w * 1000),
                y2=round(int(y2) / img_h * 1000),
                reason=reason,
            )
        return None
    if act.startswith("hotkey"):
        keys = content("key").strip().replace(" ", "+")
        return CuStep(action="key", text=keys or None, reason=reason)
    if act.startswith("type"):
        return CuStep(action="type", text=content("content") or None, reason=reason)
    if act.startswith("finished"):
        return CuStep(action="done", reason=reason or content("content")[:120])
    if act.startswith("wait"):
        return CuStep(action="key", text=None, reason=f"wait：{reason}")  # 引擎空转一拍
    # 剩余不认识的动作：空转一拍，履历让它换招（复读机刹车兜底）
    return CuStep(action="key", text=None, reason=f"暂不支持的动作 {act[:40]}，请换一种做法")


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

            dialect = get_settings().cu_grounding_dialect
            img = Image.open(_io.BytesIO(png))
            if dialect == "ui_tars":
                # 定死到 28 的倍数（Qwen2-VL patch 尺寸）——mtmd 不再二次缩放，
                # 模型回报的像素坐标才等于"我们发的这张图"的坐标系。
                # 1568（56×28）而非 1120：2560 屏降到 1120 时功能区按钮/右键菜单小字
                # 压到 5px，run2/4 实测 7B 反复点不中"新建文件夹"——分辨率是 grounding
                # 的地板。代价 ~1792 视觉 token（服务端 --image-max-tokens 2048 兜住）
                w = 1568
                h = max(28, round(img.height * w / img.width / 28) * 28)
                img = img.resize((w, h))
            elif img.width > 1440:  # 压 token：千分比坐标与分辨率无关，降采样不损协议
                img = img.resize((1440, round(img.height * 1440 / img.width)))
            buf = _io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=80)
            b64 = base64.b64encode(buf.getvalue()).decode()
            # 7B 履历减负：全量履历到 20+ 步时把 prompt 撑到 2.7k token，7B 的注意力
            # 会淹在自己过去的碎碎念里（run3 实测 tokens_in 一路涨、后半程决策明显变糊）
            shown_history = (
                [line[:60] for line in history[-10:]] if dialect == "ui_tars" else history
            )
            user_text = (
                f"目标：{goal}\n当前前台窗口标题：{window_title}"
                f"（资源管理器标题=当前所在文件夹）\n已执行：{shown_history or '（无）'}"
            )
            if dialect == "ui_tars":
                sys_prompt = _PLAN_SYS_UI_TARS + user_text
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": sys_prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                            },
                        ],
                    }
                ]
            else:
                messages = [
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
                ]
            resp = await self.route_fn(
                RouteRequest(
                    task="cu_grounding",
                    messages=messages,
                    cost_tier=get_settings().cu_grounding_tier,  # type: ignore[arg-type]
                    trace_id=trace_id,
                    # 不设则吃 llama.cpp 默认 0.8——GUI 操作不是聊天，每步高随机采样
                    # = 让 7B 掷骰子（run7 实测上一步定的方案下一步就翻悔）。官方
                    # UI-TARS 推理近贪心；留 0.1 给复读机刹车一点破循环的余地
                    temperature=0.1,
                )
            )
            raw = resp.content.strip()
            if dialect == "ui_tars":
                return _parse_ui_tars(raw, img.width, img.height)
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
        title_fence: tuple[str, ...] | None = None,
    ) -> CuReport:
        """跑一个视觉任务。每步：急停查 → 白名单查 → 地盘围栏 → 感知 → 规划 → 执行 → 审计。

        refocus_title：目标窗口标题片段。前台被第三方窗口抢走时（通知弹窗等，
        实测 1 次就撞上）回切目标窗口重查一次，而不是直接判死；回切失败仍拒——
        护栏语义不变：绝不在非白名单窗口上动手。

        title_fence：她被允许待的"地盘"（窗口标题片段集合）。应用白名单是进程级的，
        而资源管理器换文件夹进程不变——run6 实测 7B 从导航栏逃出沙箱后在主人的桌面上
        剪走了真实文件。围栏把范围执法延伸到"位置"：标题不命中任何围栏项就拒绝执行
        动作并自动返航（alt+left / enter 交替，兼顾误导航与模态弹窗），连续 6 步回不来
        判死。None=不围（非资源管理器类任务）。
        """
        max_steps = self.guard.policy.max_steps_per_task
        transcript: list[str] = []
        # 回切预算：真实桌面 30 步任务里通知/别的应用抢焦点不止 3 次（run3 被 claude.exe
        # 抢死）。放宽不弱化护栏——每次回切后都重查白名单，永不在非白名单窗口上动手。
        refocus_left = 6
        fence_breaches = 0
        last_action_mono: float | None = None
        last_sig: tuple | None = None
        repeats = 0
        # "家"句柄：任务起点的白名单窗口。回切首选句柄——资源管理器标题随导航漂
        # （实测 run2：误点导航栏后标题变"iCloud 照片"，按"sandbox"标题回切失灵判死）
        home_handle: int | None = None

        def _refocus() -> bool:
            if home_handle is not None and self.backend.activate_handle(home_handle):
                return True
            return bool(refocus_title) and self.backend.activate_title(refocus_title)

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
                if _refocus():
                    last_action_mono = time.monotonic()  # 回切的 ALT 空击是注入输入，非主人
                    time.sleep(0.3)
            # 白名单：前台窗口必须在册（每步都查——窗口可能中途切换）
            req = ActionRequest(
                track="visual",
                description=f"CU 步骤 {step_no}: {goal}",
                app=self.backend.active_window(),
                trace_id=trace_id,
            )
            verdict = self.guard.decide(req)
            if verdict.decision == "deny" and refocus_left > 0:
                # 抢焦点的多是通知/一闪而过的窗口（run5 被 claude.exe 闪杀）——它还占着
                # 前台时 SetForegroundWindow 会失败，等它过去再切，最多熬 3 拍
                for _ in range(3):
                    if _refocus():
                        refocus_left -= 1
                        last_action_mono = time.monotonic()  # 同上：ALT 空击非主人输入
                        time.sleep(0.6)
                        transcript.append(f"↻ 前台被 {req.app or '未知'} 抢走，已切回目标窗口")
                        req = req.model_copy(update={"app": self.backend.active_window()})
                        verdict = self.guard.decide(req)
                        break
                    time.sleep(1.2)
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
            if home_handle is None:  # 第一步过白名单的窗口=这个任务的"家"
                home_handle = self.backend.foreground_handle()
            # 地盘围栏：不在申报的位置上就不执行任何动作，先返航（见 docstring）。
            # 空标题不算越界：弹出菜单/重命名编辑框都是无题窗口（run7-10 实测围栏
            # 见空标题就返航，把她自己右键出来的菜单一次次关掉——菜单是位置中性的，
            # 进程白名单已在上面查过）
            title = self.backend.active_window_title()
            if title_fence and title and not any(f in title for f in title_fence):
                fence_breaches += 1
                if fence_breaches > 6:
                    return CuReport(
                        ok=False,
                        steps_taken=step_no,
                        transcript=transcript,
                        error=f"离开地盘且返航失败（当前窗口：{title}）",
                    )
                transcript.append(f"⛔ 不在地盘（{title}），自动返航")
                log.info("cu_fence_breach", trace_id=trace_id, step=step_no, title=title)
                _refocus()  # 可能只是别的窗口挡在前面
                # 交替两种返航键：alt+left 治误导航，enter 关模态弹窗（按默认钮）
                self.backend.key("alt+left" if fence_breaches % 2 else "enter")
                last_action_mono = time.monotonic()  # 返航键是我们注入的，别喂给礼让当主人输入
                time.sleep(1.0)
                continue
            fence_breaches = 0
            # 感知 → 规划：grounded 优先（截图直出坐标，单步 2-5s），两段式兜底
            png = self.backend.screenshot()
            shot_ref = self._save_shot(png, trace_id, step_no)
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
            if plan.action in ("click", "double_click", "right_click"):
                if plan.x is not None and plan.y is not None:  # grounded：千分比→像素
                    w, h = self.backend.screen_size()
                    self.backend.click(
                        round(plan.x * w / 1000),
                        round(plan.y * h / 1000),
                        double=plan.action == "double_click",
                        button="right" if plan.action == "right_click" else "left",
                    )
                else:
                    el = _match_element(elements, plan.target)
                    if el is None:
                        transcript.append(f"⚠ 找不到元素 {plan.target}")
                        continue
                    self.backend.click(
                        el.x,
                        el.y,
                        double=plan.action == "double_click",
                        button="right" if plan.action == "right_click" else "left",
                    )
            elif plan.action == "hover" and plan.x is not None and plan.y is not None:
                w, h = self.backend.screen_size()
                self.backend.move(round(plan.x * w / 1000), round(plan.y * h / 1000))
            elif plan.action == "scroll" and plan.x is not None and plan.y is not None:
                w, h = self.backend.screen_size()
                self.backend.scroll(
                    round(plan.x * w / 1000),
                    round(plan.y * h / 1000),
                    600 if plan.text == "up" else -600,
                )
            elif plan.action == "drag" and None not in (plan.x, plan.y, plan.x2, plan.y2):
                w, h = self.backend.screen_size()
                self.backend.drag(
                    round(plan.x * w / 1000),  # type: ignore[operator]
                    round(plan.y * h / 1000),  # type: ignore[operator]
                    round(plan.x2 * w / 1000),  # type: ignore[operator]
                    round(plan.y2 * h / 1000),  # type: ignore[operator]
                )
            elif plan.action == "type" and plan.text:
                # UI-TARS 方言：content 尾部 \n 表示"输完提交"。粘贴换行进重命名框
                # 不等于按回车（run3 实测残留未命名的"新建文件夹"）——忠实翻译成 enter
                submit = plan.text.endswith("\n")
                body = plan.text.rstrip("\n")
                if body:
                    self.backend.type_text(body)
                if submit:
                    time.sleep(0.3)  # 粘贴落定再回车，太快会把半截名字提交掉
                    self.backend.key("enter")
            elif plan.action == "key" and plan.text:
                self.backend.key(plan.text)
            last_action_mono = time.monotonic()
            time.sleep(0.8)  # UI 稳定窗：新建文件夹编辑框/粘贴刷新都要缓一拍再截屏
        return CuReport(
            ok=False, steps_taken=max_steps, transcript=transcript, error="达到单任务步数上限"
        )


__all__ = ["CuEngine", "CuReport", "CuStep", "Perceiver", "StubPerceiver", "UIElement"]
