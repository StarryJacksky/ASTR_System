import type { CoreClient } from "@/features/presence/data/core-client";
import type {
  PresenceStreamDiagnostic,
  PresenceTransportState,
} from "@/features/presence/data/presence-stream";
import {
  PRE_ACK_BUFFER_TTL_MS,
  conversationReducer,
  createConversationState,
  selectConversationProjection,
} from "@/features/presence/model/conversation";
import type {
  ConversationDiagnostic,
  ConversationEvent,
  ConversationModelState,
  DraftSnapshot,
} from "@/features/presence/model/presence-types";
import type { SemanticEvent, SemanticState } from "@/lib/semantic-state";
import { initialSemanticState } from "@/lib/semantic-state";
import type { SemanticStoreState } from "@/lib/semantic-store";
import type {
  AstrEvent,
  ConversationProjection,
  CoreStatus,
  CoreStatusProjection,
  EffectorPendingAction,
  EffectorStatus,
} from "@/lib/types";

const DEFAULT_STATUS_POLL_MS = 4_000;
const DEFAULT_STATUS_OFFLINE_GRACE_MS = 3_000;
const DEFAULT_REPLY_DEADLINE_MS = 10_000;
const DIAGNOSTIC_CAPACITY = 64;
const LIFE_EVENT_CAPACITY = 60;
export const LIFE_EVENT_DEDUPE_CAPACITY = 256;

const LIFE_EVENT_TYPES = new Set(["agent.thought", "moa.report", "soul.decision"]);

export type SafetyEvidence = "checking" | "clear" | "latched" | "unknown";
export type PresenceTimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface PresenceControllerRuntimeDiagnostic {
  readonly code:
    | "STATUS_REQUEST_FAILED"
    | "SAFETY_STATUS_FAILED"
    | "ESTOP_FAILED"
    | "ESTOP_READBACK_CONTRARY"
    | "RESET_FAILED"
    | "RESET_STILL_LATCHED"
    | "STREAM_START_FAILED";
  readonly message: string;
  readonly at: number;
}

export type PresenceControllerDiagnostic =
  | ConversationDiagnostic
  | PresenceStreamDiagnostic
  | PresenceControllerRuntimeDiagnostic;

export interface PresenceControllerSnapshot {
  readonly semantic: Readonly<SemanticState>;
  readonly status: Readonly<CoreStatusProjection> | null;
  readonly conversation: ConversationProjection;
  readonly draft: DraftSnapshot;
  readonly lifeEvents: readonly AstrEvent[];
  readonly safetyEvidence: SafetyEvidence;
  readonly effectorStatus: EffectorStatus | null;
  readonly diagnostics: readonly PresenceControllerDiagnostic[];
}

export interface PresenceControllerActions {
  readonly updateDraft: (draft: DraftSnapshot) => void;
  readonly send: (draft: DraftSnapshot) => Promise<boolean>;
  readonly estop: () => Promise<boolean>;
  readonly reset: () => Promise<boolean>;
}

export interface PresenceController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PresenceControllerSnapshot;
  readonly getServerSnapshot: () => PresenceControllerSnapshot;
  readonly actions: PresenceControllerActions;
  readonly start: () => void;
  readonly dispose: () => void;
}

export interface PresenceControllerStreamCallbacks {
  readonly onEvent: (event: AstrEvent) => void;
  readonly onState: (state: PresenceTransportState) => void;
  readonly onDiagnostic: (diagnostic: PresenceStreamDiagnostic) => void;
}

export interface PresenceControllerStream {
  start(): void;
  close(): void;
}

export type PresenceControllerStreamFactory = (
  callbacks: PresenceControllerStreamCallbacks,
) => PresenceControllerStream;

export interface PresenceSemanticStore {
  readonly getState: () => SemanticStoreState;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface PresenceControllerOptions {
  readonly coreClient: CoreClient;
  readonly streamFactory: PresenceControllerStreamFactory;
  readonly semanticStore: PresenceSemanticStore;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delay: number) => PresenceTimerHandle;
  readonly clearTimer?: (handle: PresenceTimerHandle) => void;
  readonly idFactory?: (kind: "attempt" | "message") => string;
  readonly statusPollMs?: number;
  readonly statusOfflineGraceMs?: number;
  readonly replyDeadlineMs?: number;
}

