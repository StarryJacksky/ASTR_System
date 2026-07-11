import type { ChatMessage, ConversationProjection } from "@/lib/types";

import type {
  BufferedDecisionFrame,
  BufferedReplyFrame,
  BufferedStreamFrame,
  ConversationAttempt,
  ConversationDiagnostic,
  ConversationEvent,
  ConversationModelState,
  DraftSnapshot,
  PresenceMessage,
  ProvisionalReply,
} from "./presence-types";

export const PRE_ACK_BUFFER_CAPACITY = 64;
export const PRE_ACK_BUFFER_TTL_MS = 10_000;
export const SEEN_EVENT_CAPACITY = 256;

const DIAGNOSTIC_CAPACITY = 64;
const EMPTY_DRAFT: DraftSnapshot = {
  revision: 0,
  text: "",
  selectionStart: 0,
  selectionEnd: 0,
};

export function createConversationState(
  initialDraft: DraftSnapshot = EMPTY_DRAFT,
): ConversationModelState {
  return {
    draft: { ...initialDraft },
    messages: [],
    activeAttempt: null,
    provisionalReplies: [],
    preAckBuffer: [],
    seenEventIds: [],
    diagnostics: [],
    authoritativeDecision: null,
    error: null,
  };
}

export function conversationReducer(
  state: ConversationModelState,
  event: ConversationEvent,
): ConversationModelState {
  const current = releaseExpiredPreAck(state, event.at);

  switch (event.type) {
    case "DRAFT_CHANGED":
      return { ...current, draft: { ...event.draft } };
    case "LOCAL_SEND":
      return startLocalSend(current, event);
    case "INGEST_ACK":
      return applyIngestAck(current, event);
    case "INGEST_FAILED":
      return applyIngestFailure(current, event);
    case "REPLY_EVENT":
      return receiveReplyEvent(current, event.event, event.at);
    case "PRE_ACK_EXPIRED":
      return current;
    case "REQUEST_TIMED_OUT":
      return applyRequestTimeout(current, event.attemptId, event.at);
  }
}

export function selectConversationProjection(state: ConversationModelState): ConversationProjection {
  const traceId = state.activeAttempt?.receipt?.trace_id;
  const provisional = traceId
    ? state.provisionalReplies.find((reply) => reply.traceId === traceId)
    : undefined;

  return {
    messages: state.messages.map(toChatMessage),
    receipt: state.activeAttempt?.receipt ?? null,
    provisionalText: provisional?.text ?? "",
    provisionalActive:
      state.activeAttempt?.status === "streaming" && provisional !== undefined && !provisional.done,
    authoritativeDecision: state.authoritativeDecision,
    error: state.error,
  };
}

function startLocalSend(
  state: ConversationModelState,
  event: Extract<ConversationEvent, { type: "LOCAL_SEND" }>,
): ConversationModelState {
  if (state.activeAttempt && isPending(state.activeAttempt)) return state;

  const message: PresenceMessage = {
    id: event.localMessageId,
    kind: "user",
    role: "user",
    text: state.draft.text,
    ts: event.at,
  };
  const attempt: ConversationAttempt = {
    id: event.attemptId,
    localMessageId: event.localMessageId,
    draftSnapshot: { ...state.draft },
    status: "sending",
    receipt: null,
    startedAt: event.at,
    firstReplyAt: null,
    lateFinal: false,
  };

  return {
    ...state,
    messages: [...state.messages, message],
    activeAttempt: attempt,
    provisionalReplies: [],
    preAckBuffer: [],
    authoritativeDecision: null,
    error: null,
  };
}

