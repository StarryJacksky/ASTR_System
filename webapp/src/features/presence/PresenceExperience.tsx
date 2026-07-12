"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { VoiceprintPanel } from "@/components/astr/VoiceprintPanel";
import { usePresenceController } from "@/features/presence/controller/use-presence-controller";
import { semanticStore } from "@/lib/semantic-store";

import styles from "./PresenceExperience.module.css";
import { Composer } from "./components/Composer";
import { ConversationRegion } from "./components/ConversationRegion";
import { LifeRegion } from "./components/LifeRegion";
import {
  OrbitNavigation,
  type PresenceOrbitEndpoint,
} from "./components/OrbitNavigation";
import { PresenceHeader } from "./components/PresenceHeader";
import { SoulPresence } from "./components/SoulPresence";

type PresenceLayout = "balanced" | "deep";

interface PresenceUiState {
  readonly layout: PresenceLayout;
  readonly activeEndpoint: PresenceOrbitEndpoint;
  readonly lifeExpanded: boolean;
  readonly settingsOpen: boolean;
}

interface PresenceAnnouncedFacts {
  readonly core: string;
  readonly replySse: string;
  readonly lifeSse: string;
  readonly visualRuntime: string;
  readonly safety: string;
  readonly safetyEvidence: string;
}

const INITIAL_UI_STATE: PresenceUiState = {
  layout: "balanced",
  activeEndpoint: "dialogue",
  lifeExpanded: false,
  settingsOpen: false,
};

const INITIAL_ANNOUNCED_FACTS: PresenceAnnouncedFacts = {
  core: "cold",
  replySse: "closed",
  lifeSse: "closed",
  visualRuntime: "loading",
  safety: "normal",
  safetyEvidence: "checking",
};

