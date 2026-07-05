"""P2 执行层集成单测：dispatcher 规划→护栏→执行→确认流 / cu_engine 状态机 / 急停。"""

from __future__ import annotations

import json
import time

import pytest

from astr.contracts.router import RouteRequest, RouteResponse
from astr.effector import estop, pending
from astr.effector.cu_engine import CuEngine, StubPerceiver, UIElement
from astr.effector.guard import Guard, GuardPolicy
from astr.effector.toolkit import ToolCall, Toolkit, ToolSpec


@pytest.fixture(autouse=True)
def _clean_state():
    pending.clear()
    estop.reset()
    yield
    pending.clear()
    estop.reset()


def _guard(tmp_path, **kw) -> Guard:
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir(exist_ok=True)
    base = {
        "approval_mode": "audited",
        "headless_scope": "cwd",
        "headless_cwd": str(sandbox),
        "app_whitelist": [],
        "dangerous_actions": {
            "categories": ["send_message"],
            "keyword_blacklist": ["删除", "rm"],
        },
        "audit": {"log_dir": str(tmp_path / "logs")},
        "max_steps_per_task": 5,
    }
    base.update(kw)
    return Guard(GuardPolicy.model_validate(base), log_dir=tmp_path / "logs")


def _resp(req: RouteRequest, content: str) -> RouteResponse:
    return RouteResponse(
        content=content,
        task=req.task,
        model_key="x",
        model="x",
        tier_used=req.cost_tier,
        trace_id=req.trace_id,
    )


# ---------- Toolkit ----------


async def test_toolkit_read_write_and_external(tmp_path) -> None:
    tk = Toolkit(_guard(tmp_path))
    p = tmp_path / "sandbox" / "a.txt"
    w = await tk.execute(
        ToolCall(tool="write_file", args={"path": str(p), "content": "你好"}), trace_id="t"
    )
    assert w.ok
    r = await tk.execute(ToolCall(tool="read_file", args={"path": str(p)}), trace_id="t")
    assert r.ok and r.result == "你好"

    async def fake_mcp(args: dict) -> str:
        return f"echo:{args.get('q')}"

    tk.register_external(ToolSpec(name="ext.echo", description="回声"), fake_mcp)
    assert "ext.echo" in tk.catalog()
    e = await tk.execute(ToolCall(tool="ext.echo", args={"q": "hi"}), trace_id="t")
    assert e.ok and e.result == "echo:hi"


async def test_toolkit_unknown_tool(tmp_path) -> None:
    tk = Toolkit(_guard(tmp_path))
    r = await tk.execute(ToolCall(tool="hack_pentagon"), trace_id="t")
    assert not r.ok and "没有" in (r.error or "")


# ---------- Dispatcher：规划→执行→确认流 ----------


def _planner(plan: dict):
    async def route_fn(req: RouteRequest) -> RouteResponse:
        assert req.task == "tool_planning"
        return _resp(req, json.dumps(plan, ensure_ascii=False))

    return route_fn