function applyIngestAck(
  state: ConversationModelState,
  event: Extract<ConversationEvent, { type: "INGEST_ACK" }>,
): ConversationModelState {
  const attempt = state.activeAttempt;
  if (!attempt || attempt.id !== event.attemptId || attempt.status !== "sending") return state;

  const draft =
    state.draft.revision === attempt.draftSnapshot.revision
      ? {
          revision: state.draft.revision + 1,
          text: "",
          selectionStart: 0,
          selectionEnd: 0,
        }
      : state.draft;
  let next: ConversationModelState = {
    ...state,
    draft,
    activeAttempt: { ...attempt, status: "acknowledged", receipt: { ...event.receipt } },
    preAckBuffer: [],
    error: null,
  };

  for (const frame of state.preAckBuffer) {
    next =
      frame.traceId === event.receipt.trace_id
        ? applyActiveFrame(next, frame)
        : releaseUnboundFrame(next, frame);
  }
  return next;
}

function applyIngestFailure(
  state: ConversationModelState,
  event: Extract<ConversationEvent, { type: "INGEST_FAILED" }>,
): ConversationModelState {
  const attempt = state.activeAttempt;
  if (!attempt || attempt.id !== event.attemptId || attempt.status !== "sending") return state;

  const released = releaseAllPreAck(state);
  return addDiagnostic(
    {
      ...released,
      activeAttempt: { ...attempt, status: "failed" },
    },
    { code: "INGEST_FAILED", message: event.message, at: event.at },
    true,
  );
}

function applyRequestTimeout(
  state: ConversationModelState,
  attemptId: string,
  at: number,
): ConversationModelState {
  const attempt = state.activeAttempt;
  if (
    !attempt ||
    attempt.id !== attemptId ||
    !isPending(attempt) ||
    attempt.firstReplyAt !== null
  ) {
    return state;
  }

  const released = releaseAllPreAck(state);
  return addDiagnostic(
    {
      ...released,
      activeAttempt: { ...attempt, status: "timedOut" },
    },
    {
      code: "REQUEST_TIMED_OUT",
      message: "No reply frame arrived before the request timeout.",
      at,
      traceId: attempt.receipt?.trace_id,
    },
    true,
  );
}

function receiveReplyEvent(
  state: ConversationModelState,
  event: Extract<ConversationEvent, { type: "REPLY_EVENT" }>["event"],
  at: number,
): ConversationModelState {
  if (state.seenEventIds.includes(event.id)) return state;

  const next: ConversationModelState = {
    ...state,
    seenEventIds: appendBounded(state.seenEventIds, event.id, SEEN_EVENT_CAPACITY),
  };
  const frame = normalizeReplyFrame(event, at);
  if (!frame) {
    return addDiagnostic(next, {
      code: "MALFORMED_REPLY_EVENT",
      message: `Malformed ${event.type} frame was discarded.`,
      at,
      eventId: event.id,
      traceId: event.trace_id,
    });
  }

  if (
    next.activeAttempt?.status === "sending" &&
    next.activeAttempt.receipt === null
  ) {
    return bufferPreAckFrame(next, frame);
  }
  return routeReplyFrame(next, frame);
}

function normalizeReplyFrame(
  event: Extract<ConversationEvent, { type: "REPLY_EVENT" }>["event"],
  receivedAt: number,
): BufferedReplyFrame | null {
  if (!event.id || !event.trace_id) return null;

  if (event.type === "soul.stream") {
    const { seq, delta = "", done = false } = event.payload;
    if (
      !Number.isInteger(seq) ||
      (seq as number) < 1 ||
      typeof delta !== "string" ||
      typeof done !== "boolean"
    ) {
      return null;
    }
    return {
      kind: "stream",
      event,
      eventId: event.id,
      traceId: event.trace_id,
      receivedAt,
      seq: seq as number,
      delta,
      done,
    };
  }

  if (event.type === "soul.decision") {
    const replyText = event.payload.reply_text;
    if (typeof replyText !== "string" || replyText.length === 0) return null;
    return {
      kind: "decision",
      event,
      eventId: event.id,
      traceId: event.trace_id,
      receivedAt,
      replyText,
    };
  }

  return null;
}

