"""soul_demo 单测（mock route_fn）：MoA 合并 / 席位选择 / orchestrator 落 CBG。"""

from __future__ import annotations

from astr.contracts.adapter import InferenceHandle
from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.soul import DecisionTrace
from astr.soul import moa
from astr.soul.orchestrator import SoulOrchestrator

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


_MEDIUM_TEXT = "帮我仔细分析一下这个方案的逻辑有没有漏洞，越详细越好，真的拜托你了秋秋"  # 30+ 字，落中档


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


async def test_orchestrator_respond_writes_cbg(tmp_path) -> None:
    orch = SoulOrchestrator("justin", adapter=_FakeAdapter(), route_fn=fake_route)
    orch.cbg_path = tmp_path / "decisions.cbg.jsonl"

    reply, report = await orch.respond("秋秋在吗", trace_id="trc_demo")
    assert reply == "……行吧，知道了。"
    assert report["emotion_estimate"] == "平淡"

    assert orch.cbg_path.exists()
    line = orch.cbg_path.read_text(encoding="utf-8").strip()
    trace = DecisionTrace.model_validate_json(line)  # schema 校验
    assert trace.trace_id == "trc_demo"
    assert trace.chosen == 0
    assert len(trace.candidates) == 1
