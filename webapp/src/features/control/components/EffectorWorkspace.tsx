"use client";

import { createEffectorClient } from "../data/effector-client";
import { useEffectorController } from "../controller/use-effector-controller";
import type { ControlModule } from "../model/control-modules";
import shellStyles from "./ControlShell.module.css";
import { AuditLedger } from "./AuditLedger";
import { EffectorPolicyEditor } from "./EffectorPolicyEditor";
import styles from "./EffectorWorkspace.module.css";
import { SafetyControl } from "./SafetyControl";

export interface EffectorWorkspaceProps {
  readonly module: ControlModule;
}

export function EffectorWorkspace({ module }: EffectorWorkspaceProps) {
  const { snapshot, actions } = useEffectorController(createEffectorClient());

  return (
    <article className={`${shellStyles.effectorDossier} ${styles.effectorWorkspace}`}>
      <nav aria-label="Effector 工作区跳转" className={styles.workspaceSkips}>
        <a
          className={styles.workspaceSkip}
          href="#control-form"
          onClick={() => focusWorkspaceTarget("control-form")}
        >
          跳到策略表单
        </a>
        <a
          className={styles.workspaceSkip}
          href="#audit-ledger"
          onClick={() => focusWorkspaceTarget("audit-ledger")}
        >
          跳到审计丁册
        </a>
      </nav>

      <header className={styles.moduleHeader}>
        <div className={styles.moduleIdentity}>
          <p className={styles.moduleIndex}>{module.index} · SOUL ARCHIVE</p>
          <h1 className={styles.moduleTitle}>{module.title}</h1>
          <p className={styles.moduleSubtitle}>{module.subtitle}</p>
          <p className={styles.moduleSummary}>{module.summary}</p>
        </div>
        <section
          aria-labelledby="effector-contract-title"
          className={styles.contractSource}
        >
          <p className={styles.sequence}>SOURCE / CORE</p>
          <h2 className={styles.contractHeading} id="effector-contract-title">Core 合同来源</h2>
          <ul className={styles.contractSourceList}>
            {module.contracts.map((contract) => (
              <li className={styles.contractSourceItem} key={contract}>{contract}</li>
            ))}
          </ul>
        </section>
      </header>

      {snapshot.errors.mutation && (
        <div className={styles.mutationAlert} role="alert">
          <span className={styles.sequence}>OPERATION / UNCONFIRMED</span>
          <p>{snapshot.errors.mutation}</p>
        </div>
      )}

      <div className={styles.safetyBand}>
        <SafetyControl
          evidence={snapshot.safetyEvidence}
          mutation={snapshot.safetyMutation}
          onEstop={actions.estop}
          onReset={actions.reset}
        />
        <section aria-labelledby="status-evidence-title" className={styles.statusEvidence}>
          <p className={styles.sequence}>STATUS / READBACK</p>
          <h2 className={styles.statusHeading} id="status-evidence-title">执行层状态证据</h2>
          <p className={styles.statusState}>
            {statusEvidenceCopy(snapshot.safetyEvidence)}
          </p>
          {snapshot.errors.status && (
            <p className={styles.channelError}>{snapshot.errors.status}</p>
          )}
          {snapshot.channels.status === "error" && snapshot.status && (
            <span className={styles.staleLabel}>可能陈旧</span>
          )}
          {snapshot.status && (
            <dl className={styles.statusCounts}>
              <div className={styles.statusCount}>
                <dt>Core pending</dt>
                <dd>待处理 {Object.keys(snapshot.status.pending).length}</dd>
              </div>
              <div className={styles.statusCount}>
                <dt>Core audit tail</dt>
                <dd>审计尾部 {snapshot.status.audit_tail.length}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>

      <div className={styles.workspaceColumns}>
        <section aria-labelledby="policy-dossier-title" className={styles.policyDossier}>
          <header className={styles.dossierHeader}>
            <div>
              <p className={styles.sequence}>DOSSIER / POLICY</p>
              <h2 className={styles.dossierTitle} id="policy-dossier-title">策略档案</h2>
            </div>
            <ChannelStateCopy
              channel={snapshot.channels.policy}
              hasEvidence={snapshot.policy !== null}
            />
          </header>
          {snapshot.errors.policy && (
            <p className={styles.channelError}>{snapshot.errors.policy}</p>
          )}
          {snapshot.policy ? (
            <EffectorPolicyEditor
              onPatch={actions.patchPolicy}
              policy={snapshot.policy}
              savingPolicy={snapshot.savingPolicy}
            />
          ) : (
            <p className={styles.loadingState} id="control-form" tabIndex={-1}>
              {snapshot.channels.policy === "error"
                ? "没有可显示的已验证策略。"
                : "正在读取 Core 策略。"}
            </p>
          )}
        </section>

        <section aria-labelledby="audit-dossier-title" className={styles.auditDossier}>
          <header className={styles.dossierHeader}>
            <div>
              <p className={styles.sequence}>DOSSIER / AUDIT</p>
              <h2 className={styles.dossierTitle} id="audit-dossier-title">审计证据</h2>
            </div>
            <ChannelStateCopy
              channel={snapshot.channels.audit}
              hasEvidence={snapshot.audit !== null}
            />
          </header>
          {snapshot.errors.audit && (
            <p className={styles.channelError}>{snapshot.errors.audit}</p>
          )}
          {snapshot.audit ? (
            <AuditLedger
              audit={snapshot.audit}
              refreshAudit={actions.refreshAudit}
              selectedDate={snapshot.selectedAuditDate}
            />
          ) : (
            <p className={styles.loadingState} id="audit-ledger" tabIndex={-1}>
              {snapshot.channels.audit === "error"
                ? "没有可显示的已验证审计记录。"
                : "正在读取 Core 审计记录。"}
            </p>
          )}
        </section>
      </div>
    </article>
  );
}

function focusWorkspaceTarget(id: "control-form" | "audit-ledger"): void {
  document.getElementById(id)?.focus({ preventScroll: true });
}

function ChannelStateCopy({
  channel,
  hasEvidence,
}: {
  readonly channel: "idle" | "loading" | "ready" | "error";
  readonly hasEvidence: boolean;
}) {
  if (channel === "error" && hasEvidence) {
    return <span className={styles.staleLabel}>可能陈旧</span>;
  }
  const copy = channel === "loading"
    ? hasEvidence ? "刷新中 · 保留已验证证据" : "加载中"
    : channel === "ready"
      ? "已验证"
      : channel === "error"
        ? "读取失败"
        : "尚未读取";
  return <span className={styles.channelState} data-channel={channel}>{copy}</span>;
}

function statusEvidenceCopy(evidence: "checking" | "clear" | "latched" | "unknown"): string {
  switch (evidence) {
    case "checking":
      return "检查中 · 等待 Core 权威回读";
    case "clear":
      return "明确 · 执行层未闩锁";
    case "latched":
      return "已闩锁 · Core 已确认急停";
    case "unknown":
      return "未知 · 不把缺失回读解释为安全";
  }
}
