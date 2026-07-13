import type {
  EffectorAudit,
  EffectorClient,
  EffectorPolicy,
  EffectorStatus,
  PolicyPatch,
} from "../data/effector-client";

export type ChannelState = "idle" | "loading" | "ready" | "error";
export type SafetyEvidence = "checking" | "clear" | "latched" | "unknown";

type Channel = "policy" | "audit" | "status";
type ErrorChannel = Channel | "mutation";

export interface EffectorSnapshot {
  readonly policy: EffectorPolicy | null;
  readonly audit: EffectorAudit | null;
  readonly status: EffectorStatus | null;
  readonly channels: Readonly<Record<Channel, ChannelState>>;
  readonly errors: Readonly<Partial<Record<ErrorChannel, string>>>;
  readonly selectedAuditDate: string | null;
  readonly savingPolicy: boolean;
  readonly safetyMutation: "estop" | "reset" | null;
  readonly safetyEvidence: SafetyEvidence;
}

export interface EffectorActions {
  readonly refreshAll: () => void;
  readonly refreshPolicy: () => void;
  readonly refreshAudit: (date?: string) => void;
  readonly refreshStatus: () => void;
  readonly patchPolicy: (patch: PolicyPatch) => Promise<boolean>;
  readonly estop: () => Promise<boolean>;
  readonly reset: () => Promise<boolean>;
}

export interface EffectorController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => EffectorSnapshot;
  readonly getServerSnapshot: () => EffectorSnapshot;
  readonly start: () => void;
  readonly dispose: () => void;
  readonly actions: EffectorActions;
}

interface ActiveOperation {
  readonly controller: AbortController;
}

const CHANNEL_ERRORS: Readonly<Record<Channel, string>> = Object.freeze({
  policy: "策略加载失败，请重试。",
  audit: "审计记录加载失败，请重试。",
  status: "安全状态读取失败，请重试。",
});
const POLICY_MUTATION_ERROR = "策略保存失败，请重试。";
const SAFETY_MUTATION_ERROR = "安全操作未获权威确认，请重试。";
const SAFETY_MISMATCH_ERROR = "权威回读与操作目标不一致。";

