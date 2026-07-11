"use client";

import { useId, useMemo } from "react";

import {
  formatUtcTimestamp,
  projectLifeEvents,
  type LifeSummary,
} from "@/features/presence/model/life-events";
import type { StreamState } from "@/lib/semantic-state";
import type { AstrEvent } from "@/lib/types";

import styles from "./PresenceTimelines.module.css";

const COLLAPSED_SUMMARY_COUNT = 3;

export interface LifeRegionProps {
  readonly events: readonly AstrEvent[];
  readonly activity?: string;
  readonly streamState: StreamState;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}

export function LifeRegion({
  events,
  activity,
  streamState,
  expanded,
  onExpandedChange,
}: LifeRegionProps) {
  const headingId = useId();
  const panelId = useId();
  const projection = useMemo(() => projectLifeEvents(events, activity), [activity, events]);
  const visibleSummaries = expanded
    ? projection.summaries
    : projection.summaries.slice(-COLLAPSED_SUMMARY_COUNT);

  return (
    <section aria-labelledby={headingId} className={styles.lifeRegion}>
      <header className={styles.lifeHeader}>
        <div>
          <p className={styles.regionKicker}>PRESENCE · LIFE</p>
          <h2 className={styles.lifeTitle} id={headingId}>
            生活记录
          </h2>
        </div>
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={expanded ? "收起生活记录" : "展开生活记录"}
          className={styles.lifeToggle}
          onClick={() => onExpandedChange(!expanded)}
          type="button"
        >
          <span aria-hidden>{expanded ? "−" : "+"}</span>
        </button>
      </header>

      <p className={styles.connectionCopy} data-life-stream-state={streamState}>
        {connectionCopy(streamState, projection.summaries.length)}
      </p>

      <div className={styles.lifePanel} data-expanded={expanded ? "true" : "false"} id={panelId}>
        {projection.currentActivity ? (
          <div className={styles.activityBlock}>
            <span className={styles.activityLabel}>当前生活状态</span>
            <p className={styles.activityText}>{projection.currentActivity.text}</p>
            <span className={styles.activityMeta}>
              来源 {projection.currentActivity.source} · 时间未提供
            </span>
          </div>
        ) : (
          <p className={styles.activityMeta}>Core 未提供当前生活状态。</p>
        )}

        <ul aria-label="生活与处理摘要" className={styles.lifeList}>
          {visibleSummaries.map((summary) => (
            <LifeSummaryItem key={summary.id} summary={summary} />
          ))}
        </ul>

        {projection.malformedCount > 0 && (
          <p className={styles.diagnosticCopy}>
            有 {projection.malformedCount} 条受支持事件因内容不可读而未显示。
          </p>
        )}
      </div>
    </section>
  );
}

function LifeSummaryItem({ summary }: { readonly summary: LifeSummary }) {
  const timestamp = summary.occurredAt
    ? formatUtcTimestamp(summary.occurredAt)
    : null;
  return (
    <li className={styles.lifeItem} data-event-id={summary.id}>
      <div className={styles.lifeItemHeader}>
        <span className={styles.summaryLabel}>{summary.label}</span>
        <span className={styles.meta}>
          {summary.source}
          {timestamp ? (
            <>
              {" · "}
              <time dateTime={timestamp.dateTime}>{timestamp.label}</time>
            </>
          ) : (
            " · 时间未提供"
          )}
        </span>
      </div>
      <p className={styles.summaryText}>{summary.text}</p>
    </li>
  );
}

function connectionCopy(state: StreamState, summaryCount: number): string {
  if (state === "connecting") return "正在连接生活记录。";
  if (state === "retrying") {
    return "生活记录连接中断，正在重连；断线期间内容可能不完整。";
  }
  if (state === "closed") return "生活记录未连接。";
  return summaryCount === 0
    ? "连接已建立；暂无 Core 提供的处理片段或生活记录。"
    : "生活记录连接已建立。";
}
