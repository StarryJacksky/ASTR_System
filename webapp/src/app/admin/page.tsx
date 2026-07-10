"use client";

// 引擎室（04 v3.0 下甲板蓝图）：观测台的机舱。
// 她住在上甲板的星空下；这里是甲板之下——没有天空，有图纸。
// 三个舱区：00 甲板索引 / 01 护栏 / 02 安全底线 / 03 审计链（航行日志）。
// 铁律可视化：底线项带锁、任何档位删不掉（服务端 enforce_floor 双保险）；
// 审计链画成一条看得见的锁链——每一环是她的一个动作，链完整 = 封印完好。
// 文件为真身：这里改的旋钮由 Core 写进 guard_policy.local.yaml 覆盖层并热重载。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Lock,
  OctagonX,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { focusEnter, staggerList } from "@/lib/motion";
import { ThemeToggle } from "@/components/astr/ThemeToggle";

const CORE = "/api/core";

type Policy = {
  approval_mode: "ask" | "audited" | "auto";
  headless_scope: "cwd" | "folders" | "full";
  headless_cwd: string;
  headless_folders: string[];
  app_whitelist: string[];
  login_sites_whitelist: string[];
  dangerous_categories: string[];
  dangerous_keywords: string[];
  max_steps_per_task: number;
  sandbox_dir: string;
  core_dangerous_categories: string[];
  core_dangerous_keywords: string[];
  overlay_path: string;
  error?: string;
};

type AuditEntry = {
  ts: string;
  trace_id: string;
  track: string;
  description: string;
  decision: string;
  dangerous: boolean;
};

type Audit = {
  dates: string[];
  date: string | null;
  entries: AuditEntry[];
  total?: number;
  chain_valid: boolean | null;
};

const APPROVAL_DESC: Record<Policy["approval_mode"], string> = {
  ask: "请求档：每个动作先问你",
  audited: "自审核档：白名单内自动执行 + 全审计，名单外仍问",
  auto: "全自动档：白名单内免问，名单外直接拒",
};

const SCOPE_DESC: Record<Policy["headless_scope"], string> = {
  cwd: "只许动“当前文件夹”（默认最安全）",
  folders: "只许动下方白名单目录",
  full: "全电脑（慎开）",
};

const CATEGORY_LABEL: Record<string, string> = {
  file_delete: "删除/覆盖",
  send_message: "发消息",
  send_email: "发邮件",
  payment: "付款/转账",
  install_uninstall: "装/卸软件",
  system_settings: "改系统设置",
  credential_access: "读凭据",
  external_upload: "外发数据",
};

/** 舱区标题（04 v4.0 天干工册）：上甲板记「卷」（生活的书），炉房记「天干」（工作的册）。
 *  甲乙丙丁——账簿分册的老传统，比 00/01/02 更像这艘舰自己的目录学。 */
function ZoneHead({ num, en, zh }: { num: string; en: string; zh: string }) {
  return (
    <div className="relative shrink-0">
      <span aria-hidden className="astr-ghost-num astr-ghost-num--sm">
        {num}
      </span>
      <div className="astr-label relative pb-4">
        {num} · {zh} — {en}
      </div>
    </div>
  );
}

/** 档位开关：黄铜仪器开关——mono 大写、hairline 框、选中档琥珀通电。 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-hairline">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
            i > 0 ? "border-l border-hairline" : ""
          } ${
            value === o.key
              ? "bg-accent font-medium text-on-accent"
              : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 词条编辑器：仪器铭条——mono 方角贴片；锁定项 = 底线，红章带锁不可删。 */
