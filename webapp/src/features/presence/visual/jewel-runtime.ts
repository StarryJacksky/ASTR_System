import type { PresenceControllerSnapshot } from "@/features/presence/controller/create-presence-controller";
import {
  JewelLeaseController,
  type JewelCapabilities,
  type JewelEnvironment,
  type JewelLease,
  type JewelLeaseHandle,
  type JewelLeaseIntent,
} from "@/lib/jewel-lease";
import type { SemanticState } from "@/lib/semantic-state";
import type { AstrEvent } from "@/lib/types";

export type JewelStaticEndpoint =
  | Readonly<{ kind: "rest"; traceId: null; stage: null }>
  | Readonly<{ kind: "stage"; traceId: string; stage: string }>;

export interface JewelRuntimeSnapshot {
  readonly lease: Readonly<JewelLease> | null;
  readonly endpoint: JewelStaticEndpoint;
  readonly activeDynamicJewelCount: 0 | 1;
}

export interface JewelRuntime {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => JewelRuntimeSnapshot;
  readonly getServerSnapshot: () => JewelRuntimeSnapshot;
  readonly syncSemantic: (
    semantic: Pick<SemanticState, "visibility" | "motion" | "visualRuntime">,
  ) => void;
  readonly syncCapabilities: (capabilities: Partial<JewelCapabilities>) => void;
  readonly primePresence: (snapshot: PresenceControllerSnapshot) => void;
  readonly syncPresence: (snapshot: PresenceControllerSnapshot) => void;
  readonly acquire: (intent: JewelLeaseIntent) => JewelLeaseHandle | null;
  readonly owns: (handle: JewelLeaseHandle) => boolean;
  readonly release: (handle: JewelLeaseHandle, endpoint?: JewelStaticEndpoint) => void;
  readonly complete: (handle: JewelLeaseHandle, endpoint?: JewelStaticEndpoint) => void;
  readonly dispose: () => void;
}

export interface JewelRuntimeOptions {
  readonly capabilities?: Partial<JewelCapabilities>;
}

const SEEN_LIFE_EVENT_CAPACITY = 512;

export const JEWEL_REST_ENDPOINT: JewelStaticEndpoint = Object.freeze({
  kind: "rest",
  traceId: null,
  stage: null,
});

export const JEWEL_RUNTIME_SERVER_SNAPSHOT: JewelRuntimeSnapshot = Object.freeze({
  lease: null,
  endpoint: JEWEL_REST_ENDPOINT,
  activeDynamicJewelCount: 0,
});

