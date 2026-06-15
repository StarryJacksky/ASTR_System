"""平台能力探测（P1-W6-d / 05 §3 末、§8-1）：把各平台实测/已知能力写盘，render 时据此降级。

本期 ASTR 侧落"已知能力表"（静态，基于 NapCat/OneBot v11 标准）。桥（AstrBot）可在连接 NapCat 后
回传实测结果覆盖（POST /v1/event kind=caps，P5-W2 接）。落点：embodiments/platform_caps.json。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from astr.contracts.settings import get_settings
from astr.sensors.platform.qq import QQ_CAPS

KNOWN_CAPS: dict[str, set[str]] = {
    "qq": QQ_CAPS,
}


def caps_path() -> Path:
    return get_settings().embodiments_dir / "platform_caps.json"


def probe(platforms: list[str] | None = None) -> dict:
    """生成能力清单并落盘。platforms 缺省探测全部已知平台。"""
    names = platforms or list(KNOWN_CAPS.keys())
    data = {
        "probed_at": datetime.now(UTC).isoformat(),
        "platforms": {n: sorted(KNOWN_CAPS.get(n, {"text"})) for n in names},
    }
    p = caps_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def load_caps(platform: str) -> set[str]:
    """读已探测的平台能力；没探测过则回退到已知静态表。"""
    p = caps_path()
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            caps = data.get("platforms", {}).get(platform)
            if caps:
                return set(caps)
        except Exception:  # noqa: BLE001
            pass
    return set(KNOWN_CAPS.get(platform, {"text"}))
