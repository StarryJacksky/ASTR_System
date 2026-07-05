"""视觉感知件真机冒烟（P2-W6 验收辅助）：真实截屏 → OmniPerceiver → 元素清单。

看三件事：①元素数量/标签质量（够不够规划器用）②耗时（首帧含加载，次帧才是真水平）
③显存占用。跑法：uv run --no-sync python scripts/vision_smoke.py
注意：会加载 YOLO+Florence 到显存——llama-server 在跑的话先停（vram 8GB 分时）。
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from astr.effector.omni_perceiver import build_perceiver, default_weights_dir  # noqa: E402
from astr.effector.platform_backend import WindowsBackend  # noqa: E402


def main() -> int:
    p = build_perceiver()
    if type(p).__name__ == "StubPerceiver":
        print(f"感知件未就绪（权重目录 {default_weights_dir()}，vision extra 装了吗）")
        return 1
    backend = WindowsBackend()
    png = backend.screenshot()
    print(f"截屏 {len(png) / 1024:.0f}KB，开始感知（首帧含模型加载）…")

    for round_no in (1, 2):
        t0 = time.perf_counter()
        elements = p.parse(png)
        dt = time.perf_counter() - t0
        print(f"\n—— 第 {round_no} 帧：{len(elements)} 个元素，{dt:.1f}s ——")
        if round_no == 2:
            for e in elements[:40]:
                print(f"  ({e.x:>4},{e.y:>4}) {e.w}x{e.h}  {e.label}")
            if len(elements) > 40:
                print(f"  …共 {len(elements)} 个")

    try:
        import torch

        if torch.cuda.is_available():
            mb = torch.cuda.max_memory_allocated() / 2**20
            print(f"\n显存峰值（torch 分配）：{mb:.0f}MB")
    except ImportError:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
