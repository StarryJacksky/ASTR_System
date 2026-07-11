import type { AstrEvent, IngestReceipt } from "@/lib/types";

export interface DraftSnapshot {
  readonly revision: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export type ConversationAttemptStatus =
  | "sending"
  | "acknowledged"
  | "streaming"
  | "waitingForFinal"
  | "final"
  | "failed"
  | "timedOut";

export interface ConversationAttempt {
  readonly id: string;
  readonly localMessageId: string;
  readonly draftSnapshot: DraftSnapshot;
  readonly status: ConversationAttemptStatus;
  readonly receipt: IngestReceipt | null;
  readonly startedAt: number;
  readonly firstReplyAt: number | null;
  readonly lateFinal: boolean;
}

export interface PresenceMessage {
  readonly id: string;
  readonly kind: "user" | "decision";
  readonly role: "user" | "qiuqiu";
  readonly text: string;
  readonly ts: number;
  readonly platform?: string;
  readonly traceId?: string;
  readonly eventId?: string;
  readonly external?: boolean;
  readonly lateFinal?: boolean;
}

export interface ProvisionalReply {
  readonly traceId: string;
  readonly messageId: string;
  readonly text: string;
  readonly lastSeq: number;
  readonly done: boolean;
}

interface BufferedReplyFrameBase {
  readonly event: AstrEvent;
  readonly eventId: string;
  readonly traceId: string;
  readonly receivedAt: number;
}

export interface BufferedStreamFrame extends BufferedReplyFrameBase {
  readonly kind: "stream";
  readonly seq: number;
  readonly delta: string;
  readonly done: boolean;
}

export interface BufferedDecisionFrame extends BufferedReplyFrameBase {
  readonly kind: "decision";
  readonly replyText: string;
}

export type BufferedReplyFrame = BufferedStreamFrame | BufferedDecisionFrame;

export type ConversationDiagnosticCode =
  | "INGEST_FAILED"
  | "MALFORMED_REPLY_EVENT"
  | "PRE_ACK_BUFFER_OVERFLOW"
  | "REQUEST_TIMED_OUT"
  | "UNBOUND_STREAM_DROPPED";

export interface ConversationDiagnostic {
  readonly code: ConversationDiagnosticCode;
  readonly message: string;
  readonly at: number;
  readonly eventId?: string;
  readonly traceId?: string;
}

export interface ConversationModelState {
  readonly draft: DraftSnapshot;
  readonly messages: readonly PresenceMessage[];
  readonly activeAttempt: ConversationAttempt | null;
  readonly provisionalReplies: readonly ProvisionalReply[];
  readonly preAckBuffer: readonly BufferedReplyFrame[];
  readonly seenEventIds: readonly string[];
  readonly diagnostics: readonly ConversationDiagnostic[];
  readonly authoritativeDecision: AstrEvent | null;
  readonly error: string | null;
}

export type ConversationEvent =
  | { readonly type: "DRAFT_CHANGED"; readonly draft: DraftSnapshot; readonly at: number }
  | {
      readonly type: "LOCAL_SEND";
      readonly attemptId: string;
      readonly localMessageId: string;
      readonly draftSnapshot: DraftSnapshot;
      readonly at: number;
    }
  | {
      readonly type: "INGEST_ACK";
      readonly attemptId: string;
      readonly receipt: IngestReceipt;
      readonly at: number;
    }
  | {
      readonly type: "INGEST_FAILED";
      readonly attemptId: string;
      readonly message: string;
      readonly at: number;
    }
  | { readonly type: "REPLY_EVENT"; readonly event: AstrEvent; readonly at: number }
  | { readonly type: "PRE_ACK_EXPIRED"; readonly at: number }
  | {
      readonly type: "REQUEST_TIMED_OUT";
      readonly attemptId: string;
      readonly at: number;
    };
