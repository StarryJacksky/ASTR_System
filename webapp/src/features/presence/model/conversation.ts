import type { AstrEvent, ChatMessage, ConversationProjection } from "@/lib/types";

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
// Invalid transport/controller times collapse to zero so the reducer stays deterministic and pure.
const INVALID_REDUCER_TIME_FALLBACK = 0;
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
  const at = normalizeReducerTime(event.at);
  if (event.type === "INGEST_ACK" && !isUsableReceipt(event.receipt)) return state;

  const current = releaseExpiredPreAck(state, at);

  switch (event.type) {
    case "DRAFT_CHANGED":
      return { ...current, draft: { ...event.draft } };
    case "LOCAL_SEND":
      return startLocalSend(current, { ...event, at });
    case "INGEST_ACK":
      return applyIngestAck(current, { ...event, at });
    case "INGEST_FAILED":
      return applyIngestFailure(current, { ...event, at });
    case "REPLY_EVENT":
      return receiveReplyEvent(current, event.event, at);
    case "PRE_ACK_EXPIRED":
      return current;
    case "REQUEST_TIMED_OUT":
      return applyRequestTimeout(current, event.attemptId, at);
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
    text: event.draftSnapshot.text,
    ts: event.at,
  };
  const attempt: ConversationAttempt = {
    id: event.attemptId,
    localMessageId: event.localMessageId,
    draftSnapshot: { ...event.draftSnapshot },
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
  const frame = normalizeReplyFrame(event, at);
  if (!frame) {
    return addDiagnostic(state, {
      code: "MALFORMED_REPLY_EVENT",
      message: "Malformed reply event was discarded.",
      at,
      eventId: typeof event.id === "string" ? event.id : undefined,
      traceId: typeof event.trace_id === "string" ? event.trace_id : undefined,
    });
  }
  if (state.seenEventIds.includes(frame.eventId)) return state;

  const next: ConversationModelState = {
    ...state,
    seenEventIds: appendBounded(state.seenEventIds, frame.eventId, SEEN_EVENT_CAPACITY),
  };

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
  if (
    !isNonBlankString(event.id) ||
    !isNonBlankString(event.trace_id) ||
    typeof event.ts !== "string" ||
    typeof event.source !== "string" ||
    (event.type !== "soul.stream" && event.type !== "soul.decision")
  ) {
    return null;
  }
  const payload = cloneJsonRecord(event.payload);
  if (!payload) return null;
  const ownedEvent: AstrEvent = {
    id: event.id,
    ts: event.ts,
    type: event.type,
    source: event.source,
    payload,
    trace_id: event.trace_id,
  };

  if (event.type === "soul.stream") {
    const seq = readOwnField(payload, "seq");
    const delta = Object.hasOwn(payload, "delta") ? readOwnField(payload, "delta") : "";
    const done = Object.hasOwn(payload, "done") ? readOwnField(payload, "done") : false;
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
      event: ownedEvent,
      eventId: ownedEvent.id,
      traceId: ownedEvent.trace_id,
      receivedAt,
      seq: seq as number,
      delta,
      done,
    };
  }

  if (event.type === "soul.decision") {
    const replyText = readOwnField(payload, "reply_text");
    if (typeof replyText !== "string" || replyText.length === 0) return null;
    return {
      kind: "decision",
      event: ownedEvent,
      eventId: ownedEvent.id,
      traceId: ownedEvent.trace_id,
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
    authoritativeDecision: state.activeAttempt ? state.authoritativeDecision : frame.event,
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

function normalizeReducerTime(at: number): number {
  return Number.isFinite(at) ? at : INVALID_REDUCER_TIME_FALLBACK;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableReceipt(receipt: { readonly event_id: string; readonly trace_id: string }): boolean {
  return isNonBlankString(receipt.event_id) && isNonBlankString(receipt.trace_id);
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonCloneResult = { readonly valid: true; readonly value: JsonValue } | { readonly valid: false };

function cloneJsonRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!isPlainRecord(value)) return null;
  try {
    const result = cloneJsonValue(value, []);
    if (
      !result.valid ||
      result.value === null ||
      typeof result.value !== "object" ||
      Array.isArray(result.value)
    ) {
      return null;
    }
    return result.value;
  } catch {
    return null;
  }
}

function cloneJsonValue(value: unknown, ancestors: readonly object[]): JsonCloneResult {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { valid: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  }
  if (typeof value !== "object" || ancestors.includes(value)) return { valid: false };

  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    const cloned: JsonValue[] = [];
    for (const item of value) {
      const result = cloneJsonValue(item, nextAncestors);
      if (!result.valid) return result;
      cloned.push(result.value);
    }
    return { valid: true, value: cloned };
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return { valid: false };
  }

  const cloned = Object.create(null) as { [key: string]: JsonValue };
  for (const key of Object.keys(value)) {
    const result = cloneJsonValue(value[key], nextAncestors);
    if (!result.valid) return result;
    Object.defineProperty(cloned, key, {
      value: result.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { valid: true, value: cloned };
}

function readOwnField(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
