"""记忆 chunks → 向量库（Chroma）。RAG 检索给 soul 层用。

P0 嵌入策略（决策，见 diary）：契约定 bge-m3(CPU/ONNX)，但其权重~2.3GB+torch。
按「原始文本是真身、向量只是可重建缓存」原则，P0 先用零依赖确定性嵌入器把管道跑通；
bge-m3 接入位见 `default_embedder()`，换嵌入器需全库重嵌（契约已认可）。
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import chromadb
import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.memory")

Vector = list[float]


class Embedder(Protocol):
    def __call__(self, texts: Sequence[str]) -> list[Vector]: ...


class HashEmbedder:
    """确定性字符 n-gram 哈希嵌入（无外部依赖、可离线）。用于 P0 跑通 RAG 管道。

    用 1/2/3-gram 混合，保证短查询与长 chunk 在字符层面有重叠 → 余弦相似可用。
    """

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def _ngrams(self, text: str) -> list[str]:
        chars = list(text.strip())
        grams: list[str] = []
        for n in (1, 2, 3):
            if len(chars) < n:
                continue
            grams += ["".join(chars[i : i + n]) for i in range(len(chars) - n + 1)]
        return grams

    def embed_one(self, text: str) -> Vector:
        vec = [0.0] * self.dim
        for g in self._ngrams(text):
            h = int(hashlib.md5(g.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def __call__(self, texts: Sequence[str]) -> list[Vector]:
        return [self.embed_one(t) for t in texts]


def default_embedder() -> Embedder:
    """P0 默认确定性嵌入器。bge-m3 接入：在此返回 BgeM3Embedder()（需 uv add 嵌入库 + 下载权重）。"""
    return HashEmbedder()


def collection_name(soul_name: str) -> str:
    return f"{soul_name}_memory"


def _chroma_client(persist_dir: Path | None = None) -> chromadb.api.ClientAPI:
    path = persist_dir or (get_settings().runtime_cache_dir / "chroma")
    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(path))


def _stable_id(soul_name: str, source: str, idx: int) -> str:
    return f"{soul_name}:{source}:{idx}"


def build_collection(
    soul_name: str = "justin",
    *,
    embedder: Embedder | None = None,
    persist_dir: Path | None = None,
    chunks_dir: Path | None = None,
):
    """扫描 memory/chunks/*.md → 嵌入 → upsert 到 Chroma collection。空记忆库也正常返回。"""
    embedder = embedder or default_embedder()
    client = _chroma_client(persist_dir)
    col = client.get_or_create_collection(
        name=collection_name(soul_name),
        metadata={"hnsw:space": "cosine"},
    )

    settings = get_settings()
    cdir = chunks_dir or (settings.soul_package_dir / soul_name / "memory" / "chunks")
    if not cdir.is_dir():
        log.info("chunks_dir_missing", dir=str(cdir))
        return col

    ids: list[str] = []
    docs: list[str] = []
    # 递归：含 episodic 写入的 YYYY-MM/ 子目录
    for md in sorted(cdir.rglob("*.md")):
        text = md.read_text(encoding="utf-8").strip()
        if not text:
            continue
        ids.append(_stable_id(soul_name, md.stem, 0))
        docs.append(text)

    if docs:
        col.upsert(ids=ids, documents=docs, embeddings=embedder(docs))
        log.info("chunks_loaded", count=len(docs), collection=col.name)
    else:
        log.info("chunks_empty", collection=col.name)
    return col


def add_chunk(col, doc_id: str, text: str, *, embedder: Embedder | None = None) -> None:
    """增量写入一条记忆到向量库（episodic 写入用）。同 id 覆盖。"""
    embedder = embedder or default_embedder()
    col.upsert(ids=[doc_id], documents=[text], embeddings=embedder([text]))


def recall(col, query: str, k: int = 6, *, embedder: Embedder | None = None) -> list[str]:
    """语义检索 top-k chunk 原文。空库返回 []。"""
    embedder = embedder or default_embedder()
    if col.count() == 0:
        return []
    res = col.query(query_embeddings=embedder([query]), n_results=min(k, col.count()))
    docs = res.get("documents") or [[]]
    return docs[0]
