import { describe, expect, it } from "vitest";

import type { AstrEvent, ConversationProjection } from "@/lib/types";

import {
  PRE_ACK_BUFFER_CAPACITY,
  PRE_ACK_BUFFER_TTL_MS,
  SEEN_EVENT_CAPACITY,
  conversationReducer,
  createConversationState,
  selectConversationProjection,
} from "./conversation";
import type {
  ConversationEvent,
  ConversationModelState,
  DraftSnapshot,
} from "./presence-types";

const draft = (
  text = "你好，星枢",
  revision = 1,
  selectionStart = 2,
  selectionEnd = 4,
): DraftSnapshot => ({ revision, text, selectionStart, selectionEnd });

const reduce = (state: ConversationModelState, event: ConversationEvent) =>
  conversationReducer(state, event);

function send(
  state = createConversationState(draft()),
  attemptId = "attempt-1",
  localMessageId = "local-1",
  at = 1,
) {
  return reduce(state, { type: "LOCAL_SEND", attemptId, localMessageId, at });
}

function acknowledge(
  state: ConversationModelState,
  traceId = "trace-active",
  eventId = "ingest-1",
  at = 2,
) {
  return reduce(state, {
    type: "INGEST_ACK",
    attemptId: "attempt-1",
    receipt: { event_id: eventId, trace_id: traceId },
    at,
  });
}

function astrEvent(
  id: string,
  traceId: string,
  type: "soul.stream" | "soul.decision",
  payload: Record<string, unknown>,
): AstrEvent {
  return {
    id,
    ts: "2026-07-11T00:00:00.000Z",
    type,
    source: "soul.orchestrator",
    payload,
    trace_id: traceId,
  };
}

function streamEvent(
  id: string,
  traceId: string,
  seq: number,
  delta = "",
  done = false,
): AstrEvent {
  return astrEvent(id, traceId, "soul.stream", { seq, delta, done });
}

function decisionEvent(id: string, traceId: string, replyText: string): AstrEvent {
  return astrEvent(id, traceId, "soul.decision", { reply_text: replyText });
}

function unsafeEvent(overrides: Record<string, unknown>): AstrEvent {
  return {
    id: "unsafe-event",
    ts: "2026-07-11T00:00:00.000Z",
    type: "soul.stream",
    source: "soul.orchestrator",
    payload: { seq: 1, delta: "safe", done: false },
    trace_id: "trace-active",
    ...overrides,
  } as unknown as AstrEvent;
}