function ChipEditor({
  items,
  locked = [],
  labelMap = {},
  placeholder,
  onAdd,
  onRemove,
}: {
  items: string[];
  locked?: string[];
  labelMap?: Record<string, string>;
  placeholder: string;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onAdd(v);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => {
          const isLocked = locked.includes(it);
          return (
            <span
              key={it}
              title={isLocked ? "底线项：任何档位不可移除（铁律，只增不减）" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-xs ${
                isLocked ? "border-danger/40 text-danger" : "border-hairline text-ink-2"
              }`}
            >
              {isLocked && <Lock size={10} />}
              {labelMap[it] ?? it}
              {!isLocked && (
                <button
                  type="button"
                  aria-label={`移除 ${it}`}
                  onClick={() => onRemove(it)}
                  className="text-ink-3 transition-colors hover:text-danger"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
        {items.length === 0 && <span className="text-xs text-ink-3">（空 = 全部拒绝）</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5 border-b border-hairline pb-1">
        <span aria-hidden className="font-mono text-xs text-ink-3">
          +
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent py-1 text-xs text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label="添加"
          onClick={add}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-hairline text-ink-2 transition-colors hover:bg-surface-2"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

/** 甲板索引（00）：现役舱室琥珀通电，未来舱室灰显带 Phase 章——蓝图上的预留舱位。 */
const DECKS: [string, string][] = [
  ["概览 Dashboard", "P6"],
  ["平台/网关", "P6"],
  ["模型/路由", "P6"],
  ["插件市场", "P6"],
  ["灵魂 Soul", "P6"],
  ["记忆 Memory", "P6"],
  ["智囊团/教学", "P3"],
  ["训练飞轮", "P4"],
  ["声纹/语音", "P5"],
  ["传承/迁移", "P5"],
];

/** 审计链节点色：deny=红（拦下）/ confirm=琥珀（等你点头）/ 其余=绿（放行）。 */
function decisionColor(decision: string): string {
  if (decision === "deny") return "var(--astr-danger)";
  if (decision === "confirm") return "var(--astr-accent)";
  return "var(--astr-success)";
}

export default function AdminConsole() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [estopped, setEstopped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const loadAll = useCallback(async (date?: string) => {
    try {
      const [p, a, s] = await Promise.all([
        fetch(`${CORE}/v1/admin/effector/policy`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${CORE}/v1/admin/effector/audit${date ? `?date=${date}` : ""}`, {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch(`${CORE}/v1/effector/status`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setPolicy(p);
      setAudit(a);
      setEstopped(Boolean(s.stopped));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 改一个旋钮 = 发一次 PUT，Core 写覆盖层 + Guard 热重载，返回新有效策略。
  const patch = async (update: Record<string, unknown>) => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`${CORE}/v1/admin/effector/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const data = (await r.json()) as Policy;
      if (data.error) setErr(data.error);
      else setPolicy(data);
    } catch {
      setErr("Core 离线，改动未保存");
    } finally {
      setSaving(false);
    }
  };

  const toggleEstop = async () => {
    const path = estopped ? "/v1/effector/estop/reset" : "/v1/effector/estop";
    try {
      await fetch(`${CORE}${path}`, { method: "POST" });
      setEstopped((v) => !v);
    } catch {
      /* Core 离线 */
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* 图纸网格：引擎室在甲板之下——没有天空，有蓝图（v3.0 下甲板环境） */}
      <div aria-hidden className="astr-blueprint" />

      {/* 顶部仪器条：与上甲板同语法——无盒，一条刻线 */}
      <header className="relative flex items-center justify-between border-b border-hairline px-8 py-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 self-center font-mono text-xs text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft size={13} /> 驾驶舱
          </Link>
          <span className="astr-wordmark text-2xl text-ink">炉房</span>
          <span className="astr-label">FURNACE ROOM — 守夜之下</span>
        </div>
        <div className="flex items-center gap-3">
          {offline && <span className="font-mono text-xs text-danger">CORE 离线</span>}
          {saving && <span className="font-mono text-xs text-ink-3">写入覆盖层…</span>}
          {err && <span className="font-mono text-xs text-danger">{err}</span>}
          <button
            type="button"
            onClick={toggleEstop}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] transition-colors ${
              estopped
                ? "animate-pulse border-danger bg-danger/20 text-danger"
                : "border-danger/40 text-danger/80 hover:bg-surface-2 hover:text-danger"
            }`}
          >
            <OctagonX size={14} />
            {estopped ? "已急停 · 复位" : "急停"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <motion.main
        variants={staggerList}
        initial="hidden"
        animate="show"
        className="relative grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[230px_minmax(0,1.05fr)_minmax(0,1fr)] lg:overflow-hidden"
      >
        {/* 00 / INDEX — 甲板索引 */}
        <motion.nav
          variants={focusEnter}
          className="hidden min-h-0 flex-col overflow-y-auto px-6 pt-6 lg:flex"
        >
          <ZoneHead num="甲" en="INDEX" zh="舱单" />
          <div className="flex flex-col">
            <span className="flex items-center justify-between border-l-2 border-[var(--astr-accent)] py-2 pl-3 pr-2 font-mono text-xs uppercase tracking-[0.12em] text-ink">
              执行层 Effector
              <span className="text-accent">●</span>
            </span>
            {DECKS.map(([name, phase]) => (
              <span
                key={name}
                title={`${phase} 落地——蓝图已预留舱位（04 §图纸）`}
                className="flex items-center justify-between border-l-2 border-transparent py-2 pl-3 pr-2 font-mono text-xs tracking-[0.08em] text-ink-3"
              >
                {name}
                <span className="rounded-sm border border-hairline px-1 text-[10px]">{phase}</span>
              </span>
            ))}
          </div>
        </motion.nav>

        {/* 01 / GUARD — 护栏 + 02 / FLOOR — 安全底线 */}
        <motion.section
          variants={focusEnter}
          className="min-h-0 overflow-y-auto border-t border-hairline px-8 pt-6 lg:border-l lg:border-t-0"
        >
          <ZoneHead num="乙" en="GUARD" zh="护栏" />
          {!policy ? (
            <p className="text-sm text-ink-3">{offline ? "Core 离线。" : "加载中…"}</p>
          ) : (
            <div className="flex flex-col gap-7 pb-8 text-sm">
              <section>
                <h3 className="astr-label mb-2">AUTONOMY — 审批三档</h3>
                <Segmented
                  value={policy.approval_mode}
                  options={[
                    { key: "ask", label: "请求" },
                    { key: "audited", label: "自审核" },
                    { key: "auto", label: "全自动" },
                  ]}
                  onChange={(v) => patch({ approval_mode: v })}
                  disabled={saving}
                />
                <p className="mt-2 text-xs text-ink-3">{APPROVAL_DESC[policy.approval_mode]}</p>
                <p className="mt-1 text-xs text-danger/80">
                  铁律：危险动作在任何档位都需二次确认，永不豁免。
                </p>
              </section>

              <section>
                <h3 className="astr-label mb-2">SCOPE — 无头轨范围</h3>
                <Segmented
                  value={policy.headless_scope}
                  options={[
                    { key: "cwd", label: "当前夹" },
                    { key: "folders", label: "白名单" },
                    { key: "full", label: "全电脑" },
                  ]}
                  onChange={(v) => patch({ headless_scope: v })}
                  disabled={saving}
                />
                <p className="mt-2 text-xs text-ink-3">
                  {SCOPE_DESC[policy.headless_scope]} ·{" "}
                  <span className="font-mono">{policy.headless_cwd}</span>
                </p>
                {policy.headless_scope === "folders" && (
                  <div className="mt-2">
                    <ChipEditor
                      items={policy.headless_folders}
                      placeholder="加一个目录，如 D:/ASTR/ops"
                      onAdd={(v) => patch({ headless_folders: [...policy.headless_folders, v] })}
                      onRemove={(v) =>
                        patch({
                          headless_folders: policy.headless_folders.filter((x) => x !== v),
                        })
                      }
                    />
                  </div>
                )}
              </section>

              <section>
                <h3 className="astr-label mb-2">APPS — 应用白名单（视觉轨）</h3>
                <ChipEditor
                  items={policy.app_whitelist}
                  placeholder="加一个进程名，如 explorer.exe"
                  onAdd={(v) => patch({ app_whitelist: [...policy.app_whitelist, v] })}
                  onRemove={(v) =>
                    patch({ app_whitelist: policy.app_whitelist.filter((x) => x !== v) })
                  }
                />
              </section>

              <section>
                <h3 className="astr-label mb-2">SITES — 登录态站点白名单</h3>
                <ChipEditor
                  items={policy.login_sites_whitelist}
                  placeholder="加一个域名，如 arxiv.org"
                  onAdd={(v) =>
                    patch({ login_sites_whitelist: [...policy.login_sites_whitelist, v] })
                  }
                  onRemove={(v) =>
                    patch({
                      login_sites_whitelist: policy.login_sites_whitelist.filter((x) => x !== v),
                    })
                  }
                />
              </section>

              {/* 02 / FLOOR：底线舱——红刻线封舱，只增不减 */}
              <section className="relative rounded-md border border-danger/25 p-4">
                <ZoneHead num="丙" en="FLOOR" zh="底线 · 只增不减" />
                <div className="flex flex-col gap-5">
                  <div>
                    <h3 className="astr-label mb-2">危险动作类别（L3 二次确认）</h3>
                    <ChipEditor
                      items={policy.dangerous_categories}
                      locked={policy.core_dangerous_categories}
                      labelMap={CATEGORY_LABEL}
                      placeholder="加自定义类别"
                      onAdd={(v) =>
                        patch({ dangerous_categories: [...policy.dangerous_categories, v] })
                      }
                      onRemove={(v) =>
                        patch({
                          dangerous_categories: policy.dangerous_categories.filter(
                            (x) => x !== v,
                          ),
                        })
                      }
                    />
                  </div>
                  <div>
                    <h3 className="astr-label mb-2">危险关键词黑名单</h3>
                    <ChipEditor
                      items={policy.dangerous_keywords}
                      locked={policy.core_dangerous_keywords}
                      placeholder="加一个关键词"
                      onAdd={(v) =>
                        patch({ dangerous_keywords: [...policy.dangerous_keywords, v] })
                      }
                      onRemove={(v) =>
                        patch({
                          dangerous_keywords: policy.dangerous_keywords.filter((x) => x !== v),
                        })
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="font-mono text-xs leading-relaxed text-ink-3">
                <p>
                  CU 步数上限 <span className="text-ink-2">{policy.max_steps_per_task}</span> · 沙箱{" "}
                  <span className="text-ink-2">{policy.sandbox_dir}</span>
                </p>
                <p className="mt-1">
                  写回落点（文件为真身）：<span className="text-ink-2">{policy.overlay_path}</span>
                </p>
              </section>
            </div>
          )}
        </motion.section>

        {/* 03 / LEDGER — 审计链（航行日志） */}
        <motion.section
          variants={focusEnter}
          className="flex min-h-0 flex-col overflow-hidden border-t border-hairline px-8 pt-6 lg:border-l lg:border-t-0"
        >
          <div className="flex shrink-0 items-start justify-between gap-2">
            <ZoneHead num="丁" en="LEDGER" zh="审计链" />
            {audit && (
              <div className="flex items-center gap-2 pt-0.5">
                <select
                  value={audit.date ?? ""}
                  onChange={(e) => loadAll(e.target.value)}
                  aria-label="选择日期"
                  className="rounded-sm border border-hairline bg-transparent px-1.5 py-0.5 font-mono text-xs text-ink-2"
                >
                  {audit.dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="刷新"
                  onClick={() => loadAll(audit.date ?? undefined)}
                  className="text-ink-3 transition-colors hover:text-ink"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            )}
          </div>

          {/* 封印徽记：链完整与否，一眼定罪 */}
          {audit && audit.chain_valid !== null && (
            <div
              className={`mb-4 flex shrink-0 items-center gap-2 border-l-2 py-1.5 pl-3 font-mono text-xs uppercase tracking-[0.14em] ${
                audit.chain_valid
                  ? "border-[var(--astr-success)] text-ink-2"
                  : "border-[var(--astr-danger)] text-danger"
              }`}
            >
              {audit.chain_valid ? (
                <>
                  <ShieldCheck size={13} className="text-success" /> SEAL INTACT — 链完整
                  {audit.total != null && (
                    <span className="tabular normal-case tracking-normal text-ink-3">
                      · {audit.total} 环
                    </span>
                  )}
                </>
              ) : (
                <>
                  <ShieldX size={13} /> SEAL BROKEN — 链断裂，日志被篡改过！
                </>
              )}
            </div>
          )}

          {!audit || audit.entries.length === 0 ? (
            <p className="text-sm text-ink-3">还没有航行记录——她动手后每一步都会落成一环。</p>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-y-auto pb-8 pr-2">
              {/* 链身：一条纵贯的刻线，每环挂一个动作 */}
              <div
                aria-hidden
                className="absolute bottom-0 left-[5px] top-1 w-px"
                style={{ background: "var(--astr-hairline-strong)" }}
              />
              <ul className="flex flex-col gap-4">
                {[...audit.entries].reverse().map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="group relative pl-6">
                    <span
                      aria-hidden
                      className="absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2"
                      style={{
                        borderColor: decisionColor(e.decision),
                        background: "var(--astr-bg)",
                      }}
                    />
                    <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                      <span className="flex items-center gap-2">
                        <span
                          className="uppercase tracking-[0.12em]"
                          style={{ color: decisionColor(e.decision) }}
                        >
                          {e.decision}
                        </span>
                        <span className="text-ink-3">{e.track}</span>
                        {e.dangerous && (
                          <span className="flex items-center gap-0.5 text-danger">
                            <Lock size={9} /> 危险类
                          </span>
                        )}
                        {/* micro-wonder「证物签」：悬停一环，浮出它的链上编号 */}
                        {e.trace_id && (
                          <span className="text-ink-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            #{e.trace_id.slice(0, 8)}
                          </span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-ink-3">
                        {new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false })}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-xs leading-relaxed text-ink-2">
                      {e.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.section>
      </motion.main>
    </div>
  );
}
