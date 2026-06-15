"""ASTR Bridge —— AstrBot 插件，把平台消息+社交事件桥接到 ASTR Core（露怀秋）。

链路：QQ ⇄ NapCat(OneBot v11) ⇄ AstrBot(本插件) ⇄ ASTR Core。
- 普通消息：POST /v1/respond → 拿 express 通道（text/face/reaction）→ 逐条发回 + stop_event()。
- 社交事件（入群邀请/被踢/禁言/好友变动/消息被贴表情）：读 raw_message → POST /v1/event → 按她的决策回应平台。
- 首次连接拉好友/群列表 → POST /v1/event(social_sync) 给她自我社交认知。

露怀秋的人格/记忆/情绪/社交决策全在 ASTR Core；本插件只做转发与平台动作执行。
ASTR Core 地址用环境变量 ASTR_CORE_URL 覆盖，默认 http://127.0.0.1:8300。
"""

from __future__ import annotations

import asyncio
import os

import httpx

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, MessageChain, filter
from astrbot.api.event.filter import CustomFilter, EventMessageType, PlatformAdapterType
from astrbot.api.message_components import At, Face, Plain
from astrbot.api.star import Context, Star

ASTR_CORE_URL = os.environ.get("ASTR_CORE_URL", "http://127.0.0.1:8300").rstrip("/")
RESPOND_ENDPOINT = f"{ASTR_CORE_URL}/v1/respond"
EVENT_ENDPOINT = f"{ASTR_CORE_URL}/v1/event"


def _typing_delay(text: str) -> float:
    """分条之间的"打字"停顿，按长度估算，0.4~2.0s。"""
    return min(2.0, max(0.4, len(text) / 9.0))


def _raw(event: AstrMessageEvent) -> dict:
    """原始 OneBot 事件载荷（request/notice 字段在此）。"""
    return getattr(event.message_obj, "raw_message", None) or {}


def _is_mentioned(event: AstrMessageEvent) -> bool:
    """是否 @ 了机器人自己（best-effort；ASTR 侧还会按名字兜底）。"""
    try:
        self_id = str(event.get_self_id())
        for comp in event.get_messages():
            if isinstance(comp, At) and str(getattr(comp, "qq", "")) == self_id:
                return True
    except Exception:  # noqa: BLE001
        pass
    return False


async def _post(url: str, payload: dict) -> dict | None:
    """POST 到 ASTR Core，失败重试一次。trust_env=False 避开代理干扰本机调用。"""
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[ASTR Bridge] POST {url} 失败(attempt {attempt})：{e!r}")
            await asyncio.sleep(0.5)
    return None


class OneBotMetaFilter(CustomFilter):
    """只匹配 post_type=request|notice 的 OneBot 元事件（非普通消息）。"""

    def filter(self, event: AstrMessageEvent, cfg) -> bool:  # noqa: ANN001
        return _raw(event).get("post_type") in ("request", "notice")


