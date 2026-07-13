import type { ReactNode } from "react";

import styles from "./CapabilityGate.module.css";

export interface CapabilityGateProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly status: string;
  readonly reason: string;
  readonly evidence: string;
  readonly capabilities?: readonly string[];
}

export function CapabilityGate({
  eyebrow,
  title,
  status,
  reason,
  evidence,
  capabilities,
}: CapabilityGateProps): ReactNode {
  return (
    <section className={styles.gate}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
      </header>

      <div className={styles.boundary}>
        <span aria-hidden="true" className={styles.staticSignal} />
        <p className={styles.status}>{status}</p>
        <p className={styles.reason}>{reason}</p>
        <p className={styles.evidence}>{evidence}</p>
      </div>

      {capabilities && capabilities.length > 0 ? (
        <ul
          aria-label={`${title}能力边界`}
          className={styles.capabilities}
        >
          {capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
