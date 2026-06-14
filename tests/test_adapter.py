"""PromptBootAdapter + chunks_loader 端到端：system prompt 渲染 + RAG recall 命中。"""

from __future__ import annotations

from astr.adapters.prompt_boot import PromptBootAdapter
from astr.memory import chunks_loader


def test_system_prompt_renders_identity() -> None:
    """system prompt 必须含她的名字、宪法规则 id 与自传内容——这是她"是她"的注入。"""
    sp = PromptBootAdapter("justin").render_system_prompt()
    assert "露怀秋" in sp
    assert "秋秋" in sp
    assert "truth-over-narrative" in sp  # 宪法第一条 id
    assert "炉" in sp  # 自传里炉中火的意象


def test_recall_hits_relevant_chunk(tmp_path) -> None:
    chunks = tmp_path / "chunks"
    chunks.mkdir()
    (chunks / "a.md").write_text("秋秋最喜欢喝黑咖啡，从不加糖", encoding="utf-8")
    (chunks / "b.md").write_text("今天北京下雪了，外面很冷", encoding="utf-8")
    (chunks / "c.md").write_text("规范场论在理论物理里非常优雅", encoding="utf-8")

    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma", chunks_dir=chunks
    )
    hits = chunks_loader.recall(col, "咖啡", k=2)
    assert hits, "应检索到结果"
    assert any("咖啡" in h for h in hits), f"咖啡查询未命中相关 chunk：{hits}"


def test_empty_memory_is_ok(tmp_path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma2", chunks_dir=empty
    )
    assert chunks_loader.recall(col, "任何问题") == []