function ownJsonRecord(
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> {
  const record = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return record;
}

function expectDangerousJsonKeysPreserved(
  clone: Readonly<Record<string, unknown>>,
  source: Readonly<Record<string, unknown>>,
) {
  expect(Object.hasOwn(clone, "__proto__")).toBe(true);
  expect(Object.hasOwn(clone, "constructor")).toBe(true);
  expect(Object.hasOwn(clone, "prototype")).toBe(true);
  expect(Object.hasOwn(clone, "nested")).toBe(true);
  expect([null, Object.prototype]).toContain(Object.getPrototypeOf(clone));

  const nested = clone.nested as Readonly<Record<string, unknown>>;
  expect(Object.hasOwn(nested, "__proto__")).toBe(true);
  expect(Object.hasOwn(nested, "constructor")).toBe(true);
  expect(Object.hasOwn(nested, "prototype")).toBe(true);
  expect([null, Object.prototype]).toContain(Object.getPrototypeOf(nested));
  expect(JSON.parse(JSON.stringify(clone))).toEqual(JSON.parse(JSON.stringify(source)));
  expect(Object.prototype).not.toHaveProperty("reply_text");
  expect(Object.prototype).not.toHaveProperty("seq");
}

function receive(state: ConversationModelState, event: AstrEvent, at: number) {
  return reduce(state, { type: "REPLY_EVENT", event, at });
}

describe("Presence conversation model", () => {
  it("starts a local send with its draft, selection, and message preserved but no receipt", () => {
    const initial = createConversationState(draft("保留这段文字", 7, 1, 5));

    const state = send(initial, "attempt-1", "local-1", 100);

    expect(state).not.toBe(initial);
    expect(initial.messages).toEqual([]);
    expect(state.draft).toEqual(draft("保留这段文字", 7, 1, 5));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "local-1",
      role: "user",
      text: "保留这段文字",
      ts: 100,
      kind: "user",
    });
    expect(state.activeAttempt).toMatchObject({
      id: "attempt-1",
      localMessageId: "local-1",
      status: "sending",
      receipt: null,
      draftSnapshot: draft("保留这段文字", 7, 1, 5),
    });
  });

  it("binds the exact ingest receipt and clears only the acknowledged draft revision", () => {
    const sending = send(createConversationState(draft("first", 3, 2, 4)));

    const acknowledged = acknowledge(sending, "trace-exact", "event-exact", 10);

    expect(acknowledged.activeAttempt?.receipt).toEqual({
      event_id: "event-exact",
      trace_id: "trace-exact",
    });
    expect(acknowledged.draft).toEqual({
      revision: 4,
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });

    const edited = reduce(sending, {
      type: "DRAFT_CHANGED",
      draft: draft("new revision", 4, 4, 8),
      at: 5,
    });
    const acknowledgedAfterEdit = acknowledge(edited, "trace-exact", "event-exact", 10);

    expect(acknowledgedAfterEdit.draft).toEqual(draft("new revision", 4, 4, 8));
  });

  it("keeps the text, selection snapshot, local message, and diagnostic on ingest failure", () => {
    const sending = send(createConversationState(draft("retry me", 8, 2, 6)));

    const failed = reduce(sending, {
      type: "INGEST_FAILED",
      attemptId: "attempt-1",
      message: "Core unavailable",
      at: 20,
    });

    expect(failed.draft).toEqual(draft("retry me", 8, 2, 6));
    expect(failed.messages).toHaveLength(1);
    expect(failed.activeAttempt).toMatchObject({
      status: "failed",
      receipt: null,
      draftSnapshot: draft("retry me", 8, 2, 6),
    });
    expect(failed.diagnostics.at(-1)).toMatchObject({
      code: "INGEST_FAILED",
      message: "Core unavailable",
    });
    expect(failed.error).toBe("Core unavailable");
  });

  it("buffers pre-ACK reply frames and replays only the matching trace in arrival order", () => {
    const activeDelta = streamEvent("stream-1", "trace-active", 1, "provisional");
    const externalDecision = decisionEvent("decision-external", "trace-other", "external");
    const activeDecision = decisionEvent("decision-active", "trace-active", "final");
    let state = send();

    state = receive(state, activeDelta, 2);
    state = receive(state, externalDecision, 3);
    state = receive(state, activeDecision, 4);

    expect(state.preAckBuffer.map((frame) => frame.event.id)).toEqual([
      "stream-1",
      "decision-external",
      "decision-active",
    ]);
    expect(state.provisionalReplies).toEqual([]);
    expect(state.authoritativeDecision).toBeNull();

    state = acknowledge(state, "trace-active", "ingest-1", 5);

    expect(state.preAckBuffer).toEqual([]);
    expect(state.activeAttempt?.status).toBe("final");
    expect(state.messages.map((message) => message.text)).toEqual([
      "你好，星枢",
      "external",
      "final",
    ]);
    expect(state.messages[1]).toMatchObject({ external: true, traceId: "trace-other" });
    expect(state.messages[2]).toMatchObject({
      id: "reply:trace-active",
      external: false,
      traceId: "trace-active",
    });
    expect(state.authoritativeDecision?.id).toBe("decision-active");

    const afterDuplicateReplay = receive(state, activeDelta, 6);
    expect(afterDuplicateReplay).toBe(state);
  });

  it("releases buffered decisions as external truth and drops unbound deltas on ACK failure", () => {
    const delta = streamEvent("stream-before-fail", "trace-unknown", 1, "discard me");
    const decision = decisionEvent("decision-before-fail", "trace-unknown", "retain me");
    let state = send();
    state = receive(state, delta, 2);
    state = receive(state, decision, 3);

    state = reduce(state, {
      type: "INGEST_FAILED",
      attemptId: "attempt-1",
      message: "ACK failed",
      at: 4,
    });

    expect(state.preAckBuffer).toEqual([]);
    expect(state.provisionalReplies).toEqual([]);
    expect(state.messages.filter((message) => message.role === "qiuqiu")).toEqual([
      expect.objectContaining({
        text: "retain me",
        external: true,
        eventId: "decision-before-fail",
      }),
    ]);
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "UNBOUND_STREAM_DROPPED",
    );

    const duplicateDecision = receive(state, decision, 5);
    expect(duplicateDecision).toBe(state);
  });

  it("releases expired pre-ACK frames using explicit reducer time", () => {
    let state = send(createConversationState(draft()), "attempt-1", "local-1", 0);
    state = receive(state, streamEvent("expired-stream", "trace-ttl", 1, "old"), 0);
    state = receive(state, decisionEvent("expired-decision", "trace-ttl", "still true"), 0);

    state = reduce(state, { type: "PRE_ACK_EXPIRED", at: PRE_ACK_BUFFER_TTL_MS });

    expect(state.preAckBuffer).toEqual([]);
    expect(state.messages.at(-1)).toMatchObject({
      text: "still true",
      external: true,
      eventId: "expired-decision",
    });
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "UNBOUND_STREAM_DROPPED",
    );
  });

  it("bounds the pre-ACK buffer and diagnoses capacity eviction", () => {
    let state = send(createConversationState(draft()), "attempt-1", "local-1", 0);

    for (let index = 0; index <= PRE_ACK_BUFFER_CAPACITY; index += 1) {
      state = receive(
        state,
        streamEvent(`buffer-${index}`, `trace-${index}`, 1, String(index)),
        index,
      );
    }

    expect(state.preAckBuffer).toHaveLength(PRE_ACK_BUFFER_CAPACITY);
    expect(state.preAckBuffer[0]?.event.id).toBe("buffer-1");
    expect(state.preAckBuffer.at(-1)?.event.id).toBe(`buffer-${PRE_ACK_BUFFER_CAPACITY}`);
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PRE_ACK_BUFFER_OVERFLOW",
    );
  });

  it("lets only the active trace create or extend provisional text", () => {
    let state = acknowledge(send(), "trace-active");

    state = receive(state, streamEvent("other-stream", "trace-other", 1, "wrong"), 3);
    expect(state.provisionalReplies).toEqual([]);

    state = receive(state, streamEvent("active-stream", "trace-active", 1, "right"), 4);
    expect(state.provisionalReplies).toEqual([
      {
        traceId: "trace-active",
        messageId: "reply:trace-active",
        text: "right",
        lastSeq: 1,
        done: false,
      },
    ]);
    expect(state.activeAttempt?.status).toBe("streaming");
  });

  it("ignores duplicate IDs, duplicate or decreasing seq, and empty deltas", () => {
    let state = acknowledge(send(), "trace-active");
    state = receive(state, streamEvent("stream-1", "trace-active", 1, "A"), 3);
    state = receive(state, streamEvent("stream-2", "trace-active", 2, "B"), 4);
    state = receive(state, streamEvent("stream-2", "trace-active", 3, "duplicate id"), 5);
    state = receive(state, streamEvent("same-seq", "trace-active", 2, "duplicate seq"), 6);
    state = receive(state, streamEvent("decreasing", "trace-active", 1, "decreasing"), 7);
    state = receive(state, streamEvent("empty", "trace-active", 3, ""), 8);
    state = receive(state, streamEvent("stream-3", "trace-active", 3, "C"), 9);

    expect(state.provisionalReplies[0]).toMatchObject({ text: "ABC", lastSeq: 3 });
  });

  it.each(["before done", "after done"])(
    "lets a decision arriving %s replace the provisional bubble in place",
    (ordering) => {
      let state = acknowledge(send(), "trace-active");
      state = receive(state, streamEvent("stream-1", "trace-active", 1, "draft reply"), 3);
      const provisionalMessageId = state.provisionalReplies[0]?.messageId;
      const done = streamEvent("stream-done", "trace-active", 2, "", true);
      const decision = decisionEvent("decision-1", "trace-active", "authoritative reply");

      if (ordering === "after done") state = receive(state, done, 4);
      state = receive(state, decision, 5);
      if (ordering === "before done") state = receive(state, done, 6);

      expect(state.provisionalReplies).toEqual([]);
      expect(state.activeAttempt?.status).toBe("final");
      expect(state.messages.at(-1)).toMatchObject({
        id: provisionalMessageId,
        text: "authoritative reply",
        kind: "decision",
      });
      expect(state.messages.filter((message) => message.id === provisionalMessageId)).toHaveLength(
        1,
      );
    },
  );

  it("never lets a late stream overwrite an authoritative final", () => {
    let state = acknowledge(send(), "trace-active");
    state = receive(state, streamEvent("stream-1", "trace-active", 1, "partial"), 3);
    state = receive(state, decisionEvent("decision-1", "trace-active", "final"), 4);

    state = receive(state, streamEvent("late-stream", "trace-active", 2, " overwrite"), 5);

    expect(state.messages.at(-1)?.text).toBe("final");
    expect(state.provisionalReplies).toEqual([]);
    expect(state.activeAttempt?.status).toBe("final");
  });

  it("finalizes on a decision even when stream done is missing", () => {
    let state = acknowledge(send(), "trace-active");

    state = receive(state, decisionEvent("decision-only", "trace-active", "complete"), 3);

    expect(state.activeAttempt?.status).toBe("final");
    expect(state.authoritativeDecision?.id).toBe("decision-only");
    expect(state.messages.at(-1)?.text).toBe("complete");
  });

  it("keeps done-without-decision waiting for final instead of claiming success", () => {
    let state = acknowledge(send(), "trace-active");
    state = receive(state, streamEvent("stream-1", "trace-active", 1, "partial"), 3);

    state = receive(state, streamEvent("stream-done", "trace-active", 2, "", true), 4);

    expect(state.activeAttempt?.status).toBe("waitingForFinal");
    expect(state.authoritativeDecision).toBeNull();
    expect(selectConversationProjection(state)).toMatchObject({
      provisionalText: "partial",
      provisionalActive: false,
      authoritativeDecision: null,
    });
  });

  it("retains a non-active real decision once without completing the active request", () => {
    const external = decisionEvent("external-decision", "trace-other", "external truth");
    let state = acknowledge(send(), "trace-active");

    state = receive(state, external, 3);

    expect(state.activeAttempt).toMatchObject({
      status: "acknowledged",
      receipt: { event_id: "ingest-1", trace_id: "trace-active" },
    });
    expect(state.messages.at(-1)).toMatchObject({
      text: "external truth",
      external: true,
      traceId: "trace-other",
    });

    const duplicate = receive(state, external, 4);
    expect(duplicate).toBe(state);
  });

  it("preserves timeout evidence and lets a same-trace late decision take over once", () => {
    const originalDraft = draft("timeout text", 11, 3, 7);
    let state = acknowledge(send(createConversationState(originalDraft)), "trace-active");

    state = reduce(state, { type: "REQUEST_TIMED_OUT", attemptId: "attempt-1", at: 10_003 });

    expect(state.activeAttempt).toMatchObject({
      status: "timedOut",
      receipt: { event_id: "ingest-1", trace_id: "trace-active" },
      draftSnapshot: originalDraft,
    });
    expect(state.provisionalReplies).toEqual([]);
    expect(state.messages[0]?.text).toBe("timeout text");
    expect(state.diagnostics.at(-1)?.code).toBe("REQUEST_TIMED_OUT");

    const lateDecision = decisionEvent("late-decision", "trace-active", "late final");
    state = receive(state, lateDecision, 10_004);

    expect(state.activeAttempt).toMatchObject({ status: "final", lateFinal: true });
    expect(state.messages.at(-1)).toMatchObject({ text: "late final", lateFinal: true });
    expect(state.provisionalReplies).toEqual([]);

    const duplicate = receive(state, lateDecision, 10_005);
    expect(duplicate).toBe(state);
  });

  it("ignores a rapid second submit while one attempt is active", () => {
    const first = send();

    const second = reduce(first, {
      type: "LOCAL_SEND",
      attemptId: "attempt-2",
      localMessageId: "local-2",
      at: 2,
    });

    expect(second).toBe(first);
    expect(second.activeAttempt?.id).toBe("attempt-1");
    expect(second.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("bounds seen-event memory to the newest event IDs", () => {
    let state = createConversationState();

    for (let index = 0; index <= SEEN_EVENT_CAPACITY; index += 1) {
      state = receive(
        state,
        decisionEvent(`decision-${index}`, `trace-${index}`, String(index)),
        index,
      );
    }

    expect(state.seenEventIds).toHaveLength(SEEN_EVENT_CAPACITY);
    expect(state.seenEventIds[0]).toBe("decision-1");
    expect(state.seenEventIds.at(-1)).toBe(`decision-${SEEN_EVENT_CAPACITY}`);
  });

  it("drops malformed reply frames with a diagnostic", () => {
    const malformed = astrEvent("malformed", "trace-active", "soul.stream", {
      seq: "one",
      delta: "bad",
    });
    let state = acknowledge(send(), "trace-active");

    state = receive(state, malformed, 3);

    expect(state.provisionalReplies).toEqual([]);
    expect(state.diagnostics.at(-1)?.code).toBe("MALFORMED_REPLY_EVENT");
  });

  it("keeps state JSON-serializable and reducer arrays immutable", () => {
    const initial = createConversationState(draft("immutable"));
    const state = send(initial);

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(Array.isArray(state.messages)).toBe(true);
    expect(Array.isArray(state.preAckBuffer)).toBe(true);
    expect(Array.isArray(state.seenEventIds)).toBe(true);
    expect(initial.messages).toEqual([]);
    expect(state.messages).not.toBe(initial.messages);
  });

  it("selects the exact existing ConversationProjection without internal fields", () => {
    let state = acknowledge(send(), "trace-active", "ingest-exact");
    state = receive(state, streamEvent("stream-1", "trace-active", 1, "typing"), 3);

    const projection = selectConversationProjection(state);
    const exactProjection: ConversationProjection = projection;

    expect(Object.keys(exactProjection)).toEqual([
      "messages",
      "receipt",
      "provisionalText",
      "provisionalActive",
      "authoritativeDecision",
      "error",
    ]);
    expect(exactProjection).toMatchObject({
      receipt: { event_id: "ingest-exact", trace_id: "trace-active" },
      provisionalText: "typing",
      provisionalActive: true,
      authoritativeDecision: null,
      error: null,
    });
    expect(exactProjection.messages).toEqual([
      { id: "local-1", role: "user", text: "你好，星枢", ts: 1 },
    ]);
    expect(Object.keys(exactProjection.messages[0] ?? {})).toEqual(["id", "role", "text", "ts"]);
  });

  it.each([
    ["empty event_id", { event_id: "", trace_id: "trace-active" }],
    ["whitespace event_id", { event_id: "   ", trace_id: "trace-active" }],
    ["empty trace_id", { event_id: "ingest-1", trace_id: "" }],
    ["whitespace trace_id", { event_id: "ingest-1", trace_id: "  \t " }],
  ])("rejects an ACK with %s before draft clearing or buffered replay", (_label, receipt) => {
    let state = send(createConversationState(draft("do not clear", 12, 3, 8)));
    state = receive(state, streamEvent("pre-ack", "trace-active", 1, "buffered"), 2);
    const beforeAck = state;

    const afterAck = reduce(state, {
      type: "INGEST_ACK",
      attemptId: "attempt-1",
      receipt,
      at: 3,
    });

    expect(afterAck).toBe(beforeAck);
    expect(afterAck.draft).toEqual(draft("do not clear", 12, 3, 8));
    expect(afterAck.activeAttempt?.receipt).toBeNull();
    expect(afterAck.preAckBuffer.map((frame) => frame.eventId)).toEqual(["pre-ack"]);
    expect(afterAck.provisionalReplies).toEqual([]);
  });

  it.each([
    ["null payload", { payload: null }],
    ["undefined payload", { payload: undefined }],
    ["array payload", { payload: [{ seq: 1 }] }],
    ["unsupported event type", { type: "agent.thought", payload: {} }],
    ["empty event id", { id: "" }],
    ["whitespace event id", { id: "   " }],
    ["empty trace id", { trace_id: "" }],
    ["whitespace trace id", { trace_id: " \t " }],
  ])("diagnoses %s as malformed without throwing", (_label, overrides) => {
    const event = unsafeEvent(overrides);
    let state = acknowledge(send(), "trace-active");

    expect(() => {
      state = receive(state, event, 3);
    }).not.toThrow();

    expect(state.provisionalReplies).toEqual([]);
    expect(state.diagnostics.at(-1)?.code).toBe("MALFORMED_REPLY_EVENT");
  });

  it.each([
    ["function", () => "unsupported"],
    ["undefined", undefined],
    ["non-finite number", Number.POSITIVE_INFINITY],
    ["non-plain object", new Date("2026-07-11T00:00:00.000Z")],
  ])("rejects a payload containing an unsupported %s value", (_label, unsupported) => {
    const event = unsafeEvent({
      type: "soul.decision",
      payload: { reply_text: "must not survive", unsupported },
    });
    let state = createConversationState();

    state = receive(state, event, 3);

    expect(state.messages).toEqual([]);
    expect(state.authoritativeDecision).toBeNull();
    expect(state.diagnostics.at(-1)?.code).toBe("MALFORMED_REPLY_EVENT");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes local-send time %s to the pure zero fallback",
    (at) => {
      const state = send(createConversationState(draft("finite")), "attempt-1", "local-1", at);

      expect(state.messages[0]?.ts).toBe(0);
      expect(state.activeAttempt?.startedAt).toBe(0);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes draft-change time %s before TTL evaluation",
    (at) => {
      let state = send(createConversationState(draft("first")), "attempt-1", "local-1", 0);
      state = receive(state, streamEvent("buffered", "trace-active", 1, "delta"), 0);

      state = reduce(state, {
        type: "DRAFT_CHANGED",
        draft: draft("edited", 2, 1, 3),
        at,
      });

      expect(state.draft).toEqual(draft("edited", 2, 1, 3));
      expect(state.preAckBuffer.map((frame) => frame.eventId)).toEqual(["buffered"]);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes reply time %s before buffering or message projection",
    (at) => {
      let buffered = send(createConversationState(draft()), "attempt-1", "local-1", 0);
      buffered = receive(buffered, streamEvent("buffered", "trace-active", 1, "delta"), at);
      expect(buffered.preAckBuffer[0]?.receivedAt).toBe(0);

      let external = createConversationState();
      const invalidTsDecision = {
        ...decisionEvent("external", "trace-external", "truth"),
        ts: "not-a-date",
      };
      external = receive(external, invalidTsDecision, at);
      expect(external.messages[0]?.ts).toBe(0);
      expect(JSON.parse(JSON.stringify(external))).toEqual(external);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes ACK time %s before pre-ACK TTL evaluation",
    (at) => {
      let state = send(createConversationState(draft()), "attempt-1", "local-1", 0);
      state = receive(state, decisionEvent("buffered-final", "trace-active", "final"), 0);

      state = reduce(state, {
        type: "INGEST_ACK",
        attemptId: "attempt-1",
        receipt: { event_id: "ingest-1", trace_id: "trace-active" },
        at,
      });

      expect(state.activeAttempt?.status).toBe("final");
      expect(state.authoritativeDecision?.id).toBe("buffered-final");
    },
  );

  it("normalizes non-finite diagnostic event times", () => {
    let failed = send();
    failed = reduce(failed, {
      type: "INGEST_FAILED",
      attemptId: "attempt-1",
      message: "failed",
      at: Number.POSITIVE_INFINITY,
    });
    expect(failed.diagnostics.at(-1)?.at).toBe(0);

    let timedOut = acknowledge(send(), "trace-active");
    timedOut = reduce(timedOut, {
      type: "REQUEST_TIMED_OUT",
      attemptId: "attempt-1",
      at: Number.NaN,
    });
    expect(timedOut.diagnostics.at(-1)?.at).toBe(0);
    expect(JSON.parse(JSON.stringify(timedOut))).toEqual(timedOut);
  });

  it("deep-owns a buffered event and nested payload", () => {
    const payload = {
      seq: 1,
      delta: "original",
      done: false,
      metadata: { tags: ["owned"] },
    };
    const event = astrEvent("buffer-owned", "trace-active", "soul.stream", payload);
    let state = send();

    state = receive(state, event, 2);
    payload.delta = "mutated";
    payload.metadata.tags[0] = "mutated";
    (event as { id: string }).id = "mutated-id";

    expect(state.preAckBuffer[0]?.event).toMatchObject({
      id: "buffer-owned",
      payload: { delta: "original", metadata: { tags: ["owned"] } },
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it.each(["active", "external"])("deep-owns an %s authoritative decision", (scope) => {
    const payload = {
      reply_text: "original final",
      metadata: { reasons: ["owned"] },
    };
    const event = astrEvent(`decision-${scope}`, `trace-${scope}`, "soul.decision", payload);
    let state =
      scope === "active"
        ? acknowledge(send(), "trace-active")
        : createConversationState();

    if (scope === "active") {
      state = receive(
        state,
        { ...event, trace_id: "trace-active" },
        3,
      );
    } else {
      state = receive(state, event, 3);
    }
    payload.reply_text = "mutated";
    payload.metadata.reasons[0] = "mutated";

    expect(state.messages.at(-1)?.text).toBe("original final");
    expect(state.authoritativeDecision?.payload).toMatchObject({
      reply_text: "original final",
      metadata: { reasons: ["owned"] },
    });
    expect(state.authoritativeDecision).not.toBe(event);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("keeps an external decision out of the public authoritative slot while active is pending", () => {
    const external = decisionEvent("external-pending", "trace-other", "external truth");
    let state = acknowledge(send(), "trace-active");

    state = receive(state, external, 3);

    expect(state.messages.at(-1)).toMatchObject({ external: true, text: "external truth" });
    expect(selectConversationProjection(state).authoritativeDecision).toBeNull();
    expect(state.activeAttempt?.status).toBe("acknowledged");
  });

  it("lets the later active final own the projection after an earlier external decision", () => {
    let state = acknowledge(send(), "trace-active");
    state = receive(state, decisionEvent("external-first", "trace-other", "external"), 3);
    state = receive(state, decisionEvent("active-final", "trace-active", "active"), 4);

    expect(state.messages.filter((message) => message.kind === "decision")).toHaveLength(2);
    expect(selectConversationProjection(state).authoritativeDecision?.id).toBe("active-final");
  });

  it("does not let an external decision overwrite an existing active final", () => {
    let state = acknowledge(send(), "trace-active");
    state = receive(state, decisionEvent("active-final", "trace-active", "active"), 3);
    state = receive(state, decisionEvent("external-later", "trace-other", "external"), 4);

    expect(state.messages.at(-1)).toMatchObject({ external: true, text: "external" });
    expect(selectConversationProjection(state).authoritativeDecision?.id).toBe("active-final");
  });

  it("uses an external decision as authoritative truth when there is no active attempt", () => {
    const external = decisionEvent("external-only", "trace-other", "external");

    const state = receive(createConversationState(), external, 1);

    expect(selectConversationProjection(state).authoritativeDecision?.id).toBe("external-only");
  });

  it("retains an overflow-evicted decision externally exactly once", () => {
    const evictedDecision = decisionEvent("overflow-decision", "trace-overflow", "retain once");
    let state = send(createConversationState(draft()), "attempt-1", "local-1", 0);
    state = receive(state, evictedDecision, 0);
    for (let index = 1; index <= PRE_ACK_BUFFER_CAPACITY; index += 1) {
      state = receive(
        state,
        streamEvent(`overflow-stream-${index}`, `trace-${index}`, 1, String(index)),
        index,
      );
    }

    expect(state.messages.filter((message) => message.eventId === "overflow-decision")).toHaveLength(
      1,
    );
    expect(state.messages.find((message) => message.eventId === "overflow-decision")).toMatchObject({
      external: true,
      text: "retain once",
    });
    expect(state.authoritativeDecision).toBeNull();

    const duplicate = receive(state, evictedDecision, PRE_ACK_BUFFER_CAPACITY + 1);
    expect(duplicate).toBe(state);
  });

  it("falls back to reducer time when AstrEvent.ts is invalid", () => {
    const decision = {
      ...decisionEvent("invalid-ts", "trace-active", "final"),
      ts: "not-a-date",
    };
    let state = acknowledge(send(), "trace-active");

    state = receive(state, decision, 77);

    expect(state.messages.at(-1)?.ts).toBe(77);
  });

  it("keeps 1,000 ordered deltas correct while all bounded histories stay bounded", () => {
    let state = acknowledge(send(), "trace-active");

    for (let index = 1; index <= 1_000; index += 1) {
      state = receive(
        state,
        streamEvent(`long-stream-${index}`, "trace-active", index, "x"),
        index + 2,
      );
    }

    expect(state.provisionalReplies[0]).toMatchObject({
      text: "x".repeat(1_000),
      lastSeq: 1_000,
      done: false,
    });
    expect(state.seenEventIds).toHaveLength(SEEN_EVENT_CAPACITY);
    expect(state.preAckBuffer.length).toBeLessThanOrEqual(PRE_ACK_BUFFER_CAPACITY);
    expect(state.diagnostics.length).toBeLessThanOrEqual(64);
  });

  it("expires pre-ACK truth before applying the request timeout", () => {
    let state = send(createConversationState(draft("timeout")), "attempt-1", "local-1", 0);
    state = receive(state, streamEvent("ttl-stream", "trace-ttl", 1, "discard"), 0);
    state = receive(state, decisionEvent("ttl-decision", "trace-ttl", "retain"), 0);

    state = reduce(state, {
      type: "REQUEST_TIMED_OUT",
      attemptId: "attempt-1",
      at: PRE_ACK_BUFFER_TTL_MS,
    });

    expect(state.preAckBuffer).toEqual([]);
    expect(state.activeAttempt?.status).toBe("timedOut");
    expect(state.messages.filter((message) => message.eventId === "ttl-decision")).toHaveLength(1);
    expect(state.messages.at(-1)).toMatchObject({ external: true, text: "retain" });
    expect(state.authoritativeDecision).toBeNull();
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["UNBOUND_STREAM_DROPPED", "REQUEST_TIMED_OUT"]),
    );
  });

  it("preserves decision prototype-shaped JSON keys as owned data", () => {
    const nested = ownJsonRecord([
      ["__proto__", { nested: "proto" }],
      ["constructor", "nested-constructor"],
      ["prototype", "nested-prototype"],
    ]);
    const payload = ownJsonRecord([
      ["reply_text", "legitimate final"],
      ["__proto__", { reply_text: "forged inherited reply" }],
      ["constructor", { name: "owned constructor" }],
      ["prototype", { name: "owned prototype" }],
      ["nested", nested],
    ]);
    const event = unsafeEvent({
      id: "decision-prototype-keys",
      type: "soul.decision",
      trace_id: "trace-decision",
      payload,
    });

    const state = receive(createConversationState(), event, 1);

    expect(state.messages.at(-1)?.text).toBe("legitimate final");
    const clonedPayload = state.authoritativeDecision?.payload;
    expect(clonedPayload).toBeDefined();
    expectDangerousJsonKeysPreserved(clonedPayload ?? {}, payload);
    expect(Object.hasOwn(clonedPayload ?? {}, "reply_text")).toBe(true);
  });

  it("rejects a decision whose reply_text exists only under an own __proto__ key", () => {
    const payload = ownJsonRecord([
      ["__proto__", { reply_text: "forged inherited reply" }],
      ["constructor", "owned constructor"],
      ["prototype", "owned prototype"],
    ]);
    const event = unsafeEvent({
      id: "decision-inherited-fields",
      type: "soul.decision",
      trace_id: "trace-decision",
      payload,
    });

    const state = receive(createConversationState(), event, 1);

    expect(state.messages).toEqual([]);
    expect(state.authoritativeDecision).toBeNull();
    expect(state.diagnostics.at(-1)?.code).toBe("MALFORMED_REPLY_EVENT");
  });

  it("preserves stream prototype-shaped JSON keys as owned data", () => {
    const nested = ownJsonRecord([
      ["__proto__", { nested: "proto" }],
      ["constructor", "nested-constructor"],
      ["prototype", "nested-prototype"],
    ]);
    const payload = ownJsonRecord([
      ["seq", 1],
      ["delta", "legitimate delta"],
      ["done", false],
      ["__proto__", { seq: 99, delta: "forged", done: true }],
      ["constructor", { name: "owned constructor" }],
      ["prototype", { name: "owned prototype" }],
      ["nested", nested],
    ]);
    const event = unsafeEvent({
      id: "stream-prototype-keys",
      type: "soul.stream",
      trace_id: "trace-stream",
      payload,
    });
    const sending = send(createConversationState(draft()), "attempt-1", "local-1", 0);

    const state = receive(sending, event, 1);

    expect(state.preAckBuffer[0]).toMatchObject({
      seq: 1,
      delta: "legitimate delta",
      done: false,
    });
    const clonedPayload = state.preAckBuffer[0]?.event.payload;
    expect(clonedPayload).toBeDefined();
    expectDangerousJsonKeysPreserved(clonedPayload ?? {}, payload);
    expect(Object.hasOwn(clonedPayload ?? {}, "seq")).toBe(true);
    expect(Object.hasOwn(clonedPayload ?? {}, "delta")).toBe(true);
    expect(Object.hasOwn(clonedPayload ?? {}, "done")).toBe(true);
  });

  it("rejects a stream whose protocol fields exist only under an own __proto__ key", () => {
    const payload = ownJsonRecord([
      ["__proto__", { seq: 1, delta: "forged", done: false }],
      ["constructor", "owned constructor"],
      ["prototype", "owned prototype"],
    ]);
    const event = unsafeEvent({
      id: "stream-inherited-fields",
      type: "soul.stream",
      trace_id: "trace-active",
      payload,
    });
    const acknowledged = acknowledge(send(), "trace-active");

    const state = receive(acknowledged, event, 3);

    expect(state.provisionalReplies).toEqual([]);
    expect(state.diagnostics.at(-1)?.code).toBe("MALFORMED_REPLY_EVENT");
  });
});
