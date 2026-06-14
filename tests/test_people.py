"""群成员关系动力学单测（赶超 MaiBot：数值亲密度/好感 FSM）。"""

from __future__ import annotations

from astr.contracts.settings import Settings
from astr.memory import people


def _patch(monkeypatch, tmp_path):
    monkeypatch.setattr(
        people, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )


def test_familiarity_rises_with_interaction(tmp_path, monkeypatch) -> None:
    _patch(monkeypatch, tmp_path)
    f0 = people.load("justin", "qq:1")["familiarity"]
    for _ in range(5):
        people.touch("justin", "qq:1")
    prof = people.load("justin", "qq:1")
    assert prof["familiarity"] > f0  # 冷启动→渐熟
    assert prof["msg_count"] == 5


def test_apply_valence_and_relationship_factor(tmp_path, monkeypatch) -> None:
    _patch(monkeypatch, tmp_path)
    people.touch("justin", "qq:2")
    people.apply_valence("justin", "qq:2", -0.5)
    assert people.load("justin", "qq:2")["affinity"] == -0.5
    warm = people.relationship_factor({"familiarity": 0.6, "affinity": 0.5})
    cold = people.relationship_factor({"familiarity": 0.05, "affinity": -0.5})
    assert warm > cold  # 熟人高好感 > 设防生人


def test_profile_line_cold_then_warm() -> None:
    cold = people.profile_line({"display_name": "x", "familiarity": 0.05, "affinity": 0.0})
    warm = people.profile_line({"display_name": "x", "familiarity": 0.8, "affinity": 0.5})
    assert "冷启动" in cold
    assert "同频" in warm
