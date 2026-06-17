"""后台教学圆桌单测：草稿→批评→修订 → 产 teaching.jsonl + dpo_dataset.jsonl。"""

from __future__ import annotations

import json

from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import Settings
from astr.soul import teaching


def _settings(tmp_path) -> Settings:
    return Settings(_env_file=None, astr_data_dir=tmp_path, teaching_critics=2)


async def _fake_route(req: RouteRequest) -> RouteResponse:
    content = (
        "改好的：你妈喊你回家吃饭了" if req.task == "soul_reply" else f"[{req.task}] 你漏了一点"
    )
    return RouteResponse(
        content=content,
        task=req.task,
        model_key="x",
        model="x",
        tier_used=req.cost_tier,
        trace_id=req.trace_id,
    )


async def test_teach_writes_learning_data(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    monkeypatch.setattr(teaching, "get_settings", lambda: s)
    # 开局两席 → 批评应由同一桌（emotion+logic）来，而非另挑一批
    report = {
        "summary": "[emotion] 安抚 | [logic] 点破",
        "seats": [{"seat": "emotion"}, {"seat": "logic"}],
    }

    out = await teaching.teach(
        "justin", "我好累啊", "草稿回复", report, route_fn=_fake_route, trace_id="t1"
    )
    assert out["changed"] is True
    assert len(out["critiques"]) == 2  # 同桌两席（teaching_critics=2 上限内）

    base = tmp_path / "soul_package" / "justin"
    tj = base / "behavior_capsules" / "teaching.jsonl"
    dp = base / "preferences" / "dpo_dataset.jsonl"
    assert tj.exists() and dp.exists()

    trace = json.loads(tj.read_text(encoding="utf-8").splitlines()[0])
    assert trace["draft"] == "草稿回复" and trace["revision"].startswith("改好的")

    dpo = json.loads(dp.read_text(encoding="utf-8").splitlines()[0])
    assert dpo["rejected"] == "草稿回复" and dpo["chosen"].startswith("改好的")
    assert dpo["source"] == "teaching" and dpo["reason"]


async def test_teach_no_dpo_when_unchanged(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    monkeypatch.setattr(teaching, "get_settings", lambda: s)

    async def same_route(req: RouteRequest) -> RouteResponse:
        # 修订与草稿一致 → 不产 DPO（没改进就不算训练对）
        content = "草稿回复" if req.task == "soul_reply" else "一点教学"
        return RouteResponse(
            content=content,
            task=req.task,
            model_key="x",
            model="x",
            tier_used=req.cost_tier,
            trace_id=req.trace_id,
        )

    out = await teaching.teach(
        "justin",
        "在吗",
        "草稿回复",
        {"summary": "x", "seats": [{}]},
        route_fn=same_route,
        trace_id="t2",
    )
    assert out["changed"] is False
    assert not (tmp_path / "soul_package" / "justin" / "preferences" / "dpo_dataset.jsonl").exists()