function routeReplyFrame(
  state: ConversationModelState,
  frame: BufferedReplyFrame,
): ConversationModelState {
  if (frame.kind === "decision") {
    const attempt = state.activeAttempt;
    if (attempt?.receipt?.trace_id === frame.traceId) {
      return attempt.status === "final" ? state : finalizeActiveDecision(state, frame);
    }
    return retainExternalDecision(state, frame);
  }

  const attempt = state.activeAttempt;
  if (attempt?.receipt?.trace_id !== frame.traceId) return releaseUnboundFrame(state, frame);
  if (attempt.status === "final" || attempt.status === "failed" || attempt.status === "timedOut") {
    return state;
  }
  return applyActiveStream(state, frame);
}

function applyActiveFrame(
  state: ConversationModelState,
  frame: BufferedReplyFrame,
): ConversationModelState {
  return frame.kind === "decision"
    ? finalizeActiveDecision(state, frame)
    : applyActiveStream(state, frame);
}

function applyActiveStream(
  state: ConversationModelState,
  frame: BufferedStreamFrame,
): ConversationModelState {
  const attempt = state.activeAttempt;
  if (!attempt || attempt.status === "final" || attempt.status === "timedOut") return state;

  const current = state.provisionalReplies.find((reply) => reply.traceId === frame.traceId);
  if (current?.done || frame.seq <= (current?.lastSeq ?? 0)) return state;
  if (!frame.done && frame.delta.length === 0) return state;

  const provisional: ProvisionalReply = {
    traceId: frame.traceId,
    messageId: current?.messageId ?? `reply:${frame.traceId}`,
    text: `${current?.text ?? ""}${frame.delta}`,
    lastSeq: frame.seq,
    done: frame.done,
  };
  const firstReplyAt =
    attempt.firstReplyAt ?? (frame.delta.length > 0 ? frame.receivedAt : null);

  return {
    ...state,
    activeAttempt: {
      ...attempt,
      status: frame.done ? "waitingForFinal" : "streaming",
      firstReplyAt,
    },
    provisionalReplies: upsertProvisional(state.provisionalReplies, provisional),
    error: null,
  };
}

function finalizeActiveDecision(
  state: ConversationModelState,
  frame: BufferedDecisionFrame,
): ConversationModelState {
  const attempt = state.activeAttempt;
  if (!attempt || attempt.status === "final" || attempt.status === "failed") return state;

  const provisional = state.provisionalReplies.find((reply) => reply.traceId === frame.traceId);
  const lateFinal = attempt.status === "timedOut";
  const message: PresenceMessage = {
    id: provisional?.messageId ?? `reply:${frame.traceId}`,
    kind: "decision",
    role: "qiuqiu",
    text: frame.replyText,
    ts: eventTimestamp(frame),
    traceId: frame.traceId,
    eventId: frame.eventId,
    external: false,
    lateFinal,
  };

  return {
    ...state,
    messages: upsertMessage(state.messages, message),
    activeAttempt: {
      ...attempt,
      status: "final",
      firstReplyAt: attempt.firstReplyAt ?? frame.receivedAt,
      lateFinal,
    },
    provisionalReplies: state.provisionalReplies.filter(
      (reply) => reply.traceId !== frame.traceId,
    ),
    authoritativeDecision: frame.event,
    error: null,
  };
}

function retainExternalDecision(
  state: ConversationModelState,
  frame: BufferedDecisionFrame,
): ConversationModelState {
  const message: PresenceMessage = {
    id: `reply:${frame.traceId}:${frame.eventId}`,
    kind: "decision",
    role: "qiuqiu",
    text: frame.replyText,
    ts: eventTimestamp(frame),
    traceId: frame.traceId,
    eventId: frame.eventId,
    external: true,
    lateFinal: false,
  };
  return {
    ...state,
    messages: [...state.messages, message],
    authoritativeDecision: frame.event,
  };
}

