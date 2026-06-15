"""QQ 适配器（P1-W6-c）：NapCat(OneBot v11) 能力集 + 表达意图翻译。

P1 基线只承诺 text + face + voice 三通道（05 §9）；其余能力（poke/image/forward 等）能力集里登记，
实际发送由桥在 P5-W2 补全。语音 ref 由 W8 TTS 产出，本期 build_express 暂不产 voice 通道。
"""

from __future__ import annotations

from astr.sensors.platform.base import BaseAdapter

# NapCat/OneBot v11 标准能力（05 §3）。P1 桥侧先实现 text/face；其余登记待 P5-W2 接发送。
QQ_CAPS: set[str] = {
    "text",
    "face",
    "voice",
    "at",
    "reply",
    "image",
    "poke",
    "reaction",
    "forward",
    "file",
}


class QQAdapter(BaseAdapter):
    name = "qq"

    def __init__(self, caps: set[str] | None = None) -> None:
        self.caps = set(caps) if caps is not None else set(QQ_CAPS)