const EMPTY_CONVERSATION = createConversationState();

export const PRESENCE_CONTROLLER_SERVER_SNAPSHOT: PresenceControllerSnapshot = makeSnapshot({
  semantic: initialSemanticState,
  status: null,
  conversation: EMPTY_CONVERSATION,
  lifeEvents: [],
  safetyEvidence: "checking",
  effectorStatus: null,
  diagnostics: [],
});

export function createPresenceController(options: PresenceControllerOptions): PresenceController {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => globalThis.clearTimeout(handle));
  const statusPollMs = positiveDuration(options.statusPollMs, DEFAULT_STATUS_POLL_MS);
  const statusOfflineGraceMs = positiveDuration(
    options.statusOfflineGraceMs,
    DEFAULT_STATUS_OFFLINE_GRACE_MS,
  );
  const replyDeadlineMs = positiveDuration(options.replyDeadlineMs, DEFAULT_REPLY_DEADLINE_MS);
  let nextFallbackId = 0;
  const idFactory =
    options.idFactory ??
    ((kind: "attempt" | "message") => `${kind}:${now()}:${++nextFallbackId}`);

  const listeners = new Set<() => void>();
  let started = false;
  let disposed = false;
  let publishRevision = 0;
  let semanticUnsubscribe: (() => void) | null = null;
  let lastSemantic = selectSemantic(options.semanticStore.getState());

  let status: CoreStatusProjection | null = null;
  let conversation = createConversationState();
  let lifeEvents: readonly AstrEvent[] = [];
  const seenLifeEventIds = new Set<string>();
  const seenLifeEventOrder: string[] = [];
  let safetyEvidence: SafetyEvidence = "checking";
  let effectorStatus: EffectorStatus | null = null;
  let diagnostics: readonly PresenceControllerDiagnostic[] = [];
  let snapshot = makeSnapshot({
    semantic: lastSemantic,
    status,
    conversation,
    lifeEvents,
    safetyEvidence,
    effectorStatus,
    diagnostics,
  });

  let stream: PresenceControllerStream | null = null;
  let statusTimer: PresenceTimerHandle | null = null;
  let statusGraceTimer: PresenceTimerHandle | null = null;
  let statusAbortController: AbortController | null = null;
  let consecutiveStatusFailures = 0;
  let statusFailureGeneration = 0;
  let replyTimer: PresenceTimerHandle | null = null;
  let replyTimerAttemptId: string | null = null;
  let preAckTimer: PresenceTimerHandle | null = null;
  let ingestAbortController: AbortController | null = null;
  let safetyAbortController: AbortController | null = null;
  let safetyGeneration = 0;
  let safetyMutation: "estop" | "reset" | null = null;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = (): PresenceControllerSnapshot => snapshot;
  const getServerSnapshot = (): PresenceControllerSnapshot =>
    PRESENCE_CONTROLLER_SERVER_SNAPSHOT;

  function publish(): void {
    lastSemantic = selectSemantic(options.semanticStore.getState());
    snapshot = makeSnapshot({
      semantic: lastSemantic,
      status,
      conversation,
      lifeEvents,
      safetyEvidence,
      effectorStatus,
      diagnostics,
    });
    publishRevision += 1;
    for (const listener of [...listeners]) listener();
  }

  function dispatch(event: SemanticEvent): void {
    const before = publishRevision;
    options.semanticStore.getState().dispatch(event);
    if (publishRevision === before) publish();
  }

  function dispatchMany(events: readonly SemanticEvent[]): void {
    const before = publishRevision;
    options.semanticStore.getState().dispatchMany(events);
    if (publishRevision === before) publish();
  }

  function appendDiagnostic(diagnostic: PresenceControllerDiagnostic): void {
    diagnostics = [...diagnostics, diagnostic].slice(-DIAGNOSTIC_CAPACITY);
  }

  function copyNewConversationDiagnostics(
    previous: ConversationModelState,
    next: ConversationModelState,
  ): void {
    if (next.diagnostics === previous.diagnostics) return;
    const previousDiagnostics = new Set(previous.diagnostics);
    for (const diagnostic of next.diagnostics) {
      if (!previousDiagnostics.has(diagnostic)) appendDiagnostic(diagnostic);
    }
  }

  function clearReplyDeadline(): void {
    if (replyTimer !== null) clearTimer(replyTimer);
    replyTimer = null;
    replyTimerAttemptId = null;
  }

  function startReplyDeadline(attemptId: string): void {
    clearReplyDeadline();
    replyTimerAttemptId = attemptId;
    replyTimer = setTimer(() => {
      replyTimer = null;
      const expectedAttemptId = replyTimerAttemptId;
      replyTimerAttemptId = null;
      if (disposed || expectedAttemptId !== attemptId) return;
      const active = conversation.activeAttempt;
      if (!active || active.id !== attemptId || active.firstReplyAt !== null) return;
      applyConversation({ type: "REQUEST_TIMED_OUT", attemptId, at: now() }, "REPLY_TIMEOUT");
    }, replyDeadlineMs);
  }

  function reschedulePreAckExpiry(): void {
    if (preAckTimer !== null) clearTimer(preAckTimer);
    preAckTimer = null;
    if (disposed || conversation.preAckBuffer.length === 0) return;
    const expiresAt = Math.min(
      ...conversation.preAckBuffer.map((frame) => frame.receivedAt + PRE_ACK_BUFFER_TTL_MS),
    );
    preAckTimer = setTimer(() => {
      preAckTimer = null;
      if (disposed) return;
      applyConversation({ type: "PRE_ACK_EXPIRED", at: now() });
    }, Math.max(0, expiresAt - now()));
  }

  function applyConversation(
    event: ConversationEvent,
    requestedSemantic?: SemanticEvent["type"],
  ): boolean {
    const previous = conversation;
    const previousAttempt = previous.activeAttempt;
    const next = conversationReducer(previous, event);
    if (next === previous) return false;
    conversation = next;
    copyNewConversationDiagnostics(previous, next);
    reschedulePreAckExpiry();

    const nextAttempt = next.activeAttempt;
    if (
      previousAttempt &&
      nextAttempt &&
      previousAttempt.id === nextAttempt.id &&
      previousAttempt.firstReplyAt === null &&
      nextAttempt.firstReplyAt !== null
    ) {
      clearReplyDeadline();
    }
    if (nextAttempt?.status === "failed" || nextAttempt?.status === "timedOut") {
      clearReplyDeadline();
    }

    const semanticType = conversationSemanticTransition(previous, next) ?? requestedSemantic;
    if (semanticType) dispatch({ type: semanticType } as SemanticEvent);
    else publish();
    return true;
  }

  function acceptStreamEvent(event: AstrEvent): void {
    if (disposed) return;
    const revisionBefore = publishRevision;
    let lifeChanged = false;
    if (LIFE_EVENT_TYPES.has(event.type) && rememberLifeEventId(event.id)) {
      lifeEvents = [...lifeEvents, event].slice(-LIFE_EVENT_CAPACITY);
      lifeChanged = true;
    }
    if (event.type === "soul.stream" || event.type === "soul.decision") {
      applyConversation({ type: "REPLY_EVENT", event, at: now() });
    }
    if (publishRevision === revisionBefore && lifeChanged) publish();
  }

  function rememberLifeEventId(eventId: string): boolean {
    if (seenLifeEventIds.has(eventId)) return false;
    seenLifeEventIds.add(eventId);
    seenLifeEventOrder.push(eventId);
    if (seenLifeEventOrder.length > LIFE_EVENT_DEDUPE_CAPACITY) {
      const evicted = seenLifeEventOrder.shift();
      if (evicted !== undefined) seenLifeEventIds.delete(evicted);
    }
    return true;
  }

  function acceptStreamState(state: PresenceTransportState): void {
    if (disposed) return;
    const events: Record<PresenceTransportState, readonly [SemanticEvent, SemanticEvent]> = {
      connecting: [
        { type: "REPLY_SSE_CONNECTING" },
        { type: "LIFE_SSE_CONNECTING" },
      ],
      open: [{ type: "REPLY_SSE_OPEN" }, { type: "LIFE_SSE_OPEN" }],
      retrying: [{ type: "REPLY_SSE_ERROR" }, { type: "LIFE_SSE_ERROR" }],
      closed: [{ type: "REPLY_SSE_CLOSED" }, { type: "LIFE_SSE_CLOSED" }],
    };
    dispatchMany(events[state]);
  }

  function acceptStreamDiagnostic(diagnostic: PresenceStreamDiagnostic): void {
    if (disposed) return;
    appendDiagnostic(diagnostic);
    publish();
  }

  function scheduleStatusPoll(): void {
    if (disposed) return;
    if (statusTimer !== null) clearTimer(statusTimer);
    statusTimer = setTimer(() => {
      statusTimer = null;
      void pollStatus();
    }, statusPollMs);
  }

  function beginStatusGrace(): void {
    if (statusGraceTimer !== null) return;
    const generation = ++statusFailureGeneration;
    statusGraceTimer = setTimer(() => {
      statusGraceTimer = null;
      if (
        disposed ||
        generation !== statusFailureGeneration ||
        consecutiveStatusFailures === 0
      ) {
        return;
      }
      dispatch({ type: "STATUS_FAIL" });
    }, statusOfflineGraceMs);
  }

  function resetStatusFailures(): void {
    consecutiveStatusFailures = 0;
    statusFailureGeneration += 1;
    if (statusGraceTimer !== null) clearTimer(statusGraceTimer);
    statusGraceTimer = null;
  }

  async function pollStatus(): Promise<void> {
    if (disposed || statusAbortController !== null) return;
    const request = new AbortController();
    statusAbortController = request;
    try {
      const value = await options.coreClient.status(request.signal);
      if (disposed || statusAbortController !== request) return;
      status = projectCoreStatus(value);
      resetStatusFailures();
      dispatch({ type: "STATUS_OK" });
    } catch (error) {
      if (disposed || statusAbortController !== request) return;
      consecutiveStatusFailures += 1;
      appendDiagnostic({
        code: "STATUS_REQUEST_FAILED",
        message: errorMessage(error, "Core status request failed"),
        at: now(),
      });
      if (consecutiveStatusFailures >= 2) dispatch({ type: "STATUS_FAIL" });
      else {
        beginStatusGrace();
        publish();
      }
    } finally {
      if (statusAbortController === request) {
        statusAbortController = null;
        scheduleStatusPoll();
      }
    }
  }

  function beginSafetyOperation(mutation: "estop" | "reset" | null): {
    readonly generation: number;
    readonly controller: AbortController;
  } {
    safetyAbortController?.abort();
    const controller = new AbortController();
    safetyAbortController = controller;
    safetyGeneration += 1;
    safetyMutation = mutation;
    return { generation: safetyGeneration, controller };
  }

  function isActiveSafetyOperation(
    generation: number,
    controller: AbortController,
  ): boolean {
    return (
      !disposed &&
      safetyGeneration === generation &&
      safetyAbortController === controller &&
      !controller.signal.aborted
    );
  }

  function settleSafetyOperation(generation: number, controller: AbortController): void {
    if (safetyGeneration !== generation || safetyAbortController !== controller) return;
    safetyAbortController = null;
    safetyMutation = null;
  }

  function applySafetyStatus(value: EffectorStatus): void {
    effectorStatus = value;
    if (value.stopped) {
      safetyEvidence = "latched";
      dispatch({ type: "ESTOP_STATUS_LATCHED" });
    } else {
      safetyEvidence = "clear";
      dispatch({ type: "ESTOP_STATUS_CLEAR" });
    }
  }

  async function checkStartupSafety(): Promise<void> {
    const { generation, controller } = beginSafetyOperation(null);
    try {
      const value = await options.coreClient.effectorStatus(controller.signal);
      if (!isActiveSafetyOperation(generation, controller)) return;
      applySafetyStatus(value);
    } catch (error) {
      if (!isActiveSafetyOperation(generation, controller)) return;
      safetyEvidence = "unknown";
      effectorStatus = null;
      appendDiagnostic({
        code: "SAFETY_STATUS_FAILED",
        message: errorMessage(error, "Effector status request failed"),
        at: now(),
      });
      dispatch({ type: "ESTOP_STATUS_CHECK" });
    } finally {
      settleSafetyOperation(generation, controller);
    }
  }

  async function runSafetyMutation(kind: "estop" | "reset"): Promise<boolean> {
    if (disposed) return false;
    if (kind === "reset" && safetyMutation !== null) return false;
    const { generation, controller } = beginSafetyOperation(kind);
    safetyEvidence = "checking";
    dispatch({ type: kind === "estop" ? "ESTOP_REQUESTED" : "ESTOP_RESET_REQUESTED" });

    try {
      if (kind === "estop") await options.coreClient.estop(controller.signal);
      else await options.coreClient.reset(controller.signal);
      if (!isActiveSafetyOperation(generation, controller)) return false;

      const readback = await options.coreClient.effectorStatus(controller.signal);
      if (!isActiveSafetyOperation(generation, controller)) return false;
      effectorStatus = readback;

      if (kind === "estop") {
        if (readback.stopped) {
          safetyEvidence = "latched";
          dispatch({ type: "ESTOP_ACK" });
          return true;
        }
        safetyEvidence = "unknown";
        appendDiagnostic({
          code: "ESTOP_READBACK_CONTRARY",
          message: "E-stop readback did not report a latched stop.",
          at: now(),
        });
        dispatch({ type: "ESTOP_ACK_TIMEOUT" });
        return false;
      }

      if (!readback.stopped) {
        safetyEvidence = "clear";
        dispatch({ type: "ESTOP_RESET_ACK" });
        return true;
      }
      safetyEvidence = "latched";
      appendDiagnostic({
        code: "RESET_STILL_LATCHED",
        message: "Reset readback still reports a latched stop.",
        at: now(),
      });
      dispatch({ type: "ESTOP_STATUS_LATCHED" });
      return false;
    } catch (error) {
      if (!isActiveSafetyOperation(generation, controller)) return false;
      safetyEvidence = "unknown";
      appendDiagnostic({
        code: kind === "estop" ? "ESTOP_FAILED" : "RESET_FAILED",
        message: errorMessage(error, `${kind} request or readback failed`),
        at: now(),
      });
      dispatch({ type: kind === "estop" ? "ESTOP_ACK_TIMEOUT" : "ESTOP_STATUS_CHECK" });
      return false;
    } finally {
      settleSafetyOperation(generation, controller);
    }
  }

  const updateDraft = (draft: DraftSnapshot): void => {
    if (disposed) return;
    applyConversation({ type: "DRAFT_CHANGED", draft, at: now() });
  };

  const send = async (draft: DraftSnapshot): Promise<boolean> => {
    if (disposed || isPendingAttempt(conversation)) return false;
    applyConversation({ type: "DRAFT_CHANGED", draft, at: now() });
    const attemptId = idFactory("attempt");
    const localMessageId = idFactory("message");
    if (
      !applyConversation(
        { type: "LOCAL_SEND", attemptId, localMessageId, at: now() },
        "INGEST_STARTED",
      )
    ) {
      return false;
    }
    startReplyDeadline(attemptId);
    const request = new AbortController();
    ingestAbortController = request;

    try {
      const receipt = await options.coreClient.ingest(
        { text: draft.text, platform: "web" },
        request.signal,
      );
      if (disposed || ingestAbortController !== request) return false;
      const applied = applyConversation(
        { type: "INGEST_ACK", attemptId, receipt, at: now() },
        "INGEST_ACK",
      );
      return (
        applied &&
        conversation.activeAttempt?.id === attemptId &&
        conversation.activeAttempt.receipt?.trace_id === receipt.trace_id
      );
    } catch (error) {
      if (disposed || ingestAbortController !== request) return false;
      applyConversation(
        {
          type: "INGEST_FAILED",
          attemptId,
          message: errorMessage(error, "Ingest request failed"),
          at: now(),
        },
        "INGEST_FAIL",
      );
      return false;
    } finally {
      if (ingestAbortController === request) ingestAbortController = null;
    }
  };

  const start = (): void => {
    if (started || disposed) return;
    started = true;
    semanticUnsubscribe = options.semanticStore.subscribe(() => {
      if (disposed) return;
      const semantic = selectSemantic(options.semanticStore.getState());
      if (!sameSemantic(lastSemantic, semantic)) publish();
    });
    dispatchMany([
      { type: "STATUS_LOADING" },
      { type: "REPLY_SSE_CONNECTING" },
      { type: "LIFE_SSE_CONNECTING" },
      { type: "ESTOP_STATUS_CHECK" },
    ]);

    try {
      stream = options.streamFactory({
        onEvent: acceptStreamEvent,
        onState: acceptStreamState,
        onDiagnostic: acceptStreamDiagnostic,
      });
      stream.start();
    } catch (error) {
      appendDiagnostic({
        code: "STREAM_START_FAILED",
        message: errorMessage(error, "Presence stream failed to start"),
        at: now(),
      });
      dispatchMany([{ type: "REPLY_SSE_CLOSED" }, { type: "LIFE_SSE_CLOSED" }]);
    }
    void pollStatus();
    void checkStartupSafety();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    semanticUnsubscribe?.();
    semanticUnsubscribe = null;
    statusAbortController?.abort();
    statusAbortController = null;
    ingestAbortController?.abort();
    ingestAbortController = null;
    safetyAbortController?.abort();
    safetyAbortController = null;
    safetyGeneration += 1;
    safetyMutation = null;
    if (statusTimer !== null) clearTimer(statusTimer);
    if (statusGraceTimer !== null) clearTimer(statusGraceTimer);
    if (preAckTimer !== null) clearTimer(preAckTimer);
    statusTimer = null;
    statusGraceTimer = null;
    preAckTimer = null;
    clearReplyDeadline();
    stream?.close();
    stream = null;
    dispatchMany([{ type: "REPLY_SSE_CLOSED" }, { type: "LIFE_SSE_CLOSED" }]);
  };

  const actions: PresenceControllerActions = Object.freeze({
    updateDraft,
    send,
    estop: () => runSafetyMutation("estop"),
    reset: () => runSafetyMutation("reset"),
  });

  return Object.freeze({ subscribe, getSnapshot, getServerSnapshot, actions, start, dispose });
}

