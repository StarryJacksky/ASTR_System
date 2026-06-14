"""日常生活引擎单测（P1-W6）：每天不同 + 确定可复现 + 邀约熬夜改写作息。"""

from __future__ import annotations

from datetime import datetime

from astr.contracts.settings import Settings
from astr.soul import life


def test_deterministic_same_day() -> None:
    a = life.generate_day_plan("justin", "2026-06-15")
    b = life.generate_day_plan("justin", "2026-06-15")
    assert a.hourly == b.hourly
    assert a.intentions == b.intentions


def test_days_differ_and_sleep_varies() -> None:
    plans = [life.generate_day_plan("justin", f"2026-06-{d:02d}") for d in range(1, 21)]
    # 每天不一样（活动签名去重后远多于 1）
    sigs = {tuple(p.hourly[h][0] for h in range(24)) for p in plans}
    assert len(sigs) > 8
    # 睡眠分布有变化（不是每天同一批小时在睡）
    sleep_sets = {tuple(h for h in range(24) if p.hourly[h][0] == "睡觉") for p in plans}
    assert len(sleep_sets) > 5


def test_block_and_availability_bounds() -> None:
    plan = life.generate_day_plan("justin", "2026-06-15")
    for h in range(24):
        blk = plan.block_at(h)
        assert isinstance(blk[0], str)
        assert 0.0 <= blk[1] <= 1.0
        assert blk[3] in ("subjective", "objective")


def test_override_stay_up(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        life, "get_settings", lambda: Settings(_env_file=None, astr_data_dir=tmp_path)
    )
    plan = life.load_or_create("justin")
    sleep_hours = [h for h in range(24) if plan.hourly[h][0] == "睡觉"]
    assert sleep_hours, "今天的计划应有睡眠时段"

    sh = sleep_hours[0]
    now2 = datetime.now().astimezone().replace(hour=sh, minute=0, second=0, microsecond=0)
    life.override_stay_up("justin", reason="被拉着熬夜", until_hour=(sh + 4) % 24, now=now2)

    reloaded = life.load_or_create("justin", now=now2)
    assert reloaded.hourly[sh][0] == "熬夜陪着"
    assert reloaded.hourly[sh][1] > life.SLEEP[1]  # 在线度比睡觉高
    assert "被拉着熬夜" in reloaded.overrides
