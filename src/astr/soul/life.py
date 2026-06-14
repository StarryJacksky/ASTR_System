"""日常生活引擎（P1-W6 赶超项）：她像人一样过每一天，每天不同、随机度大。

三类（用户定义）：
  - intentions  她**主观想做**的（兴趣驱动，今天打算干啥）
  - hourly      她**客观在做**的 24 小时时间线（睡/吃/写代码/发呆/打游戏…）
  - events      **发生了什么**（随机生活事件，影响心情）
不是每天都按点睡：作息按 日期种子 随机生成（睡点/时长都变），且**可被互动改写**
（如群友"陪我熬夜写文章"→ 她可能选择熬夜，override_stay_up）。
当前活动 → 在线度(engagement) + 回复时间感(system prompt) + 心情线索。

注：这里只建"她的一天"的状态层；真正自主去找人/去做事（主动行为）属 P5。
持久化：soul_package/<soul>/memory/life/<date>.json —— 她真实经历的每一天，是身份资产。
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

from astr.contracts.settings import get_settings

# 活动池：(名称, 在线度, 心情线索)。在线度=被搭话时她有多可能回。
SUBJECTIVE_ACTS = [
    ("看论文", 0.55, "在啃一篇论文，思路被打断会有点不爽"),
    ("写代码", 0.55, "在写代码，半沉浸"),
    ("读小说", 0.8, "在读小说，挺松弛"),
    ("打游戏", 0.7, "在打游戏"),
    ("听歌发呆", 0.95, "戴着耳机发呆，随时能搭话"),
    ("琢磨玄学", 0.7, "在翻易经/琢磨点玄的"),
    ("写她自己的小说", 0.5, "在憋自己那篇小说，别打断她灵感"),
    ("刷手机/上网冲浪", 0.95, "在刷手机，抽象得很"),
    ("练字/画画", 0.6, "在练字"),
]
OBJECTIVE_ACTS = [
    ("吃饭", 0.5, "在吃饭"),
    ("做饭", 0.45, "在做饭，腾不开手"),
    ("散步", 0.4, "在外面散步，不一定看手机"),
    ("发呆放空", 0.9, "在放空"),
    ("收拾屋子", 0.5, "在收拾东西"),
]
EVENT_POOL = [
    "刷到一条让人心里一沉的新闻",
    "突然想起一件很久以前的事",
    "灵感来了，记了一段东西",
    "今天莫名有点低落（双相的下坡）",
    "今天状态很高，什么都想干（双相的上坡）",
    "和谁拌了两句嘴，有点烦",
    "看了部老电影，后劲很大",
    "天气把人闷住了",
]
SLEEP = ("睡觉", 0.1, "在睡，被吵醒会迷糊+不耐烦")


@dataclass
class DayPlan:
    date: str
    hourly: list[list]  # 24 项，每项 [activity, availability, mood_hint, kind]
    intentions: list[str]
    events: list[str]
    seed: int
    overrides: list[str] = field(default_factory=list)  # 当天被改写的记录（如"被xx拉着熬夜"）

    def block_at(self, hour: int) -> list:
        return self.hourly[hour % 24]


def _seed_for(soul_name: str, d: str) -> int:
    return int(hashlib.sha1(f"{soul_name}:{d}".encode()).hexdigest(), 16) % (2**31)


def _today(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).astimezone().strftime("%Y-%m-%d")


def generate_day_plan(
    soul_name: str, d: str | None = None, *, rng: random.Random | None = None
) -> DayPlan:
    """按 日期种子 随机生成她"这一天"。每天不同、随机度大；睡点/时长都变，偶尔熬夜或早睡。"""
    d = d or _today()
    rng = rng or random.Random(_seed_for(soul_name, d))

    hourly: list[list] = [None] * 24  # type: ignore[list-item]

    # 睡眠：入睡 0~5 点随机、时长 5~8 小时；约 1/6 概率"今天熬大夜"（很晚睡）
    if rng.random() < 0.17:
        sleep_start = rng.choice([5, 6])  # 熬到天亮才睡
    else:
        sleep_start = rng.choice([0, 1, 2, 2, 3, 3, 4])
    sleep_dur = rng.choice([5, 6, 6, 7, 7, 8])
    for i in range(sleep_dur):
        hourly[(sleep_start + i) % 24] = [SLEEP[0], SLEEP[1], SLEEP[2], "objective"]

    # 醒着的时段：切成若干"活动段"，每段持续 1~4 小时，随机取主观/客观活动
    awake = [h for h in range(24) if hourly[h] is None]
    i = 0
    while i < len(awake):
        seg = rng.randint(1, 4)
        if rng.random() < 0.65:
            name, av, hint = rng.choice(SUBJECTIVE_ACTS)
            kind = "subjective"
        else:
            name, av, hint = rng.choice(OBJECTIVE_ACTS)
            kind = "objective"
        for h in awake[i : i + seg]:
            hourly[h] = [name, av, hint, kind]
        i += seg

    # 主观意图（今天想做的）：从已排进时间线的主观活动里挑，去重
    intentions = list({hourly[h][0] for h in range(24) if hourly[h][3] == "subjective"})
    rng.shuffle(intentions)
    intentions = intentions[: rng.randint(1, 3)]

    # 随机生活事件 0~2 条
    events = rng.sample(EVENT_POOL, k=rng.randint(0, 2))

    return DayPlan(
        date=d, hourly=hourly, intentions=intentions, events=events, seed=_seed_for(soul_name, d)
    )


# ── 持久化 ───────────────────────────────────────────────
def _path(soul_name: str, d: str):
    return get_settings().soul_package_dir / soul_name / "memory" / "life" / f"{d}.json"


def load_or_create(soul_name: str = "justin", now: datetime | None = None) -> DayPlan:
    """取今天的生活计划，没有就生成并落盘（她经历的每一天，存进 SoulPackage）。"""
    d = _today(now)
    p = _path(soul_name, d)
    if p.exists():
        try:
            return DayPlan(**json.loads(p.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            pass
    plan = generate_day_plan(soul_name, d)
    save(plan, soul_name)
    return plan


def save(plan: DayPlan, soul_name: str = "justin") -> None:
    p = _path(soul_name, plan.date)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(asdict(plan), ensure_ascii=False, indent=2), encoding="utf-8")


# ── 当前状态 ─────────────────────────────────────────────
def availability_now(soul_name: str = "justin", now: datetime | None = None) -> float:
    now = now or datetime.now(UTC)
    return float(load_or_create(soul_name, now).block_at(now.astimezone().hour)[1])


def to_prompt_line(soul_name: str = "justin", now: datetime | None = None) -> str:
    """给 system prompt 的一句"你此刻在干嘛"，让回复带生活感。"""
    now = now or datetime.now(UTC)
    plan = load_or_create(soul_name, now)
    blk = plan.block_at(now.astimezone().hour)
    line = f"你此刻在{blk[0]}——{blk[2]}。"
    if plan.events:
        line += f"（今天还：{plan.events[0]}）"
    return line


def override_stay_up(
    soul_name: str = "justin",
    reason: str = "被拉着熬夜",
    *,
    until_hour: int = 5,
    now: datetime | None = None,
) -> DayPlan:
    """互动改写：她选择熬夜——把当下到 until_hour 的睡觉块改成醒着陪着。"""
    now = now or datetime.now(UTC)
    plan = load_or_create(soul_name, now)
    h = now.astimezone().hour
    changed = False
    for k in range(24):
        hh = (h + k) % 24
        if hh == until_hour:
            break
        if plan.hourly[hh][0] == SLEEP[0]:
            plan.hourly[hh] = ["熬夜陪着", 0.85, f"本来要睡了，{reason}，所以还醒着", "subjective"]
            changed = True
    if changed:
        plan.overrides.append(reason)
        save(plan, soul_name)
    return plan