export function createJewelRuntime({
  capabilities = {},
}: JewelRuntimeOptions = {}): JewelRuntime {
  const leases = new JewelLeaseController(capabilities);
  const listeners = new Set<() => void>();
  let snapshot = JEWEL_RUNTIME_SERVER_SNAPSHOT;
  let projectedLeaseSource: JewelLease | null = null;
  let projectedLease: Readonly<JewelLease> | null = null;
  let endpoint = JEWEL_REST_ENDPOINT;
  let presencePrimed = false;
  let activeTraceId: string | null = null;
  let deltaSeen = false;
  let terminal = false;
  let lensHandle: JewelLeaseHandle | null = null;
  let speechHandle: JewelLeaseHandle | null = null;
  const seenLifeEventIds = new Set<string>();
  const seenLifeEventOrder: string[] = [];

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  };

  const publish = (): void => {
    const current = leases.current();
    if (current !== projectedLeaseSource) {
      projectedLeaseSource = current;
      projectedLease = current === null ? null : freezeLeaseProjection(current);
    }
    const activeDynamicJewelCount = projectedLease === null ? 0 : 1;
    if (
      snapshot.lease === projectedLease &&
      snapshot.endpoint === endpoint &&
      snapshot.activeDynamicJewelCount === activeDynamicJewelCount
    ) {
      return;
    }
    snapshot = Object.freeze({
      lease: projectedLease,
      endpoint,
      activeDynamicJewelCount,
    });
    for (const listener of [...listeners]) listener();
  };

  const setEndpoint = (next: JewelStaticEndpoint): void => {
    endpoint = next;
  };

  const settle = (
    handle: JewelLeaseHandle,
    nextEndpoint: JewelStaticEndpoint | undefined,
    operation: "release" | "complete",
  ): void => {
    const wasCurrent = leases.current() === handle;
    if (operation === "complete") leases.complete(handle);
    else leases.release(handle);
    if (!wasCurrent || leases.current() === handle) return;
    if (lensHandle === handle) lensHandle = null;
    if (speechHandle === handle) speechHandle = null;
    setEndpoint(nextEndpoint ?? endpointForLease(handle));
    publish();
  };

  const acquire = (intent: JewelLeaseIntent): JewelLeaseHandle | null => {
    const previous = leases.current();
    const handle = leases.acquire(intent);
    if (handle !== null) {
      if (previous !== null && previous !== handle) {
        if (lensHandle === previous) lensHandle = null;
        if (speechHandle === previous) speechHandle = null;
        setEndpoint(endpointForLease(previous));
      }
      publish();
    }
    return handle;
  };

  const resetStreamLeases = (): void => {
    if (lensHandle !== null) settle(lensHandle, JEWEL_REST_ENDPOINT, "release");
    if (speechHandle !== null) settle(speechHandle, JEWEL_REST_ENDPOINT, "release");
    lensHandle = null;
    speechHandle = null;
    setEndpoint(JEWEL_REST_ENDPOINT);
    publish();
  };

  const syncSemantic = (
    semantic: Pick<SemanticState, "visibility" | "motion" | "visualRuntime">,
  ): void => {
    const before = leases.current();
    const environment: JewelEnvironment = {
      visibility: semantic.visibility,
      motion: semantic.motion,
      runtime: semantic.visualRuntime,
    };
    leases.setEnvironment(environment);
    const after = leases.current();
    if (before !== null && after === null) {
      if (lensHandle === before) lensHandle = null;
      if (speechHandle === before) speechHandle = null;
      setEndpoint(JEWEL_REST_ENDPOINT);
      publish();
    }
  };

  const syncCapabilities = (capabilities: Partial<JewelCapabilities>): void => {
    const before = leases.current();
    leases.setCapabilities(capabilities);
    const after = leases.current();
    if (before !== null && after === null) {
      if (lensHandle === before) lensHandle = null;
      if (speechHandle === before) speechHandle = null;
      setEndpoint(JEWEL_REST_ENDPOINT);
      publish();
    }
  };

  const primePresence = (next: PresenceControllerSnapshot): void => {
    resetStreamLeases();
    activeTraceId = activeTrace(next);
    deltaSeen = hasNonblankDelta(next);
    terminal = isTerminalPresence(next, activeTraceId);
    rememberLifeEvents(next.lifeEvents);
    presencePrimed = true;
  };

  const syncPresence = (next: PresenceControllerSnapshot): void => {
    if (!presencePrimed) {
      primePresence(next);
      return;
    }

    const nextTraceId = activeTrace(next);
    const traceChanged = nextTraceId !== activeTraceId;
    if (traceChanged) {
      resetStreamLeases();
      activeTraceId = nextTraceId;
      deltaSeen = false;
      terminal = false;
    }

    const newEvents = collectNewLifeEvents(next.lifeEvents);
    const nextTerminal = isTerminalPresence(next, activeTraceId);
    const nonblankDelta = hasNonblankDelta(next);
    const firstNonblankDelta = !deltaSeen && nonblankDelta;

    if (activeTraceId === null) {
      terminal = nextTerminal;
      deltaSeen = nonblankDelta;
      return;
    }

    if (nextTerminal) {
      terminal = true;
      deltaSeen = deltaSeen || nonblankDelta;
      resetStreamLeases();
      return;
    }

    if (terminal) return;

    if (firstNonblankDelta) {
      deltaSeen = true;
      if (lensHandle !== null) {
        settle(lensHandle, endpointForLease(lensHandle), "complete");
        lensHandle = null;
      }
      speechHandle = acquire({
        owner: "live2d",
        mode: "speech",
        traceId: activeTraceId,
        semanticEnd: "rest",
      });
      return;
    }

    if (deltaSeen) return;

    for (const candidate of newEvents) {
      const stage = validStage(candidate, activeTraceId);
      if (stage === null) continue;
      const handle = acquire({
        owner: "soulLens",
        mode: "streamStage",
        traceId: activeTraceId,
        semanticEnd: stage,
      });
      if (handle !== null) lensHandle = handle;
    }
  };

  const dispose = (): void => {
    leases.setEnvironment({
      visibility: "offscreen",
      motion: "paused",
      runtime: "loading",
    });
    presencePrimed = false;
    activeTraceId = null;
    deltaSeen = false;
    terminal = false;
    lensHandle = null;
    speechHandle = null;
    seenLifeEventIds.clear();
    seenLifeEventOrder.length = 0;
    endpoint = JEWEL_REST_ENDPOINT;
    projectedLeaseSource = null;
    projectedLease = null;
    if (snapshot === JEWEL_RUNTIME_SERVER_SNAPSHOT) return;
    snapshot = JEWEL_RUNTIME_SERVER_SNAPSHOT;
    for (const listener of [...listeners]) listener();
  };

  function rememberLifeEvents(events: readonly AstrEvent[]): void {
    for (const candidate of events) rememberLifeEventId(candidate.id);
  }

  function collectNewLifeEvents(events: readonly AstrEvent[]): readonly AstrEvent[] {
    const next: AstrEvent[] = [];
    for (const candidate of events) {
      if (!isNonblank(candidate.id) || seenLifeEventIds.has(candidate.id)) continue;
      rememberLifeEventId(candidate.id);
      next.push(candidate);
    }
    return next;
  }

  function rememberLifeEventId(eventId: string): void {
    if (!isNonblank(eventId) || seenLifeEventIds.has(eventId)) return;
    seenLifeEventIds.add(eventId);
    seenLifeEventOrder.push(eventId);
    while (seenLifeEventOrder.length > SEEN_LIFE_EVENT_CAPACITY) {
      const oldest = seenLifeEventOrder.shift();
      if (oldest !== undefined) seenLifeEventIds.delete(oldest);
    }
  }

  return Object.freeze({
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => JEWEL_RUNTIME_SERVER_SNAPSHOT,
    syncSemantic,
    syncCapabilities,
    primePresence,
    syncPresence,
    acquire,
    owns: (handle: JewelLeaseHandle) => leases.current() === handle,
    release: (handle: JewelLeaseHandle, nextEndpoint?: JewelStaticEndpoint) =>
      settle(handle, nextEndpoint, "release"),
    complete: (handle: JewelLeaseHandle, nextEndpoint?: JewelStaticEndpoint) =>
      settle(handle, nextEndpoint, "complete"),
    dispose,
  });
}

