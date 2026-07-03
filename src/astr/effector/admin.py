"""后台执行层设置卡（P2-W8 · 07 §3.2 /admin 种子）：策略读写 + 审计查看的业务逻辑。

Core 的 /v1/admin/effector/* 端点是本模块的薄壳。原则：
  - 文件为真身（07 §4）：UI 改的旋钮写进覆盖层 guard_policy.local.yaml（数据目录），
    基线 guard_policy.yaml 保持人手可读、可版本控制；有效策略 = 基线 + 覆盖层。
  - 危险名单只增不减（铁律 3 延伸）：核心八类与底线关键词在任何写回中被 enforce_floor 并回。
  - 安全原语不进 UI：untrusted_wrapping / normalize_before_match / sandbox / audit 配置锁定。
  - 写回即热重载：apply_update() 后共享 Guard 就地 reload，Toolkit/Headless 无需重建。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import structlog
import yaml
from pydantic import BaseModel, Field

from astr.effector.guard import (
    CORE_DANGEROUS_CATEGORIES,
    CORE_DANGEROUS_KEYWORDS,
    Guard,
    GuardPolicy,
    default_overlay_path,
    enforce_floor,
)

log = structlog.get_logger("astr.effector.admin")


class PolicyUpdate(BaseModel):
    """后台可写的旋钮全集（都可选，只改给出的）。不在此列的字段 UI 动不了。"""

    approval_mode: Literal["ask", "audited", "auto"] | None = None
    headless_scope: Literal["cwd", "folders", "full"] | None = None
    headless_cwd: str | None = None
    headless_folders: list[str] | None = None
    app_whitelist: list[str] | None = None
    login_sites_whitelist: list[str] | None = None
    dangerous_categories: list[str] | None = None  # 写回前过 enforce_floor
    dangerous_keywords: list[str] | None = None  # 同上
    max_steps_per_task: int | None = Field(default=None, ge=1, le=100)


def read_policy(guard: Guard) -> dict:
    """有效策略 + 底线/锁定信息（前端据此渲染"不可关"的标识）。"""
    p = guard.policy
    return {
        "approval_mode": p.approval_mode,
        "headless_scope": p.headless_scope,
        "headless_cwd": p.headless_cwd,
        "headless_folders": p.headless_folders,
        "app_whitelist": p.app_whitelist,
        "login_sites_whitelist": p.login_sites_whitelist,
        "dangerous_categories": sorted(set(p.dangerous_actions.get("categories", []))),
        "dangerous_keywords": sorted(set(p.dangerous_actions.get("keyword_blacklist", []))),
        "max_steps_per_task": p.max_steps_per_task,
        "sandbox_dir": p.sandbox_dir,
        "core_dangerous_categories": sorted(CORE_DANGEROUS_CATEGORIES),
        "core_dangerous_keywords": sorted(CORE_DANGEROUS_KEYWORDS),
        "locked": ["untrusted_wrapping", "normalize_before_match", "sandbox_dir", "audit"],
        "overlay_path": str(default_overlay_path()),
    }


def apply_update(update: PolicyUpdate, guard: Guard, *, overlay: Path | None = None) -> dict:
    """合并进覆盖层 → 底线执法 → 整体校验 → 落盘 → 热重载。返回新的有效策略。"""
    ov_path = overlay if overlay is not None else default_overlay_path()
    current: dict = {}
    if ov_path.exists():
        current = yaml.safe_load(ov_path.read_text(encoding="utf-8")) or {}

    fields = update.model_dump(exclude_none=True)
    dang_cats = fields.pop("dangerous_categories", None)
    dang_kws = fields.pop("dangerous_keywords", None)
    current.update(fields)
    if dang_cats is not None or dang_kws is not None:
        merged = enforce_floor(
            {
                "categories": dang_cats
                if dang_cats is not None
                else guard.policy.dangerous_actions.get("categories", []),
                "keyword_blacklist": dang_kws
                if dang_kws is not None
                else guard.policy.dangerous_actions.get("keyword_blacklist", []),
            }
        )
        current["dangerous_actions"] = merged

    # 先在内存里合出有效策略并整体校验，坏值不落盘
    ov_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = ov_path.with_suffix(".tmp")
    tmp.write_text(yaml.safe_dump(current, allow_unicode=True, sort_keys=True), encoding="utf-8")
    policy = GuardPolicy.load(overlay=tmp)  # 校验失败在此抛出，覆盖层不被污染
    tmp.replace(ov_path)

    guard.reload(policy)
    log.info("effector_policy_updated", fields=sorted(fields), overlay=str(ov_path))
    return read_policy(guard)


def read_audit(guard: Guard, *, date: str | None = None, limit: int = 100) -> dict:
    """审计日志查看：可用日期列表 + 指定日（默认最新）末 limit 行 + hash 链校验结果。"""
    log_dir = guard.log_dir
    files = sorted(log_dir.glob("actions_*.jsonl")) if log_dir.exists() else []
    dates = [f.stem.removeprefix("actions_") for f in files]
    if not files:
        return {"dates": [], "date": None, "entries": [], "chain_valid": None}
    target = log_dir / f"actions_{date}.jsonl" if date else files[-1]
    if not target.exists():
        return {"dates": dates, "date": date, "entries": [], "chain_valid": None}
    lines = target.read_text(encoding="utf-8").splitlines()
    entries = [json.loads(x) for x in lines[-max(1, min(limit, 500)) :]]
    return {
        "dates": dates,
        "date": target.stem.removeprefix("actions_"),
        "entries": entries,
        "total": len(lines),
        "chain_valid": Guard.verify_chain(target),
    }


__all__ = ["PolicyUpdate", "apply_update", "read_audit", "read_policy"]
