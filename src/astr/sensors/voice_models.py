"""下载 P1-W7 语音模型：SenseVoice-Small(ONNX) + silero_vad.onnx。

外网到 github 偶有 SSL 问题，curl 带 --ssl-no-revoke；失败则提示手动放置。
SenseVoice 解压后取 model.int8.onnx + tokens.txt；silero_vad.onnx 直接放置。
"""

from __future__ import annotations

import subprocess
import sys
import tarfile
from pathlib import Path

from astr.contracts.settings import get_settings

_SENSE_VOICE_TAR = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
)
_SILERO_VAD = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
)
# 说话人嵌入模型（CAM++ zh，CPU，~28MB）——P1-W9 声纹鉴权
_SPEAKER_MODEL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
    "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"
)


def _curl(url: str, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    print(f"下载 {url}\n  -> {dst}")
    rc = subprocess.call(
        ["curl.exe", "-L", "--ssl-no-revoke", "--fail", "-o", str(dst), url]
    )
    return rc == 0 and dst.exists() and dst.stat().st_size > 0


def download_speaker_model() -> int:
    """下载声纹（说话人嵌入）模型到 settings.voiceprint_model。"""
    dst = get_settings().voiceprint_model
    if dst.exists() and dst.stat().st_size > 0:
        print(f"声纹模型已就位：{dst}")
        return 0
    if _curl(_SPEAKER_MODEL, dst):
        print(f"声纹模型就位：{dst}\n下一步：astr voiceprint enroll <你的录音.wav> ...")
        return 0
    print(
        "声纹模型下载失败（网络/SSL）。手动放置后重试：\n"
        f"  {_SPEAKER_MODEL}\n  -> {dst}",
        file=sys.stderr,
    )
    return 1


def download_models() -> int:
    s = get_settings()
    asr_dir = s.voice_asr_model_dir
    asr_dir.mkdir(parents=True, exist_ok=True)
    tmp = asr_dir.parent / "_sense_voice.tar.bz2"

    ok = True
    if not (asr_dir / "model.int8.onnx").exists():
        if _curl(_SENSE_VOICE_TAR, tmp):
            print("解压 SenseVoice ...")
            with tarfile.open(tmp, "r:bz2") as tf:
                tf.extractall(asr_dir.parent)
            src = asr_dir.parent / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
            for name in ("model.int8.onnx", "tokens.txt"):
                if (src / name).exists():
                    (src / name).replace(asr_dir / name)
            tmp.unlink(missing_ok=True)
            # 清理解压残留（fp32 model.onnx ~900MB 等用不上）
            import shutil

            shutil.rmtree(src, ignore_errors=True)
        else:
            ok = False
            print("SenseVoice 下载失败（网络/SSL）。", file=sys.stderr)

    if not s.voice_vad_model.exists():
        if not _curl(_SILERO_VAD, s.voice_vad_model):
            ok = False
            print("silero_vad 下载失败（网络/SSL）。", file=sys.stderr)

    if ok:
        print("语音模型就位。可 uv run astr voice 启动监听。")
        return 0
    print(
        "\n手动放置（任一镜像下载后）：\n"
        f"  {asr_dir}\\model.int8.onnx, {asr_dir}\\tokens.txt\n"
        f"  {s.voice_vad_model}",
        file=sys.stderr,
    )
    return 1
