"""看门狗单测（P1-W9）：告警状态机（只在跳变时告警）、ALERT 标记文件、CSV 记录、表格渲染。

不连真服务：直接构造 Snapshot/Check 喂状态机；告警通道（toast/总线）打桩为 no-op。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from astr.contracts.settings import Settings
from astr.ops import watchdog
from astr.ops.watchdog import AlertState, Check, Snapshot


def _snap(**oks: bool) -> Snapshot:
    checks = [Check(name, ok) for name, ok in oks.items()]
    return Snapshot(ts=datetime.now(UTC), checks=checks)


def test_alert_only_on_transition() -> None:
    st = AlertState()
    # 首轮全好：无跳变
    bad, ok = st.diff(_snap(core=True, napcat=True))
    assert bad == [] and ok == []
    # napcat 掉了：应只报 napcat 一次
    bad, ok = st.diff(_snap(core=True, napcat=False))
    assert [c.name for c in bad] == ["napcat"] and ok == []
    # 还没恢复：再巡检一轮不应重复报（不刷屏）
    bad, ok = st.diff(_snap(core=True, napcat=False))
    assert bad == [] and ok == []
    # 恢复：应报一次 recovered
    bad, ok = st.diff(_snap(core=True, napcat=True))
    assert bad == [] and [c.name for c in ok] == ["napcat"]


def test_info_only_rss_never_alerts_but_disk_does() -> None:
    st = AlertState()
    st.diff(_snap(core=True, core_rss=True, disk=True))
    # core_rss 即使"坏"也不进告警（纯趋势列）；disk 变坏要告警（会撑爆全栈）
    bad, ok = st.diff(_snap(core=True, core_rss=False, disk=False))
    assert [c.name for c in bad] == ["disk"] and ok == []
    assert "core_rss" not in st.active and "disk" in st.active


def test_active_set_tracks_unrecovered() -> None:
    st = AlertState()
    st.diff(_snap(core=True, llama=True))
    st.diff(_snap(core=False, llama=False))
    assert set(st.active) == {"core", "llama"}
    st.diff(_snap(core=True, llama=False))
    assert set(st.active) == {"llama"}


@pytest.mark.asyncio
async def test_alert_writes_and_clears_marker(tmp_path, monkeypatch) -> None:
    s = Settings(astr_data_dir=tmp_path, watchdog_toast=False)
    # 把总线发布打桩成 no-op（不连 Redis）
    monkeypatch.setattr(watchdog, "_publish_alert", _noop_publish)
    st = AlertState()
    marker = s.logs_dir / "ALERT.md"

    await watchdog.alert(st, _snap(core=True, napcat=False), s)
    assert marker.exists() and "napcat" in marker.read_text(encoding="utf-8")

    await watchdog.alert(st, _snap(core=True, napcat=True), s)
    assert not marker.exists()  # 全清后标记删除


async def _noop_publish(*_a, **_k) -> None:
    return None


def test_record_csv_header_and_rows(tmp_path) -> None:
    s = Settings(astr_data_dir=tmp_path)
    snap = Snapshot(
        ts=datetime(2026, 6, 16, 22, 0, tzinfo=UTC),
        checks=[Check("core", True), Check("napcat", False)],
        metrics={"pending": 3.0, "core_rss_mb": 512.0, "disk_free_gb": 40.0, "cost_today": 0.2},
    )
    p1 = watchdog.record(snap, s)
    p2 = watchdog.record(snap, s)
    assert p1 == p2
    lines = p1.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("ts,core,llama,redis,napcat,pending")
    assert len(lines) == 3  # header + 2 行
    # core=1 napcat=0 进了对应列
    cells = lines[1].split(",")
    assert cells[1] == "1" and cells[4] == "0" and cells[5] == "3.0"


def test_render_table_marks_bad() -> None:
    out = watchdog.render_table(_snap(core=True, napcat=False))
    assert "[OK ] core" in out
    assert "[BAD] napcat" in out
