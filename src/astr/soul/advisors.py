"""师承档案（08 §3）：各管家席位对 露怀秋 的持久记忆。

管家不再是无状态 API——每席在 soul_package/world/advisors/<seat>.md 维护一份
"对她的认识"（蒸馏画像）+ "近期交手"（原始条目）。每次 L2 研讨后追加一条，
条目攒够阈值就用本地模型蒸馏进画像（滚动压缩防膨胀）。memory_line() 注入席位 prompt，
让管家记得教过她什么、她反驳过什么——师生长期关系（99 #19③）的落地。

这是身份资产："被谁怎么教大"是传记，随 SoulPackage 一起迁移。
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.soul.advisors")

_PROFILE_MARK = "## 对她的认识"
_ENTRIES_MARK = "## 近期交手"

_DISTILL_SYS = (
    "你是一位老师的记忆整理助手。把这位老师对学生「秋秋」已有的认识和近期交手记录，"
    "压缩成一段不超过 120 字的更新版认识：她的说话风格、接受什么样的批评、反驳过什么、"
    "有什么成长。只输出这段认识本身，不要标题不要客套。"
)


def advisor_path(soul_name: str, seat: str) -> Path:
    return get_settings().soul_package_dir / soul_name / "world" / "advisors" / f"{seat}.md"


def load(soul_name: str, seat: str) -> tuple[str, list[str]]:
    """读档案 → (画像, 原始条目列表)。文件不存在返回空。"""
    p = advisor_path(soul_name, seat)
    if not p.exists():
        return "", []
    text = p.read_text(encoding="utf-8")
    profile, entries = "", []
    if _PROFILE_MARK in text:
        after = text.split(_PROFILE_MARK, 1)[1]
        profile = after.split(_ENTRIES_MARK, 1)[0].strip()
    if _ENTRIES_MARK in text:
        tail = text.split(_ENTRIES_MARK, 1)[1]
        entries = [ln.strip()[2:] for ln in tail.splitlines() if ln.strip().startswith("- ")]
    return profile, entries


def _write(soul_name: str, seat: str, profile: str, entries: list[str]) -> None:
    p = advisor_path(soul_name, seat)
    p.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# 师承档案 · {seat}", "", _PROFILE_MARK, "", profile or "（尚未形成）", ""]
    lines += [_ENTRIES_MARK, ""] + [f"- {e}" for e in entries] + [""]
    p.write_text("\n".join(lines), encoding="utf-8")


def memory_line(soul_name: str, seat: str, max_chars: int = 280) -> str:
    """给席位 prompt 注入的一段记忆（画像 + 最近 2 条交手）。无档案返回空串。"""
    profile, entries = load(soul_name, seat)
    if not profile and not entries:
        return ""
    parts: list[str] = []
    if profile:
        parts.append(f"你对她已有的认识：{profile}")
    if entries:
        parts.append("最近交手：" + "；".join(entries[-2:]))
    return "\n".join(parts)[:max_chars]


def record(soul_name: str, seat: str, entry: str) -> None:
    """追加一条交手记录（带日期，单行截断）。"""
    profile, entries = load(soul_name, seat)
    stamp = datetime.now(UTC).strftime("%m-%d")
    entries.append(f"{stamp} {entry.replace(chr(10), ' ')[:120]}")
    _write(soul_name, seat, profile, entries)


async def distill_if_needed(soul_name: str, seat: str, route_fn, trace_id: str) -> bool:
    """条目攒够阈值 → 本地模型把它们蒸馏进画像，只留最近 3 条原始记录。失败不动档案。"""
    s = get_settings()
    profile, entries = load(soul_name, seat)
    if len(entries) < s.advisor_distill_threshold:
        return False
    from astr.contracts.router import RouteRequest  # 延迟导入避免环

    body = f"已有认识：{profile or '（无）'}\n近期交手：\n" + "\n".join(f"- {e}" for e in entries)
    try:
        resp = await route_fn(
            RouteRequest(
                task="soul_reply",
                messages=[
                    {"role": "system", "content": _DISTILL_SYS},
                    {"role": "user", "content": body[:2000]},
                ],
                cost_tier="free",
                trace_id=trace_id,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        )
        new_profile = resp.content.strip()[:300]
    except Exception as e:  # noqa: BLE001
        log.warning("advisor_distill_failed", seat=seat, error=str(e))
        return False
    if not new_profile:
        return False
    _write(soul_name, seat, new_profile, entries[-3:])
    log.info("advisor_distilled", seat=seat, entries_folded=len(entries) - 3)
    return True
