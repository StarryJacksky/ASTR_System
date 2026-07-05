"""效应器技能库单测：解析 / 平台目录 / 打分选择 / 预算 / 灵魂包合并 / 引擎注入。"""

from __future__ import annotations

from astr.contracts.settings import Settings
from astr.effector import skills


def test_parse_skill_frontmatter() -> None:
    sk = skills.parse_skill(
        "---\nname: t\ndescription: 测试\napps: [explorer.exe]\n"
        "triggers: [文件, 移动]\npriority: 5\n---\n正文内容"
    )
    assert sk is not None
    assert sk.name == "t" and sk.apps == ["explorer.exe"] and sk.priority == 5
    assert sk.triggers == ["文件", "移动"] and sk.body == "正文内容"
    assert skills.parse_skill("没有 frontmatter 的普通文本") is None


def test_builtin_windows_guides_load_and_parse() -> None:
    """内置《Windows 操作指南》必须全部可解析（坏文件=知识黑洞，宁可测试红）。"""
    loaded = skills.load_all(platform="win32")
    names = {sk.name for sk in loaded}
    assert {"windows-system", "windows-explorer", "windows-local-quirks"} <= names


def test_select_scores_app_and_triggers() -> None:
    out = skills.select("把沙箱里的文件按日期移动归类", "explorer.exe", platform="win32")
    assert "资源管理器" in out  # 应用命中 → explorer 指南入选
    assert "新建文件夹" in out  # 指南正文进来了
    # 无关任务 + 未知应用：只有通用篇（apps: [*]）保底
    out2 = skills.select("随便聊聊天气", "unknown.exe", platform="win32")
    assert "资源管理器操作指南" not in out2


def test_select_respects_budget() -> None:
    out = skills.select("整理文件夹里的文件", "explorer.exe", platform="win32", budget_chars=200)
    assert 0 < len(out) <= 200


def test_soul_learned_skills_merge(tmp_path, monkeypatch) -> None:
    """她后天学的技能（灵魂包）与基础指南合并加载——可迁移资产。"""
    monkeypatch.setattr(
        skills, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    d = tmp_path / "soul_package" / "justin" / "skills" / "effector"
    d.mkdir(parents=True)
    (d / "learned.md").write_text(
        "---\nname: learned-trick\ndescription: 她学会的招\napps: [explorer.exe]\n"
        "triggers: [文件]\n---\n她自己总结的做法",
        encoding="utf-8",
    )
    out = skills.select("整理文件", "explorer.exe", platform="win32", soul_name="justin")
    assert "她自己总结的做法" in out


async def test_cu_engine_injects_skills(tmp_path, monkeypatch) -> None:
    """run_task 开工即按任务选段——规划 prompt 里带上操作指南。"""
    import json

    from astr.contracts.router import RouteResponse
    from astr.contracts.settings import Settings as S
    from astr.effector import cu_engine as cu_mod
    from astr.effector.cu_engine import CuEngine, UIElement
    from astr.effector.guard import Guard, GuardPolicy

    s = S(_env_file=None, astr_data_dir=tmp_path, tool_planning_tier="cheap")
    monkeypatch.setattr(cu_mod, "get_settings", lambda: s)

    class _B:
        def screenshot(self):
            return b"png"

        def click(self, x, y, *, double=False, button="left"):
            pass

        def type_text(self, text):
            pass

        def key(self, combo):
            pass

        def active_window(self):
            return "explorer.exe"

        def screen_size(self):
            return (1920, 1080)

        def activate_title(self, t):
            return False

        def input_idle_s(self):
            return None

        def active_window_title(self):
            return "sandbox"

        def foreground_handle(self):
            return None

        def activate_handle(self, h):
            return False

    class _P:
        def parse(self, png):
            return [UIElement(label="x", x=1, y=1)]

    async def _route(req):
        return RouteResponse(
            content=json.dumps({"action": "done", "reason": "完事"}),
            task=req.task,
            model_key="x",
            model="x",
            tier_used=req.cost_tier,
            trace_id=req.trace_id,
        )

    guard = Guard(
        GuardPolicy.model_validate(
            {
                "approval_mode": "audited",
                "app_whitelist": ["explorer.exe"],
                "audit": {"log_dir": str(tmp_path / "logs")},
                "max_steps_per_task": 5,
            }
        ),
        log_dir=tmp_path / "logs",
    )
    eng = CuEngine(_B(), _P(), guard=guard, route_fn=_route)
    report = await eng.run_task("把文件按日期移动到文件夹", trace_id="t-skill", confirmed=True)
    assert report.ok
    assert "新建文件夹" in eng._skill_notes  # explorer 指南被选中注入
