"""声纹鉴权（P1-W9）：注册主人声纹，语音入口只有匹配本人才升 L2。

堵的洞：voice.py 此前无条件用 owner_id ingest → 任何人对麦说话都拿到 L2 主人权限。
现在：转写命中唤醒词后，对该语音段算说话人嵌入，与注册模板比余弦相似度；
  · 匹配 → owner_id（L2）
  · 不匹配 → "voice:guest"（L0，resolve_level 自然降级）
  · 未注册 → 默认放行 owner 但告警（开发便利）；voice_require_voiceprint=True 则拒绝

嵌入用 sherpa-onnx SpeakerEmbeddingExtractor（CAM++ zh，CPU，复用既有依赖，零新增包）。
模板是访问控制资产（主人的生物特征），存 ops/voiceprint/，不进灵魂包。
`embed()` 设计成可被测试 monkeypatch，无需真模型即可测匹配/阈值逻辑。
"""

from __future__ import annotations

import structlog

from astr.contracts.settings import Settings, get_settings

log = structlog.get_logger("astr.voiceprint")

_extractor = None  # 懒加载缓存


def _get_extractor(s: Settings):
    global _extractor
    if _extractor is None:
        import sherpa_onnx

        cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(s.voiceprint_model), num_threads=2
        )
        _extractor = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
    return _extractor


def model_available(s: Settings | None = None) -> bool:
    s = s or get_settings()
    return s.voiceprint_model.exists() and s.voiceprint_model.stat().st_size > 0


def embed(samples, sr: int, s: Settings | None = None):
    """语音段 → 说话人嵌入向量（numpy 1-D，L2 归一化）。"""
    import numpy as np

    s = s or get_settings()
    ex = _get_extractor(s)
    stream = ex.create_stream()
    stream.accept_waveform(sample_rate=sr, waveform=samples)
    stream.input_finished()
    vec = np.asarray(ex.compute(stream), dtype="float32")
    n = float(np.linalg.norm(vec)) or 1.0
    return vec / n


def read_wave(path: str):
    """读 wav → (float32 单声道 [-1,1], 采样率)。用 stdlib wave，避免依赖 sherpa 的 read_wave（此版本无）。"""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 1:  # 8-bit 无符号
        data = (np.frombuffer(raw, dtype=np.uint8).astype("float32") - 128.0) / 128.0
    elif width == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype("float32") / 32768.0
    elif width == 4:
        data = np.frombuffer(raw, dtype=np.int32).astype("float32") / 2147483648.0
    else:
        raise ValueError(f"不支持的采样位宽: {width * 8}bit")
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return data, sr


def _cosine(a, b) -> float:
    import numpy as np

    a = np.asarray(a, dtype="float32")
    b = np.asarray(b, dtype="float32")
    na = float(np.linalg.norm(a)) or 1.0
    nb = float(np.linalg.norm(b)) or 1.0
    return float(np.dot(a, b) / (na * nb))


def template_path(name: str, s: Settings | None = None):
    s = s or get_settings()
    return s.voiceprint_template_dir / f"{name}.npy"


def is_enrolled(name: str | None = None, s: Settings | None = None) -> bool:
    s = s or get_settings()
    return template_path(name or s.astr_owner_id, s).exists()


def load_template(name: str | None = None, s: Settings | None = None):
    import numpy as np

    s = s or get_settings()
    p = template_path(name or s.astr_owner_id, s)
    return np.load(p) if p.exists() else None


def _save_template(name: str, vecs: list, s: Settings, source: str) -> int:
    """把若干嵌入平均、归一化、落盘为注册模板。"""
    import numpy as np

    if not vecs:
        print("没有可用录音。每段建议 3–5 秒、安静环境、自然说话。")
        return 1
    template = np.mean(np.stack(vecs), axis=0)
    template = template / (float(np.linalg.norm(template)) or 1.0)
    out = template_path(name, s)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.save(out, template)
    print(f"已注册声纹「{name}」（{len(vecs)} 段，{source}）→ {out}")
    print(f"语音入口已自动启用声纹校验（阈值 {s.voiceprint_threshold}）。")
    return 0


def enroll(name: str, wav_paths: list[str], s: Settings | None = None) -> int:
    """从若干 wav 录音算平均嵌入，存为注册模板。返回 0/非0。"""
    s = s or get_settings()
    if not model_available(s):
        print("声纹模型缺失，先跑：astr voiceprint download")
        return 2
    vecs = []
    for p in wav_paths:
        try:
            samples, sr = read_wave(p)
        except Exception as e:  # noqa: BLE001
            print(f"读取失败 {p}: {e!r}")
            continue
        vecs.append(embed(samples, sr, s))
    return _save_template(name, vecs, s, "文件")


def record_clip(seconds: float, sr: int = 16000):
    """从默认麦克风录一段，返回 float32 单声道。"""
    import sounddevice as sd

    rec = sd.rec(int(seconds * sr), samplerate=sr, channels=1, dtype="float32")
    sd.wait()
    return rec.reshape(-1)


def enroll_mic(name: str, n: int = 5, seconds: float = 4.0, s: Settings | None = None) -> int:
    """对麦克风录 n 段、当场注册。最省事的注册方式：运行后照提示说话即可。"""
    s = s or get_settings()
    if not model_available(s):
        print("声纹模型缺失，先跑：astr voiceprint download")
        return 2
    print(f"准备注册声纹「{name}」：共 {n} 段、每段约 {seconds:.0f} 秒。安静环境、自然说话。")
    vecs = []
    for i in range(n):
        try:
            input(f"  第 {i + 1}/{n} 段：按回车后开始说话…")
        except EOFError:
            pass
        samples = record_clip(seconds)
        vecs.append(embed(samples, 16000, s))
        print(f"  ✓ 已收录第 {i + 1} 段")
    return _save_template(name, vecs, s, "麦克风")


def verify(
    samples, sr: int, name: str | None = None, s: Settings | None = None
) -> tuple[bool, float]:
    """该语音段是否本人。返回 (是否匹配, 相似度)。无模板/无模型 → (False, -1.0)。"""
    s = s or get_settings()
    tmpl = load_template(name or s.astr_owner_id, s)
    if tmpl is None or not model_available(s):
        return False, -1.0
    try:
        v = embed(samples, sr, s)
    except Exception as e:  # noqa: BLE001
        log.warning("voiceprint_embed_failed", error=repr(e))
        return False, -1.0
    score = _cosine(v, tmpl)
    return score >= s.voiceprint_threshold, score


def resolve_speaker(samples, sr: int, s: Settings | None = None) -> tuple[str, list[str], float]:
    """语音段 → (ingest 用的 user_id, verified_by, 相似度)。封装"未注册放行/匹配/降级"三态。"""
    s = s or get_settings()
    owner = s.astr_owner_id
    if not is_enrolled(owner, s) or not model_available(s):
        if s.voice_require_voiceprint:
            return "voice:guest", [], -1.0  # 强制模式：未注册一律访客
        log.warning(
            "voiceprint_not_enrolled", note="语音默认按主人处理，建议 astr voiceprint enroll"
        )
        return owner, [], -1.0
    matched, score = verify(samples, sr, owner, s)
    if matched:
        return owner, ["voiceprint"], score
    return "voice:guest", [], score