function bufferPreAckFrame(
  state: ConversationModelState,
  frame: BufferedReplyFrame,
): ConversationModelState {
  if (state.preAckBuffer.length < PRE_ACK_BUFFER_CAPACITY) {
    return { ...state, preAckBuffer: [...state.preAckBuffer, frame] };
  }

  const [evicted, ...remaining] = state.preAckBuffer;
  let next = addDiagnostic(
    { ...state, preAckBuffer: remaining },
    {
      code: "PRE_ACK_BUFFER_OVERFLOW",
      message: "The oldest pre-ACK reply frame was released at the buffer capacity.",
      at: frame.receivedAt,
      eventId: evicted?.eventId,
      traceId: evicted?.traceId,
    },
  );
  if (evicted?.kind === "decision") next = retainExternalDecision(next, evicted);
  return { ...next, preAckBuffer: [...next.preAckBuffer, frame] };
}

function releaseExpiredPreAck(
  state: ConversationModelState,
  now: number,
): ConversationModelState {
  if (state.preAckBuffer.length === 0) return state;

  const expired = state.preAckBuffer.filter(
    (frame) => now - frame.receivedAt >= PRE_ACK_BUFFER_TTL_MS,
  );
  if (expired.length === 0) return state;

  let next: ConversationModelState = {
    ...state,
    preAckBuffer: state.preAckBuffer.filter(
      (frame) => now - frame.receivedAt < PRE_ACK_BUFFER_TTL_MS,
    ),
  };
  for (const frame of expired) next = releaseUnboundFrame(next, frame);
  return next;
}

function releaseAllPreAck(state: ConversationModelState): ConversationModelState {
  if (state.preAckBuffer.length === 0) return state;
  let next: ConversationModelState = { ...state, preAckBuffer: [] };
  for (const frame of state.preAckBuffer) next = releaseUnboundFrame(next, frame);
  return next;
}

function releaseUnboundFrame(
  state: ConversationModelState,
  frame: BufferedReplyFrame,
): ConversationModelState {
  if (frame.kind === "decision") return retainExternalDecision(state, frame);
  return addDiagnostic(state, {
    code: "UNBOUND_STREAM_DROPPED",
    message: "A provisional stream frame could not be bound to the active trace.",
    at: frame.receivedAt,
    eventId: frame.eventId,
    traceId: frame.traceId,
  });
}

function addDiagnostic(
  state: ConversationModelState,
  diagnostic: ConversationDiagnostic,
  surfaceError = false,
): ConversationModelState {
  return {
    ...state,
    diagnostics: appendBounded(state.diagnostics, diagnostic, DIAGNOSTIC_CAPACITY),
    error: surfaceError ? diagnostic.message : state.error,
  };
}

function appendBounded<T>(values: readonly T[], value: T, capacity: number): readonly T[] {
  return [...values, value].slice(-capacity);
}

function upsertProvisional(
  replies: readonly ProvisionalReply[],
  provisional: ProvisionalReply,
): readonly ProvisionalReply[] {
  const index = replies.findIndex((reply) => reply.traceId === provisional.traceId);
  if (index < 0) return [...replies, provisional];
  return replies.map((reply, replyIndex) => (replyIndex === index ? provisional : reply));
}

function upsertMessage(
  messages: readonly PresenceMessage[],
  message: PresenceMessage,
): readonly PresenceMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((candidate, messageIndex) =>
    messageIndex === index ? message : candidate,
  );
}

function eventTimestamp(frame: BufferedDecisionFrame): number {
  const timestamp = Date.parse(frame.event.ts);
  return Number.isFinite(timestamp) ? timestamp : frame.receivedAt;
}

function isPending(attempt: ConversationAttempt): boolean {
  return (
    attempt.status === "sending" ||
    attempt.status === "acknowledged" ||
    attempt.status === "streaming" ||
    attempt.status === "waitingForFinal"
  );
}

function toChatMessage(message: PresenceMessage): ChatMessage {
  const projected: ChatMessage = {
    id: message.id,
    role: message.role,
    text: message.text,
    ts: message.ts,
  };
  return message.platform ? { ...projected, platform: message.platform } : projected;
}
