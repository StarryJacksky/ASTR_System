"""金标 few-shot 锚定单测（治"不像人"）。"""

from __future__ import annotations

import random

from astr.contracts.settings import Settings
from astr.soul import fewshot


def _write_golden(tmp_path):
    d = tmp_path / "ops" / "golden_set"
    d.mkdir(parents=True, exist_ok=True)
    (d / "golden_v0.jsonl").write_text(
        "// 注释行，跳过\n"
        '{"id":"a","prompt":"你是ai吗","expect_style_notes":"我是你爸"}\n'
        '{"id":"b","prompt":"在吗","expect_style_notes":"难绷"}\n'
        '{"id":"c","prompt":"缺回复","expect_style_notes":""}\n',
        encoding="utf-8",
    )


def _patch(monkeypatch, tmp_path):
    monkeypatch.setattr(
        fewshot, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )


def test_load_examples_skips_comments_and_empty(tmp_path, monkeypatch) -> None:
    _write_golden(tmp_path)
    _patch(monkeypatch, tmp_path)
    ex = fewshot.load_examples()
    assert ("你是ai吗", "我是你爸") in ex
    assert len(ex) == 2  # 注释 + 缺回复 被跳过


def test_sample_turns_shape(tmp_path, monkeypatch) -> None:
    _write_golden(tmp_path)
    _patch(monkeypatch, tmp_path)
    turns = fewshot.sample_turns(2, rng=random.Random(0))
    assert len(turns) == 4  # 2 条 → user/assistant 各一
    assert turns[0]["role"] == "user" and turns[1]["role"] == "assistant"


def test_sample_turns_empty_when_no_file(tmp_path, monkeypatch) -> None:
    _patch(monkeypatch, tmp_path)
    assert fewshot.sample_turns() == []
