"""记忆系统 v1 单测（P1-W3）：增量入库召回 + 月份子目录递归 + episodic 写入。"""

from __future__ import annotations

import pathlib

from astr.contracts.router import RouteRequest, RouteResponse
from astr.contracts.settings import Settings
from astr.memory import chunks_loader, episodic_writer


def test_recall_after_incremental_add(tmp_path) -> None:
    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma", chunks_dir=tmp_path / "nope"
    )
    chunks_loader.add_chunk(col, "justin:episodic:t1", "用户下周要去出差三天，露怀秋记下了")
    hits = chunks_loader.recall(col, "我下周要干嘛", k=3)
    assert any("出差" in h for h in hits), f"未召回出差记忆：{hits}"


def test_build_collection_recurses_monthly(tmp_path) -> None:
    month = tmp_path / "chunks" / "2026-06"
    month.mkdir(parents=True)
    (month / "t1.md").write_text("摘要：用户下周出差\n用户：我下周要去出差三天", encoding="utf-8")
    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma2", chunks_dir=tmp_path / "chunks"
    )
    hits = chunks_loader.recall(col, "我下周干嘛", k=3)
    assert any("出差" in h for h in hits)


def test_parse_provenance() -> None:
    m = chunks_loader.parse_provenance(
        "<!-- ts=2026-06-17T00:00:00+00:00 visibility=group origin=qq:g123 -->\n摘要：x"
    )
    assert m["visibility"] == "group" and m["origin"] == "qq:g123"
    # 无注释 → 保守按 private
    assert chunks_loader.parse_provenance("摘要：无出处")["visibility"] == "private"


def test_recall_meta_roundtrips_provenance(tmp_path) -> None:
    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma", chunks_dir=tmp_path / "nope"
    )
    chunks_loader.add_chunk(
        col, "justin:episodic:t1", "用户私下说了点心事", metadata={"visibility": "private"}
    )
    pairs = chunks_loader.recall_meta(col, "心事", k=3)
    assert pairs and pairs[0][1].get("visibility") == "private"


def test_build_collection_recovers_provenance(tmp_path) -> None:
    month = tmp_path / "chunks" / "2026-06"
    month.mkdir(parents=True)
    (month / "t1.md").write_text(
        "<!-- ts=2026-06-17T00:00:00+00:00 visibility=private origin=qq:jacksky -->\n"
        "摘要：用户私下说的事\n用户：别跟别人说",
        encoding="utf-8",
    )
    col = chunks_loader.build_collection(
        "justin", persist_dir=tmp_path / "chroma2", chunks_dir=tmp_path / "chunks"
    )
    pairs = chunks_loader.recall_meta(col, "别跟别人说", k=3)
    assert pairs and pairs[0][1].get("visibility") == "private"


async def test_write_turn_persists_and_indexes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        episodic_writer, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )

    async def fake_route(req: RouteRequest) -> RouteResponse:
        return RouteResponse(
            content="用户说下周要出差三天",
            task=req.task,
            model_key="local-qwen3-8b",
            model="openai/qwen3-8b",
            tier_used="free",
            trace_id=req.trace_id,
        )

    added: list[tuple[str, str, dict]] = []

    class _FakeAdapter:
        def add_memory(self, text: str, doc_id: str, metadata: dict | None = None) -> None:
            added.append((doc_id, text, metadata or {}))

    path = await episodic_writer.write_turn(
        "justin",
        "我下周要去出差三天",
        "哦，去几天？",
        "trc_t",
        route_fn=fake_route,
        adapter=_FakeAdapter(),
        visibility="private",
        origin="qq:jacksky",
    )
    p = pathlib.Path(path)
    assert p.exists()
    body = p.read_text(encoding="utf-8")
    assert "出差" in body
    # 出处写进真身（chunk 首部注释）+ 透传到向量库 metadata
    assert "visibility=private" in body and "origin=qq:jacksky" in body
    assert added and added[0][0] == "justin:episodic:trc_t"
    assert added[0][2].get("visibility") == "private"
