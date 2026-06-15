"""ModelRouter 契约（宪法文件 03 §4 的代码落盘）。

任何"花钱"的云调用必须经 ModelRouter（02 §3-6）。代码里不出现具体模型名——
模型名/参数全在 router/routes.yaml，换模型/换价/被封只改那张表。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

CostTier = Literal["free", "cheap", "balanced", "max"]
TIER_ORDER: tuple[CostTier, ...] = ("free", "cheap", "balanced", "max")


class RouteRequest(BaseModel):
    task: str  # "emotion_analysis" / "soul_reply" / "intent" / "roundtable.critic" ...
    messages: list[dict]
    cost_tier: CostTier = "balanced"
    require_local: bool = False  # True = 隐私敏感，禁止出网（如涉及屏幕内容）
    timeout_s: int = 30
    trace_id: str
    temperature: float | None = None  # 采样温度（聊天回复调高一点更活、更有变化）
    top_p: float | None = None
    # 透传给 provider 的额外 body（如本地 Qwen3 关思考：{"chat_template_kwargs": {"enable_thinking": False}}）
    extra_body: dict | None = None


class RouteResponse(BaseModel):
    """route() 的返回。content 是模型回复正文；其余是计量/可观测字段。"""

    content: str
    task: str
    model_key: str  # routes.yaml 里的逻辑名，如 "local-qwen3-8b"
    model: str  # 实际 litellm 模型字符串
    tier_used: CostTier
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    degraded: bool = False  # True = 走了 fallback 或被预算闸降级到本地
    trace_id: str = ""
