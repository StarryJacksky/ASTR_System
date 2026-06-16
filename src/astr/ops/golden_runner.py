"""P0-T06：黄金测试集评估 runner —— "她还是她"的唯一标尺。

流程：读 golden_v0.jsonl → 对指定 endpoint 逐条生成回复 → 存 eval_reports/golden_<date>_<adapter>.jsonl
→ 生成静态 HTML 对照页（人工 1–5 打分 + 备注，可在页面里导出回填后的 JSONL）。
自动评分（LLM-as-judge）P4 再上，但字段现在就留好：human_score / judge_score / judge_model。

    uv run python -m astr.ops.golden_runner run  --label prompt_boot_qwen3_8b
    uv run python -m astr.ops.golden_runner html <report.jsonl>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from html import escape
from pathlib import Path

from astr.contracts.settings import get_settings

ResponderFn = Callable[[str], Awaitable[str]]


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        rc = getattr(s, "reconfigure", None)
        if rc:
            try:
                rc(encoding="utf-8")
            except (ValueError, OSError):
                pass


def load_golden(path: Path) -> list[dict]:
    """读金标集；跳过注释行与未填 prompt 的占位行（如待补的记忆场景），避免对空 prompt 浪费生成。"""
    items: list[dict] = []
    skipped = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("//") or line.startswith("#"):
            continue
        row = json.loads(line)
        if not str(row.get("prompt", "")).strip():
            skipped += 1
            continue
        items.append(row)
    if skipped:
        print(f"（跳过 {skipped} 条未填 prompt 的占位行）", file=sys.stderr)
    return items


async def generate_report(items: list[dict], responder: ResponderFn, label: str) -> list[dict]:
    """对每条 prompt 生成回复，组装报告行（分数字段留空待人评）。"""
    rows: list[dict] = []
    for item in items:
        try:
            response = await responder(item["prompt"])
        except Exception as e:  # noqa: BLE001
            response = f"[生成失败：{type(e).__name__}: {e}]"
        rows.append(
            {
                "id": item.get("id"),
                "scenario_tag": item.get("scenario_tag"),
                "prompt": item["prompt"],
                "expect_style_notes": item.get("expect_style_notes", ""),
                "response": response,
                "human_score": None,
                "judge_score": None,
                "judge_model": None,
                "adapter": label,
            }
        )
    return rows


def save_report(rows: list[dict], label: str) -> Path:
    settings = get_settings()
    settings.eval_reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    out = settings.eval_reports_dir / f"golden_{stamp}_{label}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return out


def to_html(report_path: Path) -> Path:
    """生成自包含 HTML 对照页：展示 prompt/期望/回复，可打 1–5 分+备注并导出回填 JSONL。"""
    rows = [
        json.loads(line)
        for line in report_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    data_json = json.dumps(rows, ensure_ascii=False)
    cards = []
    for i, r in enumerate(rows):
        cards.append(f"""
        <div class="card">
          <div class="meta">#{i + 1} · {escape(str(r.get("id")))} · <b>{escape(str(r.get("scenario_tag")))}</b></div>
          <div class="prompt"><span class="lbl">Prompt</span>{escape(r.get("prompt", ""))}</div>
          <div class="expect"><span class="lbl">期望风格</span>{escape(r.get("expect_style_notes", "") or "（未填）")}</div>
          <div class="resp"><span class="lbl">露怀秋</span>{escape(r.get("response", ""))}</div>
          <div class="score">打分(1–5)：
            <input type="number" min="1" max="5" data-i="{i}" class="sc" value="{r.get("human_score") or ""}">
            备注：<input type="text" data-i="{i}" class="nt" value="{escape(r.get("note", "") or "")}" size="40">
          </div>
        </div>""")
    html = f"""<!doctype html><html lang="zh"><meta charset="utf-8">
<title>金标集人评 · {escape(report_path.stem)}</title>
<style>
 body{{font-family:system-ui,'Microsoft YaHei';max-width:900px;margin:24px auto;padding:0 16px;color:#1a1a1a}}
 .card{{border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
 .meta{{color:#888;font-size:13px;margin-bottom:8px}}
 .lbl{{display:inline-block;min-width:64px;color:#3b6;font-weight:600;margin-right:8px}}
 .prompt,.expect,.resp{{margin:6px 0;line-height:1.6;white-space:pre-wrap}}
 .resp{{background:#f7f8fa;border-radius:6px;padding:8px}}
 .score{{margin-top:10px}}
 button{{padding:10px 18px;font-size:15px;border-radius:8px;border:0;background:#3b6;color:#fff;cursor:pointer}}
</style>
<h1>金标集人评 · {escape(report_path.stem)}</h1>
<p>逐条打 1–5 分并写备注，完成后点「导出回填 JSONL」，把下载的文件覆盖回 eval_reports/。</p>
{"".join(cards)}
<button onclick="exp()">导出回填 JSONL</button>
<script>
const DATA={data_json};
function exp(){{
  document.querySelectorAll('.sc').forEach(e=>{{const i=e.dataset.i; DATA[i].human_score=e.value?Number(e.value):null;}});
  document.querySelectorAll('.nt').forEach(e=>{{const i=e.dataset.i; DATA[i].note=e.value;}});
  const lines=DATA.map(r=>JSON.stringify(r)).join('\\n');
  const blob=new Blob([lines],{{type:'application/jsonl'}});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='{escape(report_path.stem)}.scored.jsonl';a.click();
}}
</script></html>"""
    out = report_path.with_suffix(".html")
    out.write_text(html, encoding="utf-8")
    return out


async def _run_local(items: list[dict], label: str) -> list[dict]:
    """构建一次 orchestrator（避免逐条冷启动），跑完整链路；CBG 落 logs 不脏灵魂仓库。"""
    from astr.soul.orchestrator import SoulOrchestrator

    orch = SoulOrchestrator("justin")
    orch.cbg_path = get_settings().logs_dir / "golden_eval.cbg.jsonl"

    async def responder(prompt: str) -> str:
        reply, _ = await orch.respond(prompt)
        return reply

    return await generate_report(items, responder, label)


def main(argv: list[str] | None = None) -> int:
    _utf8()
    parser = argparse.ArgumentParser(description="金标集评估 runner")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="跑金标集生成报告")
    p_run.add_argument("--label", default="prompt_boot_qwen3_8b")
    p_run.add_argument(
        "--golden", default=None, help="golden_v0.jsonl 路径，默认 ops/golden_set/golden_v0.jsonl"
    )
    p_html = sub.add_parser("html", help="把报告 jsonl 转成人评 HTML")
    p_html.add_argument("report")
    args = parser.parse_args(argv)

    settings = get_settings()
    if args.cmd == "run":
        golden = Path(args.golden) if args.golden else settings.golden_set_dir / "golden_v0.jsonl"
        if not golden.exists():
            print(
                f"✗ 金标集不存在：{golden}（先按 golden_README.md 本人撰写 30 条）", file=sys.stderr
            )
            return 1
        items = load_golden(golden)
        rows = asyncio.run(_run_local(items, args.label))
        out = save_report(rows, args.label)
        html = to_html(out)
        print(f"✓ 报告：{out}\n✓ 人评页：{html}")
        return 0
    if args.cmd == "html":
        print(f"✓ 人评页：{to_html(Path(args.report))}")
        return 0
    return 2


if __name__ == "__main__":
    _rc = main()
    # 跳过 chromadb/onnxruntime 在 Windows 退出清理时的 native 崩溃（报告已落盘）
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(_rc)