export function createEffectorController(client: EffectorClient): EffectorController {
  const initialSnapshot = freezeSnapshot({
    policy: null,
    audit: null,
    status: null,
    channels: Object.freeze({
      policy: "idle",
      audit: "idle",
      status: "idle",
    }),
    errors: Object.freeze({}),
    selectedAuditDate: null,
    savingPolicy: false,
    safetyMutation: null,
    safetyEvidence: "checking",
  });
  let snapshot = initialSnapshot;
  let started = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const channelOperations: Partial<Record<Channel, ActiveOperation>> = {};
  let policyMutation: ActiveOperation | null = null;
  let safetyMutation: ActiveOperation | null = null;

  const getSnapshot = (): EffectorSnapshot => snapshot;
  const getServerSnapshot = (): EffectorSnapshot => initialSnapshot;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  };

  const publish = (patch: Partial<EffectorSnapshot>): boolean => {
    if (disposed) return false;
    const candidate: EffectorSnapshot = {
      ...snapshot,
      ...patch,
    };
    if (snapshotEqual(snapshot, candidate)) return false;
    snapshot = freezeSnapshot(candidate);
    for (const listener of [...listeners]) listener();
    return true;
  };

  const errorsWith = (channel: ErrorChannel, message?: string) => {
    const current = snapshot.errors;
    if (message === undefined && !(channel in current)) return current;
    if (message !== undefined && current[channel] === message) return current;
    const next: Partial<Record<ErrorChannel, string>> = { ...current };
    if (message === undefined) delete next[channel];
    else next[channel] = message;
    return Object.freeze(next);
  };

  const channelsWith = (channel: Channel, state: ChannelState) => {
    if (snapshot.channels[channel] === state) return snapshot.channels;
    return Object.freeze({ ...snapshot.channels, [channel]: state });
  };

  const beginChannel = (
    channel: Channel,
    patch: Partial<EffectorSnapshot> = {},
  ): ActiveOperation | null => {
    if (disposed) return null;
    channelOperations[channel]?.controller.abort();
    const operation = { controller: new AbortController() };
    channelOperations[channel] = operation;
    publish({
      ...patch,
      channels: channelsWith(channel, "loading"),
      errors: errorsWith(channel),
    });
    return operation;
  };

  const isCurrentChannel = (channel: Channel, operation: ActiveOperation): boolean =>
    !disposed &&
    !operation.controller.signal.aborted &&
    channelOperations[channel] === operation;

  const finishChannel = (channel: Channel, operation: ActiveOperation): void => {
    if (channelOperations[channel] === operation) delete channelOperations[channel];
  };

  const cancelChannel = (channel: Channel): void => {
    channelOperations[channel]?.controller.abort();
    delete channelOperations[channel];
  };

  const refreshPolicy = (): void => {
    if (disposed || snapshot.savingPolicy) return;
    const operation = beginChannel("policy");
    if (operation === null) return;
    void (async () => {
      try {
        const received = cloneServerValue(await client.policy(operation.controller.signal));
        if (!isCurrentChannel("policy", operation)) return;
        const policy = reuseVerifiedValue(snapshot.policy, received);
        publish({
          policy,
          channels: channelsWith("policy", "ready"),
          errors: errorsWith("policy"),
        });
      } catch {
        if (!isCurrentChannel("policy", operation)) return;
        publish({
          channels: channelsWith("policy", "error"),
          errors: errorsWith("policy", CHANNEL_ERRORS.policy),
        });
      } finally {
        finishChannel("policy", operation);
      }
    })();
  };

  const refreshAudit = (date?: string): void => {
    if (disposed) return;
    const selectedDate = date ?? snapshot.selectedAuditDate ?? undefined;
    const operation = beginChannel("audit", {
      selectedAuditDate: selectedDate ?? null,
    });
    if (operation === null) return;
    void (async () => {
      try {
        const received = cloneServerValue(
          await client.audit(selectedDate, undefined, operation.controller.signal),
        );
        if (!isCurrentChannel("audit", operation)) return;
        const audit = reuseVerifiedValue(snapshot.audit, received);
        publish({
          audit,
          channels: channelsWith("audit", "ready"),
          errors: errorsWith("audit"),
        });
      } catch {
        if (!isCurrentChannel("audit", operation)) return;
        publish({
          channels: channelsWith("audit", "error"),
          errors: errorsWith("audit", CHANNEL_ERRORS.audit),
        });
      } finally {
        finishChannel("audit", operation);
      }
    })();
  };

  const refreshStatus = (): void => {
    if (disposed || snapshot.safetyMutation !== null) return;
    const operation = beginChannel("status", { safetyEvidence: "checking" });
    if (operation === null) return;
    void (async () => {
      try {
        const received = cloneServerValue(await client.status(operation.controller.signal));
        if (!isCurrentChannel("status", operation)) return;
        const status = reuseVerifiedValue(snapshot.status, received);
        publish({
          status,
          channels: channelsWith("status", "ready"),
          errors: errorsWith("status"),
          safetyEvidence: status.stopped ? "latched" : "clear",
        });
      } catch {
        if (!isCurrentChannel("status", operation)) return;
        publish({
          channels: channelsWith("status", "error"),
          errors: errorsWith("status", CHANNEL_ERRORS.status),
          safetyEvidence: "unknown",
        });
      } finally {
        finishChannel("status", operation);
      }
    })();
  };

  const refreshAll = (): void => {
    if (disposed) return;
    refreshPolicy();
    refreshAudit();
    refreshStatus();
  };

  const patchPolicy = async (patch: PolicyPatch): Promise<boolean> => {
    if (disposed || policyMutation !== null) return false;
    cancelChannel("policy");
    const operation = { controller: new AbortController() };
    policyMutation = operation;
    publish({ savingPolicy: true, errors: errorsWith("mutation") });
    try {
      const received = cloneServerValue(
        await client.patchPolicy(patch, operation.controller.signal),
      );
      if (!isCurrentPolicyMutation(operation)) return false;
      const policy = reuseVerifiedValue(snapshot.policy, received);
      publish({
        policy,
        savingPolicy: false,
        channels: channelsWith("policy", "ready"),
        errors: clearErrors("policy", "mutation"),
      });
      return true;
    } catch {
      if (!isCurrentPolicyMutation(operation)) return false;
      const hasVerifiedPolicy = snapshot.policy !== null;
      publish({
        savingPolicy: false,
        channels: channelsWith("policy", hasVerifiedPolicy ? "ready" : "error"),
        errors: replaceErrors(
          hasVerifiedPolicy ? ["policy"] : [],
          {
            ...(!hasVerifiedPolicy ? { policy: CHANNEL_ERRORS.policy } : {}),
            mutation: POLICY_MUTATION_ERROR,
          },
        ),
      });
      return false;
    } finally {
      if (policyMutation === operation) policyMutation = null;
    }
  };

  const isCurrentPolicyMutation = (operation: ActiveOperation): boolean =>
    !disposed &&
    !operation.controller.signal.aborted &&
    policyMutation === operation;

  const clearErrors = (...channels: readonly ErrorChannel[]) => {
    if (channels.every((channel) => !(channel in snapshot.errors))) return snapshot.errors;
    const next: Partial<Record<ErrorChannel, string>> = { ...snapshot.errors };
    for (const channel of channels) delete next[channel];
    return Object.freeze(next);
  };

  const replaceErrors = (
    clear: readonly ErrorChannel[],
    set: Readonly<Partial<Record<ErrorChannel, string>>>,
  ) => {
    const next: Partial<Record<ErrorChannel, string>> = { ...snapshot.errors };
    for (const channel of clear) delete next[channel];
    Object.assign(next, set);
    if (errorRecordsEqual(snapshot.errors, next)) return snapshot.errors;
    return Object.freeze(next);
  };

  const isCurrentSafetyMutation = (operation: ActiveOperation): boolean =>
    !disposed &&
    !operation.controller.signal.aborted &&
    safetyMutation === operation;

  const runSafetyMutation = async (kind: "estop" | "reset"): Promise<boolean> => {
    if (disposed || safetyMutation !== null) return false;
    cancelChannel("status");
    const operation = { controller: new AbortController() };
    safetyMutation = operation;
    publish({ safetyMutation: kind, errors: errorsWith("mutation") });
    try {
      if (kind === "estop") await client.estop(operation.controller.signal);
      else await client.reset(operation.controller.signal);
      if (!isCurrentSafetyMutation(operation)) return false;

      const received = cloneServerValue(await client.status(operation.controller.signal));
      if (!isCurrentSafetyMutation(operation)) return false;
      const readback = reuseVerifiedValue(snapshot.status, received);
      const confirmed = kind === "estop" ? readback.stopped : !readback.stopped;
      publish({
        status: readback,
        safetyMutation: null,
        safetyEvidence: confirmed
          ? readback.stopped
            ? "latched"
            : "clear"
          : "unknown",
        channels: channelsWith("status", "ready"),
        errors: confirmed
          ? clearErrors("status", "mutation")
          : replaceErrors(["status"], { mutation: SAFETY_MISMATCH_ERROR }),
      });
      return confirmed;
    } catch {
      if (!isCurrentSafetyMutation(operation)) return false;
      publish({
        safetyMutation: null,
        safetyEvidence: "unknown",
        channels: channelsWith("status", "error"),
        errors: replaceErrors([], {
          status: CHANNEL_ERRORS.status,
          mutation: SAFETY_MUTATION_ERROR,
        }),
      });
      return false;
    } finally {
      if (safetyMutation === operation) safetyMutation = null;
    }
  };

  const start = (): void => {
    if (started) return;
    disposed = false;
    started = true;
    if (snapshot.savingPolicy || snapshot.safetyMutation !== null) {
      publish({ savingPolicy: false, safetyMutation: null });
    }
    refreshAll();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    started = false;
    for (const channel of ["policy", "audit", "status"] as const) {
      channelOperations[channel]?.controller.abort();
      delete channelOperations[channel];
    }
    policyMutation?.controller.abort();
    safetyMutation?.controller.abort();
    policyMutation = null;
    safetyMutation = null;
    listeners.clear();
  };

  const actions: EffectorActions = Object.freeze({
    refreshAll,
    refreshPolicy,
    refreshAudit,
    refreshStatus,
    patchPolicy,
    estop: () => runSafetyMutation("estop"),
    reset: () => runSafetyMutation("reset"),
  });

  return Object.freeze({
    subscribe,
    getSnapshot,
    getServerSnapshot,
    start,
    dispose,
    actions,
  });
}

function freezeSnapshot(snapshot: EffectorSnapshot): EffectorSnapshot {
  return Object.freeze(snapshot);
}

function snapshotEqual(left: EffectorSnapshot, right: EffectorSnapshot): boolean {
  return (
    left.policy === right.policy &&
    left.audit === right.audit &&
    left.status === right.status &&
    left.channels === right.channels &&
    left.errors === right.errors &&
    left.selectedAuditDate === right.selectedAuditDate &&
    left.savingPolicy === right.savingPolicy &&
    left.safetyMutation === right.safetyMutation &&
    left.safetyEvidence === right.safetyEvidence
  );
}

function cloneServerValue<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function reuseVerifiedValue<T>(previous: T | null, next: T): T {
  return previous !== null && semanticEqual(previous, next) ? previous : next;
}

function semanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => semanticEqual(value, right[index]))
    );
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        semanticEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function errorRecordsEqual(
  left: Readonly<Partial<Record<ErrorChannel, string>>>,
  right: Readonly<Partial<Record<ErrorChannel, string>>>,
): boolean {
  const leftKeys = Object.keys(left) as ErrorChannel[];
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}
