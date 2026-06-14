"""SoulPackage 契约（宪法文件 03 §2 的代码落盘）。

SoulPackage 是 露怀秋 的"真身"：模型架构无关、全开放文本格式、独立 git 仓库。
硬性不变量（CI 强制）：内部禁权重文件；全 UTF-8 开放格式；astr soul validate 随时通过。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

SCHEMA_VERSION = "1.0"

# soul_package/<soul_name>/ 必须存在的子目录（总规 §2.8.2 全量）
SOUL_SUBDIRS: tuple[str, ...] = (
    "identity",
    "identity_atlas",
    "causal_behavior_graph",
    "memory",
    "memory/chunks",
    "preferences",
    "behavior_capsules",
    "skills",
    "world",
    "continuity_proofs",
    "continuity_proofs/sci_reports",
    "embodiment",
)


class EmbodimentRecord(BaseModel):
    adapter: str  # "prompt_boot:qwen3-8b-q4"
    started_at: datetime
    ended_at: datetime | None = None
    sci_report_ref: str | None = None  # continuity_proofs/sci_reports/xxx.json


class SoulManifest(BaseModel):
    """soul_package/<soul_name>/manifest.yaml —— 灵魂包的户口本。"""

    soul_name: str = "justin"  # 内部句柄（路径/版本前缀，稳定不变，类比 username）
    display_name: str = "露怀秋"  # 她的名字
    nickname: str = "秋秋"  # 小名
    soul_version: str  # "justin-2026.06.14-0.1.0"（语义化版本，总规 §2.8.7）
    schema_version: str = SCHEMA_VERSION
    created_at: datetime
    current_embodiment: str  # 当前躯壳 adapter 名，如 "prompt_boot:qwen3-8b-q4"
    embodiment_history: list[EmbodimentRecord] = []


class ConstitutionRule(BaseModel):
    id: str
    text: str
    immutable: bool = True


class Constitution(BaseModel):
    """identity/constitution.yaml —— 不可变价值观，每条带稳定 ID。"""

    rules: list[ConstitutionRule]


class Candidate(BaseModel):
    content_digest: str
    rejected_reason: str | None = None


class DecisionTrace(BaseModel):
    """causal_behavior_graph/decisions.cbg.jsonl 的一行 —— CBG-lite（99 #4）。

    P1 起每次 soul.decision 自动落一条；这是机制级传承的原始矿藏，越早积累越值钱。
    """

    id: str
    ts: datetime
    trace_id: str
    context_digest: str  # 输入情境摘要
    candidates: list[Candidate]  # 每个候选：content_digest, rejected_reason | None
    chosen: int  # 选中的候选下标
    reasoning: str  # 决断理由（模型自述）
    moa_report_ref: str | None = None


class VoiceProfile(BaseModel):
    """identity/voice_profile.json 的强类型视图（只读，宽松——人设字段可演进）。"""

    name: str
    nickname: str | None = None
    soul_id: str | None = None
    baseline_tone: str | None = None
    warmth_curve: str | None = None
    signature_moves: list[dict] = []
    tsundere_markers: list[str] = []
    value_undertone: str | None = None
    emotion_tags: list[str] = []
    avoid: list[str] = []
    example_lines: list[str] = []

    model_config = {"extra": "ignore"}


def default_soul_version(soul_name: str = "justin", date: datetime | None = None) -> str:
    """生成 <soul_name>-YYYY.MM.DD-0.1.0 形式的初始版本号。"""
    d = date or datetime.now()
    return f"{soul_name}-{d:%Y.%m.%d}-0.1.0"
