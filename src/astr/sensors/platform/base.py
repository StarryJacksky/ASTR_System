"""PlatformAdapter 抽象（P1-W6-c / 05 §2）：把平台无关的 ExpressPayload 翻译成该平台能发的段。

铁律：缺失能力自动降级到 fallback_text（没有则用 content）转成 text 段，永不报错、永不丢消息。
render 是纯函数（不碰网络）——实际发送由平台桥（AstrBot 插件）按 RenderedSegment 调 OneBot 动作。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from astr.contracts.events import ExpressChannel, ExpressPayload


@dataclass
class RenderedSegment:
    """翻译后的一个平台段，交给桥按 kind 调具体平台动作。"""

    kind: str  # text / face / voice / image / at / reply / poke / reaction ...
    content: str | None = None  # text 主体 / face id / at 目标 ...
    ref: str | None = None  # voice/image 资源引用
    to_msg_id: str | None = None  # reply 锚定

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


def degrade_channel(ch: ExpressChannel, caps: set[str]) -> RenderedSegment | None:
    """单通道翻译：支持则原样过；不支持则降级为 fallback_text 文本段；都没有则丢弃（返回 None）。"""
    if ch.kind in caps:
        return RenderedSegment(kind=ch.kind, content=ch.content, ref=ch.ref, to_msg_id=ch.to_msg_id)
    fb = ch.fallback_text or (ch.content if ch.kind == "text" else "")
    if fb:
        return RenderedSegment(kind="text", content=fb)
    return None


@runtime_checkable
class PlatformAdapter(Protocol):
    name: str

    def capabilities(self) -> set[str]: ...

    def render(self, express: ExpressPayload) -> list[RenderedSegment]: ...


class BaseAdapter:
    """默认实现：按 capabilities() 逐通道降级。子类只需给出 name 与能力集。"""

    name: str = "base"
    caps: set[str] = {"text"}

    def capabilities(self) -> set[str]:
        return set(self.caps)

    def render(self, express: ExpressPayload) -> list[RenderedSegment]:
        caps = self.capabilities()
        out: list[RenderedSegment] = []
        for ch in express.channels:
            seg = degrade_channel(ch, caps)
            if seg is not None:
                out.append(seg)
        return out
