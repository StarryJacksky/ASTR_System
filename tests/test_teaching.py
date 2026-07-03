"""L2 研讨单测（08 §3）：线索批评（看得见彼此）→ 她的答辩（异议权）→ 修订 → 落学习数据。"""

from __future__ import annotations

import json

from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import Settings
from astr.soul import discussion, teaching


def _settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None, astr_data_dir=tmp_path, teaching_critics=2, advisor_memory_enabled=True
    )


def _resp(req: RouteRequest, content: str) -> RouteResponse:
    return RouteResponse(
        content=content,
        task=req.task,
        model_key="x",
        model="x",
        tier_used=req.cost_tier,
        trace_id=req.trace_id,
    )


def _make_route(seen_prompts: list[str]):
    async def _fake_route(req: RouteRequest) -> RouteResponse:
        seen_prompts.append(req.messages[-1]["content"])
        if req.task == "soul_reply":
            body = req.messages[-1]["content"]
            if "逐条表态" in req.messages[0]["content"]:  # 答辩
                return _resp(req, "1 服：确实漏了\n2 不服：那条太啰嗦，我偏不")
            if "认识" in req.messages[0]["content"]:  # 师承蒸馏
                return _resp(req, "她吃软不吃硬")
            assert "你的表态" in body  # 修订必须能看到她的答辩
            return _resp(req, "改好的：你妈喊你回家吃饭了")
        return _resp(req, f"[{req.task}] 你漏了一点")

    return _fake_route


async def test_discuss_thread_dissent_and_data(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    monkeypatch.setattr(discussion, "get_settings", lambda: s)
    monkeypatch.setattr("astr.soul.advisors.get_settings", lambda: s)
    seen: list[str] = []
    # 开局两席 → 批评应由同一桌（emotion+logic）来，而非另挑一批
    report = {
        "summary": "[emotion] 安抚 | [logic] 点破",
        "seats": [{"seat": "emotion"}, {"seat": "logic"}],
    }
    emitted: list[tuple[str, str]] = []

    async def _emit(seat: str, text: str) -> None:
        emitted.append((seat, text))

    out = await discussion.discuss(
        "justin",
        "我好累啊",
        "草稿回复",
        report,
        route_fn=_make_route(seen),
        trace_id="t1",
        emit=_emit,
    )
    assert out["changed"] is True
    assert len(out["critiques"]) == 2  # 同桌两席（teaching_critics=2 上限内）
    assert "不服" in out["dissent"]  # 异议权：她顶回去了

    # 线索可见性：第二席的 prompt 里能看到第一席的发言（真讨论，不是并行小抄）
    second_critic_prompt = seen[1]
    assert "emotion_analysis" in second_critic_prompt or "你漏了一点" in second_critic_prompt

    # 讨论过程实时外发：两席 + 她的答辩
    assert len(emitted) >= 3
    assert any(seat == "秋秋" for seat, _ in emitted)

    base = tmp_path / "soul_package" / "justin"
    trace = json.loads(
        (base / "behavior_capsules" / "teaching.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert trace["draft"] == "草稿回复" and trace["revision"].startswith("改好的")
    assert trace["dissent"]  # 答辩入档

    dpo = json.loads(
        (base / "preferences" / "dpo_dataset.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    assert dpo["rejected"] == "草稿回复" and dpo["chosen"].startswith("改好的")
    assert dpo["source"] == "discussion" and "她的取舍" in dpo["reason"]

    # CBG 补充行：candidates=[草稿,修订]、chosen=1（她留了修订版）、reasoning 是答辩
    cbg_lines = (
        (base / "causal_behavior_graph" / "decisions.cbg.jsonl").read_text(encoding="utf-8")
    ).splitlines()
    row = json.loads(cbg_lines[-1])
    assert len(row["candidates"]) == 2 and row["chosen"] == 1
    assert row["reasoning"].startswith("答辩：")

    # 师承档案：两席各记了一笔交手
    adv = base / "world" / "advisors"
    assert (adv / "emotion.md").exists() and (adv / "logic.md").exists()
    assert "她答辩" in (adv / "emotion.md").read_text(encoding="utf-8")


async def test_teach_shim_no_dpo_when_unchanged(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    monkeypatch.setattr(discussion, "get_settings", lambda: s)
    monkeypatch.setattr("astr.soul.advisors.get_settings", lambda: s)

    async def same_route(req: RouteRequest) -> RouteResponse:
        # 修订与草稿一致 → 不产 DPO（没改进就不算训练对）
        content = "草稿回复" if req.task == "soul_reply" else "一点教学"
        return _resp(req, content)

    # 走旧入口 teaching.teach（兼容垫片），行为等同 discussion.discuss
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


async def test_advisor_memory_line_and_distill(tmp_path, monkeypatch) -> None:
    from astr.soul import advisors

    s = Settings(_env_file=None, astr_data_dir=tmp_path, advisor_distill_threshold=3)
    monkeypatch.setattr("astr.soul.advisors.get_settings", lambda: s)
    assert advisors.memory_line("justin", "devil") == ""  # 无档案 → 空串（prompt 不注水）
    for i in range(3):
        advisors.record("justin", "devil", f"交手{i}")
    line = advisors.memory_line("justin", "devil")
    assert "交手2" in line

    async def _route(req: RouteRequest) -> RouteResponse:
        return _resp(req, "她吃软不吃硬")

    assert await advisors.distill_if_needed("justin", "devil", _route, "t3") is True
    profile, entries = advisors.load("justin", "devil")
    assert profile == "她吃软不吃硬" and len(entries) == 3  # 蒸馏后只留最近 3 条
