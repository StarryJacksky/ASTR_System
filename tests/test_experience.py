"""经验联想记忆单测（统一基座）：一份经验 → 图谱关系 + 行为学习两种查询。"""

from __future__ import annotations

from astr.contracts.settings import Settings
from astr.memory import experience


def test_extract_entities() -> None:
    ents = experience.extract_entities("聊聊量子物理和哲学", "qq:9")
    assert "person:qq:9" in ents
    assert any(e.startswith("topic:") for e in ents)


def test_relations_from_cooccurrence(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        experience, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    experience.record("justin", "t1", "聊聊量子场论", "qq:1", "嗯")
    experience.record("justin", "t2", "量子和哲学的关系", "qq:1", "有意思")
    rel = experience.relations("justin", "person:qq:1")
    assert rel and any(e.startswith("topic:") for e, _ in rel)  # 人↔话题 的边自动浮现


def test_behavior_recall_prefers_scored(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        experience, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    experience.record(
        "justin", "t1", "黑格尔辩证法怎么看", "qq:1", "辩证逻辑没错，错在本体论", score=0.9
    )
    experience.record("justin", "t2", "随便聊聊", "qq:1", "嗯")
    out = experience.behavior_recall("justin", "再聊聊黑格尔", "qq:1")
    assert out and "辩证" in out[0]  # 检索到相关且高分的过往应对
