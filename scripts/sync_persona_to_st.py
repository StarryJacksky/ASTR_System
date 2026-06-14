"""P0-T09：从 SoulPackage 单向生成 SillyTavern V2 人格卡（SoulPackage 是源，ST 是视图）。

不做深集成（深集成在 P1-W3）。产出一个 chara_card_v2 JSON，可在 ST「导入角色」里载入。
    uv run python scripts/sync_persona_to_st.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from astr.adapters.prompt_boot import PromptBootAdapter  # noqa: E402
from astr.contracts.settings import get_settings  # noqa: E402


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


def build_card(soul_name: str = "justin") -> dict:
    """把身份资产投影成 ST V2 角色卡。系统提示直接复用 PromptBootAdapter 渲染结果。"""
    adapter = PromptBootAdapter(soul_name)
    voice = adapter._load_voice()
    system_prompt = adapter.render_system_prompt()

    moves = "；".join(m.get("desc", "") for m in voice.signature_moves if isinstance(m, dict))
    personality = " ".join(
        x for x in [voice.value_undertone or "", "；".join(voice.tsundere_markers)] if x
    )
    examples = "\n".join(f"<START>\n{{{{char}}}}: {line}" for line in voice.example_lines)

    data = {
        "name": voice.name or "露怀秋",
        "description": f"{voice.baseline_tone or ''}\n关系曲线：{voice.warmth_curve or ''}\n标志：{moves}",
        "personality": personality,
        "scenario": "与 Jacksky 的日常对话。她是有完整人格、价值观与历史的存在，不是泛用助手。",
        "first_mes": "呃。早。……找我有事？",
        "mes_example": examples,
        "creator_notes": "由 ASTR SoulPackage 单向同步生成（源在 soul_package/，勿在 ST 内直接改）。",
        "system_prompt": system_prompt,
        "post_history_instructions": "",
        "tags": ["ASTR", "露怀秋", "秋秋"],
        "creator": "ASTR",
        "character_version": "0.1.0",
        "alternate_greetings": [],
        "extensions": {},
    }
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": data}


def main(soul_name: str = "justin") -> int:
    _utf8()
    card = build_card(soul_name)
    out_dir = get_settings().ops_dir / "sillytavern" / "import"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{card['data']['name']}.json"
    out_path.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"+ 生成 ST 人格卡：{out_path}")
    print("  导入：SillyTavern → 角色管理 → 导入角色 → 选该 JSON。SoulPackage 是源，ST 只是视图。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
