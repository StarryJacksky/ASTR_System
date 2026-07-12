import type {
  PresenceVisualRuntime,
  PresenceVisualRuntimePhase,
  PresenceVisualSemanticSource,
  PresenceVisualWebglAvailability,
} from "./presence-visual-runtime";

export interface PresenceVisualOwnerSnapshot {
  readonly hasStartedRuntime: boolean;
  readonly activeRuntimeCount: 0 | 1;
  readonly phase: PresenceVisualRuntimePhase;
  readonly retryRequired: boolean;
  readonly webglAvailability: PresenceVisualWebglAvailability;
}

export interface PresenceVisualRuntimeRequest {
  readonly configurationKey: object;
  /** DOM/runtime attachment identity; equal keys share, different keys promote serially. */
  readonly mountKey?: object;
  readonly createRuntime: () => PresenceVisualRuntime | Promise<PresenceVisualRuntime>;
}

export interface PresenceVisualRuntimeOwner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PresenceVisualOwnerSnapshot;
  readonly getServerSnapshot: () => PresenceVisualOwnerSnapshot;
  readonly retainHost: (semantic: PresenceVisualSemanticSource) => () => void;
  readonly acquireRuntime: (request: PresenceVisualRuntimeRequest) => () => void;
  readonly retry: () => Promise<boolean>;
}

export interface PresenceVisualRuntimeOwnerOptions {
  readonly scheduleMicrotask?: (callback: () => void) => void;
}

export const PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT: PresenceVisualOwnerSnapshot =
  Object.freeze({
    hasStartedRuntime: false,
    activeRuntimeCount: 0,
    phase: "idle",
    retryRequired: false,
    webglAvailability: "unknown",
  });

