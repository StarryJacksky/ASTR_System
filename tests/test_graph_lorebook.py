"""图记忆 + 世界书单测（P1-W3 收尾）。"""

from __future__ import annotations

from xml.etree import ElementTree as ET

from astr.contracts.settings import Settings
from astr.memory import experience, graph, lorebook, semantic


def _settings(tmp_path) -> Settings:
    return Settings(_env_file=None, astr_data_dir=tmp_path)


def test_build_graphml_from_experience(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    for mod in (experience, graph):
        monkeypatch.setattr(mod, "get_settings", lambda s=s: s)
    # 两轮：person:qq:1 与 topic:哲学 共现两次 → 边权 2
    experience.record("justin", "t1", "聊聊黑格尔的哲学", "qq:1", "嗯")
    experience.record("justin", "t2", "再说说哲学", "qq:1", "好")
    path = graph.build_graphml("justin")
    assert path.exists()
    tree = ET.parse(path)
    ns = "{http://graphml.graphdrawing.org/xmlns}"
    nodes = {n.get("id") for n in tree.iter(f"{ns}node")}
    assert "person:qq:1" in nodes
    edges = tree.findall(f".//{ns}edge")
    assert edges  # 至少一条共现边


def test_graphml_escapes_special_ids(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    for mod in (experience, graph):
        monkeypatch.setattr(mod, "get_settings", lambda s=s: s)
    experience.record("justin", "t1", "x", "qq:a&b<c", "y")  # id 含 XML 特殊字符
    path = graph.build_graphml("justin")
    ET.parse(path)  # 不抛 = 转义正确


def test_lorebook_sync_from_semantic(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    for mod in (semantic, lorebook):
        monkeypatch.setattr(mod, "get_settings", lambda s=s: s)
    # 写一条已确认事实
    kp = semantic.kv_path("justin")
    kp.parent.mkdir(parents=True, exist_ok=True)
    kp.write_text('{"fact": "主人最近在迁移工作环境"}\n', encoding="utf-8")
    n = lorebook.sync_from_semantic("justin")
    assert n == 1
    book = lorebook.load("justin")
    entries = list(book["entries"].values())
    assert entries and "迁移工作环境" in entries[0]["content"]
    assert entries[0]["key"]  # 抽出了触发关键词
