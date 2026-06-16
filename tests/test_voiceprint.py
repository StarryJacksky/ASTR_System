"""声纹鉴权单测（P1-W9）：余弦/阈值匹配、三态 resolve_speaker、enroll→verify 往返。

不依赖真模型：monkeypatch embed/model_available；用 numpy 合成向量验证逻辑。
"""

from __future__ import annotations

import numpy as np

from astr.contracts.settings import Settings
from astr.sensors import voiceprint


def _settings(tmp_path, **kw) -> Settings:
    return Settings(
        voiceprint_template_dir=tmp_path / "vp",
        voiceprint_model=tmp_path / "spk.onnx",
        voiceprint_threshold=0.62,
        astr_owner_id="jacksky",
        **kw,
    )


def test_read_wave_roundtrip(tmp_path) -> None:
    import wave

    p = tmp_path / "t.wav"
    pcm = (np.sin(np.linspace(0, 6.28, 16000)) * 16000).astype("int16")
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())
    samples, sr = voiceprint.read_wave(str(p))
    assert sr == 16000
    assert samples.shape == (16000,)
    assert -1.0 <= float(samples.min()) and float(samples.max()) <= 1.0


def test_cosine_identity_and_orthogonal() -> None:
    a = np.array([1.0, 0.0, 0.0], dtype="float32")
    b = np.array([0.0, 1.0, 0.0], dtype="float32")
    assert voiceprint._cosine(a, a) == 1.0
    assert abs(voiceprint._cosine(a, b)) < 1e-6


def test_verify_matches_above_threshold(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    owner_vec = np.array([0.6, 0.8, 0.0], dtype="float32")
    s.voiceprint_template_dir.mkdir(parents=True)
    np.save(s.voiceprint_template_dir / "jacksky.npy", owner_vec)

    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: True)
    monkeypatch.setattr(voiceprint, "embed", lambda samp, sr, s=None: owner_vec)

    matched, score = voiceprint.verify(np.zeros(8000, dtype="float32"), 16000, s=s)
    assert matched and score > 0.99


def test_verify_rejects_different_speaker(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    s.voiceprint_template_dir.mkdir(parents=True)
    np.save(s.voiceprint_template_dir / "jacksky.npy", np.array([1.0, 0.0, 0.0], dtype="float32"))

    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: True)
    other = np.array([0.0, 1.0, 0.0], dtype="float32")
    monkeypatch.setattr(voiceprint, "embed", lambda samp, sr, s=None: other)

    matched, score = voiceprint.verify(np.zeros(8000, dtype="float32"), 16000, s=s)
    assert not matched and score < 0.62


def test_resolve_speaker_not_enrolled_allows_owner(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path, voice_require_voiceprint=False)
    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: False)
    uid, verified_by, score = voiceprint.resolve_speaker(
        np.zeros(8000, dtype="float32"), 16000, s=s
    )
    assert uid == "jacksky" and verified_by == []  # 开发便利：未注册放行主人


def test_resolve_speaker_required_mode_denies_unenrolled(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path, voice_require_voiceprint=True)
    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: False)
    uid, verified_by, _ = voiceprint.resolve_speaker(np.zeros(8000, dtype="float32"), 16000, s=s)
    assert uid == "voice:guest" and verified_by == []  # 强制模式：未注册一律访客


def test_resolve_speaker_guest_on_mismatch(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    s.voiceprint_template_dir.mkdir(parents=True)
    np.save(s.voiceprint_template_dir / "jacksky.npy", np.array([1.0, 0.0, 0.0], dtype="float32"))
    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: True)
    monkeypatch.setattr(
        voiceprint, "embed", lambda samp, sr, s=None: np.array([0.0, 1.0, 0.0], "float32")
    )
    uid, verified_by, _ = voiceprint.resolve_speaker(np.zeros(8000, dtype="float32"), 16000, s=s)
    assert uid == "voice:guest" and verified_by == []


def test_enroll_mic_saves_template(tmp_path, monkeypatch) -> None:
    import builtins

    s = _settings(tmp_path)
    vec = np.array([0.2, 0.5, 0.84], dtype="float32")
    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: True)
    monkeypatch.setattr(voiceprint, "embed", lambda samp, sr, s=None: vec)
    monkeypatch.setattr(
        voiceprint, "record_clip", lambda seconds, sr=16000: np.zeros(64, "float32")
    )
    monkeypatch.setattr(builtins, "input", lambda *_a: "")  # 跳过交互提示
    rc = voiceprint.enroll_mic("jacksky", n=3, seconds=1.0, s=s)
    assert rc == 0
    assert voiceprint.is_enrolled("jacksky", s=s)


def test_enroll_then_verify_roundtrip(tmp_path, monkeypatch) -> None:
    s = _settings(tmp_path)
    vec = np.array([0.3, 0.4, 0.5], dtype="float32")
    monkeypatch.setattr(voiceprint, "model_available", lambda s=None: True)
    monkeypatch.setattr(voiceprint, "embed", lambda samp, sr, s=None: vec)
    monkeypatch.setattr(voiceprint, "read_wave", lambda p: (np.zeros(8000, "float32"), 16000))
    # 让 enroll 用我们的临时 settings（它内部 get_settings 兜底；这里显式传 s）
    rc = voiceprint.enroll("jacksky", ["a.wav", "b.wav"], s=s)
    assert rc == 0
    assert voiceprint.is_enrolled("jacksky", s=s)
    matched, score = voiceprint.verify(np.zeros(8000, "float32"), 16000, s=s)
    assert matched and score > 0.99
