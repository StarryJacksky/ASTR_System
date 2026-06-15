"""表达意图构造（P1-W6-b 灵魂侧）：把灵魂层的纯文本回复翻译成平台无关的 ExpressPayload。

灵魂层从此只产出"表达意图"（channels），不直接拼平台消息；具体怎么发由 PlatformAdapter 翻译。
本期通道：text（拟人化拆分成多条）+ 可选 face（QQ 自带表情，按情绪映射，克制）。
sticker/voice 留到 P5-W2 / W8。
"""

from __future__ import annotations

from astr.contracts.events import ExpressChannel, ExpressPayload
from astr.presentation.humanize import split_reply

# 情绪关键词 → QQ face id（OneBot 经典表情 id，字符串）。命中第一个即用，未命中不发 face（克制）。
EMOTION_FACE: list[tuple[tuple[str, ...], str]] = [
    (("傲娇", "嘴硬", "别扭", "tsundere"), "1"),  # 撇嘴
    (("高燃", "兴奋", "激动", "excited", "燃"), "76"),  # 赞
    (("升温", "亲近", "温", "warm", "暖"), "14"),  # 微笑
    (("塌陷", "低落", "难过", "委屈", "sad", "down"), "5"),  # 流泪
    (("调皮", "皮", "促狭", "playful"), "12"),  # 调皮
    (("烦", "恼", "怒", "irritat", "angry"), "11"),  # 发怒
    (("开心", "高兴", "愉快", "happy", "joy"), "4"),  # 得意
]


def emotion_to_face(emotion_tag: str | None) -> str | None:
    """情绪标签（自由文本）→ QQ face id；映射不到返回 None（平淡/抽离/未知都不发表情）。"""
    if not emotion_tag:
        return None
    tag = emotion_tag.lower()
    for keys, face_id in EMOTION_FACE:
        if any(k in tag for k in keys):
            return face_id
    return None


def build_express(
    reply_text: str,
    emotion_tag: str | None = None,
    *,
    platform_hint: str | None = "qq",
    with_face: bool = True,
    reaction_emoji: str | None = None,
) -> ExpressPayload:
    """把回复组装成表达意图：可选先给来信贴个表情(reaction)，再发多条 text，情绪命中末尾追加 face。"""
    channels: list[ExpressChannel] = []
    if reaction_emoji:  # 先在你那条消息上贴个表情（轻量反馈），桥负责填 to_msg_id
        channels.append(ExpressChannel(kind="reaction", content=reaction_emoji, fallback_text=""))
    for seg in split_reply(reply_text):
        if seg:
            channels.append(ExpressChannel(kind="text", content=seg))
    if with_face:
        face = emotion_to_face(emotion_tag)
        if face:
            channels.append(ExpressChannel(kind="face", content=face, fallback_text=""))
    return ExpressPayload(channels=channels, platform_hint=platform_hint)
