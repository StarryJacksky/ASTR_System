"""看门狗 / 浸泡监控（P1-W9 稳定性周）。

两个职责合一：
  ① 48h 浸泡仪器——每轮把全栈健康快照追加到 CSV，事后画趋势抓内存泄漏 / pending 堆积；
  ② 掉线告警——某项检查从"好→坏"跳变时多通道告警（结构化日志 + ALERT 标记文件 + 桌面弹窗
     + 总线 safety.alert 事件），"坏→好"发恢复通知。只在跳变时告警，不每轮刷屏。

血的教训：QQ 号被踢下线，几小时后才在群里聊半天发现她不在。NapCat 掉线检测就是为这个加的。

设计铁律：每项检查都包到 try 里，单项炸不能掀翻巡检循环；Redis/Docker 不可达时静默降级。
检查全部只读，绝不重启/干扰正在跑的服务。
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx
import structlog

from astr.contracts.settings import Settings, get_settings

log = structlog.get_logger("astr.watchdog")

# NapCat 掉线特征串（出现在容器日志里即判离线）
_OFFLINE_MARKERS = ("KickedOffLine", "账号状态变更为离线", "登录已失效", "登录状态失效")


@dataclass
class Check:
    """一项检查的结果。ok=False 即触发告警状态机。"""

    name: str
    ok: bool
    detail: str = ""
    value: float | None = None  # 数值型指标（pending 数 / RSS MB / 剩余 GB），进 CSV 趋势列


@dataclass
class Snapshot:
    """一轮巡检的全部结果。"""

    ts: datetime
    checks: list[Check]
    metrics: dict[str, float | None] = field(default_factory=dict)

    def get(self, name: str) -> Check | None:
        return next((c for c in self.checks if c.name == name), None)


# ─────────────────────────── 各项检查（全部容错） ───────────────────────────


async def _check_http(name: str, url: str, timeout: float = 5.0) -> Check:
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as c:
            r = await c.get(url)
        return Check(name, r.status_code == 200, f"HTTP {r.status_code}")
    except Exception as e:  # noqa: BLE001
        return Check(name, False, f"unreachable: {type(e).__name__}")


async def _check_redis(s: Settings) -> tuple[Check, Check]:
    """Redis 存活 + 消费组 pending 堆积。返回 (存活检查, pending 检查)。"""
    try:
        import redis.asyncio as aioredis

        r = aioredis.Redis.from_url(s.redis_url, decode_responses=True)
        try:
            await r.ping()
            total_pending = 0
            try:
                groups = await r.xinfo_groups("astr:events")
                total_pending = sum(int(g.get("pending", 0)) for g in groups)
            except Exception:  # noqa: BLE001 —— stream/group 还没建，pending=0
                total_pending = 0
            alive = Check("redis", True, "PONG")
            ok = total_pending < s.watchdog_pending_alert
            pend = Check(
                "redis_pending",
                ok,
                f"{total_pending} pending" + ("" if ok else f" ≥ {s.watchdog_pending_alert}"),
                value=float(total_pending),
            )
            return alive, pend
        finally:
            await r.aclose()
    except Exception as e:  # noqa: BLE001
        return Check("redis", False, f"unreachable: {type(e).__name__}"), Check(
            "redis_pending", True, "skip (redis down)"
        )


def _check_napcat(s: Settings, since_s: int) -> Check:
    """扫 NapCat 容器近 since_s 秒日志找掉线特征。docker 不可用则降级为 skip（视为 ok）。"""
    try:
        out = subprocess.run(
            ["docker", "logs", s.watchdog_napcat_container, "--since", f"{since_s}s"],
            capture_output=True,
            text=True,
            timeout=10,
            encoding="utf-8",
            errors="replace",
        )
        blob = (out.stdout or "") + (out.stderr or "")
        if out.returncode != 0 and not blob:
            return Check("napcat", True, "skip (no docker/container)")
        hit = next((m for m in _OFFLINE_MARKERS if m in blob), None)
        if hit:
            return Check("napcat", False, f"掉线: 命中“{hit}”")
        return Check("napcat", True, "online (近期无掉线日志)")
    except FileNotFoundError:
        return Check("napcat", True, "skip (docker 未安装)")
    except Exception as e:  # noqa: BLE001
        return Check("napcat", True, f"skip ({type(e).__name__})")


def _check_disk(s: Settings) -> Check:
    try:
        root = Path(s.astr_data_dir).anchor or "D:/"
        free_gb = shutil.disk_usage(root).free / 2**30
        return Check("disk", free_gb > 5.0, f"{free_gb:.1f} GB free", value=round(free_gb, 1))
    except Exception as e:  # noqa: BLE001
        return Check("disk", True, f"skip ({type(e).__name__})")


def _core_rss_mb() -> Check:
    """监听 :8300 的进程 RSS（内存泄漏趋势）。纯 Windows netstat+tasklist，best-effort。"""
    try:
        ns = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=8, errors="replace"
        )
        pid = None
        for line in ns.stdout.splitlines():
            if ":8300" in line and "LISTENING" in line:
                pid = line.split()[-1]
                break
        if not pid:
            return Check("core_rss", True, "skip (无 8300 监听)")
        tl = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=8,
            errors="replace",
        )
        cells = [c.strip('"') for c in tl.stdout.strip().split('","')]
        mem_kb = int(cells[-1].replace(",", "").replace(" K", "").replace("K", "").strip() or 0)
        rss = mem_kb / 1024
        return Check("core_rss", True, f"{rss:.0f} MB", value=round(rss, 1))  # 不告警，只记趋势
    except Exception as e:  # noqa: BLE001
        return Check("core_rss", True, f"skip ({type(e).__name__})")


async def collect(s: Settings | None = None) -> Snapshot:
    """跑一轮全栈巡检，返回快照。"""
    s = s or get_settings()
    core, llama = await asyncio.gather(
        _check_http("core", s.core_status_url),
        _check_http("llama", s.llama_models_url),
    )
    redis_alive, redis_pending = await _check_redis(s)
    napcat = _check_napcat(s, since_s=max(s.watchdog_interval_s * 4, 120))
    disk = _check_disk(s)
    rss = _core_rss_mb()
    checks = [core, llama, redis_alive, redis_pending, napcat, disk, rss]
    cost = None
    if core.ok:
        try:
            async with httpx.AsyncClient(timeout=4.0, trust_env=False) as c:
                cost = float((await c.get(s.core_status_url)).json().get("cost_today_usd", 0.0))
        except Exception:  # noqa: BLE001
            cost = None
    metrics = {
        "pending": redis_pending.value,
        "core_rss_mb": rss.value,
        "disk_free_gb": disk.value,
        "cost_today": cost,
    }
    return Snapshot(ts=datetime.now(UTC), checks=checks, metrics=metrics)


# ─────────────────────────── 告警通道 ───────────────────────────


def _toast(title: str, body: str, s: Settings) -> None:
    """桌面弹窗（best-effort，走 Win10 自带 msg.exe，非阻塞，失败静默）。"""
    if not s.watchdog_toast:
        return
    try:
        subprocess.Popen(  # noqa: S603 —— 固定命令，无注入面
            ["msg", "*", "/TIME:0", f"{title} | {body}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:  # noqa: BLE001
        pass


async def _publish_alert(message: str, level: str, s: Settings) -> None:
    """发一条 safety.alert 到总线（网页/桥可订阅转达）。Redis 不可达则静默。"""
    try:
        from astr.bus.core import Bus
        from astr.contracts.events import AuthContext, Event, EventType

        bus = Bus.from_url(s.redis_url)
        try:
            await bus.publish(
                Event(
                    source="ops.watchdog",
                    type=EventType.SAFETY_ALERT,
                    payload={"level": level, "message": message, "context": {}},
                    auth=AuthContext(astr_user_id="system", level=2),
                    trace_id="trc_watchdog",
                )
            )
        finally:
            await bus.r.aclose()
    except Exception:  # noqa: BLE001
        pass


def _write_alert_marker(active: dict[str, str], s: Settings) -> None:
    """有未恢复告警时写 ALERT.md，全清时删除——一眼看出'现在有没有事'。"""
    marker = s.logs_dir / "ALERT.md"
    marker.parent.mkdir(parents=True, exist_ok=True)
    if active:
        lines = [f"# ⚠ ASTR 告警（{datetime.now(UTC).isoformat(timespec='seconds')}）", ""]
        lines += [f"- **{k}**：{v}" for k, v in active.items()]
        marker.write_text("\n".join(lines) + "\n", encoding="utf-8")
    elif marker.exists():
        marker.unlink()


class AlertState:
    """好/坏跳变检测。只在状态改变时告警，避免每轮刷屏。"""

    # 纯趋势记录、不触发告警的检查（RSS 只看曲线；disk/pending 等会告警）
    INFO_ONLY = frozenset({"core_rss"})

    def __init__(self) -> None:
        self.prev_ok: dict[str, bool] = {}
        self.active: dict[str, str] = {}  # 当前未恢复的告警 name -> detail

    def diff(self, snap: Snapshot) -> tuple[list[Check], list[Check]]:
        """返回 (新坏掉的, 新恢复的)。"""
        newly_bad, newly_ok = [], []
        for c in snap.checks:
            if c.name in self.INFO_ONLY:
                continue
            was = self.prev_ok.get(c.name, True)
            if was and not c.ok:
                newly_bad.append(c)
                self.active[c.name] = c.detail
            elif not was and c.ok:
                newly_ok.append(c)
                self.active.pop(c.name, None)
            self.prev_ok[c.name] = c.ok
        return newly_bad, newly_ok


async def alert(state: AlertState, snap: Snapshot, s: Settings) -> None:
    """根据跳变发/撤告警（多通道）。"""
    bad, recovered = state.diff(snap)
    for c in bad:
        log.critical("watchdog_alert", check=c.name, detail=c.detail)
        _toast("ASTR 出问题了", f"{c.name}: {c.detail}", s)
        await _publish_alert(f"[{c.name}] {c.detail}", "critical", s)
    for c in recovered:
        log.info("watchdog_recovered", check=c.name, detail=c.detail)
        _toast("ASTR 恢复", f"{c.name}: {c.detail}", s)
        await _publish_alert(f"[{c.name}] 已恢复：{c.detail}", "info", s)
    if bad or recovered:
        _write_alert_marker(state.active, s)


# ─────────────────────────── CSV 记录 + 循环 ───────────────────────────

_CSV_COLS = [
    "ts",
    "core",
    "llama",
    "redis",
    "napcat",
    "pending",
    "core_rss_mb",
    "disk_free_gb",
    "cost_today",
]


def record(snap: Snapshot, s: Settings | None = None) -> Path:
    """把快照追加到当日浸泡 CSV，返回文件路径。"""
    s = s or get_settings()
    s.health_dir.mkdir(parents=True, exist_ok=True)
    path = s.health_dir / f"soak_{snap.ts.strftime('%Y%m%d')}.csv"
    new = not path.exists()

    def b(name: str) -> str:
        c = snap.get(name)
        return "1" if (c and c.ok) else "0"

    row = [
        snap.ts.isoformat(timespec="seconds"),
        b("core"),
        b("llama"),
        b("redis"),
        b("napcat"),
        _num(snap.metrics.get("pending")),
        _num(snap.metrics.get("core_rss_mb")),
        _num(snap.metrics.get("disk_free_gb")),
        _num(snap.metrics.get("cost_today")),
    ]
    with path.open("a", encoding="utf-8") as f:
        if new:
            f.write(",".join(_CSV_COLS) + "\n")
        f.write(",".join(row) + "\n")
    return path


def _num(v: float | None) -> str:
    return "" if v is None else str(v)


def render_table(snap: Snapshot) -> str:
    """把一轮快照渲染成对齐文本（--once 与启动横幅用）。"""
    width = max(len(c.name) for c in snap.checks)
    lines = [f"巡检 @ {snap.ts.isoformat(timespec='seconds')}"]
    for c in snap.checks:
        mark = "OK " if c.ok else "BAD"
        lines.append(f"  [{mark}] {c.name.ljust(width)}  {c.detail}")
    return "\n".join(lines)


async def run(interval_s: int | None = None, *, once: bool = False) -> int:
    """巡检循环。once=True 跑一轮打印即返回（适合浸泡开始/收尾抽查）。"""
    s = get_settings()
    interval = interval_s or s.watchdog_interval_s
    state = AlertState()
    print(f"看门狗启动（每 {interval}s 巡检；CSV→{s.health_dir}）。Ctrl+C 退出。")
    try:
        while True:
            snap = await collect(s)
            record(snap, s)
            await alert(state, snap, s)
            if once:
                print(render_table(snap))
                bad = [c for c in snap.checks if not c.ok]
                return 1 if bad else 0
            await asyncio.sleep(interval)
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\n看门狗停了。")
        return 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="astr watch", description="全栈看门狗 / 浸泡监控")
    p.add_argument("--interval", type=int, default=None, help="巡检间隔秒（默认读 settings）")
    p.add_argument("--once", action="store_true", help="只巡检一轮、打印、退出（坏=退出码1）")
    a = p.parse_args(argv)
    return asyncio.run(run(a.interval, once=a.once))


# 供 cli.py 与测试引用
__all__ = ["AlertState", "Check", "Snapshot", "alert", "collect", "main", "record", "run"]
ALERT_CALLBACK: Callable[[str], Awaitable[None]] | None = None  # 预留：P5 可挂"在线时桥回 QQ 告警"