export const jewelRuntime = createJewelRuntime();

function freezeLeaseProjection(lease: JewelLease): Readonly<JewelLease> {
  return Object.freeze({
    owner: lease.owner,
    mode: lease.mode,
    traceId: lease.traceId,
    priority: lease.priority,
    acquiredAt: lease.acquiredAt,
    semanticEnd: lease.semanticEnd,
  });
}

function endpointForLease(lease: JewelLease): JewelStaticEndpoint {
  if (
    lease.owner === "soulLens" &&
    lease.mode === "streamStage" &&
    isNonblank(lease.traceId) &&
    isNonblank(lease.semanticEnd)
  ) {
    return Object.freeze({
      kind: "stage",
      traceId: lease.traceId,
      stage: lease.semanticEnd,
    });
  }
  return JEWEL_REST_ENDPOINT;
}

function activeTrace(snapshot: PresenceControllerSnapshot): string | null {
  const traceId = snapshot.conversation.receipt?.trace_id;
  return isNonblank(traceId) ? traceId : null;
}

function hasNonblankDelta(snapshot: PresenceControllerSnapshot): boolean {
  return isNonblank(snapshot.conversation.provisionalText);
}

function isTerminalPresence(
  snapshot: PresenceControllerSnapshot,
  traceId: string | null,
): boolean {
  if (isNonblank(snapshot.conversation.error)) return true;
  const decision = snapshot.conversation.authoritativeDecision;
  return (
    traceId !== null &&
    decision !== null &&
    decision.type === "soul.decision" &&
    decision.trace_id === traceId
  );
}

function validStage(candidate: AstrEvent, activeTraceId: string): string | null {
  if (
    candidate.type !== "agent.thought" ||
    candidate.trace_id !== activeTraceId ||
    candidate.source === "soul.heartbeat" ||
    !Object.hasOwn(candidate.payload, "stage")
  ) {
    return null;
  }
  const stage = candidate.payload.stage;
  return isNonblank(stage) ? stage.trim() : null;
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
