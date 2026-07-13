"use client";

import { useSyncExternalStore } from "react";

import type { EffectorActions } from "../controller/create-effector-controller";
import type { EffectorAudit } from "../data/effector-client";
import { auditDecisionColor } from "../model/audit-decision";
import styles from "./EffectorWorkspace.module.css";

export interface AuditLedgerProps {
  readonly audit: EffectorAudit;
  readonly selectedDate: string | null;
  readonly refreshAudit: EffectorActions["refreshAudit"];
}

const INTEGRITY_COPY = {
  complete: "链完整 · 校验通过",
  broken: "链断裂 · 证据可能被修改",
  unverified: "未提供链完整性证据",
} as const;

export function AuditLedger({
  audit,
  selectedDate,
  refreshAudit,
}: AuditLedgerProps) {
  const activeDate = selectedDate ?? audit.date ?? "";
  const dates = activeDate && !audit.dates.includes(activeDate)
    ? [activeDate, ...audit.dates]
    : audit.dates;
  const integrity = audit.chain_valid === true
    ? "complete"
    : audit.chain_valid === false
      ? "broken"
      : "unverified";

  return (
    <section
      aria-labelledby="audit-title"
      className={styles.auditLedger}
      id="audit-ledger"
      tabIndex={-1}
    >
      <header className={styles.auditHeader}>
        <div className={styles.auditTitleBlock}>
          <p className={styles.sequence}>AUDIT / VERIFIED RECORD</p>
          <h2 className={styles.sectionTitle} id="audit-title">审计丁册</h2>
          <p className={styles.integrityLine} data-integrity={integrity}>
            {INTEGRITY_COPY[integrity]}
          </p>
        </div>
        <div className={styles.auditControls}>
          <label className={styles.dateField}>
            <span className={styles.label}>审计日期</span>
            <select
              aria-label="审计日期"
              className={styles.dateSelect}
              value={activeDate}
              onChange={(event) => {
                const date = event.currentTarget.value;
                refreshAudit(date.length > 0 ? date : undefined);
              }}
            >
              {activeDate === "" && <option value="">最近可用日期</option>}
              {dates.map((date) => <option key={date} value={date}>{date}</option>)}
            </select>
          </label>
          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => refreshAudit(activeDate || undefined)}
          >
            刷新所选日期
          </button>
        </div>
      </header>

      {audit.total !== undefined && (
        <p className={styles.auditSummary}>共 {audit.total} 条</p>
      )}

      {audit.entries.length === 0 ? (
        <p className={styles.emptyAudit}>当前所选日期没有审计条目。</p>
      ) : (
        <ol className={styles.auditList}>
          {audit.entries.map((entry, index) => {
            const tone = decisionTone(entry.decision);
            return (
              <li
                key={`${entry.trace_id}:${entry.ts}:${index}`}
                className={styles.auditEntry}
                data-dangerous={entry.dangerous}
                data-decision={tone}
              >
                <div className={styles.entryHeader}>
                  <span className={styles.entryDecision}>决策：{entry.decision}</span>
                  <LocalizedAuditTime value={entry.ts} />
                </div>
                <p className={styles.entryDescription}>{entry.description}</p>
                <dl className={styles.entryFacts}>
                  <div>
                    <dt>轨道</dt>
                    <dd>轨道：{entry.track}</dd>
                  </div>
                  <div>
                    <dt>危险</dt>
                    <dd>危险：{entry.dangerous ? "是" : "否"}</dd>
                  </div>
                  <div className={styles.traceFact}>
                    <dt>Trace ID</dt>
                    <dd>{entry.trace_id}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const subscribeToLocale = () => () => undefined;

function LocalizedAuditTime({ value }: { readonly value: string }) {
  const localized = useSyncExternalStore(
    subscribeToLocale,
    () => formatAuditTimestamp(value),
    () => value,
  );
  return <time dateTime={value}>{localized}</time>;
}

function decisionTone(decision: string): "action" | "warning" | "danger" | "silver" {
  const color = auditDecisionColor(decision.trim().toLowerCase());
  if (color === "var(--astr-danger)") return "danger";
  if (color === "var(--astr-warning)") return "warning";
  if (color === "var(--astr-action)") return "action";
  return "silver";
}

function formatAuditTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(date);
}
