"use client";

import type { ReactNode } from "react";

import { Composer } from "@/features/presence/components/Composer";
import {
  ConversationRegion,
  getFinalAnnouncementLedgerForScope,
} from "@/features/presence/components/ConversationRegion";
import { StaticSoulLens } from "@/features/presence/components/StaticSoulLens";
import {
  presenceControllerOwner,
  usePresenceController,
  type PresenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";
import type { CoreState, StreamState } from "@/lib/semantic-state";

import styles from "./MobilePresenceDomain.module.css";

const CORE_COPY: Readonly<Record<CoreState, string>> = Object.freeze({
  cold: "未启动",
  loading: "核验中",
  reachable: "可达",
  offline: "离线",
  error: "状态错误",
});

const STREAM_COPY: Readonly<Record<StreamState, string>> = Object.freeze({
  connecting: "连接中",
  open: "已连接",
  retrying: "重连中",
  closed: "未连接",
});

export interface TrustedMobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function TrustedMobilePresenceDomain({
  owner = presenceControllerOwner,
}: TrustedMobilePresenceDomainProps): ReactNode {
  const { snapshot, actions } = usePresenceController(owner);
  const assistantLabel = nonblank(snapshot.status?.displayName) ?? "Soul";
  const activity = activityCopy(
    snapshot.status?.activity,
    snapshot.semantic.core,
  );

  return (
    <section className={styles.domain}>
      <header className={styles.hero}>
        <div className={styles.titleRail}>
          <p className={styles.eyebrow}>PRESENCE / 灵魂中继</p>
          <h1>与 {assistantLabel} 对话</h1>
          <p className={styles.activity}>{activity}</p>
        </div>
      </header>

      <dl
        aria-label="Presence 连接事实"
        className={styles.statusRail}
      >
        <div>
          <dt>Core</dt>
          <dd>{CORE_COPY[snapshot.semantic.core]}</dd>
        </div>
        <div>
          <dt>Reply SSE</dt>
          <dd>{STREAM_COPY[snapshot.semantic.replySse]}</dd>
        </div>
        <div>
          <dt>Life SSE</dt>
          <dd>{STREAM_COPY[snapshot.semantic.lifeSse]}</dd>
        </div>
      </dl>

      <section
        aria-label="Mobile Presence 对话"
        className={styles.dialogueSurface}
        role="region"
      >
        <ConversationRegion
          announcementLedger={getFinalAnnouncementLedgerForScope(owner)}
          assistantLabel={assistantLabel}
          conversation={snapshot.conversation}
          headerAction={
            <div
              aria-hidden="true"
              className={styles.soulMark}
              data-mobile-soul-mark=""
            >
              <svg
                aria-hidden="true"
                className={styles.sCurve}
                focusable="false"
                viewBox="0 0 120 220"
              >
                <path d="M90 12 C20 42 24 94 72 108 C116 121 100 182 28 208" />
              </svg>
              <StaticSoulLens className={styles.lens} />
            </div>
          }
        />
        <Composer
          actions={actions}
          snapshot={{
            conversation: snapshot.conversation,
            diagnostics: snapshot.diagnostics,
            draft: snapshot.draft,
            semantic: snapshot.semantic,
          }}
        />
      </section>
    </section>
  );
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function activityCopy(value: string | undefined, core: CoreState): string {
  const activity = nonblank(value);
  if (!activity) return "Core 未提供";
  if (core === "reachable") return "此刻：" + activity;
  return "最近一次：" + activity + "（可能陈旧）";
}
