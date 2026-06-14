"""soul_demo 单测（mock route_fn）：MoA 合并 / 席位选择 / orchestrator 落 CBG。"""

from __future__ import annotations

from astr.contracts.adapter import InferenceHandle
from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.soul import DecisionTrace
from astr.soul import moa
from astr.soul.orchestrator import SoulOrchestrator, sanitize_reply


def test_sanitize_strips_name_prefix_and_roleplay() -> None:
    assert sanitize_reply("秋秋：你好") == "你好"
    assert sanitize_reply("露怀秋: 在呢") == "在呢"
    assert sanitize_reply("*翻白眼* 你是不是脑子进水了") == "你是不是脑子进水了"
    assert sanitize_reply("秋秋：*挑眉* 哦？") == "哦？"
    # 正常文本不动
    assert sanitize_reply("？") == "？"


_SEAT_JSON = (
    '{"intent":"测试意图","emotion_estimate":"平淡",'
    '"suggested_strategy":"直接回答","risk_flags":[]}'
)


async def fake_route(req: RouteRequest) -> RouteResponse:
    if req.task == "soul_reply":
        return RouteResponse(
            content="……行吧，知道了。",
            task=req.task,
            model_key="local-qwen3-8b",
            model="openai/qwen3-8b",
            tier_used="free",
            trace_id=req.trace_id,
        )
    return RouteResponse(
        content=_SEAT_JSON,
        task=req.task,
        model_key="deepseek-chat",
        model="deepseek/deepseek-chat",
        tier_used="cheap",
        trace_id=req.trace_id,
    )


_MEDIUM_TEXT = (
    "帮我仔细分析一下这个方案的逻辑有没有漏洞，越详细越好，真的拜托你了秋秋"  # 30+ 字，落中档
)


def test_select_seats_by_length() -> None:
    assert moa.select_seats("在吗")[0] == ["emotion"]
    assert moa.select_seats(_MEDIUM_TEXT)[0] == ["emotion", "logic"]
    long_text = "请详细分析" + "啊" * 300
    assert moa.select_seats(long_text)[0] == ["emotion", "logic", "retrieval", "zeitgeist"]


async def test_moa_merge() -> None:
    report = await moa.analyze(_MEDIUM_TEXT, "trc_t", route_fn=fake_route)
    assert report["emotion_estimate"] == "平淡"
    assert report["intent"] == "测试意图"
    assert report["risk_flags"] == []
    assert "seats" in report and len(report["seats"]) == 2


class _FakeAdapter:
    def cold_boot(self) -> InferenceHandle:
        return InferenceHandle(
            endpoint="http://127.0.0.1:8080/v1",
            model_name="qwen3-8b",
            system_prompt="（系统提示占位）",
            rag_collection="justin_memory",
            adapter_name="prompt_boot:qwen3-8b",
        )

    def recall(self, query: str, k: int = 6) -> list[str]:
        return []


async def test_orchestrator_respond_writes_cbg(tmp_path, monkeypatch) -> None:
    # 情感/纪要/生活落盘指向 no-op，避免污染真实灵魂目录
    from astr.soul import emotion, life

    monkeypatch.setattr(emotion, "load", lambda *a, **k: emotion.EmotionVector())
    monkeypatch.setattr(emotion, "save", lambda *a, **k: None)
    monkeypatch.setattr(moa, "save_report", lambda *a, **k: "ref.json")
    monkeypatch.setattr(life, "to_prompt_line", lambda *a, **k: "（作息占位）")
    from astr.memory import experience

    monkeypatch.setattr(experience, "record", lambda *a, **k: None)
    monkeypatch.setattr(experience, "behavior_recall", lambda *a, **k: [])

    orch = SoulOrchestrator("justin", adapter=_FakeAdapter(), route_fn=fake_route)
    orch.cbg_path = tmp_path / "decisions.cbg.jsonl"

    # 带问号 → 触发 MoA（条件式 MoA 下短句会跳过）
    reply, report = await orch.respond("秋秋，你怎么看这事？", trace_id="trc_demo")
    assert reply == "……行吧，知道了。"
    assert report["emotion_estimate"] == "平淡"

    assert orch.cbg_path.exists()
    line = orch.cbg_path.read_text(encoding="utf-8").strip()
    trace = DecisionTrace.model_validate_json(line)  # schema 校验
    assert trace.trace_id == "trc_demo"
    assert trace.chosen == 0
    assert len(trace.candidates) == 1
    assert trace.moa_report_ref == "ref.json"  # 管家纪要已链上（不再是 None）


def test_moa_save_report(tmp_path, monkeypatch) -> None:
    import astr.soul.moa as moa_mod
    from astr.contracts.settings import Settings

    monkeypatch.setattr(
        moa_mod, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    ref = moa_mod.save_report("justin", "trc_x", {"summary": "[emotion] 安抚", "intent": "chat"})
    assert ref.startswith("causal_behavior_graph/moa_reports/") and ref.endswith("trc_x.json")
    import json

    saved = json.loads((tmp_path / "soul_package" / "justin" / ref).read_text(encoding="utf-8"))
    assert saved["trace_id"] == "trc_x" and saved["intent"] == "chat"
