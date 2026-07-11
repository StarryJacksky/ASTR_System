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
});
