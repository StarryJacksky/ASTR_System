"""ASTR 事件契约（宪法文件 03 §1 的代码落盘）。SCHEMA_VERSION = "1.0"。

跨层通信走 Redis Streams，stream key = `astr:events`，按 `type` 前缀过滤。
Schema 演进铁律：只许加可选字段，不许改名/删字段；破坏性变更升 SCHEMA_VERSION 大版本 + 迁移脚本。
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field
from ulid import ULID

SCHEMA_VERSION = "1.0"


class EventType(StrEnum):
    USER_UTTERANCE = "user.utterance"  # 用户说话（任何平台/语音）
    SYSTEM_EVENT = "system.event"  # 日历/邮件/温度等环境事件
    AGENT_THOUGHT = "agent.thought"  # 思考过程片段（给网页 SSE）
    MOA_REPORT = "moa.report"  # 智囊团结构化分析
    SOUL_DECISION = "soul.decision"  # 灵魂层最终决断（要说/要做什么）
    EFFECTOR_ACTION = "effector.action"  # 执行层动作意图
    EFFECTOR_RESULT = "effector.result"  # 动作结果 + 截图引用
    PRESENTATION_TTS = "presentation.tts"  # 待合成语音文本 + emotion_tag
    PRESENTATION_LIVE2D = "presentation.live2d"  # 表情/动作意图
    PRESENTATION_EXPRESS = "presentation.express"  # 平台无关"表达意图"，见 05 §2
    TRAIN_SAMPLE = "train.sample"  # 沉淀的训练样本
    HEARTBEAT_TICK = "heartbeat.tick"  # 心跳触发
    SAFETY_ALERT = "safety.alert"  # 护栏告警


class AuthContext(BaseModel):
    astr_user_id: str  # "jacksky" 是唯一 L2+ 用户
    level: Literal[0, 1, 2, 3]
    verified_by: list[str] = []  # ["voiceprint", "telegram_id"]


def _new_event_id() -> str:
    return f"evt_{ULID()}"


def new_trace_id() -> str:
    """入口处生成因果链 trace_id，全链路携带。"""
    return f"trc_{ULID()}"


class Event(BaseModel):
    id: str = Field(default_factory=_new_event_id)
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))
    schema_version: str = SCHEMA_VERSION
    source: str  # "sensor.voice" / "soul.orchestrator" / ...
    type: EventType
    payload: dict[str, Any]  # 各类型 payload 模型见下方
    auth: AuthContext
    trace_id: str  # 同一条因果链共享


# ─────────────────────────── 各 EventType 的 payload 模型 ───────────────────────────
# 字段一旦上线只加不改（03 §1）。可选字段默认 None / 空。


class UserUtterancePayload(BaseModel):
    """type == user.utterance。"""

    text: str
    platform: str = "cli"  # "qq"/"telegram"/"voice"/"cli"
    lang: str = "zh"
    audio_ref: str | None = None  # 语音原始音频引用
    is_group: bool = False  # 群聊消息（影响接话语境标注）
    recent: list[str] = []  # 该会话最近若干条（"说话人: 内容"），供接话顺语境


class SystemEventPayload(BaseModel):
    """type == system.event：日历/邮件/温度等环境事件。"""

    kind: str  # "calendar"/"email"/"sensor"...
    data: dict[str, Any] = {}


class AgentThoughtPayload(BaseModel):
    """type == agent.thought：给网页 SSE 的思考片段。"""

    text: str
    stage: str | None = None  # "moa"/"recall"/"compose"...


class MoaReportPayload(BaseModel):
    """type == moa.report：智囊团合并后的圆桌纪要。"""

    summary: str  # 合并摘要
    seats: list[dict[str, Any]] = []  # 每路席位的结构化输出
    intent: str | None = None
    emotion_estimate: str | None = None
    suggested_strategy: str | None = None
    risk_flags: list[str] = []


class SoulDecisionPayload(BaseModel):
    """type == soul.decision：灵魂层最终决断。"""

    reply_text: str
    emotion_tag: str | None = None
    intent: str | None = None  # 意图标签（P1-W2）：tool/research/coding/emotion/silent_observe/chat
    emotion_delta: dict[str, float] | None = None  # 本轮情绪增量（P1-W4）
    decision_trace_ref: str | None = None  # causal_behavior_graph/decisions.cbg.jsonl 行 id


class EffectorActionPayload(BaseModel):
    """type == effector.action：执行层动作意图（P2）。"""

    tool: str
    args: dict[str, Any] = {}
    requires_confirmation: bool = False


class EffectorResultPayload(BaseModel):
    """type == effector.result：动作结果 + 截图引用（P2）。"""

    tool: str
    ok: bool
    output: str | None = None
    screenshot_ref: str | None = None
    error: str | None = None


class PresentationTtsPayload(BaseModel):
    """type == presentation.tts。"""

    text: str
    emotion_tag: str | None = None
    voice_ref: str | None = None


class PresentationLive2dPayload(BaseModel):
    """type == presentation.live2d：表情/动作意图。"""

    expression: str | None = None
    motion: str | None = None
    intensity: float = 1.0


class ExpressChannel(BaseModel):
    """一条表达通道。kind 决定其余字段语义；平台不支持该 kind 时 adapter 降级到 fallback_text。"""

    kind: Literal[
        "text", "sticker", "voice", "face", "poke", "reply", "image", "reaction", "forward", "file"
    ]
    content: str | None = None  # text 主体 / face 的 id 等
    emotion: str | None = None  # sticker 选择用情绪标签（见 05 §4）
    context: str | None = None  # sticker 选择用语境
    ref: str | None = None  # voice/image/file 资源引用，如 "tts://..."
    target: str | None = None  # poke/at 目标（astr_user_id 或平台 id）
    to_msg_id: str | None = None  # reply 锚定的消息 id
    fallback_text: str = ""  # 平台不支持该 kind 时的降级文本（永不丢消息）


class ExpressPayload(BaseModel):
    """type == presentation.express 的 payload。channels 按序发送，可多通道。"""

    channels: list[ExpressChannel]
    platform_hint: str | None = None  # "qq"/"wechat"/...；None = 由 orchestrator 当前会话决定


class TrainSamplePayload(BaseModel):
    """type == train.sample：沉淀的训练样本（P4）。"""

    prompt: str
    response: str
    score: float | None = None
    tags: list[str] = []


class HeartbeatTickPayload(BaseModel):
    """type == heartbeat.tick：心跳触发（P5）。"""

    reason: str | None = None
    cadence_s: int | None = None


class SafetyAlertPayload(BaseModel):
    """type == safety.alert：护栏告警（含预算闸触发）。"""

    level: Literal["info", "warn", "critical"] = "warn"
    message: str
    context: dict[str, Any] = {}


PAYLOAD_MODELS: dict[EventType, type[BaseModel]] = {
    EventType.USER_UTTERANCE: UserUtterancePayload,
    EventType.SYSTEM_EVENT: SystemEventPayload,
    EventType.AGENT_THOUGHT: AgentThoughtPayload,
    EventType.MOA_REPORT: MoaReportPayload,
    EventType.SOUL_DECISION: SoulDecisionPayload,
    EventType.EFFECTOR_ACTION: EffectorActionPayload,
    EventType.EFFECTOR_RESULT: EffectorResultPayload,
    EventType.PRESENTATION_TTS: PresentationTtsPayload,
    EventType.PRESENTATION_LIVE2D: PresentationLive2dPayload,
    EventType.PRESENTATION_EXPRESS: ExpressPayload,
    EventType.TRAIN_SAMPLE: TrainSamplePayload,
    EventType.HEARTBEAT_TICK: HeartbeatTickPayload,
    EventType.SAFETY_ALERT: SafetyAlertPayload,
}
