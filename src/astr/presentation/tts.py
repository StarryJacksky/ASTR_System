"""语音输出管线 v1（P1-W8）：订阅 presentation.tts → 合成 → 播放。

后端 edge（edge-tts，在线、零训练、大厂同款音质，几十种预设音色客户可选）为开发期默认；
sovits（GPT-SoVITS 本地克隆，需参考音）后续可选，.env 切 tts_backend。
情绪 emotion_tag → 语速/音高微调，让语气有差别。新回复到达时打断当前播放（sd.stop）。
依赖懒加载。隐私：只合成要说的话，不留音频。
"""

from __future__ import annotations

import asyncio

import httpx
import structlog

from astr.bus.core import Bus
from astr.contracts.events import Event, EventType
from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.presentation.tts")

TTS_GROUP = "cg.presentation"
_SILICONFLOW_TTS = "https://api.siliconflow.cn/v1/audio/speech"

# 情绪关键词 → CosyVoice 情感指令（放 <|endofprompt|> 前），让语气有起伏
_EMO_PROMPT: list[tuple[tuple[str, ...], str]] = [
    (("高燃", "兴奋", "激动", "excited"), "用兴奋的语气说"),
    (("塌陷", "低落", "难过", "sad"), "用低落的语气说"),
    (("傲娇", "tsundere"), "用傲娇又不耐烦的语气说"),
    (("升温", "亲近", "warm"), "用温柔的语气说"),
]
# 情绪 → edge-tts (语速,音高)
_EDGE_PROSODY: list[tuple[tuple[str, ...], str, str]] = [
    (("高燃", "兴奋", "激动", "excited"), "+12%", "+3Hz"),
    (("塌陷", "低落", "难过", "sad"), "-10%", "-3Hz"),
    (("傲娇", "tsundere"), "+6%", "+1Hz"),
]


def _emo_prompt(emotion_tag: str | None) -> str:
    if emotion_tag:
        tag = emotion_tag.lower()
        for keys, instr in _EMO_PROMPT:
            if any(k in tag for k in keys):
                return instr
    return ""


def _edge_prosody(emotion_tag: str | None) -> tuple[str, str]:
    if emotion_tag:
        tag = emotion_tag.lower()
        for keys, rate, pitch in _EDGE_PROSODY:
            if any(k in tag for k in keys):
                return rate, pitch
    return "+0%", "+0Hz"


class TtsPlayer:
    """语音合成 + 本地播放。默认 SiliconFlow CosyVoice（域内可达），可切 edge。"""

    def __init__(self) -> None:
        self.s = get_settings()

    async def synth(self, text: str, emotion_tag: str | None = None) -> bytes:
        if self.s.tts_backend == "edge":
            return await self._synth_edge(text, emotion_tag)
        return await self._synth_siliconflow(text, emotion_tag)

    async def _synth_siliconflow(self, text: str, emotion_tag: str | None) -> bytes:
        voice = self.s.tts_voice if ":" in self.s.tts_voice else f"{self.s.tts_model}:{self.s.tts_voice}"
        instr = _emo_prompt(emotion_tag)
        payload = {
            "model": self.s.tts_model,
            "input": f"{instr}<|endofprompt|>{text}" if instr else text,
            "voice": voice,
            "response_format": "mp3",
        }
        async with httpx.AsyncClient(timeout=30.0, trust_env=False) as c:
            r = await c.post(
                _SILICONFLOW_TTS,
                json=payload,
                headers={"Authorization": f"Bearer {self.s.siliconflow_api_key}"},
            )
            r.raise_for_status()
            return r.content

    async def _synth_edge(self, text: str, emotion_tag: str | None) -> bytes:
        import edge_tts

        rate, pitch = _edge_prosody(emotion_tag)
        comm = edge_tts.Communicate(text, voice="zh-CN-XiaoyiNeural", rate=rate, pitch=pitch)
        buf = b""
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                buf += chunk["data"]
        return buf

    def play(self, mp3: bytes) -> None:
        import miniaudio
        import numpy as np
        import sounddevice as sd

        dec = miniaudio.decode(mp3)
        samples = np.frombuffer(bytes(dec.samples), dtype=np.int16)
        if dec.nchannels > 1:
            samples = samples.reshape(-1, dec.nchannels)
        sd.stop()  # 打断上一句（新回复优先）
        sd.play(samples, dec.sample_rate, device=self.s.tts_output_device)

    async def speak(self, text: str, emotion_tag: str | None = None) -> None:
        if not text.strip():
            return
        mp3 = await self.synth(text, emotion_tag)
        if mp3:
            self.play(mp3)


async def run_player(bus: Bus, *, stop: asyncio.Event | None = None) -> None:
    """长驻：订阅 presentation.tts，逐条合成播放。"""
    player = TtsPlayer()

    async def handler(event: Event) -> None:
        text = event.payload.get("text", "")
        try:
            await player.speak(text, event.payload.get("emotion_tag"))
        except Exception:  # noqa: BLE001 —— 播放失败不拖垮订阅
            log.exception("tts_play_failed", trace_id=event.trace_id)

    log.info("tts_player_started", backend=get_settings().tts_backend)
    await bus.subscribe(TTS_GROUP, [EventType.PRESENTATION_TTS], handler, stop=stop)


def main() -> int:
    async def _run() -> None:
        await run_player(Bus.from_url())

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        print("\nTTS 停了。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