class Main(Star):
    """ASTR Core 消息+社交事件桥。"""

    def __init__(self, context: Context, config: dict | None = None) -> None:
        super().__init__(context)
        self._synced = False  # 是否已把好友/群列表同步给 ASTR

    async def _ask_astr(self, payload: dict) -> dict | None:
        return await _post(RESPOND_ENDPOINT, payload)

    async def _sync_social(self, bot) -> None:  # noqa: ANN001
        """拉好友/群列表 → 同步给她的自我社交认知。"""
        try:
            friends = await bot.call_action("get_friend_list")
            groups = await bot.call_action("get_group_list")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[ASTR Bridge] 拉好友/群列表失败：{e!r}")
            return
        f = [
            {"id": f"qq:{x.get('user_id')}", "name": x.get("nickname") or x.get("remark") or ""}
            for x in (friends or [])
        ]
        g = [
            {"id": f"group:{x.get('group_id')}", "name": x.get("group_name") or ""}
            for x in (groups or [])
        ]
        await _post(EVENT_ENDPOINT, {"kind": "social_sync", "friends": f, "groups": g})
        logger.info(f"[ASTR Bridge] 已同步社交认知：好友 {len(f)}、群 {len(g)}")

    @filter.platform_adapter_type(PlatformAdapterType.AIOCQHTTP)
    @filter.custom_filter(OneBotMetaFilter)
    @filter.event_message_type(EventMessageType.ALL, priority=10001)
    async def on_meta(self, event: AstrMessageEvent):
        """OneBot request/notice：入群邀请→她决策、被踢/禁言/好友变动/被贴表情→她感知。"""
        raw = _raw(event)
        post_type = raw.get("post_type")
        bot = getattr(event, "bot", None)
        self_id = str(event.get_self_id())
        try:
            if (
                post_type == "request"
                and raw.get("request_type") == "group"
                and raw.get("sub_type") == "invite"
            ):
                gid = str(raw.get("group_id") or "")
                res = await _post(
                    EVENT_ENDPOINT,
                    {
                        "kind": "group_invite",
                        "inviter_id": f"qq:{raw.get('user_id')}",
                        "group_id": gid,
                        "group_name": gid,
                    },
                )
                approve = bool(res and res.get("accept"))
                if bot:
                    await bot.call_action(
                        "set_group_add_request",
                        flag=raw.get("flag"),
                        sub_type="invite",
                        approve=approve,
                    )
                logger.info(f"[ASTR Bridge] 入群邀请 {gid} -> {'同意' if approve else '拒绝'}")
            elif post_type == "notice":
                await self._handle_notice(raw, self_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[ASTR Bridge] meta 处理失败：{e!r}")
        event.stop_event()

    async def _handle_notice(self, raw: dict, self_id: str) -> None:
        nt = raw.get("notice_type")
        gid = str(raw.get("group_id") or "")
        if nt == "group_decrease" and str(raw.get("user_id")) == self_id:
            await _post(EVENT_ENDPOINT, {"kind": "notice", "notice_type": "kicked", "where": gid})
        elif nt == "group_ban" and str(raw.get("user_id")) == self_id:
            sub = raw.get("sub_type")
            await _post(
                EVENT_ENDPOINT,
                {"kind": "notice", "notice_type": "muted" if sub == "ban" else "unmuted", "where": gid},
            )
        elif nt == "friend_add":
            await _post(
                EVENT_ENDPOINT,
                {"kind": "notice", "notice_type": "friend_added", "who": f"qq:{raw.get('user_id')}"},
            )
        elif nt in ("group_msg_emoji_like", "group_msg_emoji_like_notice"):
            # 别人给我消息贴了表情（NapCat 仅对 bot 自己消息的回应推送）
            likes = raw.get("likes") or []
            emoji = str(likes[0].get("emoji_id")) if likes else ""
            who_id = f"qq:{raw.get('user_id')}"
            await _post(
                EVENT_ENDPOINT,
                {"kind": "reaction", "emoji_id": emoji, "who_id": who_id, "who": who_id},
            )

    @filter.event_message_type(filter.EventMessageType.ALL, priority=10000)
    async def on_message(self, event: AstrMessageEvent):
        # 这是露怀秋专用 bot：所有消息都交给 ASTR，绝不让 AstrBot 自带 LLM 兜底。
        bot = getattr(event, "bot", None)
        if bot is not None and not self._synced:
            self._synced = True
            asyncio.create_task(self._sync_social(bot))  # 首次连接：拉好友/群列表（不阻塞回复）

        text = event.message_str.strip()
        express: list[dict] = []
        segments: list[str] = []

        if text:
            sender = event.get_sender_id()
            group_id = event.get_group_id() or None
            platform = event.get_platform_name() or "qq"
            user_id = f"qq:{sender}" if platform == "aiocqhttp" else f"{platform}:{sender}"
            data = await self._ask_astr({
                "text": text,
                "platform": "qq" if platform == "aiocqhttp" else platform,
                "user_id": user_id,
                "group_id": group_id,
                "mentioned": _is_mentioned(event),
            })
            if data and not data.get("timed_out"):
                express = data.get("express") or []
                segments = data.get("segments") or ([data["reply"]] if data.get("reply") else [])

        if express:
            await self._send_express(event, express)
        else:  # 向后兼容：没有 express 就发纯文本分条
            for i, seg in enumerate(segments):
                if not seg:
                    continue
                if i > 0:
                    await asyncio.sleep(_typing_delay(seg))
                await event.send(MessageChain([Plain(seg)]))

        event.stop_event()  # 永远阻断 AstrBot 默认 LLM 与后续 handler

    async def _send_express(self, event: AstrMessageEvent, express: list[dict]) -> None:
        """按表达通道发送：reaction 贴在来信上、text 逐条带打字停顿、face 作 QQ 表情。"""
        bot = getattr(event, "bot", None)
        msg_id = getattr(event.message_obj, "message_id", None)
        first_text = True
        for seg in express:
            kind = seg.get("kind")
            content = seg.get("content")
            if kind == "text":
                if not content:
                    continue
                if not first_text:
                    await asyncio.sleep(_typing_delay(content))
                first_text = False
                await event.send(MessageChain([Plain(content)]))
            elif kind == "face":
                try:
                    await event.send(MessageChain([Face(id=int(content))]))
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"[ASTR Bridge] 发 face 失败：{e!r}")
            elif kind == "reaction":
                if bot is not None and msg_id is not None and content:
                    try:
                        await bot.call_action(
                            "set_msg_emoji_like", message_id=msg_id, emoji_id=str(content)
                        )
                    except Exception as e:  # noqa: BLE001
                        logger.warning(f"[ASTR Bridge] 贴表情(set_msg_emoji_like)失败：{e!r}")
