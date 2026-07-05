"""效应器技能库（enikk 取经裁定 #3：知识外置——可教性 > 模型能力）。

《Windows/macOS/Linux 系统完全操作指南》按 平台/应用 分文件放 os_skills/<platform>/*.md
（随代码仓维护的平台知识）；她后天学会的技能放 soul_package/<soul>/skills/effector/*.md
（P4 复盘提取写入，随灵魂迁移）。两处合并加载，同一格式：

    ---
    name: explorer
    description: 资源管理器操作指南
    apps: [explorer.exe]        # 命中当前前台应用加重权；'*' 表示通用篇
    triggers: [文件, 文件夹, 移动]  # 命中任务目标文本加权
    priority: 1                 # 同分时的先后（system 基础篇给高）
    ---
    正文（Markdown，写给规划器看的操作知识）

为什么按文件选段注入而非整本：7B 的注意力预算有限（真机实测履历撑到 2.7k token
决策就变糊），指南只有被任务命中的部分才有资格占上下文。
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.effector.skills")

_OS_DIR = Path(__file__).parent / "os_skills"

_PLATFORM_DIRS = {"win32": "windows", "darwin": "macos", "linux": "linux"}


@dataclass
class Skill:
    name: str
    description: str = ""
    apps: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    priority: int = 0
    body: str = ""


def _parse_list(raw: str) -> list[str]:
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        raw = raw[1:-1]
    return [x.strip().strip("'\"") for x in raw.split(",") if x.strip()]


def parse_skill(text: str) -> Skill | None:
    """解析 SKILL.md（frontmatter 手拆，不引 yaml 全解析——字段就这五个）。"""
    if not text.startswith("---"):
        return None
    try:
        _, front, body = text.split("---", 2)
    except ValueError:
        return None
    sk = Skill(name="")
    for line in front.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if key == "name":
            sk.name = val.strip("'\"")
        elif key == "description":
            sk.description = val.strip("'\"")
        elif key == "apps":
            sk.apps = _parse_list(val)
        elif key == "triggers":
            sk.triggers = _parse_list(val)
        elif key == "priority":
            try:
                sk.priority = int(val)
            except ValueError:
                pass
    sk.body = body.strip()
    return sk if sk.name and sk.body else None


def _platform_dir(platform: str | None = None) -> str:
    return _PLATFORM_DIRS.get(platform or sys.platform, "linux")


def load_all(platform: str | None = None, soul_name: str | None = None) -> list[Skill]:
    """基础指南（代码仓）+ 她学会的技能（灵魂包，可迁移）合并加载。"""
    skills: list[Skill] = []
    dirs = [_OS_DIR / _platform_dir(platform)]
    if soul_name:
        dirs.append(get_settings().soul_package_dir / soul_name / "skills" / "effector")
    for d in dirs:
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            try:
                sk = parse_skill(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 —— 单个坏文件不拖垮加载
                log.warning("skill_parse_failed", path=str(p))
                continue
            if sk:
                skills.append(sk)
    return skills


def _score(sk: Skill, goal: str, app: str) -> int:
    s = 0
    low_goal = goal.lower()
    low_app = (app or "").lower()
    if "*" in sk.apps:
        s += 1  # 通用篇保底入围
    if low_app and any(a.lower() == low_app for a in sk.apps):
        s += 3  # 正在操作的应用，最相关
    s += min(sum(1 for t in sk.triggers if t.lower() in low_goal), 3)
    return s


def select(
    goal: str,
    app: str,
    *,
    platform: str | None = None,
    soul_name: str | None = None,
    budget_chars: int = 3000,
) -> str:
    """按任务挑技能拼成注入文本（预算内，高分优先）。没命中返回空串。"""
    scored = [
        (sk, _score(sk, goal, app)) for sk in load_all(platform=platform, soul_name=soul_name)
    ]
    picked = sorted(
        (x for x in scored if x[1] > 0), key=lambda x: (-x[1], -x[0].priority, x[0].name)
    )
    parts: list[str] = []
    used = 0
    for sk, _s in picked:
        block = f"【{sk.description or sk.name}】\n{sk.body}"
        if used + len(block) > budget_chars and parts:
            break
        parts.append(block[: budget_chars - used])
        used += len(parts[-1])
    if parts:
        log.info("skills_selected", names=[sk.name for sk, _ in picked[: len(parts)]])
    return "\n\n".join(parts)


__all__ = ["Skill", "parse_skill", "load_all", "select"]