export function createPresenceVisualRuntimeOwner({
  scheduleMicrotask = enqueueMicrotask,
}: PresenceVisualRuntimeOwnerOptions = {}): PresenceVisualRuntimeOwner {
  const listeners = new Set<() => void>();
  const destroyedRuntimes = new WeakSet<PresenceVisualRuntime>();
  let snapshot = PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT;
  let semantic: PresenceVisualSemanticSource | null = null;
  let hostRetainers = 0;
  let hostCleanupGeneration = 0;
  const runtimeCandidates = new Map<symbol, RuntimeCandidate>();
  let runtimeCleanupGeneration = 0;
  let configurationGeneration = 0;
  let creationGeneration = 0;
  let configurationKey: object | null = null;
  let activeCandidateToken: symbol | null = null;
  let activeMountKey: object | null = null;
  let runtime: PresenceVisualRuntime | null = null;
  let releaseRuntimeSnapshot: (() => void) | null = null;
  let creation: Promise<void> | null = null;
  let creationFailed = false;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  };

  const publish = (next: PresenceVisualOwnerSnapshot): void => {
    if (sameOwnerSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const publishServerSnapshot = (): void => {
    if (snapshot === PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT) return;
    snapshot = PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT;
    for (const listener of [...listeners]) listener();
  };

  const publishLoading = (): void => {
    publish(
      Object.freeze({
        hasStartedRuntime: true,
        activeRuntimeCount: runtime === null ? 0 : 1,
        phase: "loading",
        retryRequired: false,
        webglAvailability: runtime?.getSnapshot().webglAvailability ?? "unknown",
      }),
    );
  };

  const publishRuntimeSnapshot = (): void => {
    const ownedRuntime = runtime;
    if (ownedRuntime === null) {
      if (creation !== null) publishLoading();
      else if (creationFailed) {
        publish(
          Object.freeze({
            hasStartedRuntime: true,
            activeRuntimeCount: 0,
            phase: "static",
            retryRequired: true,
            webglAvailability: "unknown",
          }),
        );
      }
      return;
    }
    const runtimeSnapshot = ownedRuntime.getSnapshot();
    publish(
      Object.freeze({
        hasStartedRuntime: true,
        activeRuntimeCount: 1,
        phase: runtimeSnapshot.phase,
        retryRequired: runtimeSnapshot.retryRequired,
        webglAvailability: runtimeSnapshot.webglAvailability,
      }),
    );
  };

  const ensureSemanticLoading = (): void => {
    if (semantic?.getSnapshot().visualRuntime !== "loading") {
      semantic?.dispatch({ type: "VISUAL_RETRY" });
    }
  };

  const detachRuntime = (): PresenceVisualRuntime | null => {
    releaseRuntimeSnapshot?.();
    releaseRuntimeSnapshot = null;
    const ownedRuntime = runtime;
    runtime = null;
    return ownedRuntime;
  };

  const invalidateCreation = (): void => {
    creationGeneration += 1;
    creation = null;
  };

  const clearRuntimeConfiguration = (): void => {
    configurationGeneration += 1;
    runtimeCandidates.clear();
    configurationKey = null;
    activeCandidateToken = null;
    activeMountKey = null;
    creationFailed = false;
  };

  const teardownRuntime = (): void => {
    invalidateCreation();
    const ownedRuntime = detachRuntime();
    destroyRuntimeOnce(ownedRuntime);
  };

  const destroyRuntimeOnce = (ownedRuntime: PresenceVisualRuntime | null): void => {
    if (ownedRuntime === null || destroyedRuntimes.has(ownedRuntime)) return;
    destroyedRuntimes.add(ownedRuntime);
    ownedRuntime.destroy();
  };

  const failCreation = (generation: number): void => {
    if (generation !== creationGeneration) return;
    creation = null;
    creationFailed = true;
    publishRuntimeSnapshot();
  };

  const beginCreation = (
    mountKey: object,
    request: PresenceVisualRuntimeRequest,
  ): void => {
    if (creation !== null || runtime !== null || runtimeCandidates.size === 0) return;
    const generation = ++creationGeneration;
    creationFailed = false;
    publishLoading();

    let created: PresenceVisualRuntime | Promise<PresenceVisualRuntime>;
    try {
      created = request.createRuntime();
    } catch {
      failCreation(generation);
      return;
    }

    const pending = Promise.resolve(created)
      .then(async (nextRuntime) => {
        if (
          generation !== creationGeneration ||
          runtimeCandidates.size === 0 ||
          hostRetainers === 0 ||
          activeMountKey !== mountKey
        ) {
          destroyRuntimeOnce(nextRuntime);
          return;
        }

        runtime = nextRuntime;
        releaseRuntimeSnapshot = nextRuntime.subscribe(publishRuntimeSnapshot);
        publishRuntimeSnapshot();
        try {
          await nextRuntime.mount();
        } catch {
          if (runtime === nextRuntime) {
            destroyRuntimeOnce(detachRuntime());
            failCreation(generation);
          } else {
            destroyRuntimeOnce(nextRuntime);
          }
          return;
        }

        if (generation !== creationGeneration || runtime !== nextRuntime) {
          if (runtime === nextRuntime) detachRuntime();
          destroyRuntimeOnce(nextRuntime);
          return;
        }
        publishRuntimeSnapshot();
      })
      .catch(() => failCreation(generation))
      .finally(() => {
        if (generation !== creationGeneration || creation !== pending) return;
        creation = null;
        publishRuntimeSnapshot();
      });
    creation = pending;
  };

  const retainHost = (source: PresenceVisualSemanticSource): (() => void) => {
    if (semantic !== null && semantic !== source) {
      throw new Error("A Presence visual owner must retain the same semantic source.");
    }
    semantic = source;
    hostCleanupGeneration += 1;
    hostRetainers += 1;
    if (hostRetainers === 1) ensureSemanticLoading();
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      hostRetainers -= 1;
      if (hostRetainers !== 0) return;
      const scheduledGeneration = ++hostCleanupGeneration;
      scheduleMicrotask(() => {
        if (
          hostRetainers !== 0 ||
          scheduledGeneration !== hostCleanupGeneration
        ) {
          return;
        }
        teardownRuntime();
        clearRuntimeConfiguration();
        ensureSemanticLoading();
        semantic = null;
        publishServerSnapshot();
      });
    };
  };

  const firstCandidate = (
    mountKey?: object,
  ): { readonly token: symbol; readonly candidate: RuntimeCandidate } | null => {
    for (const [token, candidate] of runtimeCandidates) {
      if (mountKey === undefined || candidate.mountKey === mountKey) {
        return { token, candidate };
      }
    }
    return null;
  };

  const hasMountCandidate = (mountKey: object): boolean =>
    firstCandidate(mountKey) !== null;

  const currentActiveCandidate = (): RuntimeCandidate | null => {
    if (activeCandidateToken !== null) {
      const candidate = runtimeCandidates.get(activeCandidateToken);
      if (candidate !== undefined) return candidate;
    }
    return activeMountKey === null ? null : firstCandidate(activeMountKey)?.candidate ?? null;
  };

  const acquireRuntime = (request: PresenceVisualRuntimeRequest): (() => void) => {
    if (hostRetainers === 0 || semantic === null) {
      throw new Error("Retain a Presence visual Host before acquiring its runtime.");
    }
    if (configurationKey !== null && configurationKey !== request.configurationKey) {
      if (runtimeCandidates.size !== 0) {
        throw new Error(
          "A Presence visual owner must use the same configuration across runtime retainers.",
        );
      }
      teardownRuntime();
      clearRuntimeConfiguration();
      ensureSemanticLoading();
    }
    if (configurationKey === null) {
      configurationGeneration += 1;
      configurationKey = request.configurationKey;
    }
    const acquiredConfiguration = configurationGeneration;
    const token = Symbol("Presence visual runtime candidate");
    const mountKey = request.mountKey ?? request.configurationKey;
    runtimeCandidates.set(token, { mountKey, request });
    runtimeCleanupGeneration += 1;
    if (activeMountKey === null || !hasMountCandidate(activeMountKey)) {
      activeCandidateToken = token;
      activeMountKey = mountKey;
    }
    if (activeMountKey === mountKey) beginCreation(mountKey, request);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      if (acquiredConfiguration !== configurationGeneration) return;
      const releasedCandidate = runtimeCandidates.get(token);
      if (releasedCandidate === undefined) return;
      runtimeCandidates.delete(token);
      if (activeMountKey === releasedCandidate.mountKey) {
        const sameMountReplacement = firstCandidate(releasedCandidate.mountKey);
        if (sameMountReplacement !== null) {
          activeCandidateToken = sameMountReplacement.token;
        } else if (runtimeCandidates.size > 0) {
          const promoted = firstCandidate();
          if (promoted !== null) {
            teardownRuntime();
            creationFailed = false;
            activeCandidateToken = promoted.token;
            activeMountKey = promoted.candidate.mountKey;
            beginCreation(promoted.candidate.mountKey, promoted.candidate.request);
          }
        }
      }
      if (runtimeCandidates.size !== 0) return;
      const scheduledGeneration = ++runtimeCleanupGeneration;
      scheduleMicrotask(() => {
        if (
          runtimeCandidates.size !== 0 ||
          scheduledGeneration !== runtimeCleanupGeneration ||
          acquiredConfiguration !== configurationGeneration
        ) {
          return;
        }
        teardownRuntime();
        clearRuntimeConfiguration();
        ensureSemanticLoading();
        publishServerSnapshot();
      });
    };
  };

  const retry = async (): Promise<boolean> => {
    if (hostRetainers === 0 || semantic === null) return false;
    if (runtime !== null) return runtime.retry();
    ensureSemanticLoading();
    creationFailed = false;
    publishLoading();
    const activeCandidate = currentActiveCandidate();
    if (activeCandidate === null) return false;
    beginCreation(activeCandidate.mountKey, activeCandidate.request);
    const pending = creation;
    if (pending !== null) await pending;
    return currentRuntimeIsReady();
  };

  const currentRuntimeIsReady = (): boolean =>
    runtime?.getSnapshot().phase === "ready";

  return Object.freeze({
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT,
    retainHost,
    acquireRuntime,
    retry,
  });
}

export const presenceVisualRuntimeOwner = createPresenceVisualRuntimeOwner();

function sameOwnerSnapshot(
  left: PresenceVisualOwnerSnapshot,
  right: PresenceVisualOwnerSnapshot,
): boolean {
  return (
    left.hasStartedRuntime === right.hasStartedRuntime &&
    left.activeRuntimeCount === right.activeRuntimeCount &&
    left.phase === right.phase &&
    left.retryRequired === right.retryRequired &&
    left.webglAvailability === right.webglAvailability
  );
}

function enqueueMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}

interface RuntimeCandidate {
  readonly mountKey: object;
  readonly request: PresenceVisualRuntimeRequest;
}
