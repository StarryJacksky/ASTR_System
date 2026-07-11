import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoreClient } from "@/features/presence/data/core-client";
import type {
  PresenceStreamDiagnostic,
  PresenceTransportState,
} from "@/features/presence/data/presence-stream";
import type { DraftSnapshot } from "@/features/presence/model/presence-types";
import { createSemanticStore } from "@/lib/semantic-store";
import type { AstrEvent, CoreStatus, EffectorStatus } from "@/lib/types";

import {
  LIFE_EVENT_DEDUPE_CAPACITY,
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  createPresenceController,
  type PresenceControllerStream,
  type PresenceControllerStreamCallbacks,
} from "./create-presence-controller";

const CORE_STATUS: CoreStatus = {
  soul_name: "justin",
  display_name: "露怀秋",
  local_llm_model: "local-model",
  cost_today_usd: 0.25,
  daily_budget_usd: 2,
  emotion: {
    loneliness: 0.1,
    talkativeness: 0.2,
    irritation: 0.3,
    excitement: 0.4,
  },
  activity: "reading",
};

const CLEAR_EFFECTOR: EffectorStatus = {
  stopped: false,
  pending: {},
  audit_tail: [],
};

const LATCHED_EFFECTOR: EffectorStatus = {
  stopped: true,
  pending: {},
  audit_tail: [],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function draft(text = "hello", revision = 1): DraftSnapshot {
  return {
    revision,
    text,
    selectionStart: 1,
    selectionEnd: Math.min(text.length, 4),
  };
}

function event(
  type: string,
  id: string,
  traceId = "trace-1",
  payload: Readonly<Record<string, unknown>> = {},
): AstrEvent {
  return {
    id,
    ts: "2026-07-11T08:00:00.000Z",
    type,
    source: "soul.orchestrator",
    payload,
    trace_id: traceId,
  };
}

class ControlledStream implements PresenceControllerStream {
  readonly start = vi.fn();
  readonly close = vi.fn();

  constructor(readonly callbacks: PresenceControllerStreamCallbacks) {}

  emitState(state: PresenceTransportState): void {
    this.callbacks.onState(state);
  }

  emitEvent(value: AstrEvent): void {
    this.callbacks.onEvent(value);
  }

  emitDiagnostic(diagnostic: PresenceStreamDiagnostic): void {
    this.callbacks.onDiagnostic(diagnostic);
  }
}

function createCoreMock() {
  return {
    status: vi.fn<CoreClient["status"]>(async () => CORE_STATUS),
    ingest: vi.fn<CoreClient["ingest"]>(async () => ({
      event_id: "ingest-event-1",
      trace_id: "trace-1",
    })),
    transcribe: vi.fn<CoreClient["transcribe"]>(async () => ({ text: "" })),
    effectorStatus: vi.fn<CoreClient["effectorStatus"]>(async () => CLEAR_EFFECTOR),
    estop: vi.fn<CoreClient["estop"]>(async () => ({ stopped: true })),
    reset: vi.fn<CoreClient["reset"]>(async () => ({ stopped: false })),
  } satisfies CoreClient;
}

function setup(
  options: {
    readonly core?: ReturnType<typeof createCoreMock>;
    readonly statusPollMs?: number;
    readonly statusOfflineGraceMs?: number;
    readonly replyDeadlineMs?: number;
  } = {},
) {
  const core = options.core ?? createCoreMock();
  const semanticStore = createSemanticStore();
  let stream: ControlledStream | null = null;
  const streamFactory = vi.fn((callbacks: PresenceControllerStreamCallbacks) => {
    stream = new ControlledStream(callbacks);
    return stream;
  });
  let nextId = 0;
  const controller = createPresenceController({
    coreClient: core,
    semanticStore,
    streamFactory,
    now: () => Date.now(),
    idFactory: (kind) => `${kind}-${++nextId}`,
    statusPollMs: options.statusPollMs,
    statusOfflineGraceMs: options.statusOfflineGraceMs,
    replyDeadlineMs: options.replyDeadlineMs,
  });

  return {
    controller,
    core,
    semanticStore,
    streamFactory,
    stream: () => {
      if (!stream) throw new Error("Stream has not been created");
      return stream;
    },
  };
}

describe("createPresenceController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("owns one poller and one stream while exposing a stable frozen external-store snapshot", async () => {
    const { controller, core, semanticStore, streamFactory, stream } = setup();
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);
    expect(controller.getServerSnapshot()).toBe(PRESENCE_CONTROLLER_SERVER_SNAPSHOT);
    expect(controller.getServerSnapshot()).toBe(controller.getServerSnapshot());
    expect(controller.subscribe).toBe(controller.subscribe);
    expect(controller.getSnapshot).toBe(controller.getSnapshot);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.semantic)).toBe(true);
    expect(Object.isFrozen(initial.lifeEvents)).toBe(true);
    expect(Object.isFrozen(initial.diagnostics)).toBe(true);
    expect(initial).toMatchObject({
      status: null,
      safetyEvidence: "checking",
      effectorStatus: null,
      lifeEvents: [],
      diagnostics: [],
    });

    controller.start();
    controller.start();

    expect(streamFactory).toHaveBeenCalledTimes(1);
    expect(stream().start).toHaveBeenCalledTimes(1);
    expect(core.status).toHaveBeenCalledTimes(1);
    expect(core.effectorStatus).toHaveBeenCalledTimes(1);
    expect(semanticStore.getState()).toMatchObject({
      core: "loading",
      replySse: "connecting",
      lifeSse: "connecting",
      safety: "stopUnknown",
    });
    expect(controller.getSnapshot()).not.toBe(initial);

    await flushAsync();

    const resolved = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(resolved);
    expect(resolved.status).toEqual({
      internalHandle: "justin",
      displayName: "露怀秋",
      model: "local-model",
      costTodayUsd: 0.25,
      dailyBudgetUsd: 2,
      emotion: CORE_STATUS.emotion,
      activity: "reading",
    });
    expect(resolved.safetyEvidence).toBe("clear");
    expect(resolved.effectorStatus).toEqual(CLEAR_EFFECTOR);
    expect(resolved.semantic).toMatchObject({ core: "reachable", safety: "normal" });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(core.status).toHaveBeenCalledTimes(2);
    expect(streamFactory).toHaveBeenCalledTimes(1);
  });

  it("maps one physical transport transition to both semantic regions atomically", async () => {
    const { controller, semanticStore, stream } = setup();
    controller.start();
    await flushAsync();
    const listener = vi.fn();
    const unsubscribe = semanticStore.subscribe(listener);

    for (const [transport, semantic] of [
      ["open", "open"],
      ["retrying", "retrying"],
      ["connecting", "connecting"],
      ["closed", "closed"],
    ] as const) {
      listener.mockClear();
      stream().emitState(transport);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(semanticStore.getState()).toMatchObject({
        replySse: semantic,
        lifeSse: semantic,
      });
    }

    unsubscribe();
  });

  it("publishes deeply owned and frozen projections that consumers cannot corrupt", async () => {
    const richEffector: EffectorStatus = {
      stopped: false,
      pending: {
        job: { summary: "pending summary", tool: "desktop" },
      },
      audit_tail: [{ nested: { value: 1 } }],
    };
    const core = createCoreMock();
    core.effectorStatus.mockResolvedValueOnce(richEffector);
    const { controller, stream } = setup({ core });
    controller.start();
    await flushAsync();
    expect(await controller.actions.send(draft("immutable projection"))).toBe(true);

    const originalDecision = event("soul.decision", "owned-decision", "trace-1", {
      reply_text: "owned answer",
      nested: { value: 1 },
    });
    const originalDiagnostic: PresenceStreamDiagnostic = {
      code: "MALFORMED_SSE_FRAME",
      eventName: "agent.thought",
      reason: "shape",
      at: Date.now(),
    };
    stream().emitEvent(originalDecision);
    stream().emitDiagnostic(originalDiagnostic);

    const snapshot = controller.getSnapshot();
    const lifeDecision = snapshot.lifeEvents[0];
    const authoritativeDecision = snapshot.conversation.authoritativeDecision;
    const pendingAction = snapshot.effectorStatus?.pending.job;
    const auditEntry = snapshot.effectorStatus?.audit_tail[0];
    const auditNested = auditEntry?.nested as Readonly<Record<string, unknown>> | undefined;

    expect(snapshot.status?.emotion).not.toBe(CORE_STATUS.emotion);
    expect(lifeDecision).not.toBe(originalDecision);
    expect(lifeDecision?.payload).not.toBe(originalDecision.payload);
    expect(snapshot.effectorStatus).not.toBe(richEffector);
    expect(snapshot.diagnostics.at(-1)).not.toBe(originalDiagnostic);
    for (const value of [
      snapshot.status,
      snapshot.status?.emotion,
      snapshot.conversation,
      snapshot.conversation.messages,
      ...snapshot.conversation.messages,
      snapshot.conversation.receipt,
      authoritativeDecision,
      authoritativeDecision?.payload,
      lifeDecision,
      lifeDecision?.payload,
      snapshot.effectorStatus,
      snapshot.effectorStatus?.pending,
      pendingAction,
      snapshot.effectorStatus?.audit_tail,
      auditEntry,
      auditNested,
      snapshot.diagnostics.at(-1),
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    expect(Reflect.set(lifeDecision?.payload ?? {}, "reply_text", "corrupted")).toBe(false);
    expect(Reflect.set(pendingAction ?? {}, "summary", "corrupted")).toBe(false);
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(controller.getSnapshot().conversation.authoritativeDecision?.payload.reply_text).toBe(
      "owned answer",
    );
    expect(controller.getSnapshot().effectorStatus?.pending.job?.summary).toBe(
      "pending summary",
    );

    (originalDecision.payload.nested as { value: number }).value = 9;
    (richEffector.pending.job as { summary: string }).summary = "changed outside";
    expect(controller.getSnapshot().lifeEvents[0]?.payload.nested).toEqual({ value: 1 });
    expect(controller.getSnapshot().effectorStatus?.pending.job?.summary).toBe(
      "pending summary",
    );
  });

  it("records the first status failure immediately but waits for a second failure before offline", async () => {
    const core = createCoreMock();
    core.status
      .mockResolvedValueOnce(CORE_STATUS)
      .mockRejectedValueOnce(new Error("poll one failed"))
      .mockRejectedValueOnce(new Error("poll two failed"))
      .mockResolvedValueOnce({ ...CORE_STATUS, activity: "recovered" });
    const { controller, semanticStore } = setup({ core, statusPollMs: 1_000 });
    controller.start();
    await flushAsync();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(semanticStore.getState().core).toBe("reachable");
    expect(controller.getSnapshot().status?.activity).toBe("reading");
    expect(controller.getSnapshot().diagnostics.at(-1)).toMatchObject({
      code: "STATUS_REQUEST_FAILED",
      message: "poll one failed",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(semanticStore.getState().core).toBe("offline");
    expect(controller.getSnapshot().status?.activity).toBe("reading");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(semanticStore.getState().core).toBe("reachable");
    expect(controller.getSnapshot().status?.activity).toBe("recovered");
  });

  it("marks Core offline after the first failure remains unresolved for the grace interval", async () => {
    const core = createCoreMock();
    core.status.mockRejectedValue(new Error("Core unreachable"));
    const { controller, semanticStore } = setup({
      core,
      statusPollMs: 10_000,
      statusOfflineGraceMs: 3_000,
    });
    controller.start();
    await flushAsync();

    expect(semanticStore.getState().core).toBe("loading");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(semanticStore.getState().core).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);
    expect(semanticStore.getState().core).toBe("offline");
  });

  it("never overlaps status requests", async () => {
    const pending = deferred<CoreStatus>();
    const core = createCoreMock();
    core.status.mockImplementationOnce(() => pending.promise);
    const { controller } = setup({ core, statusPollMs: 1_000 });
    controller.start();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(core.status).toHaveBeenCalledTimes(1);

    pending.resolve(CORE_STATUS);
    await flushAsync();
    await vi.advanceTimersByTimeAsync(999);
    expect(core.status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(core.status).toHaveBeenCalledTimes(2);
  });

  it("allows only one ingest and cancels the deadline only after a pre-ACK frame binds", async () => {
    const receipt = deferred<{ event_id: string; trace_id: string }>();
    const core = createCoreMock();
    core.ingest.mockImplementationOnce(() => receipt.promise);
    const { controller, semanticStore, stream } = setup({ core });
    controller.start();
    await flushAsync();

    const firstSend = controller.actions.send(draft("keep exact draft", 7));
    const secondSend = controller.actions.send(draft("duplicate", 8));

    expect(await secondSend).toBe(false);
    expect(core.ingest).toHaveBeenCalledTimes(1);
    expect(core.ingest).toHaveBeenCalledWith(
      { text: "keep exact draft", platform: "web" },
      expect.any(AbortSignal),
    );
    expect(controller.getSnapshot().conversation.messages).toHaveLength(1);
    expect(controller.getSnapshot().draft).toEqual(draft("keep exact draft", 7));
    expect(semanticStore.getState().conversation).toBe("sending");

    stream().emitEvent(
      event("soul.stream", "stream-before-ack", "trace-1", {
        seq: 1,
        delta: "bound later",
        done: false,
      }),
    );
    expect(controller.getSnapshot().conversation.provisionalText).toBe("");
    expect(semanticStore.getState().conversation).toBe("sending");

    await vi.advanceTimersByTimeAsync(9_999);
    expect(controller.getSnapshot().conversation.error).toBeNull();

    receipt.resolve({ event_id: "ack-1", trace_id: "trace-1" });
    expect(await firstSend).toBe(true);
    await flushAsync();

    expect(controller.getSnapshot().conversation).toMatchObject({
      receipt: { event_id: "ack-1", trace_id: "trace-1" },
      provisionalText: "bound later",
      provisionalActive: true,
      error: null,
    });
    expect(controller.getSnapshot().draft.text).toBe("");
    expect(semanticStore.getState().conversation).toBe("streaming");

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().conversation.error).toBeNull();
    expect(
      controller.getSnapshot().diagnostics.some(({ code }) => code === "REQUEST_TIMED_OUT"),
    ).toBe(false);
  });

  it("does not let an unbound pre-ACK frame suppress the request timeout", async () => {
    const receipt = deferred<{ event_id: string; trace_id: string }>();
    const core = createCoreMock();
    core.ingest.mockImplementationOnce(() => receipt.promise);
    const { controller, semanticStore, stream } = setup({ core });
    controller.start();
    await flushAsync();

    const sending = controller.actions.send(draft("timeout before ack"));
    stream().emitEvent(
      event("soul.stream", "pre-ack-timeout", "trace-1", {
        seq: 1,
        delta: "not yet bound",
        done: false,
      }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(semanticStore.getState().conversation).toBe("error");
    expect(controller.getSnapshot().conversation.error).toContain("No reply frame");
    expect(controller.getSnapshot().diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["UNBOUND_STREAM_DROPPED", "REQUEST_TIMED_OUT"]),
    );

    receipt.resolve({ event_id: "late-ack", trace_id: "trace-1" });
    expect(await sending).toBe(false);
    expect(controller.getSnapshot().conversation.receipt).toBeNull();
    expect(controller.getSnapshot().draft.text).toBe("timeout before ack");
  });

  it("schedules a quiet pre-ACK expiry independently from the longer request deadline", async () => {
    const receipt = deferred<{ event_id: string; trace_id: string }>();
    const core = createCoreMock();
    core.ingest.mockImplementationOnce(() => receipt.promise);
    const { controller, semanticStore, stream } = setup({ core, replyDeadlineMs: 20_000 });
    controller.start();
    await flushAsync();

    const sending = controller.actions.send(draft("buffer expiry"));
    stream().emitEvent(
      event("soul.stream", "expires-unbound", "trace-late-ack", {
        seq: 1,
        delta: "temporary",
        done: false,
      }),
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(
      controller.getSnapshot().diagnostics.some(({ code }) => code === "UNBOUND_STREAM_DROPPED"),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      controller.getSnapshot().diagnostics.some(({ code }) => code === "UNBOUND_STREAM_DROPPED"),
    ).toBe(true);
    expect(semanticStore.getState().conversation).toBe("sending");

    receipt.resolve({ event_id: "ack-after-expiry", trace_id: "trace-late-ack" });
    expect(await sending).toBe(true);
    expect(controller.getSnapshot().conversation.provisionalText).toBe("");
  });

  it("times out an acknowledged request and lets one late bound decision finalize it", async () => {
    const { controller, semanticStore, stream } = setup();
    controller.start();
    await flushAsync();
    expect(await controller.actions.send(draft("wait for final"))).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.getSnapshot().conversation).toMatchObject({
      receipt: { event_id: "ingest-event-1", trace_id: "trace-1" },
    });
    expect(controller.getSnapshot().conversation.error).toContain("No reply frame");
    expect(semanticStore.getState().conversation).toBe("error");

    const lateDecision = event("soul.decision", "late-decision", "trace-1", {
      reply_text: "authoritative late answer",
    });
    stream().emitEvent(lateDecision);
    stream().emitEvent(lateDecision);

    expect(semanticStore.getState().conversation).toBe("final");
    expect(controller.getSnapshot().conversation.authoritativeDecision).toEqual(lateDecision);
    expect(controller.getSnapshot().conversation.messages).toEqual([
      expect.objectContaining({ role: "user", text: "wait for final" }),
      expect.objectContaining({ role: "qiuqiu", text: "authoritative late answer" }),
    ]);
  });

  it("preserves the draft and cancels the reply timer when ingest fails", async () => {
    const core = createCoreMock();
    core.ingest.mockRejectedValueOnce(new Error("ingest unavailable"));
    const { controller, semanticStore } = setup({ core });
    controller.start();
    await flushAsync();
    const exactDraft = draft("retry this exact selection", 12);

    expect(await controller.actions.send(exactDraft)).toBe(false);

    expect(controller.getSnapshot().draft).toEqual(exactDraft);
    expect(controller.getSnapshot().conversation.error).toBe("ingest unavailable");
    expect(semanticStore.getState().conversation).toBe("error");
    expect(controller.getSnapshot().diagnostics.at(-1)).toMatchObject({
      code: "INGEST_FAILED",
      message: "ingest unavailable",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      controller.getSnapshot().diagnostics.filter(({ code }) => code === "REQUEST_TIMED_OUT"),
    ).toHaveLength(0);
  });

  it("keeps only deduplicated raw life types and bounds life plus diagnostics", async () => {
    const pendingIngest = deferred<{ event_id: string; trace_id: string }>();
    const core = createCoreMock();
    core.ingest.mockImplementationOnce(() => pendingIngest.promise);
    const { controller, semanticStore, stream } = setup({ core });
    controller.start();
    await flushAsync();
    const sending = controller.actions.send(draft("active request"));
    stream().emitState("open");

    for (let index = 1; index <= 65; index += 1) {
      stream().emitEvent(event("agent.thought", `thought-${index}`, `thought-trace-${index}`));
    }
    const beforeDuplicateLifeEvent = controller.getSnapshot();
    stream().emitEvent(event("agent.thought", "thought-65", "thought-trace-65"));
    expect(controller.getSnapshot()).toBe(beforeDuplicateLifeEvent);
    stream().emitEvent(event("moa.report", "moa-1", "moa-trace"));
    stream().emitEvent(event("presentation.express", "presentation-1", "present-trace"));
    const externalDecision = event("soul.decision", "decision-life", "other-trace", {
      reply_text: "external history",
    });
    stream().emitEvent(externalDecision);
    pendingIngest.resolve({ event_id: "active-ack", trace_id: "trace-1" });
    expect(await sending).toBe(true);
    await flushAsync();

    expect(controller.getSnapshot().lifeEvents).toHaveLength(60);
    expect(new Set(controller.getSnapshot().lifeEvents.map(({ id }) => id)).size).toBe(60);
    expect(controller.getSnapshot().lifeEvents.at(-1)).toEqual(externalDecision);
    expect(controller.getSnapshot().lifeEvents.some(({ id }) => id === "presentation-1")).toBe(
      false,
    );
    expect(
      controller
        .getSnapshot()
        .lifeEvents.every(({ type }) =>
          ["agent.thought", "moa.report", "soul.decision"].includes(type),
        ),
    ).toBe(true);
    expect(controller.getSnapshot().conversation.messages).toContainEqual(
      expect.objectContaining({ text: "external history" }),
    );
    expect(semanticStore.getState().conversation).toBe("sending");

    for (let index = 0; index < 70; index += 1) {
      stream().emitDiagnostic({
        code: "MALFORMED_SSE_FRAME",
        eventName: "agent.thought",
        reason: "json",
        at: Date.now() + index,
      });
    }
    expect(controller.getSnapshot().diagnostics).toHaveLength(64);
    expect(semanticStore.getState()).toMatchObject({ replySse: "open", lifeSse: "open" });

    controller.dispose();
  });

  it("bounds life-event dedupe history while retaining duplicate protection for the visible window", async () => {
    const { controller, stream } = setup();
    controller.start();
    await flushAsync();

    for (let index = 0; index <= LIFE_EVENT_DEDUPE_CAPACITY; index += 1) {
      stream().emitEvent(event("agent.thought", `bounded-${index}`, `trace-${index}`));
    }
    expect(controller.getSnapshot().lifeEvents).toHaveLength(60);

    const beforeVisibleDuplicate = controller.getSnapshot();
    stream().emitEvent(
      event(
        "agent.thought",
        `bounded-${LIFE_EVENT_DEDUPE_CAPACITY}`,
        `trace-${LIFE_EVENT_DEDUPE_CAPACITY}`,
      ),
    );
    expect(controller.getSnapshot()).toBe(beforeVisibleDuplicate);

    stream().emitEvent(event("agent.thought", "bounded-0", "trace-0"));
    expect(controller.getSnapshot().lifeEvents).toHaveLength(60);
    expect(controller.getSnapshot().lifeEvents.at(-1)?.id).toBe("bounded-0");
  });

  it.each([
    {
      label: "clear",
      result: CLEAR_EFFECTOR,
      evidence: "clear",
      semantic: "normal",
    },
    {
      label: "latched",
      result: LATCHED_EFFECTOR,
      evidence: "latched",
      semantic: "stoppedLatched",
    },
  ] as const)("maps startup effector evidence to $label", async ({ result, evidence, semantic }) => {
    const core = createCoreMock();
    core.effectorStatus.mockResolvedValueOnce(result);
    const { controller, semanticStore } = setup({ core });

    controller.start();
    expect(controller.getSnapshot().safetyEvidence).toBe("checking");
    expect(semanticStore.getState().safety).toBe("stopUnknown");
    await flushAsync();

    expect(controller.getSnapshot()).toMatchObject({
      safetyEvidence: evidence,
      effectorStatus: result,
    });
    expect(semanticStore.getState().safety).toBe(semantic);
  });

  it("keeps failed startup safety evidence unknown without disabling e-stop", async () => {
    const core = createCoreMock();
    core.effectorStatus.mockRejectedValueOnce(new Error("status readback unavailable"));
    const { controller, semanticStore } = setup({ core });
    controller.start();
    await flushAsync();

    expect(controller.getSnapshot()).toMatchObject({
      safetyEvidence: "unknown",
      effectorStatus: null,
    });
    expect(controller.getSnapshot().diagnostics.at(-1)).toMatchObject({
      code: "SAFETY_STATUS_FAILED",
      message: "status readback unavailable",
    });
    expect(semanticStore.getState().safety).toBe("stopUnknown");

    core.effectorStatus.mockResolvedValueOnce(LATCHED_EFFECTOR);
    expect(await controller.actions.estop()).toBe(true);
    expect(core.estop).toHaveBeenCalledTimes(1);
    expect(semanticStore.getState().safety).toBe("stoppedLatched");
  });

  it("orders e-stop and reset as requested semantic state, POST, then authoritative GET", async () => {
    const core = createCoreMock();
    const { controller, semanticStore } = setup({ core });
    controller.start();
    await flushAsync();
    const order: string[] = [];
    core.estop.mockImplementationOnce(async () => {
      order.push("estop-post");
      return { stopped: false };
    });
    core.effectorStatus.mockImplementationOnce(async () => {
      order.push("estop-get");
      return LATCHED_EFFECTOR;
    });

    const stopping = controller.actions.estop();
    expect(semanticStore.getState().safety).toBe("stopRequested");
    expect(controller.getSnapshot().safetyEvidence).toBe("checking");
    expect(await stopping).toBe(true);
    expect(order).toEqual(["estop-post", "estop-get"]);
    expect(controller.getSnapshot()).toMatchObject({
      safetyEvidence: "latched",
      effectorStatus: LATCHED_EFFECTOR,
    });
    expect(semanticStore.getState().safety).toBe("stoppedLatched");

    core.reset.mockImplementationOnce(async () => {
      order.push("reset-post");
      return { stopped: true };
    });
    core.effectorStatus.mockImplementationOnce(async () => {
      order.push("reset-get");
      return CLEAR_EFFECTOR;
    });
    const resetting = controller.actions.reset();
    expect(semanticStore.getState().safety).toBe("resetting");
    expect(await resetting).toBe(true);
    expect(order).toEqual(["estop-post", "estop-get", "reset-post", "reset-get"]);
    expect(controller.getSnapshot()).toMatchObject({
      safetyEvidence: "clear",
      effectorStatus: CLEAR_EFFECTOR,
    });
    expect(semanticStore.getState().safety).toBe("normal");
  });

  it("uses readback rather than POST bodies and maps contrary or failed outcomes truthfully", async () => {
    const core = createCoreMock();
    const { controller, semanticStore } = setup({ core });
    controller.start();
    await flushAsync();

    core.estop.mockResolvedValueOnce({ stopped: true });
    core.effectorStatus.mockResolvedValueOnce(CLEAR_EFFECTOR);
    expect(await controller.actions.estop()).toBe(false);
    expect(controller.getSnapshot().safetyEvidence).toBe("unknown");
    expect(controller.getSnapshot().effectorStatus).toEqual(CLEAR_EFFECTOR);
    expect(semanticStore.getState().safety).toBe("stopUnknown");

    core.reset.mockResolvedValueOnce({ stopped: false });
    core.effectorStatus.mockResolvedValueOnce(LATCHED_EFFECTOR);
    expect(await controller.actions.reset()).toBe(false);
    expect(controller.getSnapshot().safetyEvidence).toBe("latched");
    expect(semanticStore.getState().safety).toBe("stoppedLatched");

    core.estop.mockRejectedValueOnce(new Error("stop POST failed"));
    expect(await controller.actions.estop()).toBe(false);
    expect(controller.getSnapshot().safetyEvidence).toBe("unknown");
    expect(semanticStore.getState().safety).toBe("stopUnknown");

    core.reset.mockResolvedValueOnce({ stopped: false });
    core.effectorStatus.mockRejectedValueOnce(new Error("reset readback failed"));
    expect(await controller.actions.reset()).toBe(false);
    expect(controller.getSnapshot().safetyEvidence).toBe("unknown");
    expect(semanticStore.getState().safety).toBe("stopUnknown");
  });

  it("lets reset supersede startup evidence and ignores the aborted startup completion", async () => {
    const startup = deferred<EffectorStatus>();
    let startupSignal: AbortSignal | undefined;
    const core = createCoreMock();
    core.effectorStatus
      .mockImplementationOnce((signal) => {
        startupSignal = signal;
        return startup.promise;
      })
      .mockResolvedValueOnce(CLEAR_EFFECTOR);
    const { controller, semanticStore } = setup({ core });
    controller.start();

    const resetting = controller.actions.reset();
    expect(startupSignal?.aborted).toBe(true);
    expect(semanticStore.getState().safety).toBe("resetting");
    expect(await resetting).toBe(true);
    expect(controller.getSnapshot().safetyEvidence).toBe("clear");

    startup.resolve(LATCHED_EFFECTOR);
    await flushAsync();
    expect(controller.getSnapshot().effectorStatus).toEqual(CLEAR_EFFECTOR);
    expect(controller.getSnapshot().safetyEvidence).toBe("clear");
    expect(semanticStore.getState().safety).toBe("normal");
  });

  it("rejects reset during a mutation while e-stop preempts that mutation and always runs", async () => {
    const resetPost = deferred<{ stopped: boolean }>();
    let resetSignal: AbortSignal | undefined;
    const core = createCoreMock();
    core.reset.mockImplementationOnce((signal) => {
      resetSignal = signal;
      return resetPost.promise;
    });
    const { controller, semanticStore } = setup({ core });
    controller.start();
    await flushAsync();

    const firstReset = controller.actions.reset();
    expect(await controller.actions.reset()).toBe(false);
    expect(core.reset).toHaveBeenCalledTimes(1);

    core.effectorStatus.mockResolvedValueOnce(LATCHED_EFFECTOR);
    const stopping = controller.actions.estop();
    expect(resetSignal?.aborted).toBe(true);
    expect(await stopping).toBe(true);
    expect(core.estop).toHaveBeenCalledTimes(1);
    expect(semanticStore.getState().safety).toBe("stoppedLatched");

    resetPost.resolve({ stopped: false });
    expect(await firstReset).toBe(false);
    await flushAsync();
    expect(core.effectorStatus).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().safetyEvidence).toBe("latched");
    expect(semanticStore.getState().safety).toBe("stoppedLatched");
  });

  it("aborts in-flight work, closes once, clears every timer, and ignores all late completion", async () => {
    const status = deferred<CoreStatus>();
    const safety = deferred<EffectorStatus>();
    const ingest = deferred<{ event_id: string; trace_id: string }>();
    const core = createCoreMock();
    core.status.mockImplementationOnce(() => status.promise);
    core.effectorStatus.mockImplementationOnce(() => safety.promise);
    core.ingest.mockImplementationOnce(() => ingest.promise);
    const { controller, semanticStore, stream } = setup({ core, replyDeadlineMs: 20_000 });
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.start();
    const sending = controller.actions.send(draft("dispose me"));
    stream().emitEvent(
      event("soul.stream", "buffered-at-dispose", "trace-1", {
        seq: 1,
        delta: "buffered",
        done: false,
      }),
    );

    const statusSignal = core.status.mock.calls[0]?.[0];
    const safetySignal = core.effectorStatus.mock.calls[0]?.[0];
    const ingestSignal = core.ingest.mock.calls[0]?.[1];
    controller.dispose();
    controller.dispose();
    const disposedSnapshot = controller.getSnapshot();

    expect(statusSignal?.aborted).toBe(true);
    expect(safetySignal?.aborted).toBe(true);
    expect(ingestSignal?.aborted).toBe(true);
    expect(stream().close).toHaveBeenCalledTimes(1);
    expect(semanticStore.getState()).toMatchObject({ replySse: "closed", lifeSse: "closed" });
    expect(vi.getTimerCount()).toBe(0);

    listener.mockClear();
    status.resolve({ ...CORE_STATUS, activity: "too late" });
    safety.resolve(LATCHED_EFFECTOR);
    ingest.resolve({ event_id: "too-late", trace_id: "trace-1" });
    expect(await sending).toBe(false);
    await flushAsync();

    expect(listener).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(disposedSnapshot);
    expect(controller.getSnapshot().status).toBeNull();
    expect(controller.getSnapshot().safetyEvidence).toBe("checking");
    expect(controller.getSnapshot().conversation.receipt).toBeNull();
  });
});
