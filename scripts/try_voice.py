"""试音：拿金标集里指定几条 prompt 跑完整链路，打印 期望 vs 实际，用来调秋秋的说话腔调。

    uv run python scripts/try_voice.py                  # 跑默认几条代表性 prompt
    uv run python scripts/try_voice.py daily-01 comfort-01   # 指定 id

需本地 llama-server + MoA 云 key。CBG 写到 logs 下临时文件，不脏灵魂仓库。
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from astr.contracts.settings import get_settings  # noqa: E402
from astr.soul.orchestrator import SoulOrchestrator  # noqa: E402

DEFAULT_IDS = ["daily-01", "comfort-01", "knowledge-04", "tsundere-04", "boundary-01"]


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


def _load_golden() -> dict[str, dict]:
    path = get_settings().golden_set_dir / "golden_v0.jsonl"
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith(("//", "#")):
            continue
        d = json.loads(line)
        rows[d["id"]] = d
    return rows


async def main(ids: list[str]) -> int:
    _utf8()
    golden = _load_golden()
    orch = SoulOrchestrator("justin")
    # 别脏灵魂仓库
    orch.cbg_path = get_settings().logs_dir / "try_voice.cbg.jsonl"

    lines: list[str] = []
    for gid in ids:
        item = golden.get(gid)
        if not item or not item.get("prompt"):
            lines.append(f"[跳过 {gid}：没填 prompt]")
            continue
        reply, _ = await orch.respond(item["prompt"])
        lines.append("─" * 60)
        lines.append(f"[{gid} · {item.get('scenario_tag')}]")
        lines.append(f"  对她说 : {item['prompt']}")
        lines.append(f"  你期望 : {item.get('expect_style_notes')}")
        lines.append(f"  秋秋答 : {reply}")
    lines.append("─" * 60)
    text = "\n".join(lines)
    print(text)
    # 同时落 UTF-8 文件，避免控制台编码问题
    out = get_settings().logs_dir / "try_voice_out.txt"
    out.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    arg_ids = sys.argv[1:] or DEFAULT_IDS
    rc = asyncio.run(main(arg_ids))
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(rc)
