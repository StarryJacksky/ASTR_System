import type {
  MobileLocalAuditProjection,
  MobileLocalPolicyProjection,
  MobileLocalStatusProjection,
  MobileSafetyClient,
} from "./mobile-safety-types";

export type MobileChannelSnapshot<T> =
  | {
      readonly phase: "idle" | "loading";
      readonly value: null;
      readonly error: null;
      readonly verified_at: null;
    }
  | {
      readonly phase: "ready";
      readonly value: T;
      readonly error: null;
      readonly verified_at: string;
    }
  | {
      readonly phase: "refreshing";
      readonly value: T;
      readonly error: null;
      readonly verified_at: string;
    }
  | {
      readonly phase: "stale";
      readonly value: T;
      readonly error: string;
      readonly verified_at: string;
    }
  | {
      readonly phase: "error";
      readonly value: null;
      readonly error: string;
      readonly verified_at: null;
    };

export interface MobileSafetySnapshot {
  readonly status: MobileChannelSnapshot<MobileLocalStatusProjection>;
  readonly policy: MobileChannelSnapshot<MobileLocalPolicyProjection>;
  readonly audit: MobileChannelSnapshot<MobileLocalAuditProjection>;
}

export interface MobileSafetyActions {
  readonly refreshStatus: () => void;
  readonly refreshPolicy: () => void;
  readonly refreshAudit: () => void;
}

export interface MobileSafetyController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => MobileSafetySnapshot;
  readonly getServerSnapshot: () => MobileSafetySnapshot;
  readonly start: () => void;
  readonly dispose: () => void;
  readonly actions: MobileSafetyActions;
}

type ChannelKey = "status" | "policy" | "audit";

type ChannelValue = {
  readonly status: MobileLocalStatusProjection;
  readonly policy: MobileLocalPolicyProjection;
  readonly audit: MobileLocalAuditProjection;
};

interface RequestSlot {
  epoch: number;
  abort: AbortController | null;
}

const CHANNEL_KEYS: readonly ChannelKey[] = ["status", "policy", "audit"];

const LOCAL_ERRORS: Readonly<Record<ChannelKey, string>> = Object.freeze({
  status: "本机状态读取失败",
  policy: "本机策略读取失败",
  audit: "本机审计读取失败",
});

const IDLE = Object.freeze({
  phase: "idle",
  value: null,
  error: null,
  verified_at: null,
} as const);

export const MOBILE_SAFETY_SERVER_SNAPSHOT: MobileSafetySnapshot = Object.freeze({
  status: IDLE,
  policy: IDLE,
  audit: IDLE,
});

export interface CreateMobileSafetyControllerOptions {
  readonly client: MobileSafetyClient;
  readonly now?: () => Date;
}

export function createMobileSafetyController({
  client,
  now = () => new Date(),
}: CreateMobileSafetyControllerOptions): MobileSafetyController {
  let snapshot = MOBILE_SAFETY_SERVER_SNAPSHOT;
  let disposed = false;
  let started = false;
  const listeners = new Set<() => void>();
  const requests: Record<ChannelKey, RequestSlot> = {
    status: { epoch: 0, abort: null },
    policy: { epoch: 0, abort: null },
    audit: { epoch: 0, abort: null },
  };

  const publish = <K extends ChannelKey>(
    key: K,
    channel: MobileChannelSnapshot<ChannelValue[K]>,
  ): void => {
    if (disposed) return;
    snapshot = Object.freeze({
      ...snapshot,
      [key]: Object.freeze(channel),
    }) as MobileSafetySnapshot;
    for (const listener of listeners) listener();
  };

  const isCurrent = (key: ChannelKey, epoch: number, abort: AbortController): boolean => {
    const slot = requests[key];
    return (
      !disposed &&
      !abort.signal.aborted &&
      slot.epoch === epoch &&
      slot.abort === abort
    );
  };

  const freezeValue = <K extends ChannelKey>(value: ChannelValue[K]): ChannelValue[K] => {
    Object.freeze(value);
    return value;
  };

  const settleFailure = <K extends ChannelKey>(
    key: K,
    epoch: number,
    abort: AbortController,
  ): void => {
    if (!isCurrent(key, epoch, abort)) return;
    const current = snapshot[key] as MobileChannelSnapshot<ChannelValue[K]>;
    const verifiedAt = current.verified_at;
    requests[key].abort = null;
    publish(
      key,
      current.value === null || verifiedAt === null
        ? {
            phase: "error",
            value: null,
            error: LOCAL_ERRORS[key],
            verified_at: null,
          }
        : {
            phase: "stale",
            value: current.value,
            error: LOCAL_ERRORS[key],
            verified_at: verifiedAt,
          },
    );
  };

  const load = <K extends ChannelKey>(
    key: K,
    request: (signal: AbortSignal) => Promise<ChannelValue[K]>,
  ): void => {
    if (disposed) return;
    const previous = snapshot[key] as MobileChannelSnapshot<ChannelValue[K]>;
    const verifiedAt = previous.verified_at;
    requests[key].abort?.abort();
    const abort = new AbortController();
    const epoch = ++requests[key].epoch;
    requests[key].abort = abort;
    publish(
      key,
      previous.value === null || verifiedAt === null
        ? { phase: "loading", value: null, error: null, verified_at: null }
        : {
            phase: "refreshing",
            value: previous.value,
            error: null,
            verified_at: verifiedAt,
          },
    );

    let pending: Promise<ChannelValue[K]>;
    try {
      pending = request(abort.signal);
    } catch {
      settleFailure(key, epoch, abort);
      return;
    }

    void pending
      .then((value) => {
        if (!isCurrent(key, epoch, abort)) return;
        const frozenValue = freezeValue(value);
        const verifiedAt = now().toISOString();
        if (!isCurrent(key, epoch, abort)) return;
        requests[key].abort = null;
        publish(key, {
          phase: "ready",
          value: frozenValue,
          error: null,
          verified_at: verifiedAt,
        });
      })
      .catch(() => {
        settleFailure(key, epoch, abort);
      });
  };

  const actions: MobileSafetyActions = Object.freeze({
    refreshStatus: () => load("status", (signal) => client.status(signal)),
    refreshPolicy: () => load("policy", (signal) => client.policy(signal)),
    refreshAudit: () => load("audit", (signal) => client.audit(signal)),
  });

  const controller: MobileSafetyController = {
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => MOBILE_SAFETY_SERVER_SNAPSHOT,
    start: () => {
      if (started || disposed) return;
      started = true;
      actions.refreshStatus();
      actions.refreshPolicy();
      actions.refreshAudit();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const key of CHANNEL_KEYS) {
        requests[key].abort?.abort();
        requests[key].abort = null;
      }
      listeners.clear();
    },
    actions,
  };

  return Object.freeze(controller);
}
