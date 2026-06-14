"""EmbodimentAdapter 契约（宪法文件 03 §3 的代码落盘）。

四方法（总规 §2.8.5）：cold_boot / derive_weights / evaluate_continuity / export_soul_delta。
v1 三个实现：PromptBootAdapter(P0) / PromptOnlyAdapter(P1) / TransformerLoRAAdapter(P4)。
上层只拿到一个 OpenAI 兼容端点 + 注入说明（InferenceHandle），永不直接碰权重。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field


class InferenceHandle(BaseModel):
    """cold_boot 的返回——上层只拿到一个 OpenAI 兼容端点 + 注入说明。"""

    endpoint: str  # "http://127.0.0.1:8080/v1" 或 LiteLLM 模型名
    model_name: str
    system_prompt: str  # 已注入身份叙事/宪法/风格的完整 system prompt
    rag_collection: str  # Chroma collection 名
    adapter_name: str


class ContinuityReport(BaseModel):
    """evaluate_continuity 的产出（P5 传承仪式用）。"""

    sci: float
    p_continuity: float  # 人格连续性
    m_completeness: float  # 记忆完整性
    c_retention: float  # 能力保留度
    d_consistency: float  # 决策一致性
    details_ref: str = Field(default="")  # eval_reports/ 下完整报告路径


class EmbodimentAdapter(ABC):
    """躯壳适配器抽象基类。把模型无关的 SoulPackage 投射进某个具体躯壳。"""

    name: str

    @abstractmethod
    def cold_boot(self) -> InferenceHandle:
        """从 SoulPackage 冷启动出一个可对话的躯壳。"""
        raise NotImplementedError

    @abstractmethod
    def derive_weights(self) -> str:
        """派生权重（LoRA 等）。PromptBoot/PromptOnly 直接 raise NotImplementedError。"""
        raise NotImplementedError

    @abstractmethod
    def evaluate_continuity(self) -> ContinuityReport:
        """对当前躯壳跑金标集，产出 SCI 连续性报告。"""
        raise NotImplementedError

    @abstractmethod
    def export_soul_delta(self) -> dict:
        """导出自上次以来 SoulPackage 的增量（迁移/备份用）。"""
        raise NotImplementedError
