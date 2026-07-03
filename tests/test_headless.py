"""无视觉轨 v0 单测：里程碑归类 / 越界拒绝 / 危险动作待确认流程 / 审计留痕。"""

from __future__ import annotations

import json
import os
import time

from astr.effector.guard import Guard, GuardPolicy
from astr.effector.headless import Headless


def _headless(tmp_path, **kw) -> Headless:
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir(exist_ok=True)
    base = {
        "approval_mode": "audited",  # 白名单内自动执行（里程碑无人值守跑）
        "headless_scope": "cwd",
        "headless_cwd": str(sandbox),
        "dangerous_actions": {
            "categories": ["file_delete"],
            "keyword_blacklist": ["删除", "rm"],
        },
        "audit": {"log_dir": str(tmp_path / "logs")},
    }
    base.update(kw)
    policy = GuardPolicy.model_validate(base)
    return Headless(Guard(policy, log_dir=tmp_path / "logs"))


def test_milestone_organize_by_date(tmp_path) -> None:
    """P2 里程碑（headless 轨）：沙箱文件按日期归类，全程审计可验。"""
    h = _headless(tmp_path)
    sandbox = tmp_path / "sandbox"
    old = sandbox / "old.txt"
    new = sandbox / "new.txt"
    old.write_text("a", encoding="utf-8")
    new.write_text("b", encoding="utf-8")
    day_old = time.time() - 3 * 86400
    os.utime(old, (day_old, day_old))

    r = h.run(
        "organize_by_date", target=str(sandbox), description="沙箱文件按日期归类", trace_id="t-ms"
    )
    assert r.ok and sum(r.result.values()) == 2
    assert len(list(sandbox.glob("*/*.txt"))) == 2  # 两个文件都进了日期子目录
    assert len({p.parent.name for p in sandbox.glob("*/*.txt")}) == 2  # 且日期不同

    # 审计留痕 + hash 链可验
    logs = list((tmp_path / "logs").glob("actions_*.jsonl"))
    assert logs and Guard.verify_chain(logs[0]) is True
    row = json.loads(logs[0].read_text(encoding="utf-8").splitlines()[-1])
    assert row["decision"] == "allow" and row["extra"]["executed"] is True


def test_outside_scope_denied_and_audited(tmp_path) -> None:
    h = _headless(tmp_path)
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    r = h.run("list_dir", target=str(outside), description="看看外面的目录", trace_id="t-out")
    assert not r.ok and r.verdict is not None and r.verdict.decision == "deny"
    # 拒绝也要留痕（谁想越界、被拦了，都是审计的一部分）
    logs = list((tmp_path / "logs").glob("actions_*.jsonl"))
    assert (
        logs
        and json.loads(logs[0].read_text(encoding="utf-8").splitlines()[-1])["decision"] == "deny"
    )


def test_dangerous_requires_confirmation_then_runs(tmp_path) -> None:
    """危险动作（关键词命中）→ 先待确认不执行；confirmed=True 重来才动手。"""
    h = _headless(tmp_path)
    sandbox = tmp_path / "sandbox"
    f = sandbox / "junk.txt"
    f.write_text("x", encoding="utf-8")
    trash = sandbox / "trash" / "junk.txt"

    first = h.run(
        "move",
        target=str(f),
        dest=str(trash),
        description="把垃圾文件删除（移入回收目录）",
        trace_id="t-danger",
    )
    assert not first.ok and first.needs_confirmation and f.exists()  # 没确认，一根手指都没动

    second = h.run(
        "move",
        target=str(f),
        dest=str(trash),
        description="把垃圾文件删除（移入回收目录）",
        confirmed=True,
        trace_id="t-danger",
    )
    assert second.ok and trash.exists() and not f.exists()


def test_read_write_roundtrip(tmp_path) -> None:
    h = _headless(tmp_path)
    p = tmp_path / "sandbox" / "note.txt"
    assert h.run(
        "write_text", target=str(p), content="第一行\n第二行\n第三行", description="写笔记"
    ).ok
    r = h.run("read_text", target=str(p), tail=2, description="读笔记最后两行")
    assert r.ok and r.result == "第二行\n第三行"
