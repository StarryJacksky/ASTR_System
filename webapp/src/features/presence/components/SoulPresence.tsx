import type { ReactNode } from "react";

import type { VisualRuntimeState } from "@/lib/semantic-state";

import styles from "./SoulPresence.module.css";
import { StaticSoulLens } from "./StaticSoulLens";

export interface SoulPresenceProps {
  readonly displayName?: string;
  readonly activity?: string;
  readonly model?: string;
  readonly visualRuntime: VisualRuntimeState;
  readonly visualSlot?: ReactNode;
}

const RUNTIME_COPY: Readonly<Record<VisualRuntimeState, string>> = {
  loading: "视觉呈现正在加载；静态 Soul 持续可用。",
  ready: "视觉呈现已就绪；静态 Soul 仍作为连续性锚点。",
  contextLost: "视觉呈现暂不可用；已保持静态 Soul。",
};

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function SoulPresence({
  displayName,
  activity,
  model,
  visualRuntime,
  visualSlot,
}: SoulPresenceProps) {
  const personName = optionalText(displayName) ?? "Soul";
  const currentActivity = optionalText(activity);
  const modelShell = optionalText(model);

  return (
    <section className={styles.soulPresence} data-visual-runtime={visualRuntime}>
      <header className={styles.identityHeader}>
        <p className={styles.kicker}>PRESENCE · SOUL</p>
        <h2 className={styles.identity}>{personName}</h2>
        <p className={styles.identityCopy}>在场保持；视觉能力不会阻断对话。</p>
      </header>

      <div className={styles.visualStage}>
        <StaticSoulLens className={styles.lens} />
        <p className={styles.runtimeCopy} data-visual-runtime={visualRuntime}>
          {RUNTIME_COPY[visualRuntime]}
        </p>
        {visualSlot ? (
          <div aria-hidden="true" className={styles.visualSlot} data-visual-slot="reserved">
            {visualSlot}
          </div>
        ) : null}
      </div>

      <dl className={styles.truthLedger}>
        <div className={styles.truthRow}>
          <dt>当前活动</dt>
          <dd>{currentActivity ? `当前活动：${currentActivity}` : "当前活动：未提供"}</dd>
        </div>
        <div className={styles.truthRow}>
          <dt>模型外壳</dt>
          <dd>{modelShell ? `模型外壳：${modelShell}` : "模型外壳：未提供"}</dd>
        </div>
        <div className={styles.truthRow}>
          <dt>记忆连续性</dt>
          <dd>记忆连续性 / provenance：未提供</dd>
        </div>
      </dl>
    </section>
  );
}