export function PresenceExperience() {
  const { snapshot, actions } = usePresenceController();
  const [ui, setUi] = useState<PresenceUiState>(INITIAL_UI_STATE);
  const orbitRegionRef = useRef<HTMLDivElement>(null);
  const lifeIslandRef = useRef<HTMLDivElement>(null);
  const lifeInitiatorRef = useRef<HTMLElement | null>(null);
  const returnLifeFocusRef = useRef(false);
  const announcedFactsRef = useRef<PresenceAnnouncedFacts>(INITIAL_ANNOUNCED_FACTS);
  const resetVerificationPendingRef = useRef(false);
  const assistantLabel = nonblank(snapshot.status?.displayName) ?? undefined;

  useLayoutEffect(() => {
    if (ui.lifeExpanded) {
      lifeIslandRef.current?.focus();
      return;
    }
    if (!returnLifeFocusRef.current) return;
    returnLifeFocusRef.current = false;
    const initiator = lifeInitiatorRef.current;
    if (initiator?.isConnected) initiator.focus();
  }, [ui.lifeExpanded]);

  useEffect(() => {
    const previous = announcedFactsRef.current;
    const next: PresenceAnnouncedFacts = {
      core: snapshot.semantic.core,
      replySse: snapshot.semantic.replySse,
      lifeSse: snapshot.semantic.lifeSse,
      visualRuntime: snapshot.semantic.visualRuntime,
      safety: snapshot.semantic.safety,
      safetyEvidence: snapshot.safetyEvidence,
    };
    const announcements: Array<readonly [string, "polite" | "assertive"]> = [];

    if (next.core !== previous.core) {
      if (next.core === "offline") announcements.push(["Core 不可达", "polite"]);
      if (next.core === "error") announcements.push(["Core 状态错误", "polite"]);
    }
    if (next.replySse === "retrying" && previous.replySse !== "retrying") {
      announcements.push(["回复流连接中断；断线期间消息可能不完整", "polite"]);
    }
    if (next.lifeSse === "retrying" && previous.lifeSse !== "retrying") {
      announcements.push(["生活流连接中断；断线期间记录可能不完整", "polite"]);
    }
    if (next.visualRuntime === "contextLost" && previous.visualRuntime !== "contextLost") {
      announcements.push(["视觉呈现暂不可用；已保持静态 Soul", "polite"]);
    }
    if (next.safety !== previous.safety) {
      if (next.safety === "stopRequested") {
        announcements.push(["急停请求已发送，正在核验执行层", "assertive"]);
      } else if (next.safety === "stopUnknown") {
        announcements.push(["安全操作结果未知，执行层状态可能不一致", "assertive"]);
      } else if (next.safety === "stoppedLatched") {
        announcements.push(["急停已闩锁", "assertive"]);
      } else if (next.safety === "resetting") {
        announcements.push(["正在核验急停复位结果", "polite"]);
      }
    }

    if (next.safety === "resetting") {
      resetVerificationPendingRef.current = true;
    } else if (
      resetVerificationPendingRef.current &&
      next.safety === "normal" &&
      next.safetyEvidence === "clear"
    ) {
      announcements.push(["急停复位已由执行层确认", "polite"]);
      resetVerificationPendingRef.current = false;
    } else if (
      next.safety === "stopRequested" ||
      next.safety === "stopUnknown" ||
      next.safety === "stoppedLatched"
    ) {
      resetVerificationPendingRef.current = false;
    }

    announcedFactsRef.current = next;
    for (const [message, politeness] of announcements) {
      semanticStore.getState().announce(message, politeness);
    }
  }, [
    snapshot.semantic.core,
    snapshot.semantic.lifeSse,
    snapshot.semantic.replySse,
    snapshot.semantic.safety,
    snapshot.semantic.visualRuntime,
    snapshot.safetyEvidence,
  ]);

  const navigateOrbit = (endpoint: Exclude<PresenceOrbitEndpoint, "task">) => {
    if (endpoint === "life") {
      lifeInitiatorRef.current =
        orbitRegionRef.current?.querySelector<HTMLElement>(
          "[data-orbit-endpoint='life'] button",
        ) ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      returnLifeFocusRef.current = false;
      setUi((current) => ({
        ...current,
        activeEndpoint: "life",
        lifeExpanded: true,
      }));
      return;
    }

    returnLifeFocusRef.current = false;
    setUi((current) => ({
      ...current,
      activeEndpoint: endpoint,
      lifeExpanded: false,
    }));
  };

  const setLifeExpanded = (expanded: boolean) => {
    if (expanded && document.activeElement instanceof HTMLElement) {
      lifeInitiatorRef.current = document.activeElement;
    }
    returnLifeFocusRef.current = !expanded;
    setUi((current) => ({
      ...current,
      activeEndpoint: expanded ? "life" : "dialogue",
      lifeExpanded: expanded,
    }));
  };

  const toggleDeepLayout = () => {
    returnLifeFocusRef.current = false;
    setUi((current) => ({
      ...current,
      layout: current.layout === "balanced" ? "deep" : "balanced",
      activeEndpoint: "dialogue",
      lifeExpanded: false,
    }));
  };

  return (
    <>
      <a className={`astr-skip-link ${styles.composerSkip}`} href="#presence-message-input">
        跳到消息输入
      </a>
      <main
        className={styles.presence}
        data-presence-layout={ui.layout}
        id="main-content"
        tabIndex={-1}
      >
        <PresenceHeader
          actions={actions}
          effectorStatus={snapshot.effectorStatus}
          onSettingsOpenChange={(settingsOpen) =>
            setUi((current) => ({ ...current, settingsOpen }))
          }
          safetyEvidence={snapshot.safetyEvidence}
          semantic={snapshot.semantic}
          settingsContent={<VoiceprintPanel active={ui.settingsOpen} />}
          settingsOpen={ui.settingsOpen}
          status={snapshot.status}
        />

        <div ref={orbitRegionRef} className={styles.orbitField}>
          <OrbitNavigation
            activeEndpoint={ui.activeEndpoint}
            onNavigate={navigateOrbit}
          />
        </div>

        <div className={styles.presenceField}>
          <section className={styles.dialogueSurface} aria-label="Presence 对话场">
            <ConversationRegion
              assistantLabel={assistantLabel}
              conversation={snapshot.conversation}
              headerAction={
                <button
                  aria-pressed={ui.layout === "deep"}
                  className={styles.layoutToggle}
                  onClick={toggleDeepLayout}
                  type="button"
                >
                  <span aria-hidden>{ui.layout === "deep" ? "收束" : "展开"}</span>
                  <span className={styles.layoutToggleCopy}>切换深聊布局</span>
                </button>
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

          <div className={styles.soulField} data-presence-soul="true">
            <SoulPresence
              activity={snapshot.status?.activity}
              displayName={snapshot.status?.displayName}
              model={snapshot.status?.model}
              visualRuntime={snapshot.semantic.visualRuntime}
            />
          </div>
        </div>

        <div
          ref={lifeIslandRef}
          aria-label="生活密度岛"
          className={styles.lifeIsland}
          data-expanded={ui.lifeExpanded ? "true" : "false"}
          data-presence-life-island="true"
          role="region"
          tabIndex={-1}
        >
          <LifeRegion
            activity={snapshot.status?.activity}
            events={snapshot.lifeEvents}
            expanded={ui.lifeExpanded}
            onExpandedChange={setLifeExpanded}
            streamState={snapshot.semantic.lifeSse}
          />
        </div>
      </main>
    </>
  );
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
