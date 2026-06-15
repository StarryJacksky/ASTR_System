"""发言习惯锚定（P1-W6 治"不像人"）：把主人写的金标当 few-shot 范例喂进对话。

金标 expect_style_notes 就是"她该怎么回"的真身（如 你是ai吗→我是你爸）。本地小模型有了这些
真实范例，就照主人定义的腔说话（短、有态度、不解释自己），而不是把系统提示背成 AI 腔。
每轮随机取样若干条 → 既锚定风格，又制造变化（避免"都是一样的回复"）。
"""

from __future__ import annotations

import json
import random

from astr.contracts.settings import get_settings


def load_examples(filename: str = "golden_v0.jsonl") -> list[tuple[str, str]]:
    """读金标 (prompt, expect_style_notes) 对；跳过注释行与缺字段行。"""
    path = get_settings().golden_set_dir / filename
    out: list[tuple[str, str]] = []
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith(("//", "#")):
            continue
        try:
            d = json.loads(s)
        except json.JSONDecodeError:
            continue
        p = (d.get("prompt") or "").strip()
        r = (d.get("expect_style_notes") or "").strip()
        if p and r:
            out.append((p, r))
    return out


def sample_turns(n: int = 6, *, rng: random.Random | None = None) -> list[dict]:
    """随机取 n 条金标，展开成 user/assistant 轮次（few-shot 范例）。"""
    rng = rng or random
    ex = load_examples()
    if not ex:
        return []
    picks = rng.sample(ex, min(n, len(ex)))
    turns: list[dict] = []
    for prompt, reply in picks:
        turns.append({"role": "user", "content": prompt})
        turns.append({"role": "assistant", "content": reply})
    return turns
