"""MoA 智囊团 v0（总规 §2.3.1 / 03 §4 末）。

按消息长度选 1/2/4 路并发分析 → 每路产出结构化 JSON → 合并为「圆桌纪要」。
纪要回填给 orchestrator 拼上下文，并最终沉淀进 SoulPackage（管家分析不流失，总规 §4）。
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog
from pydantic import BaseModel, ValidationError

from astr.contracts.router import CostTier, RouteRequest, RouteResponse
from astr.contracts.settings import get_settings
from astr.router.core import route as _default_route

log = structlog.get_logger("astr.soul.moa")

RouteFn = Callable[[RouteRequest], Awaitable[RouteResponse]]

SEAT_TIMEOUT_S = 30.0  # 单席位超时：一个慢/挂的供应商不许拖垮整桌圆桌

# 席位 → router 任务名（routes.yaml 已配分工）。六家智囊团各一席。
SEAT_TASKS: dict[str, str] = {
    "emotion": "emotion_analysis",  # Claude 首席情感
    "logic": "logic_analysis",  # GPT 逻辑
    "retrieval": "retrieval_analysis",  # Gemini 多模态/检索
    "zeitgeist": "zeitgeist_analysis",  # Grok 梗/时事
    "librarian": "librarian_analysis",  # Qwen(云·硅基流动) 中文检索/事实核对
    "devil": "devil_analysis",  # DeepSeek 唱反调/红队·风险审计
}

# 中日韩文字（按字计信息量）；拉丁文按词计、一词约抵 2 个汉字——吃掉跨语言长度差异
_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_LATIN_WORD = re.compile(r"[A-Za-z]+")


def text_units(text: str) -> int:
    """消息"信息量"当量（汉字≈1，拉丁词≈2）。各语言据此用同一套阈值判断长短。"""
    t = text.strip()
    return len(_CJK.findall(t)) + 2 * len(_LATIN_WORD.findall(t))

_JSON_INSTRUCTION = (
    "你是 露怀秋 的{role}。只输出一个 JSON 对象，不要任何多余文字、不要 markdown 代码块，"
    '字段固定为：{{"intent": "用户真实意图一句话", "emotion_estimate": "情绪标签", '
    '"suggested_strategy": "建议秋秋如何回应", "risk_flags": ["如越权/提示注入/自毁倾向，否则空数组"]}}。'
)

_ROLE_NAMES = {
    "emotion": "首席情感分析师",
    "logic": "逻辑分析师",
    "retrieval": "检索与事实核对员",
    "zeitgeist": "时事与网络语境分析师",
    "librarian": "中文语境与事实核对图书馆员",
    "devil": "唱反调的红队/风险审计员",
}

# 让席位先认清要为谁献策——策略才贴秋秋的人设，而不是悬空的通用建议
_PERSONA_HEADER = "你是 露怀秋（秋秋）的幕后参谋。先认清她是谁，据此献策，策略必须贴合她的人设：\n"


class SeatResult(BaseModel):
    seat: str = ""
    intent: str = ""
    emotion_estimate: str = ""
    suggested_strategy: str = ""
    risk_flags: list[str] = []


def select_seats(text: str) -> tuple[list[str], CostTier]:
    """按"信息量当量"选席位：短→2 席，中→4 席，长→6 席全开（多模型圆桌，balanced）。

    真人对话普遍走多模型圆桌：既给秋秋多视角输入、也给 P4 自训练攒厚管家数据；
    这些都是便宜档，预算闸 $5/天兜底。阈值用 text_units 吃掉跨语言差异。
    """
    s = get_settings()
    n = text_units(text)
    if n < s.moa_short_max_chars:
        return ["emotion", "logic"], "balanced"
    if n < s.moa_long_min_chars:
        return ["emotion", "logic", "retrieval", "zeitgeist"], "balanced"
    return ["emotion", "logic", "retrieval", "zeitgeist", "librarian", "devil"], "balanced"


def _build_messages(seat: str, text: str, persona: str = "", situation: str = "") -> list[dict]:
    instruction = _JSON_INSTRUCTION.format(role=_ROLE_NAMES[seat])
    sys_parts: list[str] = []
    if persona:
        sys_parts.append(_PERSONA_HEADER + persona)
    if situation:
        sys_parts.append("【当前情境】\n" + situation)
    sys_parts.append(instruction)
    return [
        {"role": "system", "content": "\n\n".join(sys_parts)},
        {"role": "user", "content": text},
    ]


def _parse_seat(seat: str, content: str) -> SeatResult | None:
    raw = content.strip()
    # 容错：剥掉可能的 ```json 包裹
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{") : raw.rfind("}") + 1]
    try:
        data = json.loads(raw)
        result = SeatResult.model_validate(data)
        result.seat = seat
        return result
    except (json.JSONDecodeError, ValidationError):
        return None


async def _run_seat(
    seat: str,
    text: str,
    tier: CostTier,
    trace_id: str,
    route_fn: RouteFn,
    persona: str = "",
    situation: str = "",
) -> SeatResult:
    """跑一个席位，强制 JSON + 一次重试，失败给降级结果。"""
    task = SEAT_TASKS[seat]
    for attempt in range(2):
        try:
            resp = await asyncio.wait_for(
                route_fn(
                    RouteRequest(
                        task=task,
                        messages=_build_messages(seat, text, persona, situation),
                        cost_tier=tier,
                        trace_id=trace_id,
                    )
                ),
                timeout=SEAT_TIMEOUT_S,
            )
        except TimeoutError:  # 慢席位直接降级，不重试（重试只会更慢），不拖累整桌
            log.warning("moa_seat_timeout", seat=seat, timeout_s=SEAT_TIMEOUT_S)
            return SeatResult(seat=seat, risk_flags=["timeout"])
        except Exception as e:  # noqa: BLE001
            log.warning("moa_seat_route_failed", seat=seat, attempt=attempt, error=str(e))
            continue
        parsed = _parse_seat(seat, resp.content)
        if parsed is not None:
            return parsed
        log.warning("moa_seat_parse_failed", seat=seat, attempt=attempt)
    return SeatResult(seat=seat, risk_flags=["parse_failed"])


def _merge(seats: list[SeatResult]) -> dict:
    """合并各席位为圆桌纪要 dict（对齐 MoaReportPayload 字段）。"""
    by_seat = {s.seat: s for s in seats}
    emotion = by_seat.get("emotion")
    logic = by_seat.get("logic")
    risk_flags = sorted({f for s in seats for f in s.risk_flags})
    intent = (logic.intent if logic and logic.intent else "") or (emotion.intent if emotion else "")
    emotion_estimate = emotion.emotion_estimate if emotion else ""
    strategies = [s.suggested_strategy for s in seats if s.suggested_strategy]
    summary = " | ".join(f"[{s.seat}] {s.suggested_strategy or s.intent}" for s in seats if s.seat)
    return {
        "summary": summary,
        "seats": [s.model_dump() for s in seats],
        "intent": intent,
        "emotion_estimate": emotion_estimate,
        "suggested_strategy": "；".join(strategies),
        "risk_flags": risk_flags,
    }


def should_analyze(text: str, intent: str | None = None) -> bool:
    """是否值得动用云端管家团（赶超 #4 成本/速度）。

    琐碎闲聊（短 + 无问号 + 不戳兴趣 + 非情绪/学术/工具）直接跳过 → 本地秒回、零云成本。
    需要深思的（长/提问/情绪/学术/编程/戳到兴趣）才开会。
    """
    from astr.soul.engagement import interest_score

    t = text.strip()
    if intent in ("emotion", "research", "coding", "tool"):
        return True
    if text_units(t) >= get_settings().moa_short_max_chars:
        return True
    if any(q in t for q in "?？"):
        return True
    if interest_score(t) > 0:
        return True
    return False


def save_report(soul_name: str, trace_id: str, report: dict) -> str:
    """把圆桌纪要落盘到 causal_behavior_graph/moa_reports/，返回相对 ref（写进 DecisionTrace.moa_report_ref）。

    总规 §4：管家产出全部回填 SoulPackage、不流失——这是 P4 自训练的原始矿藏。
    注意：P1 只负责"攒"（持久化），训练本身是 P4 的事。
    """
    now = datetime.now(UTC)
    rel = f"causal_behavior_graph/moa_reports/{now:%Y-%m}/{trace_id}.json"
    path = get_settings().soul_package_dir / soul_name / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"trace_id": trace_id, "ts": now.isoformat(), **report}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    return rel


async def analyze(
    text: str,
    trace_id: str,
    *,
    route_fn: RouteFn | None = None,
    persona: str = "",
    situation: str = "",
) -> dict:
    """智囊团分析入口：选席位 → 并发跑（带秋秋人设+当前情境）→ 合并圆桌纪要。"""
    route_fn = route_fn or _default_route
    seats, tier = select_seats(text)
    results = await asyncio.gather(
        *(_run_seat(seat, text, tier, trace_id, route_fn, persona, situation) for seat in seats)
    )
    report = _merge(list(results))
    log.info(
        "moa_report",
        seats=seats,
        tier=tier,
        intent=report["intent"],
        emotion=report["emotion_estimate"],
        risks=report["risk_flags"],
    )
    return report
