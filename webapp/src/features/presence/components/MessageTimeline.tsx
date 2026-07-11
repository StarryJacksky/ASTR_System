import type { ConversationProjection } from "@/lib/types";
import { formatUtcTimestamp } from "@/features/presence/model/life-events";

import styles from "./PresenceTimelines.module.css";

export type TimelineEntryPhase = "settled" | "provisional" | "waitingForFinal";

export interface ConversationTimelineEntry {
  readonly id: string;
  readonly role: "user" | "qiuqiu";
  readonly text: string;
  readonly timestamp: number | null;
  readonly phase: TimelineEntryPhase;
  readonly platform?: string;
  readonly traceId?: string;
  readonly eventId?: string;
  readonly replyToMessageId?: string;
  readonly external?: boolean;
  readonly lateFinal?: boolean;
}

export interface MessageTimelineProps {
  readonly entries: readonly ConversationTimelineEntry[];
  readonly assistantLabel?: string;
}

export function projectConversationTimeline(
  conversation: ConversationProjection,
): readonly ConversationTimelineEntry[] {
  const entries = conversation.messages.map<ConversationTimelineEntry>((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    timestamp: message.ts,
    phase: "settled",
    ...(message.platform === undefined ? {} : { platform: message.platform }),
    ...(message.traceId === undefined ? {} : { traceId: message.traceId }),
    ...(message.eventId === undefined ? {} : { eventId: message.eventId }),
    ...(message.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: message.replyToMessageId }),
    ...(message.external === undefined ? {} : { external: message.external }),
    ...(message.lateFinal === undefined ? {} : { lateFinal: message.lateFinal }),
  }));

  const traceId = conversation.receipt?.trace_id;
  const provisionalId = traceId ? `reply:${traceId}` : null;
  if (
    provisionalId &&
    conversation.provisionalText.length > 0 &&
    !entries.some(({ id }) => id === provisionalId)
  ) {
    entries.push({
      id: provisionalId,
      role: "qiuqiu",
      text: conversation.provisionalText,
      timestamp: null,
      phase: conversation.provisionalActive ? "provisional" : "waitingForFinal",
      traceId,
    });
  }

  return entries;
}

export function MessageTimeline({ entries, assistantLabel }: MessageTimelineProps) {
  const visibleAssistantLabel = normalizeAssistantLabel(assistantLabel);

  return (
    <>
      {entries.length === 0 && (
        <p className={styles.emptyCopy}>本次会话还没有消息。可以从输入区开始。</p>
      )}
      <ol aria-label="对话消息" className={styles.timeline}>
        {entries.map((entry) => {
          const assistant = entry.role === "qiuqiu";
          const timestamp =
            entry.timestamp === null ? null : formatUtcTimestamp(entry.timestamp);
          const phase = entryPhaseLabel(entry);
          const bubbleClassName = [
            styles.bubble,
            assistant ? styles.assistantBubble : styles.userBubble,
            entry.phase === "provisional" ? styles.provisionalBubble : "",
            entry.phase === "waitingForFinal" ? styles.waitingBubble : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li
              className={`${styles.messageItem} ${
                assistant ? styles.assistantMessage : styles.userMessage
              }`}
              data-event-id={entry.eventId}
              data-message-id={entry.id}
              data-message-phase={entry.phase}
              data-reply-to={entry.replyToMessageId}
              key={entry.id}
            >
              <div className={styles.messageMeta}>
                <span className={styles.author}>{assistant ? visibleAssistantLabel : "你"}</span>
                {entry.platform && <span className={styles.platform}>{entry.platform}</span>}
                {timestamp && (
                  <time className={styles.meta} dateTime={timestamp.dateTime}>
                    {timestamp.label}
                  </time>
                )}
                {phase && <span className={styles.phase}>{phase}</span>}
              </div>
              <p className={bubbleClassName}>{entry.text}</p>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function entryPhaseLabel(entry: ConversationTimelineEntry): string | null {
  if (entry.phase === "provisional") return "临时回复 · 尚未成为终稿";
  if (entry.phase === "waitingForFinal") return "等待终稿";
  if (entry.role !== "qiuqiu" || !entry.eventId) return null;
  if (entry.lateFinal) return "迟到终稿";
  if (entry.external) return "外部终稿";
  return "权威终稿";
}

function normalizeAssistantLabel(value: string | undefined): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "Soul";
}
