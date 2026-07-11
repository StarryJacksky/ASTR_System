"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { semanticStore, type Announcement } from "@/lib/semantic-store";
import type { AstrEvent, ChatMessage, ConversationProjection } from "@/lib/types";

import {
  MessageTimeline,
  projectConversationTimeline,
  type ConversationTimelineEntry,
} from "./MessageTimeline";
import styles from "./PresenceTimelines.module.css";

export const BOTTOM_FOLLOW_THRESHOLD_PX = 72;
export const FINAL_ANNOUNCEMENT_ID_CAPACITY = 256;
export const UNREAD_BUBBLE_ID_CAPACITY = 256;

export type FinalAnnouncementPublisher = (
  message: string,
  politeness?: Announcement["politeness"],
) => void;

export interface ConversationRegionProps {
  readonly conversation: ConversationProjection;
  readonly assistantLabel?: string;
  readonly announceFinal?: FinalAnnouncementPublisher;
}

export interface BoundedIdLedger {
  readonly size: number;
  readonly remember: (id: string) => boolean;
}

export function createBoundedIdLedger(
  capacity = FINAL_ANNOUNCEMENT_ID_CAPACITY,
): BoundedIdLedger {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("A bounded id ledger requires a positive integer capacity.");
  }
  const ids = new Set<string>();
  const order: string[] = [];
  return Object.freeze({
    get size() {
      return ids.size;
    },
    remember(id: string) {
      if (ids.has(id)) return false;
      ids.add(id);
      order.push(id);
      if (order.length > capacity) {
        const evicted = order.shift();
        if (evicted !== undefined) ids.delete(evicted);
      }
      return true;
    },
  });
}

const defaultFinalAnnouncement: FinalAnnouncementPublisher = (message, politeness = "polite") => {
  semanticStore.getState().announce(message, politeness);
};

