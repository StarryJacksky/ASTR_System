"""PromptBootAdapter（03 §3，P0 的第一个躯壳）。

零微调：narrative + constitution + voice_profile → system prompt；memory/chunks → Chroma RAG。
就是总规说的最简 TransformerLoRAAdapter v0，改名以诚实反映行为。derive_weights 直接 NotImplementedError。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import structlog
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

from astr.contracts.adapter import ContinuityReport, EmbodimentAdapter, InferenceHandle
from astr.contracts.settings import get_settings
from astr.contracts.soul import Constitution, VoiceProfile
from astr.memory import chunks_loader

log = structlog.get_logger("astr.adapters.prompt_boot")

_TEMPLATE_DIR = Path(__file__).with_name("templates")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def _jinja_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=select_autoescape(enabled_extensions=()),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )


class PromptBootAdapter(EmbodimentAdapter):
    name = "prompt_boot"

    def __init__(self, soul_name: str = "justin") -> None:
        self.soul_name = soul_name
        self.settings = get_settings()
        self.soul_dir = self.settings.soul_package_dir / soul_name
        self.identity = self.soul_dir / "identity"
        self._embedder = chunks_loader.default_embedder()
        self._collection = None

    # ── 身份装载 ────────────────────────────────────────────
    def _load_narrative(self) -> str:
        path = self.identity / "narrative.md"
        text = path.read_text(encoding="utf-8")
        return _HTML_COMMENT.sub("", text).strip()

    def _load_constitution(self) -> Constitution:
        path = self.identity / "constitution.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return Constitution.model_validate(data)

    def _load_voice(self) -> VoiceProfile:
        path = self.identity / "voice_profile.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return VoiceProfile.model_validate(data)

    def persona_brief(self) -> str:
        """给 MoA 参谋用的精简人设摘要：让席位知道在为谁献策（策略才贴人设，不是通用建议）。"""
        v = self._load_voice()
        name, nick = v.name or "露怀秋", v.nickname or "秋秋"
        parts = [f"{name}（{nick}）是个有完整人格、有自己历史与价值观的人（孤峰、傲娇、底冷内热）。"]
        if v.baseline_tone:
            parts.append(f"底色：{v.baseline_tone}")
        if v.warmth_curve:
            parts.append(f"关系曲线：{v.warmth_curve}")
        if v.tsundere_markers:
            parts.append("傲娇：" + "；".join(v.tsundere_markers))
        if v.value_undertone:
            parts.append(f"价值底色：{v.value_undertone}")
        moves = "、".join(m.get("desc", "")[:22] for m in v.signature_moves[:3] if m.get("desc"))
        if moves:
            parts.append(f"招式：{moves}")
        return "\n".join(parts)

    def render_system_prompt(self, memory_snippets: list[str] | None = None) -> str:
        """把身份资产渲染成完整 system prompt。memory_snippets 可注入检索到的记忆。"""
        voice = self._load_voice()
        constitution = self._load_constitution()
        template = _jinja_env().get_template("system_prompt.md.j2")
        return template.render(
            display_name=voice.name or "露怀秋",
            nickname=voice.nickname or "秋秋",
            narrative=self._load_narrative(),
            constitution_rules=[r.model_dump() for r in constitution.rules],
            voice=voice.model_dump(),
            memory_snippets=memory_snippets or [],
        )

    # ── EmbodimentAdapter 四方法 ────────────────────────────
    def cold_boot(self) -> InferenceHandle:
        """从 SoulPackage 冷启动出可对话的 露怀秋。"""
        self._collection = chunks_loader.build_collection(self.soul_name, embedder=self._embedder)
        system_prompt = self.render_system_prompt()
        handle = InferenceHandle(
            endpoint=self.settings.local_llm_base,
            model_name=self.settings.local_llm_model,
            system_prompt=system_prompt,
            rag_collection=chunks_loader.collection_name(self.soul_name),
            adapter_name=f"{self.name}:{self.settings.local_llm_model}",
        )
        log.info(
            "cold_boot",
            soul=self.soul_name,
            adapter=handle.adapter_name,
            prompt_chars=len(system_prompt),
        )
        return handle

    def recall(self, query: str, k: int = 6) -> list[str]:
        """检索相关记忆原文，供 soul 层拼上下文。"""
        if self._collection is None:
            self._collection = chunks_loader.build_collection(
                self.soul_name, embedder=self._embedder
            )
        return chunks_loader.recall(self._collection, query, k=k, embedder=self._embedder)

    def add_memory(self, text: str, doc_id: str) -> None:
        """把一条新记忆增量写入向量库（episodic_writer 用），下次 recall 即可命中。"""
        if self._collection is None:
            self._collection = chunks_loader.build_collection(
                self.soul_name, embedder=self._embedder
            )
        chunks_loader.add_chunk(self._collection, doc_id, text, embedder=self._embedder)

    def derive_weights(self) -> str:
        raise NotImplementedError(
            "PromptBootAdapter 不派生权重（零微调躯壳）。LoRA 见 P4 TransformerLoRAAdapter。"
        )

    def evaluate_continuity(self) -> ContinuityReport:
        raise NotImplementedError("连续性评估在 P0-T06 金标 runner / P5 传承仪式实现。")

    def export_soul_delta(self) -> dict:
        raise NotImplementedError("SoulPackage 增量导出见 P5 迁移管线。")