function conversationSemanticTransition(
  previous: ConversationModelState,
  next: ConversationModelState,
): SemanticEvent["type"] | null {
  const previousAttempt = previous.activeAttempt;
  const nextAttempt = next.activeAttempt;
  if (!nextAttempt || previousAttempt?.id !== nextAttempt.id) return null;
  if (previousAttempt.status !== "final" && nextAttempt.status === "final") {
    return "SOUL_DECISION";
  }
  if (previousAttempt.status !== "streaming" && nextAttempt.status === "streaming") {
    return "STREAM_DELTA";
  }
  if (
    previousAttempt.status !== "waitingForFinal" &&
    nextAttempt.status === "waitingForFinal"
  ) {
    return "STREAM_DONE";
  }
  return null;
}

function isPendingAttempt(state: ConversationModelState): boolean {
  const status = state.activeAttempt?.status;
  return (
    status === "sending" ||
    status === "acknowledged" ||
    status === "streaming" ||
    status === "waitingForFinal"
  );
}

function projectCoreStatus(value: CoreStatus): CoreStatusProjection {
  return {
    internalHandle: value.soul_name,
    ...(value.display_name === undefined ? {} : { displayName: value.display_name }),
    model: value.local_llm_model,
    costTodayUsd: value.cost_today_usd,
    dailyBudgetUsd: value.daily_budget_usd,
    emotion: { ...value.emotion },
    ...(value.activity === undefined ? {} : { activity: value.activity }),
  };
}

