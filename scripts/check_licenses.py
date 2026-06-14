"""依赖许可证闸 —— §0.6 / 06 号文档的机器执法。

地位
----
扫描已安装的 Python 依赖许可证，把它们归类，并按仓库性质拦截：
  - 主仓（AGPL-3.0 应用）：GPL/AGPL 依赖**允许**（兼容）；**UNKNOWN 必须拦**（逼你人工归类，否则 NOTICES 不完整）。
  - oisp-spec 仓（要做宽松标准）：`--strict` 下**任何 copyleft 都拦**——标准仓一旦被 copyleft 传染就失去被大厂采纳的资格（06 §3 铁律）。

为什么是闸而不是文档
--------------------
"我们合规"必须有一条可运行的命令背书（99 #14 原则）。这跟 soul-purity 钩子同构：
许可证合规不靠 README 上一段话，靠 CI 每次 push 真的扫一遍。

落点
----
拷到 `scripts/check_licenses.py`。P0-T02 接进 CI（与 ruff/pytest 并列）。
注：仅扫 Python 依赖；前端 npm 依赖用 `license-checker`/`license-checker-rseidelsohn` 另跑（P1-W10 补）。

CLI
---
    python check_licenses.py                          # 主仓：UNKNOWN 即失败，copyleft 仅报告
    python check_licenses.py --strict                 # oisp-spec：任何 copyleft 即失败
    python check_licenses.py --verify-notices THIRD_PARTY_NOTICES.md   # 校验 NOTICES 覆盖
"""

from __future__ import annotations

import argparse
import sys
from importlib import metadata
from pathlib import Path

# —— 许可证归类（关键词匹配，全大写后判断）——
STRONG_COPYLEFT = ("AGPL", "AFFERO", "GPLV3", "GPLV2", "GPL-3", "GPL-2", "GNU GENERAL PUBLIC")
WEAK_COPYLEFT = ("LGPL", "LESSER GENERAL PUBLIC", "MPL", "MOZILLA PUBLIC", "EPL", "CDDL")
PERMISSIVE = (
    "MIT",
    "BSD",
    "APACHE",
    "ISC",
    "PYTHON SOFTWARE",
    "PSF",
    "UNLICENSE",
    "ZLIB",
    "BOOST",
    "0BSD",
    "WTFPL",
    "PUBLIC DOMAIN",
)
# GPL 含 LGPL 时按 weak 处理：匹配顺序 weak → strong → permissive


def _license_text(dist: metadata.Distribution) -> str:
    """从分发元数据里尽量挖出许可证字符串。

    覆盖三处来源（现代包多用 PEP 639 的 License-Expression，老的 License 字段常空）：
      1) License-Expression（metadata 2.4 / PEP 639，SPDX 表达式，最可靠）
      2) License（自由文本，常空或填全文）
      3) Classifier: License ::（分类器）
    """
    meta = dist.metadata
    parts: list[str] = []
    expr = meta.get("License-Expression")
    if expr and expr.upper() != "UNKNOWN":
        parts.append(expr)
    lic = meta.get("License")
    # License 字段有时塞了整段许可证全文，截断避免噪声
    if lic and lic.upper() != "UNKNOWN":
        parts.append(lic if len(lic) <= 80 else lic[:80])
    for clf in meta.get_all("Classifier") or []:
        if clf.startswith("License ::"):
            parts.append(clf.split("::")[-1].strip())
    return " ; ".join(parts).strip()


def classify(license_text: str) -> str:
    """归类为 strong-copyleft / weak-copyleft / permissive / unknown。"""
    if not license_text:
        return "unknown"
    up = license_text.upper()
    if any(k in up for k in WEAK_COPYLEFT):
        return "weak-copyleft"
    if any(k in up for k in STRONG_COPYLEFT):
        return "strong-copyleft"
    if any(k in up for k in PERMISSIVE):
        return "permissive"
    return "unknown"


def scan() -> list[tuple[str, str, str]]:
    """返回 (包名, 许可证文本, 归类)，按包名排序，稳定可 diff。"""
    rows: list[tuple[str, str, str]] = []
    for dist in metadata.distributions():
        name = dist.metadata.get("Name") or "?"
        lic = _license_text(dist)
        rows.append((name, lic or "(无声明)", classify(lic)))
    # 去重（同名多版本）+ 排序
    return sorted(set(rows), key=lambda r: r[0].lower())


def _force_utf8_output() -> None:
    """Windows 控制台默认 GBK，打不出 ‼/▲/✓ 等符号；统一强制 UTF-8（CI/Linux 无副作用）。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass


def main(argv: list[str] | None = None) -> int:
    _force_utf8_output()
    ap = argparse.ArgumentParser(description="依赖许可证闸（06 号文档）")
    ap.add_argument("--strict", action="store_true", help="oisp-spec 仓用：任何 copyleft 都失败")
    ap.add_argument(
        "--verify-notices", type=Path, default=None, help="校验每个包都在该 NOTICES 文件里有记录"
    )
    args = ap.parse_args(argv)

    rows = scan()
    strong = [r for r in rows if r[2] == "strong-copyleft"]
    weak = [r for r in rows if r[2] == "weak-copyleft"]
    unknown = [r for r in rows if r[2] == "unknown"]

    for name, lic, cat in rows:
        flag = {"strong-copyleft": "‼", "weak-copyleft": "▲", "unknown": "?", "permissive": " "}[
            cat
        ]
        print(f"  {flag} {name:<28} {cat:<16} {lic[:60]}")
    print(
        f"\n合计 {len(rows)}：strong-copyleft {len(strong)} / weak {len(weak)} / unknown {len(unknown)}"
    )

    failed = False

    if args.strict and (strong or weak):
        print(
            "\n✗ --strict（oisp-spec 仓）：禁止任何 copyleft 依赖（06 §3 铁律）：", file=sys.stderr
        )
        for name, lic, _ in strong + weak:
            print(f"    - {name}: {lic}", file=sys.stderr)
        failed = True

    if unknown:
        print(
            "\n✗ 存在 UNKNOWN 许可证依赖，必须人工归类并补进 THIRD_PARTY_NOTICES：", file=sys.stderr
        )
        for name, lic, _ in unknown:
            print(f"    - {name}: {lic}", file=sys.stderr)
        failed = True
    elif not args.strict and strong:
        # 主仓（AGPL）：copyleft 合法，仅提示，不失败
        print("\nℹ 主仓为 AGPL-3.0，上述 copyleft 依赖合规（仅提示，不拦截）。")

    if args.verify_notices:
        missing = _verify_notices(args.verify_notices, [r[0] for r in rows])
        if missing:
            print(f"\n✗ 以下依赖未在 {args.verify_notices} 记录：", file=sys.stderr)
            for m in missing:
                print(f"    - {m}", file=sys.stderr)
            failed = True

    if failed:
        return 1
    print("\n✓ 许可证闸通过")
    return 0


def _verify_notices(notices: Path, names: list[str]) -> list[str]:
    """返回未在 NOTICES 文本里出现的包名（宽松：大小写无关子串匹配）。"""
    if not notices.exists():
        return names
    text = notices.read_text(encoding="utf-8").lower()
    return [n for n in names if n.lower() not in text]


if __name__ == "__main__":
    raise SystemExit(main())
