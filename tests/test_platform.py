"""平台适配器单测（P1-W6-c/d）：能力降级矩阵 + 能力探测。"""

from __future__ import annotations

from astr.contracts.events import ExpressChannel, ExpressPayload
from astr.contracts.settings import Settings
from astr.sensors.platform import caps as caps_mod
from astr.sensors.platform.base import BaseAdapter
from astr.sensors.platform.qq import QQAdapter


def _express(*channels: ExpressChannel) -> ExpressPayload:
    return ExpressPayload(channels=list(channels), platform_hint="qq")


def test_qq_passes_supported_channels() -> None:
    expr = _express(
        ExpressChannel(kind="text", content="你好"),
        ExpressChannel(kind="face", content="1"),
    )
    out = QQAdapter().render(expr)
    assert [s.kind for s in out] == ["text", "face"]


def test_unsupported_channel_degrades_to_fallback_text() -> None:
    # 一个只支持 text 的平台收到 face → 降级为 fallback_text 文本段
    adapter = BaseAdapter()  # caps={"text"}
    expr = _express(
        ExpressChannel(kind="text", content="嗯"),
        ExpressChannel(kind="face", content="1", fallback_text="(撇嘴)"),
    )
    out = adapter.render(expr)
    assert [s.kind for s in out] == ["text", "text"]
    assert out[1].content == "(撇嘴)"


def test_unsupported_without_fallback_is_dropped() -> None:
    adapter = BaseAdapter()
    expr = _express(ExpressChannel(kind="poke", target="x"))  # 无 fallback_text
    assert adapter.render(expr) == []


def test_never_raises_and_never_loses_text() -> None:
    expr = _express(
        ExpressChannel(kind="text", content="正文"),
        ExpressChannel(kind="voice", ref="tts://x", fallback_text="(语音)"),
    )
    out = BaseAdapter().render(expr)
    assert any(s.content == "正文" for s in out)


def test_probe_writes_caps_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        caps_mod, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    data = caps_mod.probe()
    assert "qq" in data["platforms"]
    assert caps_mod.caps_path().exists()
    assert "face" in caps_mod.load_caps("qq")