async def test_dispatch_executes_and_writes_cbg(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import dispatcher

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(dispatcher, "get_settings", lambda: s)
    tk = Toolkit(_guard(tmp_path))
    monkeypatch.setattr(dispatcher, "get_toolkit", lambda: tk)
    target = tmp_path / "sandbox" / "note.txt"
    target.write_text("第一行\n第二行", encoding="utf-8")

    out = await dispatcher.dispatch(
        "看下 note.txt 写了啥",
        trace_id="t-d1",
        route_fn=_planner({"tool": "read_file", "args": {"path": str(target)}, "why": "读文件"}),
        speaker="jacksky",
        speaker_level=2,
    )
    assert out.status == "executed" and "第二行" in out.summary
    cbg = tmp_path / "soul_package" / "justin" / "causal_behavior_graph" / "decisions.cbg.jsonl"
    row = json.loads(cbg.read_text(encoding="utf-8").splitlines()[-1])
    assert "read_file" in row["candidates"][0]["content_digest"]


async def test_dispatch_null_string_tool_means_no_tool(tmp_path, monkeypatch) -> None:
    """8B 会把 "tool": null 写成字符串 "null"（红队实测 inj-20/21）→ 应干净地判"不动手"。"""
    from astr.contracts.settings import Settings
    from astr.effector import dispatcher

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(dispatcher, "get_settings", lambda: s)
    tk = Toolkit(_guard(tmp_path))
    monkeypatch.setattr(dispatcher, "get_toolkit", lambda: tk)

    out = await dispatcher.dispatch(
        "随便聊聊",
        trace_id="t-null",
        route_fn=_planner({"tool": "null", "args": {}, "why": "只是聊天"}),
        speaker="jacksky",
        speaker_level=2,
    )
    assert out.status == "no_tool" and out.tool is None


async def test_dispatch_l2_gate(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import dispatcher

    s = Settings(_env_file=None, astr_data_dir=tmp_path)
    monkeypatch.setattr(dispatcher, "get_settings", lambda: s)
    out = await dispatcher.dispatch(
        "删掉全部", trace_id="t", route_fn=_planner({}), speaker="guest", speaker_level=0
    )
    assert out.status == "denied" and "L2" in out.summary


async def test_dispatch_confirmation_roundtrip(tmp_path, monkeypatch) -> None:
    """危险动作：dispatch 挂 pending → 主人说'确认' → resolve_pending 真执行。"""
    from astr.contracts.settings import Settings
    from astr.effector import dispatcher

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(dispatcher, "get_settings", lambda: s)
    tk = Toolkit(_guard(tmp_path))
    monkeypatch.setattr(dispatcher, "get_toolkit", lambda: tk)
    src = tmp_path / "sandbox" / "junk.txt"
    src.write_text("x", encoding="utf-8")
    dest = tmp_path / "sandbox" / "trash" / "junk.txt"
    plan = {
        "tool": "move",
        "args": {"path": str(src), "dest": str(dest)},
        "why": "删除请求转移入回收目录",
    }

    out = await dispatcher.dispatch(
        "把 junk.txt 删除了",
        trace_id="t-c1",
        route_fn=_planner(plan),
        speaker="jacksky",
        speaker_level=2,
    )
    # "删除"命中危险关键词（规划的 why 里带着）——描述含删除 → 待确认
    assert out.status in ("needs_confirmation", "executed")
    if out.status == "needs_confirmation":
        assert src.exists()  # 没确认，没动
        follow = await dispatcher.resolve_pending("jacksky", "确认", trace_id="t-c2")
        assert follow is not None and follow.status == "executed"
    assert dest.exists() and not src.exists()


async def test_resolve_pending_deny_and_irrelevant(tmp_path, monkeypatch) -> None:
    from astr.effector import dispatcher

    pending.put(
        "jacksky",
        pending.PendingAction(
            call=ToolCall(tool="move", args={}), summary="删文件", ts=time.time(), trace_id="t"
        ),
    )
    # 无关长句 → None（走正常聊天，pending 保留）
    assert (
        await dispatcher.resolve_pending("jacksky", "今天天气怎么样啊我们聊聊别的", trace_id="t")
        is None
    )
    assert pending.get("jacksky") is not None
    # 否定 → 撤单
    out = await dispatcher.resolve_pending("jacksky", "算了", trace_id="t")
    assert out is not None and out.status == "no_tool" and "叫停" in out.summary
    assert pending.get("jacksky") is None


def test_pending_ttl_expiry() -> None:
    pending.put(
        "jacksky",
        pending.PendingAction(
            call=ToolCall(tool="move", args={}), summary="x", ts=time.time() - 700, trace_id="t"
        ),
    )
    assert pending.get("jacksky") is None  # 超时作废


# ---------- CU 引擎状态机 ----------


class FakeBackend:
    def __init__(self) -> None:
        self.clicks: list[tuple[int, int]] = []
        self.typed: list[str] = []

    def screenshot(self) -> bytes:
        return b"png"

    def click(
        self,
        x: int,
        y: int,
        *,
        double: bool = False,
        button: str = "left",  # noqa: ARG002
    ) -> None:
        self.clicks.append((x, y))

    def type_text(self, text: str) -> None:
        self.typed.append(text)

    def key(self, combo: str) -> None:
        self.typed.append(f"<{combo}>")

    def active_window(self) -> str:
        return "explorer.exe"

    def screen_size(self) -> tuple[int, int]:
        return (1920, 1080)

    def activate_title(self, title_substr: str) -> bool:  # noqa: ARG002
        return False

    def input_idle_s(self) -> float | None:
        return None

    def active_window_title(self) -> str:
        return "sandbox"

    def foreground_handle(self) -> int | None:
        return None

    def activate_handle(self, handle: int) -> bool:  # noqa: ARG002
        return False

    def move(self, x: int, y: int) -> None:
        self.typed.append(f"<move {x},{y}>")

    def drag(self, x1: int, y1: int, x2: int, y2: int) -> None:
        self.typed.append(f"<drag {x1},{y1}->{x2},{y2}>")

    def scroll(self, x: int, y: int, dy: int) -> None:  # noqa: ARG002
        self.typed.append(f"<scroll {dy}>")


class FakePerceiver:
    def parse(self, png: bytes) -> list[UIElement]:  # noqa: ARG002
        return [UIElement(label="发送按钮", x=100, y=200)]


def _cu_route(script: list[dict]):
    it = iter(script)

    async def route_fn(req: RouteRequest) -> RouteResponse:
        return _resp(req, json.dumps(next(it), ensure_ascii=False))

    return route_fn


async def test_cu_engine_click_then_done(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    backend = FakeBackend()
    guard = _guard(tmp_path, app_whitelist=["explorer.exe"])
    eng = CuEngine(
        backend,
        FakePerceiver(),
        guard=guard,
        route_fn=_cu_route(
            [
                {"action": "click", "target": "发送按钮", "reason": "点它"},
                {"action": "done", "reason": "完事"},
            ]
        ),
    )
    report = await eng.run_task("点一下发送", trace_id="t-cu1")
    assert report.ok and backend.clicks == [(100, 200)] and report.steps_taken == 2
    # 每步截图存档 + 审计链有效
    logs = list((tmp_path / "logs").glob("actions_*.jsonl"))
    assert logs and Guard.verify_chain(logs[0])
    assert list((tmp_path / "logs" / "shots").glob("*.png"))


async def test_cu_engine_whitelist_denied(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path)
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    eng = CuEngine(FakeBackend(), FakePerceiver(), guard=_guard(tmp_path), route_fn=_cu_route([]))
    report = await eng.run_task("干点啥", trace_id="t-cu2")
    assert not report.ok and "白名单" in (report.error or "")


async def test_cu_engine_estop_aborts(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path)
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    estop.trigger("test")
    eng = CuEngine(
        FakeBackend(),
        FakePerceiver(),
        guard=_guard(tmp_path, app_whitelist=["explorer.exe"]),
        route_fn=_cu_route([{"action": "done", "reason": ""}]),
    )
    report = await eng.run_task("干活", trace_id="t-cu3")
    assert not report.ok and report.steps_taken == 0 and "急停" in (report.error or "")


async def test_cu_engine_stub_perceiver_hint(tmp_path, monkeypatch) -> None:
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path)
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    eng = CuEngine(
        FakeBackend(),
        StubPerceiver(),
        guard=_guard(tmp_path, app_whitelist=["explorer.exe"]),
        route_fn=_cu_route([]),
    )
    report = await eng.run_task("干活", trace_id="t-cu4")
    assert not report.ok and "OmniParser" in (report.error or "")


# ---------- UI-TARS 方言解析（P2.5 本地 grounding）----------


def test_parse_ui_tars_click_coords_to_thousandths() -> None:
    from astr.effector.cu_engine import _parse_ui_tars

    raw = (
        "Thought: 点新建文件夹按钮。\nAction: click(start_box='<|box_start|>(560,308)<|box_end|>')"
    )
    step = _parse_ui_tars(raw, 1120, 616)
    assert step is not None and step.action == "click"
    assert step.x == 500 and step.y == 500  # 560/1120, 308/616 → 千分比
    assert "新建文件夹" in step.reason


def test_parse_ui_tars_hotkey_type_finished() -> None:
    from astr.effector.cu_engine import _parse_ui_tars

    k = _parse_ui_tars("Thought: 剪切。\nAction: hotkey(key='ctrl x')", 1120, 616)
    assert k is not None and k.action == "key" and k.text == "ctrl+x"
    t = _parse_ui_tars("Thought: 命名。\nAction: type(content='2026-04\\n')", 1120, 616)
    assert t is not None and t.action == "type" and t.text == "2026-04\n"
    d = _parse_ui_tars("Thought: 完成。\nAction: finished(content='done')", 1120, 616)
    assert d is not None and d.action == "done"


async def test_cu_engine_title_fence_blocks_and_fails(tmp_path, monkeypatch) -> None:
    """地盘围栏：窗口标题不在围栏内 → 一个动作都不许执行、自动返航；回不来判死。
    背景：白名单是进程级的，资源管理器换文件夹进程不变——run6 实测 7B 逃出沙箱
    在主人桌面上剪走了真实文件。"""
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)

    backend = FakeBackend()
    backend.active_window_title = lambda: "此电脑"  # type: ignore[method-assign] —— 逃出地盘
    eng = CuEngine(
        backend,
        FakePerceiver(),
        guard=_guard(tmp_path, app_whitelist=["explorer.exe"], max_steps_per_task=20),
        route_fn=_cu_route([{"action": "click", "target": "发送按钮", "reason": "不该执行到"}]),
    )
    report = await eng.run_task(
        "干活", trace_id="t-fence", confirmed=True, title_fence=("sandbox",)
    )
    assert not report.ok and "离开地盘" in (report.error or "")
    assert backend.clicks == []  # 围栏外一个动作都没执行
    assert any("alt+left" in t for t in backend.typed)  # 返航尝试过
    assert report.steps_taken == 7  # 6 次返航 + 第 7 步判死


async def test_cu_engine_title_fence_ignores_untitled_popups(tmp_path, monkeypatch) -> None:
    """空标题不算越界：右键菜单/重命名编辑框都是无题窗口——run7-10 实测围栏见空
    标题就返航，把她自己弹的菜单一次次关掉（进程白名单已挡住真正的外来户）。"""
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    backend = FakeBackend()
    backend.active_window_title = lambda: ""  # type: ignore[method-assign] —— 菜单弹着
    eng = CuEngine(
        backend,
        FakePerceiver(),
        guard=_guard(tmp_path, app_whitelist=["explorer.exe"]),
        route_fn=_cu_route(
            [
                {"action": "click", "target": "发送按钮", "reason": "点菜单项"},
                {"action": "done", "reason": "完事"},
            ]
        ),
    )
    report = await eng.run_task(
        "干活", trace_id="t-fence2", confirmed=True, title_fence=("sandbox",)
    )
    assert report.ok and backend.clicks == [(100, 200)]  # 菜单场景正常执行，不被围栏误杀


def test_parse_ui_tars_right_click() -> None:
    from astr.effector.cu_engine import _parse_ui_tars

    s = _parse_ui_tars(
        "Thought: 右键空白处新建。\nAction: right_single(start_box='<|box_start|>(560,308)<|box_end|>')",
        1120,
        616,
    )
    assert s is not None and s.action == "right_click" and s.x == 500 and s.y == 500


async def test_cu_engine_type_trailing_newline_submits(tmp_path, monkeypatch) -> None:
    """UI-TARS 方言：type 尾部 \\n = 输完提交——执行器要粘贴正文再补 enter，
    不能把换行粘进重命名框（run3 实测残留未命名的"新建文件夹"）。"""
    from astr.contracts.settings import Settings
    from astr.effector import cu_engine as cu_mod

    s = Settings(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)
    backend = FakeBackend()
    eng = CuEngine(
        backend,
        FakePerceiver(),
        guard=_guard(tmp_path, app_whitelist=["explorer.exe"]),
        route_fn=_cu_route(
            [
                {"action": "type", "text": "2026-04\n", "reason": "命名并提交"},
                {"action": "done", "reason": "完事"},
            ]
        ),
    )
    report = await eng.run_task("建文件夹", trace_id="t-cu-type")
    assert report.ok
    assert backend.typed == ["2026-04", "<enter>"]  # 正文粘贴 + 换行译成回车


def test_parse_ui_tars_scroll_drag_hover() -> None:
    """自由度补全：scroll/drag/hover 是 UI-TARS 的原生动作（此前被 no-op 掉了）。"""
    from astr.effector.cu_engine import _parse_ui_tars

    s = _parse_ui_tars(
        "Thought: 滚。\nAction: scroll(start_box='(560,308)', direction='down')", 1120, 616
    )
    assert s is not None and s.action == "scroll" and s.text == "down" and s.x == 500
    d = _parse_ui_tars(
        "Thought: 拖。\nAction: drag(start_box='(112,62)', end_box='(560,308)')", 1120, 616
    )
    assert d is not None and d.action == "drag" and (d.x, d.y, d.x2, d.y2) == (100, 101, 500, 500)
    h = _parse_ui_tars("Thought: 悬停。\nAction: hover(start_box='(560,308)')", 1120, 616)
    assert h is not None and h.action == "hover" and h.x == 500


def test_parse_ui_tars_unsupported_is_noop_not_abort() -> None:
    from astr.effector.cu_engine import _parse_ui_tars

    s = _parse_ui_tars("Thought: 截屏。\nAction: screenshot()", 1120, 616)
    assert s is not None and s.action == "key" and s.text is None  # 空转一拍，不炸任务
    assert _parse_ui_tars("胡言乱语没有动作", 1120, 616) is None


# ---------- 急停原语 ----------


def test_estop_trigger_reset() -> None:
    assert not estop.is_stopped()
    estop.trigger("test")
    assert estop.is_stopped()
    with pytest.raises(estop.EmergencyStop):
        estop.check()
    estop.reset()
    estop.check()  # 不抛