function makeSnapshot(input: {
  readonly semantic: SemanticState;
  readonly status: CoreStatusProjection | null;
  readonly conversation: ConversationModelState;
  readonly lifeEvents: readonly AstrEvent[];
  readonly safetyEvidence: SafetyEvidence;
  readonly effectorStatus: EffectorStatus | null;
  readonly diagnostics: readonly PresenceControllerDiagnostic[];
}): PresenceControllerSnapshot {
  const projection = selectConversationProjection(input.conversation);
  const frozenConversation: ConversationProjection = Object.freeze({
    ...projection,
    messages: Object.freeze(
      projection.messages.map((message) => Object.freeze({ ...message })),
    ),
    receipt: projection.receipt === null ? null : Object.freeze({ ...projection.receipt }),
    authoritativeDecision:
      projection.authoritativeDecision === null
        ? null
        : cloneFrozenEvent(projection.authoritativeDecision),
  });
  return Object.freeze({
    semantic: Object.freeze({ ...input.semantic }),
    status: input.status === null ? null : cloneFrozenStatus(input.status),
    conversation: frozenConversation,
    draft: Object.freeze({ ...input.conversation.draft }),
    lifeEvents: Object.freeze(input.lifeEvents.map(cloneFrozenEvent)),
    safetyEvidence: input.safetyEvidence,
    effectorStatus:
      input.effectorStatus === null ? null : cloneFrozenEffectorStatus(input.effectorStatus),
    diagnostics: Object.freeze(input.diagnostics.map(cloneFrozenDiagnostic)),
  });
}

