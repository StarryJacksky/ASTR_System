"""世界书 lorebook（P1-W3）：world/lorebook.json，与 SillyTavern World Info 格式兼容。

长期"设定/事实"知识库（关于主人、世界、关系的稳定条目），可被 ST 直接导入、也供 soul 层检索。
P1：从已确认的语义事实（semantic.kv.jsonl）同步成条目；条目住真身（world/），是身份资产。
keys 命中即触发的轻量检索留给消费方（P3 圆桌/检索时用）。
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import structlog

from astr.contracts.settings import get_settings
from astr.memory import semantic

log = structlog.get_logger("astr.memory.lorebook")

_STOP = {"的", "了", "在", "是", "我", "你", "他", "她", "和", "也", "都", "就", "要", "会"}


def lorebook_path(soul_name: str = "justin") -> Path:
    return get_settings().soul_package_dir / soul_name / "world" / "lorebook.json"


def load(soul_name: str = "justin") -> dict:
    p = lorebook_path(soul_name)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("lorebook_corrupt", path=str(p))
    return {"entries": {}}


def save(soul_name: str, book: dict) -> Path:
    p = lorebook_path(soul_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(book, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def _keywords(text: str, n: int = 4) -> list[str]:
    """从事实里抽几个触发关键词（中文 2+ 连续汉字、英文词），去停用词。"""
    toks = re.findall(r"[一-鿿]{2,}|[A-Za-z][A-Za-z0-9]{1,}", text)
    seen: list[str] = []
    for t in toks:
        if t not in _STOP and t not in seen:
            seen.append(t)
        if len(seen) >= n:
            break
    return seen


def upsert_entry(soul_name: str, uid: str, keys: list[str], content: str, comment: str = "") -> None:
    """新增/更新一条世界书条目（ST World Info 兼容字段）。"""
    book = load(soul_name)
    book.setdefault("entries", {})[uid] = {
        "uid": uid,
        "key": keys,
        "keysecondary": [],
        "comment": comment,
        "content": content,
        "constant": False,
        "selective": True,
        "order": 100,
        "position": 0,
        "disable": False,
    }
    save(soul_name, book)


def sync_from_semantic(soul_name: str = "justin") -> int:
    """把已确认的语义事实（semantic.kv.jsonl）同步成世界书条目。返回新增/更新条目数。"""
    facts = semantic._read_jsonl(semantic.kv_path(soul_name))
    book = load(soul_name)
    entries = book.setdefault("entries", {})
    n = 0
    for row in facts:
        fact = (row.get("fact") or "").strip()
        if not fact:
            continue
        uid = "fact_" + hashlib.md5(fact.encode("utf-8")).hexdigest()[:10]
        entries[uid] = {
            "uid": uid,
            "key": _keywords(fact) or [fact[:6]],
            "keysecondary": [],
            "comment": "语义事实（已确认）",
            "content": fact,
            "constant": False,
            "selective": True,
            "order": 100,
            "position": 0,
            "disable": False,
        }
        n += 1
    save(soul_name, book)
    log.info("lorebook_synced", facts=n, path=str(lorebook_path(soul_name)))
    return n
