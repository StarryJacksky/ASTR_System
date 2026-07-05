"""OmniParser-v2 真视觉感知件（P2-W6）：截屏 → UI 元素树（label + 坐标）。

管线（对齐微软 OmniParser 官方流程，OCR 件换轻量 RapidOCR）：
  ① icon_detect（YOLOv8 微调，AGPL——与本项目同 license）检测可交互元素框；
  ② RapidOCR（onnxruntime）出文本框——UI 元素大头是文本，这一步就给了大部分 label；
  ③ 框合并：图标框吸收框内 OCR 文本作 label；剩下无文字的图标框才批量过
     icon_caption（Florence-2-base 微调，MIT）生成语义描述——"万能兜底"的最后一环。

工程约束：
  - 重依赖（torch/ultralytics/transformers）在 `vision` extra，本模块只做懒加载——
    缺件/缺权重时 build_perceiver() 回落 StubPerceiver（给明确指引，不装死）。
  - 显存：CU 期间 llama 已被 vram_broker 卸载，8GB 全给视觉；Florence 用 fp16。
  - Florence 加载：transformers ≥4.55 原生 Florence2 类优先，旧式 trust_remote_code 兜底。
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import structlog

from astr.contracts.settings import get_settings
from astr.effector.cu_engine import Perceiver, StubPerceiver, UIElement

log = structlog.get_logger("astr.effector.omni")

CAPTION_PROMPT = "<CAPTION>"
CAPTION_BATCH = 32  # 8GB 卡上 fp16 base 模型的稳妥批量


def default_weights_dir() -> Path:
    return get_settings().embodiments_dir / "vision" / "omniparser_v2"


def weights_ready(weights_dir: Path | None = None) -> bool:
    d = weights_dir or default_weights_dir()
    return (d / "icon_detect" / "model.pt").exists() and (d / "icon_caption").is_dir()


def deps_ready() -> bool:
    try:
        import torch  # noqa: F401
        import ultralytics  # noqa: F401
        from rapidocr_onnxruntime import RapidOCR  # noqa: F401
    except ImportError:
        return False
    return True


def build_perceiver(weights_dir: Path | None = None) -> Perceiver:
    """感知件工厂：权重 + vision 依赖俱在 → OmniPerceiver；否则 Stub（带指引）。"""
    d = weights_dir or default_weights_dir()
    if not weights_ready(d):
        log.info("perceiver_stub", reason="weights_missing", dir=str(d))
        return StubPerceiver()
    if not deps_ready():
        log.info("perceiver_stub", reason="vision_extra_missing")
        return StubPerceiver()
    return OmniPerceiver(d)


# ---------- 纯逻辑（无重依赖，可单测）----------


def _contain_ratio(inner: tuple[float, float, float, float], outer: tuple) -> float:
    """inner 面积中落在 outer 内的比例（0~1）。"""
    ix1, iy1, ix2, iy2 = inner
    ox1, oy1, ox2, oy2 = outer
    w = min(ix2, ox2) - max(ix1, ox1)
    h = min(iy2, oy2) - max(iy1, oy1)
    if w <= 0 or h <= 0:
        return 0.0
    area = max(1e-6, (ix2 - ix1) * (iy2 - iy1))
    return (w * h) / area


def merge_boxes(
    icon_boxes: list[tuple[float, float, float, float]],
    ocr_items: list[tuple[tuple[float, float, float, float], str]],
    *,
    containment: float = 0.8,
) -> tuple[list[tuple[tuple, str]], list[int]]:
    """框合并：图标框吸收框内 OCR 文本；返回 (带标签元素列表, 仍需 caption 的图标框下标)。

    规则（简化自 OmniParser get_som_labeled_img）：
    - OCR 框大部分（≥containment）落在某图标框内 → 文本归该图标框，OCR 框本身不再独立成元素；
    - 没被吸收的 OCR 框独立成元素（label=文本）；
    - 吸收到文本的图标框用拼接文本作 label；一无所获的图标框留给 Florence caption。
    """
    absorbed: dict[int, list[str]] = {}
    leftover_ocr: list[tuple[tuple, str]] = []
    for obox, text in ocr_items:
        host = None
        for i, ibox in enumerate(icon_boxes):
            if _contain_ratio(obox, ibox) >= containment:
                host = i
                break
        if host is None:
            leftover_ocr.append((obox, text))
        else:
            absorbed.setdefault(host, []).append(text)

    elements: list[tuple[tuple, str]] = list(leftover_ocr)
    need_caption: list[int] = []
    for i, ibox in enumerate(icon_boxes):
        texts = absorbed.get(i)
        if texts:
            elements.append((ibox, " ".join(texts)))
        else:
            need_caption.append(i)
    return elements, need_caption


def to_ui_elements(labeled: list[tuple[tuple, str]]) -> list[UIElement]:
    """(xyxy, label) → UIElement（中心坐标 + 宽高），空标签丢弃。"""
    out: list[UIElement] = []
    for (x1, y1, x2, y2), label in labeled:
        label = (label or "").strip()
        if not label:
            continue
        out.append(
            UIElement(
                label=label[:80],
                x=int((x1 + x2) / 2),
                y=int((y1 + y2) / 2),
                w=int(x2 - x1),
                h=int(y2 - y1),
            )
        )
    return out


# ---------- 感知件本体（懒加载重依赖）----------


class OmniPerceiver:
    """OmniParser-v2：YOLO 检测 + RapidOCR 文本 + Florence-2 图标语义。"""

    def __init__(self, weights_dir: Path | None = None, *, device: str | None = None) -> None:
        self.weights_dir = weights_dir or default_weights_dir()
        self._device = device
        self._yolo: Any = None
        self._florence: Any = None
        self._processor: Any = None
        self._ocr: Any = None

    # -- 加载 --

    def _load(self) -> None:
        if self._yolo is not None:
            return
        # 强制离线：权重全在本地；transformers 缺文件时静默连 huggingface.co
        # 在被墙网络下会挂起几十分钟，离线模式让它秒级报错。
        import os

        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        import torch
        from rapidocr_onnxruntime import RapidOCR
        from ultralytics import YOLO

        self._device = self._device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._yolo = YOLO(str(self.weights_dir / "icon_detect" / "model.pt"))
        self._ocr = RapidOCR()
        self._load_florence(torch)
        log.info("omni_perceiver_loaded", device=self._device, dir=str(self.weights_dir))

    def _load_florence(self, torch: Any) -> None:
        """微调 Florence-2：原生类优先（无远程代码），旧式 trust_remote_code 兜底。

        icon_caption 权重目录只有 config+safetensors，processor/tokenizer 文件来自基座
        （下载脚本已放 processor_native / processor_remote，离线可用）。
        """
        # icon_caption_native：scripts/convert_florence2_native.py 的产物（原生命名，
        # 无 remote code）；官方原始目录 icon_caption 仅作兜底。
        native_dir = self.weights_dir / "icon_caption_native"
        cap_dir = str(native_dir if native_dir.exists() else self.weights_dir / "icon_caption")
        native_proc = self.weights_dir / "processor_native"
        remote_proc = self.weights_dir / "processor_remote"
        dtype = torch.float16 if self._device == "cuda" else torch.float32
        from transformers import AutoProcessor

        try:
            from transformers import Florence2ForConditionalGeneration

            self._florence = Florence2ForConditionalGeneration.from_pretrained(
                cap_dir, dtype=dtype
            ).to(self._device)
            self._processor = AutoProcessor.from_pretrained(
                str(native_proc) if native_proc.exists() else cap_dir
            )
            log.info("florence_loaded", path="native")
        except Exception as e:  # noqa: BLE001 —— 原生类不认旧 config 时走官方 remote code 路径
            log.warning("florence_native_load_failed_fallback_remote", error=str(e)[:200])
            from transformers import AutoModelForCausalLM

            src = str(remote_proc) if remote_proc.exists() else "microsoft/Florence-2-base-ft"
            self._florence = AutoModelForCausalLM.from_pretrained(
                cap_dir, torch_dtype=dtype, trust_remote_code=True
            ).to(self._device)
            self._processor = AutoProcessor.from_pretrained(src, trust_remote_code=True)
            log.info("florence_loaded", path="remote_code")

    # -- 感知 --

    def parse(self, png: bytes) -> list[UIElement]:
        self._load()
        from PIL import Image

        img = Image.open(io.BytesIO(png)).convert("RGB")

        # ① YOLO 图标/控件框（像素 xyxy）
        pred = self._yolo.predict(img, conf=0.05, iou=0.7, imgsz=1920, verbose=False)[0]
        icon_boxes = [tuple(map(float, b)) for b in pred.boxes.xyxy.tolist()]

        # ② OCR 文本框（RapidOCR 返回四点框 + 文本 + 置信度）
        import numpy as np

        ocr_raw, _ = self._ocr(np.asarray(img))
        ocr_items: list[tuple[tuple[float, float, float, float], str]] = []
        for quad, text, conf in ocr_raw or []:
            if float(conf) < 0.5 or not str(text).strip():
                continue
            xs = [p[0] for p in quad]
            ys = [p[1] for p in quad]
            ocr_items.append(((min(xs), min(ys), max(xs), max(ys)), str(text)))

        # ③ 合并 + ④ 无文字图标批量 caption
        labeled, need_caption = merge_boxes(icon_boxes, ocr_items)
        if need_caption:
            crops = [img.crop(tuple(int(v) for v in icon_boxes[i])) for i in need_caption]
            captions = self._caption(crops)
            labeled += [
                (icon_boxes[i], cap) for i, cap in zip(need_caption, captions, strict=False)
            ]

        elements = to_ui_elements(labeled)
        log.info(
            "omni_parse",
            icons=len(icon_boxes),
            ocr=len(ocr_items),
            captioned=len(need_caption),
            elements=len(elements),
        )
        return elements

    def _caption(self, crops: list[Any]) -> list[str]:
        import torch

        out: list[str] = []
        for i in range(0, len(crops), CAPTION_BATCH):
            batch = [c.resize((64, 64)) for c in crops[i : i + CAPTION_BATCH]]
            inputs = self._processor(
                images=batch, text=[CAPTION_PROMPT] * len(batch), return_tensors="pt"
            ).to(self._device)
            if self._device == "cuda":
                inputs = {
                    k: (v.half() if v.dtype == torch.float32 else v) for k, v in inputs.items()
                }
            with torch.inference_mode():
                ids = self._florence.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=20,
                    num_beams=1,
                    do_sample=False,
                )
            texts = self._processor.batch_decode(ids, skip_special_tokens=True)
            out += [t.strip() for t in texts]
        return out


__all__ = [
    "OmniPerceiver",
    "build_perceiver",
    "default_weights_dir",
    "deps_ready",
    "merge_boxes",
    "to_ui_elements",
    "weights_ready",
]
