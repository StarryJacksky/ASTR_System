"""ModelRouter v0（03 §4）。策略层：tier 路由 / fallback / 预算闸 / 成本计量。

底层全部走 LiteLLM；模型名/参数由 routes.yaml 决定，代码里不出现具体模型名。
所有 key 只在本进程经 Settings 读取，永不进日志。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import litellm
import structlog
import yaml

from astr.contracts.router import TIER_ORDER, CostTier, RouteRequest, RouteResponse
from astr.contracts.settings import get_settings
from astr.ops import ledger

log = structlog.get_logger("astr.router")

# litellm 默认会打印一堆东西并对未知模型 drop 参数；收敛之。
litellm.drop_params = True
litellm.suppress_debug_info = True

_ROUTES_PATH = Path(__file__).with_name("routes.yaml")
LOCAL_MODEL_KEY = "local-qwen3-8b"


class RoutesConfig:
    """routes.yaml 的内存视图。"""

    def __init__(self, data: dict[str, Any]):
        self.tasks: dict[str, dict[str, str]] = data.get("tasks", {})
        self.models: dict[str, dict[str, str]] = data.get("models", {})
        self.fallback: dict[str, list[str]] = data.get("fallback", {})

    def fallback_chain(self) -> list[str]:
        return list(self.fallback.get("default", ["balanced", "cheap", "free"]))


@lru_cache
def load_routes(path: str | None = None) -> RoutesConfig:
    p = Path(path) if path else _ROUTES_PATH
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    return RoutesConfig(data)


def _rank(tier: str) -> int:
    return TIER_ORDER.index(tier) if tier in TIER_ORDER else 0


def _downgrade_one(tier: CostTier) -> CostTier:
    return TIER_ORDER[max(0, _rank(tier) - 1)]


def resolve_model_key(cfg: RoutesConfig, task: str, tier: str) -> str | None:
    """task+tier → routes.yaml 里的逻辑模型名。tier 缺失时取不高于它的最近可用档。"""
    task_map = cfg.tasks.get(task)
    if not task_map:
        return None
    if tier in task_map:
        return task_map[tier]
    # 向下找最近可用档（不升档，省钱优先）
    for t in reversed(TIER_ORDER[: _rank(tier)]):
        if t in task_map:
            return task_map[t]
    # 都没有就取该任务里最便宜的可用档
    for t in TIER_ORDER:
        if t in task_map:
            return task_map[t]
    return None


def _extract(resp: Any) -> tuple[str, int, int]:
    content = resp.choices[0].message.content or ""
    usage = getattr(resp, "usage", None)
    ti = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
    to = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0
    return content, ti, to


def _cost_of(resp: Any) -> float:
    hidden = getattr(resp, "_hidden_params", None)
    if isinstance(hidden, dict) and hidden.get("response_cost") is not None:
        return float(hidden["response_cost"])
    try:
        return float(litellm.completion_cost(completion_response=resp) or 0.0)
    except Exception:
        return 0.0  # 本地模型/未知定价 → 0


def _build_params(model_cfg: dict[str, str], req: RouteRequest) -> dict[str, Any]:
    params: dict[str, Any] = {
        "model": model_cfg["litellm"],
        "messages": req.messages,
        "timeout": req.timeout_s,
    }
    if req.extra_body:
        params["extra_body"] = req.extra_body
    api_base = model_cfg.get("api_base")
    if api_base:
        params["api_base"] = api_base
        key_env = model_cfg.get("api_key_env")
        if key_env:
            # OpenAI 兼容的云端点（如硅基流动）：key 经 Settings 读，永不裸取 os.environ
            params["api_key"] = getattr(get_settings(), key_env.lower(), "") or ""
        else:
            # 本地端点不校验 key，但 litellm 要求非空
            params["api_key"] = "sk-local"
    return params


def _emit_budget_alert(spent: float, budget: float) -> None:
    """预算闸触发。bus 就绪前（T09）先用日志；之后改发 safety.alert 事件。"""
    log.warning("budget_gate_triggered", spent_usd=round(spent, 6), budget_usd=budget)


async def route(req: RouteRequest, *, routes_path: str | None = None) -> RouteResponse:
    """把一条请求路由到合适的模型，含 fallback、预算闸与成本入账。"""
    cfg = load_routes(routes_path)
    settings = get_settings()

    # —— 预算闸（03 §4 规则 3）——
    spent = ledger.today_total_usd()
    budget = settings.astr_daily_budget_usd
    start_tier: CostTier = req.cost_tier
    if budget > 0 and not req.require_local:
        ratio = spent / budget
        if ratio >= 1.0:
            start_tier = "free"
            _emit_budget_alert(spent, budget)
        elif ratio >= 0.8:
            start_tier = _downgrade_one(req.cost_tier)
            _emit_budget_alert(spent, budget)

    # —— require_local：禁止出网，只打本地 ——
    if req.require_local:
        return await _attempt_local(cfg, req, degraded=False)

    # —— 构造尝试序列：起始档 + fallback 链中不高于起始档的更便宜档 ——
    attempt: list[CostTier] = [start_tier]
    for t in cfg.fallback_chain():
        if t in TIER_ORDER and _rank(t) <= _rank(start_tier) and t not in attempt:
            attempt.append(t)  # type: ignore[arg-type]

    last_err: Exception | None = None
    for i, tier in enumerate(attempt):
        model_key = resolve_model_key(cfg, req.task, tier)
        if model_key is None:
            continue
        model_cfg = cfg.models.get(model_key)
        if not model_cfg:
            continue
        try:
            resp = await litellm.acompletion(**_build_params(model_cfg, req))
        except Exception as e:  # noqa: BLE001 —— 任意 provider 异常都进 fallback
            last_err = e
            log.warning(
                "route_attempt_failed", task=req.task, tier=tier, model_key=model_key, error=str(e)
            )
            continue
        content, ti, to = _extract(resp)
        cost = _cost_of(resp)
        degraded = i > 0 or start_tier != req.cost_tier
        ledger.record(
            trace_id=req.trace_id,
            task=req.task,
            model=model_cfg["litellm"],
            tokens_in=ti,
            tokens_out=to,
            cost_usd=cost,
            degraded=degraded,
        )
        log.info(
            "route_ok",
            task=req.task,
            tier=tier,
            model_key=model_key,
            tokens_in=ti,
            tokens_out=to,
            cost_usd=round(cost, 6),
            degraded=degraded,
        )
        return RouteResponse(
            content=content,
            task=req.task,
            model_key=model_key,
            model=model_cfg["litellm"],
            tier_used=tier,
            tokens_in=ti,
            tokens_out=to,
            cost_usd=cost,
            degraded=degraded,
            trace_id=req.trace_id,
        )

    # —— 全失败 → 落本地并标 degraded ——
    log.error("route_all_failed_fallback_local", task=req.task, error=str(last_err))
    return await _attempt_local(cfg, req, degraded=True)


async def _attempt_local(cfg: RoutesConfig, req: RouteRequest, *, degraded: bool) -> RouteResponse:
    model_cfg = cfg.models.get(LOCAL_MODEL_KEY)
    if not model_cfg:
        raise RuntimeError(f"routes.yaml 缺少本地模型 {LOCAL_MODEL_KEY}")
    resp = await litellm.acompletion(**_build_params(model_cfg, req))
    content, ti, to = _extract(resp)
    ledger.record(
        trace_id=req.trace_id,
        task=req.task,
        model=model_cfg["litellm"],
        tokens_in=ti,
        tokens_out=to,
        cost_usd=0.0,
        degraded=degraded,
    )
    return RouteResponse(
        content=content,
        task=req.task,
        model_key=LOCAL_MODEL_KEY,
        model=model_cfg["litellm"],
        tier_used="free",
        tokens_in=ti,
        tokens_out=to,
        cost_usd=0.0,
        degraded=degraded,
        trace_id=req.trace_id,
    )
