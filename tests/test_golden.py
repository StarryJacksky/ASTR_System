"""金标集 runner 单测：报告生成 + HTML 对照页（不触真模型/真目录）。"""

from __future__ import annotations

import json

from astr.ops import golden_runner


async def test_generate_report_shape(tmp_path) -> None:
    golden = tmp_path / "golden.jsonl"
    golden.write_text(
        json.dumps(
            {
                "id": "g1",
                "prompt": "在吗",
                "scenario_tag": "日常闲聊",
                "expect_style_notes": "冷淡但在",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    items = golden_runner.load_golden(golden)

    async def responder(_p: str) -> str:
        return "……在。干嘛。"

    rows = await golden_runner.generate_report(items, responder, "test")
    assert rows[0]["response"] == "……在。干嘛。"
    assert rows[0]["human_score"] is None
    assert rows[0]["judge_model"] is None  # 字段已留好，P4 再填
    assert rows[0]["scenario_tag"] == "日常闲聊"


def test_load_golden_skips_empty_prompt(tmp_path) -> None:
    golden = tmp_path / "golden.jsonl"
    golden.write_text(
        "\n".join(
            [
                '// 注释行应跳过',
                '{"id": "v1", "prompt": "在吗", "scenario_tag": "语音场景"}',
                '{"id": "m1", "prompt": "", "scenario_tag": "记忆场景"}',  # 占位，应跳过
                '{"id": "m2", "prompt": "   ", "scenario_tag": "记忆场景"}',  # 仅空白，应跳过
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    items = golden_runner.load_golden(golden)
    assert [r["id"] for r in items] == ["v1"]


def test_to_html_self_contained(tmp_path) -> None:
    report = tmp_path / "golden_report.jsonl"
    report.write_text(
        json.dumps(
            {
                "id": "g1",
                "scenario_tag": "日常闲聊",
                "prompt": "在吗",
                "expect_style_notes": "冷淡但在",
                "response": "……在。",
                "human_score": None,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    html = golden_runner.to_html(report)
    assert html.exists()
    content = html.read_text(encoding="utf-8")
    assert "金标集人评" in content
    assert "在吗" in content
    assert "导出回填 JSONL" in content
