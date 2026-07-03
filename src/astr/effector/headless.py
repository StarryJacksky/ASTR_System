"""无视觉执行轨 v0（P2-W2）：Codex/OpenClaw 式文件操作，每一步先过护栏。

原则（P2 重写版）：接口优先、视觉兜底——能用路径/API 干的活绝不动像素。
所有操作走统一入口 run()：guard.decide() 判（三档审批 + 范围三档）→ 通过才执行 → audit 落链。
confirm 判决不在这里弹窗——返回 needs_confirmation，由上层（网页/QQ/语音）向主人要确认，
确认后带 confirmed=True 重来（危险动作的 L3 流程）。

v0 动作集：list_dir / read_text / write_text / move / organize_by_date（P2 里程碑）。
删除类故意不提供——真要删由 move 进回收目录代替（可逆优先）。
"""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog
from pydantic import BaseModel

from astr.effector.guard import ActionRequest, Guard, GuardVerdict

log = structlog.get_logger("astr.effector.headless")


class OpResult(BaseModel):
    ok: bool
    needs_confirmation: bool = False
    verdict: GuardVerdict | None = None
    result: Any = None
    error: str | None = None


class Headless:
    """无视觉轨执行器。每个动作 = 一次 guard 问询 + 一次审计。"""

    def __init__(self, guard: Guard | None = None) -> None:
        self.guard = guard or Guard()

    def run(
        self,
        op: str,
        *,
        target: str,
        description: str,
        category: str | None = None,
        confirmed: bool = False,
        trace_id: str = "",
        **kwargs: Any,
    ) -> OpResult:
        """统一入口：判 → 执行 → 审计。confirm 未确认时不执行只返回待确认。"""
        req = ActionRequest(
            track="headless",
            description=description,
            category=category,
            target_path=target,
            trace_id=trace_id,
        )
        verdict = self.guard.decide(req)
        if verdict.decision == "deny":
            self.guard.audit(req, verdict, {"op": op, "executed": False})
            return OpResult(ok=False, verdict=verdict, error=verdict.reason)
        if verdict.decision == "confirm" and not confirmed:
            # 不落审计——还没发生任何事；确认后重来才算一次动作
            return OpResult(ok=False, needs_confirmation=True, verdict=verdict)
        fn = getattr(self, f"_op_{op}", None)
        if fn is None:
            return OpResult(ok=False, verdict=verdict, error=f"未知动作 {op}")
        try:
            result = fn(Path(target), **kwargs)
        except Exception as e:  # noqa: BLE001 —— 单个动作失败要留痕，不许无声消失
            self.guard.audit(req, verdict, {"op": op, "executed": False, "error": str(e)})
            log.warning("headless_op_failed", op=op, error=str(e), trace_id=trace_id)
            return OpResult(ok=False, verdict=verdict, error=str(e))
        self.guard.audit(req, verdict, {"op": op, "executed": True})
        return OpResult(ok=True, verdict=verdict, result=result)

    # ---------- 动作集 v0 ----------

    def _op_list_dir(self, target: Path) -> list[str]:
        return sorted(p.name for p in target.iterdir())

    def _op_read_text(self, target: Path, tail: int | None = None) -> str:
        text = target.read_text(encoding="utf-8", errors="replace")
        if tail:
            return "\n".join(text.splitlines()[-tail:])
        return text

    def _op_write_text(self, target: Path, content: str = "") -> str:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return str(target)

    def _op_move(self, target: Path, dest: str = "") -> str:
        d = Path(dest)
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(d))
        return str(d)

    def _op_organize_by_date(self, target: Path) -> dict[str, int]:
        """P2 里程碑：把目录下的文件按修改日期归入 YYYY-MM-DD 子文件夹。"""
        moved: dict[str, int] = {}
        for f in list(target.iterdir()):
            if not f.is_file():
                continue
            day = datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d")
            sub = target / day
            sub.mkdir(exist_ok=True)
            shutil.move(str(f), str(sub / f.name))
            moved[day] = moved.get(day, 0) + 1
        return moved


__all__ = ["Headless", "OpResult"]
