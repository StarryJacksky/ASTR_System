"""后台执行层设置卡（P2-W8）：覆盖层合并 / 危险名单底线 / 写回热重载 / 审计查看。"""

from __future__ import annotations

import json

import pytest
import yaml
from pydantic import ValidationError

from astr.effector.admin import PolicyUpdate, apply_update, read_audit, read_policy
from astr.effector.guard import (
    CORE_DANGEROUS_CATEGORIES,
    ActionRequest,
    Guard,
    GuardPolicy,
    enforce_floor,
    merge_policy,
)


def _write_yaml(path, data) -> None:
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def _base_policy(tmp_path) -> dict:
    return {
        "approval_mode": "ask",
        "headless_scope": "cwd",
        "headless_cwd": str(tmp_path / "sandbox"),
        "dangerous_actions": {
            "categories": ["payment", "file_delete"],
            "keyword_blacklist": ["删除", "rm"],
        },
        "audit": {"log_dir": str(tmp_path / "logs")},
    }


# ---------- 覆盖层合并 ----------


def test_policy_overlay_merges_over_base(tmp_path) -> None:
    base = tmp_path / "base.yaml"
    ov = tmp_path / "local.yaml"
    _write_yaml(base, _base_policy(tmp_path))
    _write_yaml(ov, {"approval_mode": "audited", "headless_folders": ["D:/somewhere"]})

    p = GuardPolicy.load(base, overlay=ov)
    assert p.approval_mode == "audited"  # 覆盖层生效
    assert p.headless_folders == ["D:/somewhere"]
    assert p.headless_scope == "cwd"  # 未覆盖字段保持基线
    # dict 字段逐键合并
    merged = merge_policy({"audit": {"a": 1, "b": 2}}, {"audit": {"b": 9}})
    assert merged["audit"] == {"a": 1, "b": 9}


def test_policy_load_without_overlay_unchanged(tmp_path) -> None:
    base = tmp_path / "base.yaml"
    _write_yaml(base, _base_policy(tmp_path))
    p = GuardPolicy.load(base, overlay=tmp_path / "nonexistent.yaml")
    assert p.approval_mode == "ask"


# ---------- 危险名单底线（铁律 3 延伸）----------


def test_enforce_floor_cannot_remove_core() -> None:
    # 企图把 payment 从危险类别里勾掉、把"删除"从关键词里删掉 → 全部被并回
    out = enforce_floor({"categories": ["send_message"], "keyword_blacklist": ["自定义词"]})
    assert CORE_DANGEROUS_CATEGORIES <= set(out["categories"])
    assert "删除" in out["keyword_blacklist"] and "自定义词" in out["keyword_blacklist"]


def test_policy_update_rejects_bad_mode() -> None:
    with pytest.raises(ValidationError):
        PolicyUpdate(approval_mode="yolo")  # type: ignore[arg-type]


# ---------- 写回 → 热重载 ----------


def test_apply_update_writes_overlay_and_reloads(tmp_path) -> None:
    ov = tmp_path / "guard_policy.local.yaml"
    guard = Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "logs")

    result = apply_update(PolicyUpdate(approval_mode="audited"), guard, overlay=ov)
    assert result["approval_mode"] == "audited"
    assert guard.policy.approval_mode == "audited"  # 共享 Guard 就地生效
    assert yaml.safe_load(ov.read_text(encoding="utf-8"))["approval_mode"] == "audited"

    # 第二次只改别的字段：已写字段保持（覆盖层是累积的）
    apply_update(PolicyUpdate(headless_scope="folders"), guard, overlay=ov)
    data = yaml.safe_load(ov.read_text(encoding="utf-8"))
    assert data["approval_mode"] == "audited" and data["headless_scope"] == "folders"


def test_apply_update_dangerous_floor_enforced(tmp_path) -> None:
    ov = tmp_path / "guard_policy.local.yaml"
    guard = Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "logs")

    apply_update(PolicyUpdate(dangerous_keywords=["只留这个"]), guard, overlay=ov)
    kws = guard.policy.dangerous_actions["keyword_blacklist"]
    assert "只留这个" in kws and "删除" in kws and "付款" in kws  # 底线并回
    # 重载后的关键词判定仍然生效（危险动作任何档 confirm）
    v = guard.decide(ActionRequest(track="mcp", description="帮我把付款流程走完"))
    assert v.decision == "confirm" and v.dangerous


def test_read_policy_exposes_locks(tmp_path) -> None:
    guard = Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "logs")
    view = read_policy(guard)
    assert "payment" in view["core_dangerous_categories"]
    assert "untrusted_wrapping" in view["locked"]


# ---------- 审计查看 ----------


def test_read_audit_entries_and_chain(tmp_path) -> None:
    guard = Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "logs")
    for i in range(3):
        req = ActionRequest(track="headless", description=f"动作{i}", trace_id=f"t{i}")
        guard.audit(req, guard.decide(req))

    out = read_audit(guard, limit=2)
    assert out["total"] == 3 and len(out["entries"]) == 2
    assert out["chain_valid"] is True and out["dates"]

    # 篡改一行 → 链断
    f = guard._audit_path()
    lines = f.read_text(encoding="utf-8").splitlines()
    row = json.loads(lines[1])
    row["description"] = "被改过"
    lines[1] = json.dumps(row, ensure_ascii=False)
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert read_audit(guard)["chain_valid"] is False


def test_read_audit_empty(tmp_path) -> None:
    guard = Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "empty")
    out = read_audit(guard)
    assert out["entries"] == [] and out["chain_valid"] is None


# ---------- Core 端点（ASGI 直调，不起 lifespan/redis）----------


async def test_admin_endpoints_roundtrip(tmp_path, monkeypatch) -> None:
    import httpx

    import astr.effector.admin as admin_mod
    from astr.core.app import app
    from astr.effector import dispatcher
    from astr.effector.toolkit import Toolkit

    tk = Toolkit(
        Guard(GuardPolicy.model_validate(_base_policy(tmp_path)), log_dir=tmp_path / "logs")
    )
    monkeypatch.setattr(dispatcher, "_toolkit", tk)
    ov = tmp_path / "guard_policy.local.yaml"
    monkeypatch.setattr(admin_mod, "default_overlay_path", lambda: ov)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.get("/v1/admin/effector/policy")
        assert r.status_code == 200 and r.json()["approval_mode"] == "ask"

        r = await c.put("/v1/admin/effector/policy", json={"approval_mode": "audited"})
        assert r.status_code == 200 and r.json()["approval_mode"] == "audited"
        assert tk.guard.policy.approval_mode == "audited"  # 共享 Guard 热重载

        # 坏值：pydantic 请求体校验直接 422，覆盖层不被碰
        r = await c.put("/v1/admin/effector/policy", json={"approval_mode": "yolo"})
        assert r.status_code == 422

        r = await c.get("/v1/admin/effector/audit")
        assert r.status_code == 200 and "chain_valid" in r.json()
