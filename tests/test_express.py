"""表达意图构造单测（P1-W6-b）：情绪→QQ face 映射 + channels 组装。"""

from __future__ import annotations

from astr.presentation.express import build_express, emotion_to_face


def test_emotion_to_face_keyword_match() -> None:
    assert emotion_to_face("傲娇") == "1"
    assert emotion_to_face("高燃/兴奋") == "76"
    assert emotion_to_face("tsundere, smug") == "1"


def test_emotion_to_face_unknown_is_none() -> None:
    assert emotion_to_face(None) is None
    assert emotion_to_face("平淡") is None
    assert emotion_to_face("抽离/解离") is None


def test_build_express_text_only_when_no_emotion() -> None:
    expr = build_express("就这样吧。", None)
    assert [c.kind for c in expr.channels] == ["text"]
    assert expr.platform_hint == "qq"


def test_build_express_appends_face_on_emotion() -> None:
    expr = build_express("行吧行吧，知道了。", "傲娇")
    kinds = [c.kind for c in expr.channels]
    assert kinds[-1] == "face"
    assert expr.channels[-1].content == "1"


def test_build_express_prepends_reaction() -> None:
    expr = build_express("嗯。", None, reaction_emoji="76")
    assert expr.channels[0].kind == "reaction"
    assert expr.channels[0].content == "76"
