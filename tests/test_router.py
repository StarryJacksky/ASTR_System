"""ModelRouter 三个核心行为单测（mock litellm）：tier 选择 / fallback / 预算降档。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from astr.contracts.router import RouteRequest
from astr.router import core


def _fake_resp(content: str = "pong", ti: int = 3, to: int = 2):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=ti, completion_tokens=to),
        _hidden_params={"response_cost": 0.0001},
    )


@pytest.fixture
def cfg():
    return core.load_routes()


@pytest.fixture(autouse=True)
def _patch_ledger(monkeypatch):
    """账本写入设为 no-op，默认当日花费 0（各测试可再覆盖）。"""
    recorded: list[dict] = []
    monkeypatch.setattr(core.ledger, "record", lambda **kw: recorded.append(kw))
    monkeypatch.setattr(core.ledger, "today_total_usd", lambda: 0.0)
    return recorded


# ── ① tier 选择 ──────────────────────────────────────────────
def test_tier_selection(cfg):
    assert core.resolve_model_key(cfg, "soul_reply", "free") == "local-qwen3-8b"
    assert core.resolve_model_key(cfg, "soul_reply", "max") == "claude-sonnet"
    assert core.resolve_model_key(cfg, "emotion_analysis", "max") == "claude-sonnet"
    # intent 只有 free 档：请求 balanced 也回落到 free 的 local
    assert core.resolve_model_key(cfg, "intent", "balanced") == "local-qwen3-8b"
    # 未知任务 → None
    assert core.resolve_model_key(cfg, "nonexistent", "max") is None


# ── ② fallback：max 档(claude)失败 → 沿 fallback 链落到本地，标 degraded ──
async def test_fallback_to_local(monkeypatch):
    async def fake_acompletion(**kwargs):
        if "anthropic" in kwargs["model"]:
            raise RuntimeError("no anthropic key")
        return _fake_resp()

    monkeypatch.setattr(core.litellm, "acompletion", fake_acompletion)
    req = RouteRequest(
        task="soul_reply",
        cost_tier="max",
        messages=[{"role": "user", "content": "ping"}],
        trace_id="trc_test",
    )
    resp = await core.route(req)
    assert resp.model_key == "local-qwen3-8b"
    assert resp.degraded is True
    assert resp.content == "pong"


# ── ③ 预算降档：当日花费达 90% → 起始档降一级 ──
async def test_budget_downgrade(monkeypatch):
    monkeypatch.setattr(core.ledger, "today_total_usd", lambda: 4.5)  # 默认预算 5 → 90%

    captured = {}

    async def fake_acompletion(**kwargs):
        captured["model"] = kwargs["model"]
        return _fake_resp()

    monkeypatch.setattr(core.litellm, "acompletion", fake_acompletion)
    # 请求 max 档情感分析（max=claude-sonnet）；降一档到 balanced（claude-haiku）
    req = RouteRequest(
        task="emotion_analysis",
        cost_tier="max",
        messages=[{"role": "user", "content": "ping"}],
        trace_id="trc_test",
    )
    resp = await core.route(req)
    assert resp.tier_used == "balanced"
    assert resp.model_key == "claude-haiku"
    assert resp.degraded is True


# ── 云 Qwen 走硅基流动（OpenAI 兼容 + api_key_env）──
def test_siliconflow_qwen_routing(cfg):
    assert core.resolve_model_key(cfg, "chinese_writing", "balanced") == "qwen-sf"
    model_cfg = cfg.models["qwen-sf"]
    assert model_cfg["litellm"].startswith("openai/Qwen/")
    assert "siliconflow" in model_cfg["api_base"]
    assert model_cfg["api_key_env"] == "SILICONFLOW_API_KEY"
    req = RouteRequest(
        task="chinese_writing",
        messages=[{"role": "user", "content": "写一段"}],
        cost_tier="balanced",
        trace_id="trc_t",
    )
    params = core._build_params(model_cfg, req)
    assert params["api_base"] == "https://api.siliconflow.cn/v1"
    assert "api_key" in params  # 从 Settings.siliconflow_api_key 读，值取决于 .env


# ── require_local：永不出网，直接打本地 ──
async def test_require_local(monkeypatch):
    async def fake_acompletion(**kwargs):
        assert kwargs.get("api_base"), "require_local 必须走带 api_base 的本地端点"
        return _fake_resp()

    monkeypatch.setattr(core.litellm, "acompletion", fake_acompletion)
    req = RouteRequest(
        task="soul_reply",
        cost_tier="max",
        require_local=True,
        messages=[{"role": "user", "content": "屏幕内容"}],
        trace_id="trc_test",
    )
    resp = await core.route(req)
    assert resp.model_key == "local-qwen3-8b"
