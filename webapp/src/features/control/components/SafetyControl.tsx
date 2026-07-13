"use client";

import type {
  EffectorActions,
  SafetyEvidence,
} from "../controller/create-effector-controller";
import styles from "./EffectorWorkspace.module.css";

const SAFETY_COPY: Readonly<
  Record<
    SafetyEvidence,
    { readonly action: string; readonly title: string; readonly description: string }
  >
> = {
  checking: {
    action: "安全状态检查中",
    title: "正在核验执行层",
    description: "在权威状态返回前，不推断急停是否闭锁。",
  },
  clear: {
    action: "触发急停",
    title: "执行层未闭锁",
    description: "急停将先提交请求，再由状态回读确认结果。",
  },
  latched: {
    action: "急停已闩锁 · 请求复位",
    title: "执行层已闩锁",
    description: "复位请求同样需要权威状态回读确认。",
  },
  unknown: {
    action: "安全状态未知 · 重新触发急停",
    title: "执行层状态未知",
    description: "上次操作未获得一致回读；不把未知解释为安全。",
  },
};

export interface SafetyControlProps {
  readonly evidence: SafetyEvidence;
  readonly mutation: "estop" | "reset" | null;
  readonly onEstop: EffectorActions["estop"];
  readonly onReset: EffectorActions["reset"];
}

export function SafetyControl({
  evidence,
  mutation,
  onEstop,
  onReset,
}: SafetyControlProps) {
  const copy = SAFETY_COPY[evidence];
  const disabled = evidence === "checking" || mutation !== null;

  return (
    <section
      aria-labelledby="safety-control-title"
      className={styles.safetyControl}
      data-safety={evidence}
    >
      <div className={styles.safetyCopy}>
        <p className={styles.safetyEyebrow}>SAFETY / AUTHORITATIVE</p>
        <h2 className={styles.safetyTitle} id="safety-control-title">{copy.title}</h2>
        <p className={styles.safetyDescription}>{copy.description}</p>
        {mutation !== null && (
          <p className={styles.mutationNote}>等待 Core 权威回读</p>
        )}
      </div>
      <button
        aria-busy={mutation !== null}
        className={styles.safetyButton}
        disabled={disabled}
        type="button"
        onClick={() => {
          if (evidence === "latched") void onReset();
          else if (evidence === "clear" || evidence === "unknown") void onEstop();
        }}
      >
        {copy.action}
      </button>
    </section>
  );
}
