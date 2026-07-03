"use client";

// 后台控制台种子（07 §3.2）：第一张卡 = 执行层 Effector。
// 铁律可视化：危险类别/底线关键词带锁标识，UI 上就删不掉（服务端 enforce_floor 双保险）。
// 文件为真身：这里改的旋钮由 Core 写进 guard_policy.local.yaml 覆盖层并热重载。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { Panel } from "@/components/astr/Panel";
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

/** 三档分段开关 */
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
    <div className="flex overflow-hidden rounded-xl border border-hairline">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
            value === o.key ? "bg-accent text-ink" : "text-ink-2 hover:bg-surface-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 词条列表编辑器：加号输入 + 可删 chip；locked 集合内的带锁不可删。 */
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
              title={isLocked ? "底线项：任何档位不可移除（铁律）" : undefined}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs ${
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
                  className="text-ink-3 hover:text-danger"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
        {items.length === 0 && <span className="text-xs text-ink-3">（空 = 全部拒绝）</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label="添加"
          onClick={add}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-hairline text-ink-2 hover:bg-surface-2"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
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
    <div className="flex h-screen flex-col gap-3 p-3">
      {/* 顶栏 */}
      <header className="flex items-center justify-between rounded-2xl border border-hairline bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-ink-2 transition-colors hover:text-ink"
          >
            <ArrowLeft size={14} /> 驾驶舱
          </Link>
          <span className="text-sm font-semibold text-ink">ASTR 后台 · 控制台</span>
          {offline && <span className="text-xs text-danger">Core 离线（只读缓存不可用）</span>}
          {saving && <span className="text-xs text-ink-3">保存中…</span>}
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleEstop}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              estopped
                ? "animate-pulse border-danger bg-danger/20 text-danger"
                : "border-hairline text-danger/70 hover:bg-surface-2"
            }`}
          >
            <OctagonX size={14} />
            {estopped ? "急停已触发 · 点击复位" : "急停"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[200px_1fr_1fr]">
        {/* 模块导航：种子期只有执行层可用，其余随 Phase 生长（07 §5） */}
        <Panel className="hidden lg:flex">
          <nav className="flex flex-col gap-1 text-sm">
            <span className="rounded-lg bg-surface-2 px-3 py-1.5 font-medium text-ink">
              执行层 Effector
            </span>
            {[
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
            ].map(([name, phase]) => (
              <span
                key={name}
                className="flex items-center justify-between px-3 py-1.5 text-ink-3"
                title={`${phase} 落地`}
              >
                {name}
                <span className="text-[10px]">{phase}</span>
              </span>
            ))}
          </nav>
        </Panel>

        {/* 执行层设置卡 */}
        <Panel title="执行层 · 护栏策略" className="min-h-0">
          {!policy ? (
            <p className="text-sm text-ink-3">{offline ? "Core 离线。" : "加载中…"}</p>
          ) : (
            <div className="flex flex-col gap-5 text-sm">
              <section>
                <h3 className="mb-1.5 font-medium text-ink">审批三档</h3>
                <Segmented
                  value={policy.approval_mode}
                  options={[
                    { key: "ask", label: "请求 ask" },
                    { key: "audited", label: "自审核 audited" },
                    { key: "auto", label: "全自动 auto" },
                  ]}
                  onChange={(v) => patch({ approval_mode: v })}
                  disabled={saving}
                />
                <p className="mt-1 text-xs text-ink-3">{APPROVAL_DESC[policy.approval_mode]}</p>
                <p className="mt-1 text-xs text-danger/80">
                  铁律：危险动作在任何档位都需二次确认，永不豁免。
                </p>
              </section>

              <section>
                <h3 className="mb-1.5 font-medium text-ink">headless 范围三档</h3>
                <Segmented
                  value={policy.headless_scope}
                  options={[
                    { key: "cwd", label: "当前文件夹" },
                    { key: "folders", label: "白名单目录" },
                    { key: "full", label: "全电脑" },
                  ]}
                  onChange={(v) => patch({ headless_scope: v })}
                  disabled={saving}
                />
                <p className="mt-1 text-xs text-ink-3">
                  {SCOPE_DESC[policy.headless_scope]} · 当前文件夹：{policy.headless_cwd}
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
                <h3 className="mb-1.5 font-medium text-ink">应用白名单（视觉轨）</h3>
                <ChipEditor
                  items={policy.app_whitelist}
                  placeholder="加一个进程名，如 explorer.exe"
                  onAdd={(v) => patch({ app_whitelist: [...policy.app_whitelist, v] })}
                  onRemove={(v) => patch({ app_whitelist: policy.app_whitelist.filter((x) => x !== v) })}
                />
              </section>

              <section>
                <h3 className="mb-1.5 font-medium text-ink">登录态站点白名单</h3>
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

              <section>
                <h3 className="mb-1.5 font-medium text-ink">危险动作类别（L3 二次确认）</h3>
                <ChipEditor
                  items={policy.dangerous_categories}
                  locked={policy.core_dangerous_categories}
                  labelMap={CATEGORY_LABEL}
                  placeholder="加自定义类别"
                  onAdd={(v) => patch({ dangerous_categories: [...policy.dangerous_categories, v] })}
                  onRemove={(v) =>
                    patch({
                      dangerous_categories: policy.dangerous_categories.filter((x) => x !== v),
                    })
                  }
                />
              </section>

              <section>
                <h3 className="mb-1.5 font-medium text-ink">危险关键词黑名单</h3>
                <ChipEditor
                  items={policy.dangerous_keywords}
                  locked={policy.core_dangerous_keywords}
                  placeholder="加一个关键词"
                  onAdd={(v) => patch({ dangerous_keywords: [...policy.dangerous_keywords, v] })}
                  onRemove={(v) =>
                    patch({ dangerous_keywords: policy.dangerous_keywords.filter((x) => x !== v) })
                  }
                />
              </section>

              <section className="text-xs text-ink-3">
                <p>CU 单任务步数上限：{policy.max_steps_per_task} · 沙箱：{policy.sandbox_dir}</p>
                <p className="mt-1">写回落点（文件为真身）：{policy.overlay_path}</p>
              </section>
            </div>
          )}
        </Panel>

        {/* 审计日志（hash 链） */}
        <Panel
          title="审计日志 · hash 链"
          className="min-h-0"
          right={
            audit && (
              <div className="flex items-center gap-2">
                {audit.chain_valid !== null &&
                  (audit.chain_valid ? (
                    <span className="flex items-center gap-1 text-xs text-ink-2">
                      <ShieldCheck size={13} className="text-accent" /> 链完整
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-danger">
                      <ShieldX size={13} /> 链断裂——日志被篡改过！
                    </span>
                  ))}
                <select
                  value={audit.date ?? ""}
                  onChange={(e) => loadAll(e.target.value)}
                  className="rounded-lg border border-hairline bg-surface px-1.5 py-0.5 text-xs text-ink-2"
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
                  className="text-ink-3 hover:text-ink"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            )
          }
        >
          {!audit || audit.entries.length === 0 ? (
            <p className="text-sm text-ink-3">还没有审计记录——她动手后每一步都会落在这里。</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...audit.entries].reverse().map((e, i) => (
                <li
                  key={`${e.ts}-${i}`}
                  className="rounded-xl border border-hairline px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          e.decision === "deny"
                            ? "bg-danger/15 text-danger"
                            : e.decision === "confirm"
                              ? "bg-surface-2 text-ink-2"
                              : "bg-accent/15 text-ink-2"
                        }`}
                      >
                        {e.decision}
                      </span>
                      <span className="text-ink-3">{e.track}</span>
                      {e.dangerous && <span className="text-danger">危险类</span>}
                    </span>
                    <span className="shrink-0 text-ink-3">
                      {new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false })}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-ink-2">{e.description}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </div>
  );
}
