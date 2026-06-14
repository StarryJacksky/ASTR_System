"""意图路由 + 鉴权白名单单测（P1-W2）。"""

from __future__ import annotations

from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import Settings
from astr.soul import intent


def test_rule_classify() -> None:
    assert intent.rule_classify("帮我打开下载文件夹") == "tool"
    assert intent.rule_classify("这段代码报错了，traceback 在这") == "coding"
    assert intent.rule_classify("帮我复现这篇 arxiv 论文") == "research"
    assert intent.rule_classify("今天好难过啊") is None  # 交给模型兜底


async def test_classify_intent_model_fallback() -> None:
    async def fake_route(req: RouteRequest) -> RouteResponse:
        return RouteResponse(
            content="emotion",
            task=req.task,
            model_key="local-qwen3-8b",
            model="openai/qwen3-8b",
            tier_used="free",
            trace_id=req.trace_id,
        )

    label = await intent.classify_intent("今天好难过啊", "trc_t", route_fn=fake_route)
    assert label == "emotion"


async def test_empty_is_silent_observe() -> None:
    async def fake_route(req: RouteRequest) -> RouteResponse:  # pragma: no cover - 不应被调用
        raise AssertionError("空串不该调模型")

    assert await intent.classify_intent("   ", "trc_t", route_fn=fake_route) == "silent_observe"


def test_resolve_level_whitelist() -> None:
    s = Settings(_env_file=None, astr_owner_id="jacksky", astr_l2_user_ids="telegram:123")
    assert s.resolve_level("jacksky") == 2
    assert s.resolve_level("telegram:123") == 2
    assert s.resolve_level("qq:999") == 0
