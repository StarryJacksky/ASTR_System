"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
import type {
  PresenceControllerActions,
  SafetyEvidence,
} from "@/features/presence/controller/create-presence-controller";
import type { CoreState, SafetyState, SemanticState, StreamState } from "@/lib/semantic-state";
import type { CoreStatusProjection, EffectorStatus } from "@/lib/types";

import styles from "./PresenceHeader.module.css";

const TOUCH_TARGET_STYLE: CSSProperties = {
  minInlineSize: "var(--touch-target)",
  minBlockSize: "var(--touch-target)",
};

const CORE_COPY: Readonly<Record<CoreState, string>> = {
  cold: "尚未启动",
  loading: "读取中",
  reachable: "Core 可达",
  offline: "Core 不可达",
  error: "状态错误",
};

const REPLY_STREAM_COPY: Readonly<Record<StreamState, string>> = {
  connecting: "回复流连接中",
  open: "回复流已连接",
  retrying: "回复流中断，正在重连；期间可能存在消息缺口",
  closed: "回复流未连接",
};

const LIFE_STREAM_COPY: Readonly<Record<StreamState, string>> = {
  connecting: "生活流连接中",
  open: "生活流已连接",
  retrying: "生活流中断，正在重连；期间可能存在记录缺口",
  closed: "生活流未连接",
};

const SAFETY_EVIDENCE_COPY: Readonly<Record<SafetyEvidence, string>> = {
  checking: "安全状态核验中",
  clear: "执行层未闩锁",
  latched: "急停已闩锁",
  unknown: "执行层状态未知",
};