function cloneFrozenStatus(value: CoreStatusProjection): Readonly<CoreStatusProjection> {
  return Object.freeze({
    ...value,
    emotion: Object.freeze({ ...value.emotion }),
  });
}

function cloneFrozenEvent(value: AstrEvent): AstrEvent {
  return Object.freeze({
    id: value.id,
    ts: value.ts,
    type: value.type,
    source: value.source,
    payload: cloneFrozenJsonRecord(value.payload),
    trace_id: value.trace_id,
  });
}

function cloneFrozenEffectorStatus(value: EffectorStatus): EffectorStatus {
  const pending = Object.create(null) as Record<string, EffectorPendingAction>;
  for (const key of Object.keys(value.pending)) {
    const action = value.pending[key];
    if (action === undefined) continue;
    Object.defineProperty(pending, key, {
      value: Object.freeze({ summary: action.summary, tool: action.tool }),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  Object.freeze(pending);
  return Object.freeze({
    stopped: value.stopped,
    pending,
    audit_tail: Object.freeze(value.audit_tail.map(cloneFrozenJsonRecord)),
  });
}

function cloneFrozenDiagnostic(
  value: PresenceControllerDiagnostic,
): PresenceControllerDiagnostic {
  return cloneFrozenJsonRecord(
    value as unknown as Readonly<Record<string, unknown>>,
  ) as unknown as PresenceControllerDiagnostic;
}

function cloneFrozenJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const cloned = cloneFrozenJsonValue(value, []);
  if (!isPlainRecord(cloned)) throw new TypeError("Expected a JSON record");
  return cloned;
}

function cloneFrozenJsonValue(value: unknown, ancestors: readonly object[]): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== "object" || ancestors.includes(value)) {
    throw new TypeError("Expected an acyclic JSON value");
  }
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneFrozenJsonValue(item, nextAncestors)));
  }
  if (!isPlainRecord(value)) throw new TypeError("Expected a plain JSON record");
  const cloned = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    Object.defineProperty(cloned, key, {
      value: cloneFrozenJsonValue(value[key], nextAncestors),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(cloned);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function selectSemantic(state: SemanticStoreState | SemanticState): SemanticState {
  return {
    core: state.core,
    replySse: state.replySse,
    lifeSse: state.lifeSse,
    conversation: state.conversation,
    visualRuntime: state.visualRuntime,
    visibility: state.visibility,
    motion: state.motion,
    safety: state.safety,
    task: state.task,
  };
}

function sameSemantic(left: SemanticState, right: SemanticState): boolean {
  return (
    left.core === right.core &&
    left.replySse === right.replySse &&
    left.lifeSse === right.lifeSse &&
    left.conversation === right.conversation &&
    left.visualRuntime === right.visualRuntime &&
    left.visibility === right.visibility &&
    left.motion === right.motion &&
    left.safety === right.safety &&
    left.task === right.task
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
