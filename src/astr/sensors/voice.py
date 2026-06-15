"""语音输入管线 v1（P1-W7）：常驻采音 → VAD 切段 → SenseVoice 转写 → 命中唤醒词则 ingest。

链路：sounddevice(16k) → sherpa-onnx Silero VAD 切语音段 → SenseVoice-Small(ONNX,CPU) 转写
→ 若转写命中唤醒词"秋秋"，把唤醒词之后的内容 POST 到 ASTR Core /v1/ingest。

隐私铁律：只在 VAD 判定的语音段内转写；不落盘任何音频。
中文唤醒：本期靠"转写后字符串匹配"实现（中文开箱即用）；openWakeWord 自训模型(stage2)用主人录音再上。
依赖与模型懒加载——缺失时给出清晰指引，不在 import 期炸。
"""

from __future__ import annotations

import re
import sys

import httpx
import structlog

from astr.contracts.settings import get_settings

log = structlog.get_logger("astr.sensors.voice")

_NON_HAN = re.compile(r"[^\u4e00-\u9fff]")


def _strip_wake(text: str, wake_words: list[str]) -> tuple[bool, str]:
    """转写命中唤醒词？命中则返回 (True, 唤醒词之后的命令文本)。"""
    flat = _NON_HAN.sub("", text)  # 只看汉字，规避标点/空格干扰
    for w in wake_words:
        idx = flat.find(w)
        if idx >= 0:
            # 在原文里定位唤醒词尾，取其后的内容作为命令
            pos = text.find(w)
            cmd = text[pos + len(w) :] if pos >= 0 else flat[idx + len(w) :]
            return True, cmd.strip(" ，,。.、:：")
    return False, ""


class VoiceListener:
    """常驻麦克风监听器。run() 阻塞直到 Ctrl+C。"""

    def __init__(self) -> None:
        self.s = get_settings()
        self.wake_words = [w.strip() for w in self.s.voice_wake_words.split(",") if w.strip()]
        self.sr = self.s.voice_sample_rate
        self._recognizer = None
        self._vad = None

    def _check_models(self) -> bool:
        model = self.s.voice_asr_model_dir / "model.int8.onnx"
        tokens = self.s.voice_asr_model_dir / "tokens.txt"
        vad = self.s.voice_vad_model
        missing = [str(p) for p in (model, tokens, vad) if not p.exists()]
        if missing:
            print("缺少语音模型文件：", file=sys.stderr)
            for m in missing:
                print(f"  - {m}", file=sys.stderr)
            print(
                "\n下载 SenseVoice + silero_vad（任选其一）：\n"
                "  1) uv run python -m astr.sensors.voice --download\n"
                "  2) 手动放置：SenseVoice 的 model.int8.onnx 与 tokens.txt 放进\n"
                f"     {self.s.voice_asr_model_dir}\\，silero_vad.onnx 放到\n"
                f"     {self.s.voice_vad_model}",
                file=sys.stderr,
            )
            return False
        return True

    def _build(self) -> None:
        import sherpa_onnx  # 懒加载

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(self.s.voice_asr_model_dir / "model.int8.onnx"),
            tokens=str(self.s.voice_asr_model_dir / "tokens.txt"),
            use_itn=True,
            num_threads=2,
        )
        cfg = sherpa_onnx.VadModelConfig()
        cfg.silero_vad.model = str(self.s.voice_vad_model)
        cfg.silero_vad.threshold = 0.5
        cfg.silero_vad.min_silence_duration = 0.25
        cfg.silero_vad.min_speech_duration = 0.25
        cfg.silero_vad.max_speech_duration = 8.0  # 8s 窗口（卡规格）
        cfg.sample_rate = self.sr
        self._vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=30)

    def _transcribe(self, samples) -> str:
        stream = self._recognizer.create_stream()
        stream.accept_waveform(self.sr, samples)
        self._recognizer.decode_stream(stream)
        return (stream.result.text or "").strip()

    def _ingest(self, text: str) -> None:
        try:
            with httpx.Client(timeout=10.0, trust_env=False) as c:
                c.post(
                    self.s.core_ingest_url,
                    json={"text": text, "platform": "voice", "user_id": self.s.astr_owner_id},
                )
        except Exception as e:  # noqa: BLE001
            log.warning("voice_ingest_failed", error=repr(e))

    def run(self) -> int:
        if not self._check_models():
            return 2
        import sounddevice as sd

        self._build()
        block = int(0.1 * self.sr)  # 100ms 一读
        print(f"在听了（唤醒词：{'/'.join(self.wake_words)}）。Ctrl+C 退出。")
        try:
            with sd.InputStream(
                channels=1, dtype="float32", samplerate=self.sr, device=self.s.voice_input_device
            ) as stream:
                while True:
                    chunk, _ = stream.read(block)
                    self._vad.accept_waveform(chunk.reshape(-1))
                    while not self._vad.empty():
                        seg = self._vad.front.samples
                        self._vad.pop()
                        text = self._transcribe(seg)
                        if not text:
                            continue
                        hit, cmd = _strip_wake(text, self.wake_words)
                        log.info("voice_segment", text=text, wake=hit)
                        if hit and cmd:
                            print(f"[唤醒] {cmd}")
                            self._ingest(cmd)
                        elif hit:
                            print("[唤醒] （只听到名字，说完整点）")
        except KeyboardInterrupt:
            print("\n停了。")
        return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if "--download" in args:
        from astr.sensors.voice_models import download_models

        return download_models()
    return VoiceListener().run()


if __name__ == "__main__":
    raise SystemExit(main())