export function ConversationRegion({
  conversation,
  assistantLabel,
  announceFinal = defaultFinalAnnouncement,
}: ConversationRegionProps) {
  const headingId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousEntriesRef = useRef<readonly ConversationTimelineEntry[] | null>(null);
  const followingRef = useRef(true);
  const unreadIdsRef = useRef(new Set<string>());
  const unreadOverflowRef = useRef(false);
  const previousMessagesRef = useRef<readonly ChatMessage[] | null>(null);
  const previousFallbackDecisionIdRef = useRef<string | null>(null);
  const announcementLedgerRef = useRef<BoundedIdLedger | null>(null);
  if (announcementLedgerRef.current === null) {
    announcementLedgerRef.current = createBoundedIdLedger();
  }
  const entries = useMemo(
    () => projectConversationTimeline(conversation),
    [conversation],
  );
  const visibleAssistantLabel = normalizeAssistantLabel(assistantLabel);
  const [scrollUi, setScrollUi] = useState({
    following: true,
    unreadCount: 0,
    unreadOverflow: false,
  });

  const syncScrollUi = useCallback(() => {
    const next = {
      following: followingRef.current,
      unreadCount: unreadIdsRef.current.size,
      unreadOverflow: unreadOverflowRef.current,
    };
    setScrollUi((current) =>
      current.following === next.following &&
      current.unreadCount === next.unreadCount &&
      current.unreadOverflow === next.unreadOverflow
        ? current
        : next,
    );
  }, []);

  const clearUnread = useCallback(() => {
    unreadIdsRef.current.clear();
    unreadOverflowRef.current = false;
  }, []);

  const scrollToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    }
    followingRef.current = true;
    clearUnread();
    syncScrollUi();
  }, [clearUnread, syncScrollUi]);

  const returnToLatest = useCallback(() => {
    scrollToLatest();
    viewportRef.current?.focus({ preventScroll: true });
  }, [scrollToLatest]);

  useLayoutEffect(() => {
    const previousEntries = previousEntriesRef.current;
    const previousById = new Map(
      (previousEntries ?? []).map((entry) => [entry.id, entry]),
    );
    const initialRender = previousEntries === null;
    const newLocalMessage = entries.some(
      (entry) => entry.role === "user" && !previousById.has(entry.id),
    );
    const changedAssistantIds = entries
      .filter((entry) => {
        if (entry.role !== "qiuqiu") return false;
        const previous = previousById.get(entry.id);
        return previous === undefined || timelineEntryChanged(previous, entry);
      })
      .map(({ id }) => id);

    previousEntriesRef.current = entries;
    if (initialRender || newLocalMessage || followingRef.current) {
      scrollToLatest();
      return;
    }

    let changed = false;
    for (const id of changedAssistantIds) {
      if (unreadIdsRef.current.has(id)) continue;
      if (unreadIdsRef.current.size >= UNREAD_BUBBLE_ID_CAPACITY) {
        if (!unreadOverflowRef.current) {
          unreadOverflowRef.current = true;
          changed = true;
        }
        continue;
      }
      unreadIdsRef.current.add(id);
      changed = true;
    }
    if (changed) syncScrollUi();
  }, [entries, scrollToLatest, syncScrollUi]);

  useEffect(() => {
    const previousByMessageId = new Map(
      (previousMessagesRef.current ?? []).map((message) => [message.id, message]),
    );
    const projectedEventIds = new Set<string>();

    for (const message of conversation.messages) {
      if (message.role !== "qiuqiu" || !isNonBlankString(message.eventId)) continue;
      projectedEventIds.add(message.eventId);
      const previous = previousByMessageId.get(message.id);
      if (previous?.eventId === message.eventId) continue;
      publishFinalAnnouncement(message.eventId, finalAnnouncementCopy(message, visibleAssistantLabel));
    }

    const fallback = compatibleDecision(
      conversation.authoritativeDecision,
      conversation.receipt?.trace_id,
    );
    if (
      fallback &&
      !projectedEventIds.has(fallback.id) &&
      previousFallbackDecisionIdRef.current !== fallback.id
    ) {
      publishFinalAnnouncement(
        fallback.id,
        `${visibleAssistantLabel} 的权威终稿：${fallback.text}`,
      );
    }

    previousMessagesRef.current = conversation.messages;
    previousFallbackDecisionIdRef.current = fallback?.id ?? null;

    function publishFinalAnnouncement(eventId: string, message: string): void {
      if (!announcementLedgerRef.current?.remember(eventId)) return;
      announceFinal(message, "polite");
    }
  }, [
    announceFinal,
    conversation.authoritativeDecision,
    conversation.messages,
    conversation.receipt?.trace_id,
    visibleAssistantLabel,
  ]);

  return (
    <section aria-labelledby={headingId} className={styles.conversationRegion}>
      <header className={styles.regionHeader}>
        <div>
          <p className={styles.regionKicker}>PRESENCE · DIALOGUE</p>
          <h2 className={styles.regionTitle} id={headingId}>
            对话
          </h2>
        </div>
      </header>
      <div className={styles.scrollFrame}>
        <div
          aria-label="对话记录"
          className={styles.scrollPort}
          onScroll={(event) => {
            const following = isWithinBottomThreshold(event.currentTarget);
            followingRef.current = following;
            if (following) clearUnread();
            syncScrollUi();
          }}
          ref={viewportRef}
          role="region"
          tabIndex={0}
        >
          <MessageTimeline assistantLabel={visibleAssistantLabel} entries={entries} />
        </div>
        {!scrollUi.following && (
          <button
            aria-label={returnLatestLabel(scrollUi.unreadCount, scrollUi.unreadOverflow)}
            className={styles.returnLatest}
            onClick={returnToLatest}
            type="button"
          >
            回到最新
            {scrollUi.unreadCount > 0 && (
              <span>
                {" · "}
                {scrollUi.unreadCount}
                {scrollUi.unreadOverflow ? "+" : ""} 条未读更新
              </span>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

export function isWithinBottomThreshold(
  metrics: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
  threshold = BOTTOM_FOLLOW_THRESHOLD_PX,
): boolean {
  const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distance <= threshold;
}

function timelineEntryChanged(
  previous: ConversationTimelineEntry,
  next: ConversationTimelineEntry,
): boolean {
  return (
    previous.text !== next.text ||
    previous.phase !== next.phase ||
    previous.eventId !== next.eventId ||
    previous.external !== next.external ||
    previous.lateFinal !== next.lateFinal
  );
}

function returnLatestLabel(unreadCount: number, overflow: boolean): string {
  if (unreadCount === 0) return "回到最新";
  return `回到最新，${unreadCount}${overflow ? "+" : ""} 条未读更新`;
}

function finalAnnouncementCopy(message: ChatMessage, assistantLabel: string): string {
  if (message.lateFinal) return `${assistantLabel} 的迟到终稿：${message.text}`;
  if (message.external) return `${assistantLabel} 的外部终稿：${message.text}`;
  return `${assistantLabel} 回答完成：${message.text}`;
}

function compatibleDecision(
  event: AstrEvent | null,
  activeTraceId: string | undefined,
): { readonly id: string; readonly text: string } | null {
  if (!event || !isNonBlankString(event.id) || !Object.hasOwn(event.payload, "reply_text")) {
    return null;
  }
  if (isNonBlankString(activeTraceId) && event.trace_id !== activeTraceId) return null;
  const replyText = event.payload.reply_text;
  return isNonBlankString(replyText) ? { id: event.id, text: replyText } : null;
}

function normalizeAssistantLabel(value: string | undefined): string {
  return isNonBlankString(value) ? value.trim() : "Soul";
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
