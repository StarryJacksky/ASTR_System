"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { MobileChannelSnapshot } from "./create-mobile-safety-controller";
import styles from "./MobileLocalSafetyDomain.module.css";
import type {
  MobileLocalAuditProjection,
  MobileLocalPolicyProjection,
  MobileLocalStatusProjection,
} from "./mobile-safety-types";
import {
  mobileSafetyControllerOwner,
  useMobileSafetyController,
  type MobileSafetyControllerOwner,
} from "./use-mobile-safety-controller";

const PHASE_COPY = Object.freeze({
  idle: "尚未读取",
  loading: "读取中",
  ready: "已验证",
  refreshing: "刷新中 · 保留最近已验证值",
  stale: "可能陈旧",
  error: "读取失败",
} satisfies Readonly<Record<MobileChannelSnapshot<unknown>["phase"], string>>);

const APPROVAL_COPY: Readonly<
  Record<MobileLocalPolicyProjection["approval_mode"], string>
> = Object.freeze({
  ask: "每次请求确认",
  audited: "按审计策略执行",
  auto: "在策略边界内自动执行",
});

const SCOPE_COPY: Readonly<
  Record<MobileLocalPolicyProjection["headless_scope"], string>
> = Object.freeze({
  cwd: "当前目录",
  folders: "白名单目录",
  full: "全电脑",
});

export interface TrustedMobileLocalSafetyDomainProps {
  readonly owner?: MobileSafetyControllerOwner;
}

export function TrustedMobileLocalSafetyDomain({
  owner = mobileSafetyControllerOwner,
}: TrustedMobileLocalSafetyDomainProps): ReactNode {
  const { snapshot, actions } = useMobileSafetyController(owner);

  return (
    <div className={styles.trusted}>
      <header className={styles.trustedHeader}>
        <p className={styles.coordinate}>LOOPBACK / GET-ONLY</p>
        <h2>当前 Web 主机 · 本机可信入口</h2>
        <p className={styles.trustedNote}>
          三条读取通道各自保留最近一次可验证事实；这里不开放执行或策略写入。
        </p>
      </header>

      <section
        aria-label="本机安全只读证据"
        className={styles.evidenceSurface}
      >
        <div className={styles.surfaceLegend}>
          <span>LOCAL EVIDENCE</span>
          <span>03 READ CHANNELS</span>
        </div>

        <div className={styles.channelGrid}>
          <ChannelSection
            className={`${styles.channel} ${styles.statusChannel}`}
            heading={<h3>执行状态</h3>}
            refreshLabel="重新读取状态"
            retryLabel="重试读取状态"
            snapshot={snapshot.status}
            onRefresh={actions.refreshStatus}
          >
            {(value) => <StatusEvidence value={value} />}
          </ChannelSection>

          <ChannelSection
            className={`${styles.channel} ${styles.policyChannel}`}
            heading={<h3>执行策略</h3>}
            refreshLabel="重新读取策略"
            retryLabel="重试读取策略"
            snapshot={snapshot.policy}
            onRefresh={actions.refreshPolicy}
          >
            {(value) => <PolicyEvidence value={value} />}
          </ChannelSection>

          <ChannelSection
            className={`${styles.channel} ${styles.auditChannel}`}
            heading={<h3>审计证据</h3>}
            refreshLabel="重新读取审计"
            retryLabel="重试读取审计"
            snapshot={snapshot.audit}
            onRefresh={actions.refreshAudit}
          >
            {(value) => <AuditEvidence value={value} />}
          </ChannelSection>
        </div>

        <div className={styles.controlRail}>
          <Link href="/admin/effector" prefetch={false}>
            在 Control 查看本机安全控制
          </Link>
        </div>
      </section>
    </div>
  );
}

function ChannelSection<T>({
  className,
  heading,
  refreshLabel,
  retryLabel,
  snapshot,
  onRefresh,
  children,
}: {
  readonly className: string;
  readonly heading: ReactNode;
  readonly refreshLabel: string;
  readonly retryLabel: string;
  readonly snapshot: MobileChannelSnapshot<T>;
  readonly onRefresh: () => void;
  readonly children: (value: T | null) => ReactNode;
}): ReactNode {
  const actionLabel =
    snapshot.phase === "ready"
      ? refreshLabel
      : snapshot.phase === "stale" || snapshot.phase === "error"
        ? retryLabel
        : null;

  return (
    <section className={className}>
      <header className={styles.channelHeader}>
        <div>
          {heading}
          <p className={styles.phase}>{PHASE_COPY[snapshot.phase]}</p>
        </div>
        {actionLabel ? (
          <button className={styles.action} onClick={onRefresh} type="button">
            {actionLabel}
          </button>
        ) : null}
      </header>

      <div className={styles.channelValue}>{children(snapshot.value)}</div>
      {snapshot.error ? (
        <p className={styles.channelError}>{snapshot.error}</p>
      ) : null}
      {snapshot.verified_at ? (
        <time
          className={styles.verifiedAt}
          dateTime={snapshot.verified_at}
        >
          已验证于：{snapshot.verified_at}
        </time>
      ) : null}
    </section>
  );
}

function StatusEvidence({
  value,
}: {
  readonly value: MobileLocalStatusProjection | null;
}): ReactNode {
  if (value === null) {
    return <p className={styles.primaryEvidence}>停止状态：未知</p>;
  }
  return (
    <>
      <p className={styles.primaryEvidence}>
        {value.stopped ? "本机执行层已闩锁" : "停止状态：未闩锁"}
      </p>
      <dl className={styles.compactFacts}>
        <div>
          <dt>待处理</dt>
          <dd>待处理：{value.pending_count}</dd>
        </div>
        <div>
          <dt>审计尾部</dt>
          <dd>审计尾部：{value.audit_tail_count}</dd>
        </div>
      </dl>
    </>
  );
}

function PolicyEvidence({
  value,
}: {
  readonly value: MobileLocalPolicyProjection | null;
}): ReactNode {
  if (value === null) return null;
  return (
    <dl className={styles.evidenceList}>
      <div>
        <dt>确认方式</dt>
        <dd>确认方式：{APPROVAL_COPY[value.approval_mode]}</dd>
      </div>
      <div>
        <dt>作用范围</dt>
        <dd>作用范围：{SCOPE_COPY[value.headless_scope]}</dd>
      </div>
      <div>
        <dt>最大步骤</dt>
        <dd>最大步骤：{value.max_steps_per_task}</dd>
      </div>
    </dl>
  );
}

function AuditEvidence({
  value,
}: {
  readonly value: MobileLocalAuditProjection | null;
}): ReactNode {
  if (value === null) return null;
  const chainCopy =
    value.chain_valid === true
      ? "当前审计文件 hash 链校验通过"
      : value.chain_valid === false
        ? "链校验失败"
        : "未提供链完整性证据";
  return (
    <dl className={styles.evidenceList}>
      <div>
        <dt>审计日期</dt>
        <dd>审计日期：{value.audit_date ?? "未提供"}</dd>
      </div>
      <div>
        <dt>审计总数</dt>
        <dd>审计总数：{value.audit_total ?? "未提供"}</dd>
      </div>
      <div>
        <dt>链完整性</dt>
        <dd>{chainCopy}</dd>
      </div>
    </dl>
  );
}