const SAFETY_OVERRIDE_COPY: Partial<Record<SafetyState, string>> = {
  stopRequested: "急停请求已发送，正在核验执行层",
  stopUnknown: "安全操作结果未知，执行层状态可能不一致",
  stoppedLatched: "急停已闩锁",
  resetting: "正在核验急停复位结果",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface PresenceHeaderProps {
  readonly semantic: Readonly<SemanticState>;
  readonly status: Readonly<CoreStatusProjection> | null;
  readonly safetyEvidence: SafetyEvidence;
  readonly effectorStatus: EffectorStatus | null;
  readonly actions: Pick<PresenceControllerActions, "estop" | "reset">;
  readonly settingsOpen: boolean;
  readonly onSettingsOpenChange: (open: boolean) => void;
  readonly settingsContent?: ReactNode;
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function safetyCopy(semanticSafety: SafetyState, evidence: SafetyEvidence): string {
  if (semanticSafety === "stopUnknown" && evidence === "checking") {
    return SAFETY_EVIDENCE_COPY.checking;
  }
  return SAFETY_OVERRIDE_COPY[semanticSafety] ?? SAFETY_EVIDENCE_COPY[evidence];
}

function focusableChildren(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function PresenceHeader({
  semantic,
  status,
  safetyEvidence,
  effectorStatus,
  actions,
  settingsOpen,
  onSettingsOpenChange,
  settingsContent,
}: PresenceHeaderProps) {
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialDialogFocusRef = useRef<HTMLButtonElement>(null);
  const safetyFactRef = useRef<HTMLDivElement>(null);
  const wasSettingsOpenRef = useRef(false);
  const displayName = nonblank(status?.displayName);
  const internalHandle = nonblank(status?.internalHandle) ?? "未提供";
  const model = nonblank(status?.model) ?? "未提供";
  const visibleSafetyCopy = safetyCopy(semantic.safety, safetyEvidence);
  const resetIsUnsafe =
    semantic.safety === "stopRequested" ||
    semantic.safety === "stopUnknown" ||
    semantic.safety === "resetting";
  const canReset =
    !resetIsUnsafe &&
    (semantic.safety === "stoppedLatched" ||
      safetyEvidence === "latched" ||
      effectorStatus?.stopped === true);

  useLayoutEffect(() => {
    const wasOpen = wasSettingsOpenRef.current;
    wasSettingsOpenRef.current = settingsOpen;

    if (settingsOpen) {
      initialDialogFocusRef.current?.focus();
    } else if (wasOpen) {
      settingsTriggerRef.current?.focus();
    }
  }, [settingsOpen]);

  const closeSettings = () => onSettingsOpenChange(false);

  useEffect(() => {
    if (!settingsOpen) return;

    const captureModalKeys = (event: globalThis.KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onSettingsOpenChange(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableChildren(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", captureModalKeys, true);
    return () => document.removeEventListener("keydown", captureModalKeys, true);
  }, [onSettingsOpenChange, settingsOpen]);

  return (
    <header className={styles.header} role="banner">
      <div className={styles.identityRail}>
        <div className={styles.identityCopy}>
          <p className={styles.eyebrow}>SOVEREIGN PRESENCE FIELD</p>
          <h1 className={styles.title}>星枢 ASTR</h1>
          {displayName && (
            <p className={styles.displayName} data-testid="presence-display-name">
              Soul · {displayName}
            </p>
          )}
        </div>

        <nav className={styles.controlRail} aria-label="全局控制">
          <ThemeToggle />
          <VisualMotionRouteSlot className={styles.motionSlot} />
          <button
            ref={settingsTriggerRef}
            type="button"
            className={styles.control}
            style={TOUCH_TARGET_STYLE}
            aria-label="打开设置"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => onSettingsOpenChange(true)}
          >
            <span aria-hidden="true">⌘</span>
            <span className={styles.controlText}>设置</span>
          </button>
          <a className={styles.control} style={TOUCH_TARGET_STYLE} href="/admin">
            Control
          </a>
        </nav>
      </div>

      <div className={styles.truthGrid} aria-label="连接与安全事实">
        <div className={styles.truthRegion} role="group" aria-label="Core 状态">
          <span className={styles.truthLabel}>CORE</span>
          <span className={styles.truthValue}>{CORE_COPY[semantic.core]}</span>
        </div>
        <div className={styles.truthRegion} role="group" aria-label="回复流状态">
          <span className={styles.truthLabel}>REPLY SSE</span>
          <span className={styles.truthValue}>{REPLY_STREAM_COPY[semantic.replySse]}</span>
        </div>
        <div className={styles.truthRegion} role="group" aria-label="生活流状态">
          <span className={styles.truthLabel}>LIFE SSE</span>
          <span className={styles.truthValue}>{LIFE_STREAM_COPY[semantic.lifeSse]}</span>
        </div>
        <div
          ref={safetyFactRef}
          className={styles.truthRegion}
          role="group"
          aria-label="执行安全状态"
          tabIndex={-1}
        >
          <span className={styles.truthLabel}>SAFETY</span>
          <span className={styles.truthValue}>{visibleSafetyCopy}</span>
        </div>
      </div>

      <div className={styles.secondaryRail}>
        <details className={styles.systemDetails}>
          <summary>系统细节</summary>
          <dl className={styles.detailList}>
            <div>
              <dt>内部句柄</dt>
              <dd>{internalHandle}</dd>
            </div>
            <div>
              <dt>本地模型</dt>
              <dd>{model}</dd>
            </div>
            <div>
              <dt>今日成本 / 日预算</dt>
              <dd>
                {status
                  ? `$${status.costTodayUsd.toFixed(2)} / $${status.dailyBudgetUsd.toFixed(2)}`
                  : "未提供"}
              </dd>
            </div>
          </dl>
        </details>

        <div className={styles.safetyActions} aria-label="执行安全控制">
          {canReset && (
            <button
              type="button"
              className={styles.control}
              style={TOUCH_TARGET_STYLE}
              onClick={() => {
                safetyFactRef.current?.focus();
                void actions.reset();
              }}
            >
              复位急停
            </button>
          )}
          <button
            type="button"
            className={`${styles.control} ${styles.estop}`}
            style={TOUCH_TARGET_STYLE}
            onClick={() => void actions.estop()}
          >
            触发急停
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className={styles.dialogBackdrop}>
          <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="presence-settings-title"
          >
            <div className={styles.dialogHeader}>
              <div>
                <p className={styles.eyebrow}>LOCAL CAPABILITIES</p>
                <h2 id="presence-settings-title" className={styles.dialogTitle}>
                  星枢设置
                </h2>
              </div>
              <button
                ref={initialDialogFocusRef}
                type="button"
                className={styles.control}
                style={TOUCH_TARGET_STYLE}
                onClick={closeSettings}
              >
                关闭设置
              </button>
            </div>
            <div className={styles.settingsContent}>
              {settingsContent ?? <p>当前未提供额外设置项。</p>}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
