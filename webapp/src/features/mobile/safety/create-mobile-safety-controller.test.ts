import { describe, expect, it, vi } from "vitest";

import type {
  MobileLocalAuditProjection,
  MobileLocalPolicyProjection,
  MobileLocalStatusProjection,
  MobileSafetyClient,
} from "./mobile-safety-types";
import {
  MOBILE_SAFETY_SERVER_SNAPSHOT,
  createMobileSafetyController,
  type MobileSafetyActions,
} from "./create-mobile-safety-controller";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

interface PendingRequest<T> extends Deferred<T> {
  readonly signal: AbortSignal | undefined;
}

const STATUS: MobileLocalStatusProjection = {
  stopped: false,
  pending_count: 1,
  audit_tail_count: 2,
};

const POLICY: MobileLocalPolicyProjection = {
  approval_mode: "audited",
  headless_scope: "folders",
  max_steps_per_task: 24,
};

const AUDIT: MobileLocalAuditProjection = {
  audit_date: "2026-07-13",
  audit_total: 8,
  chain_valid: true,
};

const ERRORS = {
  status: "本机状态读取失败",
  policy: "本机策略读取失败",
  audit: "本机审计读取失败",
} as const;

type ChannelKey = keyof typeof ERRORS;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function pending<T>(signal: AbortSignal | undefined): PendingRequest<T> {
  return { ...deferred<T>(), signal };
}

function createPendingClient() {
  const statusRequests: PendingRequest<MobileLocalStatusProjection>[] = [];
  const policyRequests: PendingRequest<MobileLocalPolicyProjection>[] = [];
  const auditRequests: PendingRequest<MobileLocalAuditProjection>[] = [];
  const client: MobileSafetyClient = {
    status: vi.fn((signal?: AbortSignal) => {
      const request = pending<MobileLocalStatusProjection>(signal);
      statusRequests.push(request);
      return request.promise;
    }),
    policy: vi.fn((signal?: AbortSignal) => {
      const request = pending<MobileLocalPolicyProjection>(signal);
      policyRequests.push(request);
      return request.promise;
    }),
    audit: vi.fn((signal?: AbortSignal) => {
      const request = pending<MobileLocalAuditProjection>(signal);
      auditRequests.push(request);
      return request.promise;
    }),
  };
  return { client, statusRequests, policyRequests, auditRequests };
}

function resolveRequest(
  harness: ReturnType<typeof createPendingClient>,
  key: ChannelKey,
  index: number,
): void {
  if (key === "status") harness.statusRequests[index]?.resolve(STATUS);
  if (key === "policy") harness.policyRequests[index]?.resolve(POLICY);
  if (key === "audit") harness.auditRequests[index]?.resolve(AUDIT);
}

function rejectRequest(
  harness: ReturnType<typeof createPendingClient>,
  key: ChannelKey,
  index: number,
  reason: unknown,
): void {
  if (key === "status") harness.statusRequests[index]?.reject(reason);
  if (key === "policy") harness.policyRequests[index]?.reject(reason);
  if (key === "audit") harness.auditRequests[index]?.reject(reason);
}

function requestSignal(
  harness: ReturnType<typeof createPendingClient>,
  key: ChannelKey,
  index: number,
): AbortSignal {
  const signal =
    key === "status"
      ? harness.statusRequests[index]?.signal
      : key === "policy"
        ? harness.policyRequests[index]?.signal
        : harness.auditRequests[index]?.signal;
  if (!signal) throw new Error(`missing ${key} signal ${index}`);
  return signal;
}

function refresh(actions: MobileSafetyActions, key: ChannelKey): void {
  if (key === "status") actions.refreshStatus();
  if (key === "policy") actions.refreshPolicy();
  if (key === "audit") actions.refreshAudit();
}

async function flushSettlements(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Mobile Safety controller", () => {
  it("publishes status without changing loading policy or audit", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({
      client: harness.client,
      now: () => new Date("2026-07-13T00:00:00.000Z"),
    });

    controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      status: { phase: "loading" },
      policy: { phase: "loading" },
      audit: { phase: "loading" },
    });

    harness.statusRequests[0]?.resolve(STATUS);
    await flushSettlements();

    expect(controller.getSnapshot()).toMatchObject({
      status: {
        phase: "ready",
        value: STATUS,
        verified_at: "2026-07-13T00:00:00.000Z",
      },
      policy: { phase: "loading" },
      audit: { phase: "loading" },
    });
  });

  it.each<ChannelKey>(["status", "policy", "audit"])(
    "keeps %s initial failure local and independent",
    async (failedKey) => {
      const harness = createPendingClient();
      const controller = createMobileSafetyController({ client: harness.client });
      controller.start();

      rejectRequest(harness, failedKey, 0, new Error("REMOTE_SECRET_NEVER_EXPOSE"));
      for (const key of ["status", "policy", "audit"] as const) {
        if (key !== failedKey) resolveRequest(harness, key, 0);
      }
      await flushSettlements();

      expect(controller.getSnapshot()[failedKey]).toEqual({
        phase: "error",
        value: null,
        error: ERRORS[failedKey],
        verified_at: null,
      });
      for (const key of ["status", "policy", "audit"] as const) {
        if (key !== failedKey) expect(controller.getSnapshot()[key].phase).toBe("ready");
      }
      expect(JSON.stringify(controller.getSnapshot())).not.toContain("REMOTE_SECRET_NEVER_EXPOSE");
    },
  );

  it.each<ChannelKey>(["status", "policy", "audit"])(
    "contains a synchronous %s throw and still starts the other channels",
    async (failedKey) => {
      const harness = createPendingClient();
      let failedSignal: AbortSignal | undefined;
      const client: MobileSafetyClient = {
        status:
          failedKey === "status"
            ? vi.fn((signal?: AbortSignal) => {
                failedSignal = signal;
                throw new Error("SYNC_REMOTE_SECRET");
              })
            : harness.client.status,
        policy:
          failedKey === "policy"
            ? vi.fn((signal?: AbortSignal) => {
                failedSignal = signal;
                throw new Error("SYNC_REMOTE_SECRET");
              })
            : harness.client.policy,
        audit:
          failedKey === "audit"
            ? vi.fn((signal?: AbortSignal) => {
                failedSignal = signal;
                throw new Error("SYNC_REMOTE_SECRET");
              })
            : harness.client.audit,
      };
      const controller = createMobileSafetyController({ client });

      expect(() => controller.start()).not.toThrow();
      expect(client.status).toHaveBeenCalledTimes(1);
      expect(client.policy).toHaveBeenCalledTimes(1);
      expect(client.audit).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot()[failedKey]).toMatchObject({
        phase: "error",
        error: ERRORS[failedKey],
      });
      for (const key of ["status", "policy", "audit"] as const) {
        if (key !== failedKey) expect(controller.getSnapshot()[key].phase).toBe("loading");
      }

      for (const key of ["status", "policy", "audit"] as const) {
        if (key !== failedKey) resolveRequest(harness, key, 0);
      }
      await flushSettlements();
      for (const key of ["status", "policy", "audit"] as const) {
        if (key !== failedKey) expect(controller.getSnapshot()[key].phase).toBe("ready");
      }
      expect(failedSignal?.aborted).toBe(false);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain("SYNC_REMOTE_SECRET");
    },
  );

  it("contains a throwing then getter without leaking or blocking the other channels", async () => {
    const harness = createPendingClient();
    const hostile = Object.defineProperty({}, "then", {
      get(): never {
        throw new Error("THEN_GETTER_SECRET");
      },
    }) as unknown as Promise<MobileLocalStatusProjection>;
    const client: MobileSafetyClient = {
      status: vi.fn(() => hostile),
      policy: harness.client.policy,
      audit: harness.client.audit,
    };
    const controller = createMobileSafetyController({ client });

    expect(() => controller.start()).not.toThrow();
    expect(client.status).toHaveBeenCalledTimes(1);
    expect(client.policy).toHaveBeenCalledTimes(1);
    expect(client.audit).toHaveBeenCalledTimes(1);
    harness.policyRequests[0]?.resolve(POLICY);
    harness.auditRequests[0]?.resolve(AUDIT);
    await flushSettlements();

    expect(controller.getSnapshot().status).toEqual({
      phase: "error",
      value: null,
      error: ERRORS.status,
      verified_at: null,
    });
    expect(controller.getSnapshot().policy.phase).toBe("ready");
    expect(controller.getSnapshot().audit.phase).toBe("ready");
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("THEN_GETTER_SECRET");
  });

  it("assimilates a synchronous thenable whose then returns undefined", async () => {
    const harness = createPendingClient();
    const synchronousThenable = {
      then(resolve: (value: MobileLocalStatusProjection) => void): undefined {
        resolve(STATUS);
        return undefined;
      },
    } as unknown as Promise<MobileLocalStatusProjection>;
    const client: MobileSafetyClient = {
      status: vi.fn(() => synchronousThenable),
      policy: harness.client.policy,
      audit: harness.client.audit,
    };
    const controller = createMobileSafetyController({ client });

    expect(() => controller.start()).not.toThrow();
    expect(client.status).toHaveBeenCalledTimes(1);
    expect(client.policy).toHaveBeenCalledTimes(1);
    expect(client.audit).toHaveBeenCalledTimes(1);
    harness.policyRequests[0]?.resolve(POLICY);
    harness.auditRequests[0]?.resolve(AUDIT);
    await flushSettlements();

    expect(controller.getSnapshot().status).toMatchObject({
      phase: "ready",
      value: STATUS,
    });
    expect(controller.getSnapshot().policy.phase).toBe("ready");
    expect(controller.getSnapshot().audit.phase).toBe("ready");
  });

  it("does not call any client after a loading listener disposes the controller", () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    controller.subscribe(() => {
      if (controller.getSnapshot().status.phase === "loading") controller.dispose();
    });

    expect(() => controller.start()).not.toThrow();
    expect(harness.client.status).not.toHaveBeenCalled();
    expect(harness.client.policy).not.toHaveBeenCalled();
    expect(harness.client.audit).not.toHaveBeenCalled();
  });

  it("calls only the new current request after a loading listener refreshes the same channel", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    let refreshed = false;
    controller.subscribe(() => {
      if (!refreshed && controller.getSnapshot().status.phase === "loading") {
        refreshed = true;
        controller.actions.refreshStatus();
      }
    });

    controller.start();
    expect(harness.client.status).toHaveBeenCalledTimes(1);
    expect(harness.statusRequests).toHaveLength(1);
    expect(harness.statusRequests[0]?.signal?.aborted).toBe(false);
    expect(harness.client.policy).toHaveBeenCalledTimes(1);
    expect(harness.client.audit).toHaveBeenCalledTimes(1);

    harness.statusRequests[0]?.resolve(STATUS);
    harness.policyRequests[0]?.resolve(POLICY);
    harness.auditRequests[0]?.resolve(AUDIT);
    await flushSettlements();
    expect(controller.getSnapshot().status.phase).toBe("ready");
  });

  it("ignores a superseded request that rejects after its replacement starts", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    controller.start();
    const firstSignal = requestSignal(harness, "status", 0);

    controller.actions.refreshStatus();
    const replacementSnapshot = controller.getSnapshot();
    expect(firstSignal.aborted).toBe(true);

    harness.statusRequests[0]?.reject(new Error("SUPERSEDED_SECRET"));
    await flushSettlements();

    expect(controller.getSnapshot()).toBe(replacementSnapshot);
    expect(controller.getSnapshot().status.phase).toBe("loading");
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("SUPERSEDED_SECRET");
    controller.dispose();
  });

  it("lets a clock callback supersede settlement without publishing the older value", async () => {
    const harness = createPendingClient();
    let superseded = false;
    const controller = createMobileSafetyController({
      client: harness.client,
      now: () => {
        if (!superseded) {
          superseded = true;
          controller.actions.refreshStatus();
        }
        return new Date("2026-07-13T04:05:06.007Z");
      },
    });
    controller.start();

    harness.statusRequests[0]?.resolve(STATUS);
    await flushSettlements();

    expect(harness.statusRequests).toHaveLength(2);
    expect(requestSignal(harness, "status", 0).aborted).toBe(true);
    expect(controller.getSnapshot().status.phase).toBe("loading");

    harness.statusRequests[1]?.resolve({ ...STATUS, pending_count: 7 });
    await flushSettlements();
    expect(controller.getSnapshot().status).toMatchObject({
      phase: "ready",
      value: { pending_count: 7 },
      verified_at: "2026-07-13T04:05:06.007Z",
    });
  });

  it("does not publish or request again when abort disposal reenters refresh", () => {
    const harness = createPendingClient();
    const client: MobileSafetyClient = {
      ...harness.client,
      status: vi.fn((signal?: AbortSignal) => {
        const request = pending<MobileLocalStatusProjection>(signal);
        harness.statusRequests.push(request);
        signal?.addEventListener("abort", () => controller.dispose(), { once: true });
        return request.promise;
      }),
    };
    const controller = createMobileSafetyController({ client });
    controller.start();
    const loading = controller.getSnapshot();

    expect(() => controller.actions.refreshStatus()).not.toThrow();

    expect(controller.getSnapshot()).toBe(loading);
    expect(client.status).toHaveBeenCalledTimes(1);
    expect(harness.statusRequests).toHaveLength(1);
  });

  it.each<ChannelKey>(["status", "policy", "audit"])(
    "retains verified value and time when %s refresh fails",
    async (key) => {
      const harness = createPendingClient();
      const controller = createMobileSafetyController({
        client: harness.client,
        now: () => new Date("2026-07-13T01:02:03.004Z"),
      });
      controller.start();
      for (const channel of ["status", "policy", "audit"] as const) {
        resolveRequest(harness, channel, 0);
      }
      await flushSettlements();

      const before = controller.getSnapshot();
      const ready = before[key];
      expect(ready.phase).toBe("ready");
      refresh(controller.actions, key);
      const refreshing = controller.getSnapshot()[key];
      expect(refreshing).toMatchObject({
        phase: "refreshing",
        error: null,
        verified_at: "2026-07-13T01:02:03.004Z",
      });
      expect(refreshing.value).toBe(ready.value);

      rejectRequest(harness, key, 1, new Error("REFRESH_SECRET"));
      await flushSettlements();
      const stale = controller.getSnapshot()[key];
      expect(stale).toEqual({
        phase: "stale",
        value: ready.value,
        error: ERRORS[key],
        verified_at: "2026-07-13T01:02:03.004Z",
      });
      expect(stale.value).toBe(ready.value);
      for (const other of ["status", "policy", "audit"] as const) {
        if (other !== key) expect(controller.getSnapshot()[other]).toBe(before[other]);
      }
    },
  );

  it("supersedes and aborts an older request without allowing its late value to publish", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    controller.start();
    for (const key of ["status", "policy", "audit"] as const) resolveRequest(harness, key, 0);
    await flushSettlements();

    controller.actions.refreshStatus();
    const firstSignal = requestSignal(harness, "status", 1);
    controller.actions.refreshStatus();
    const secondSignal = requestSignal(harness, "status", 2);
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);

    const newest = { ...STATUS, pending_count: 77 };
    harness.statusRequests[2]?.resolve(newest);
    await flushSettlements();
    const published = controller.getSnapshot();
    expect(published.status).toMatchObject({ phase: "ready", value: newest });

    harness.statusRequests[1]?.resolve({ ...STATUS, pending_count: 999 });
    await flushSettlements();
    expect(controller.getSnapshot()).toBe(published);
    expect(controller.getSnapshot().status).toBe(published.status);
  });

  it.each(["success", "failure"] as const)(
    "clears the current abort slot after a %s settlement",
    async (settlement) => {
      const harness = createPendingClient();
      const controller = createMobileSafetyController({ client: harness.client });
      controller.start();
      const settledSignal = requestSignal(harness, "status", 0);
      if (settlement === "success") harness.statusRequests[0]?.resolve(STATUS);
      else harness.statusRequests[0]?.reject(new Error("expected failure"));
      await flushSettlements();
      expect(settledSignal.aborted).toBe(false);

      controller.actions.refreshStatus();
      const activeSignal = requestSignal(harness, "status", 1);
      expect(settledSignal.aborted).toBe(false);
      controller.dispose();
      expect(settledSignal.aborted).toBe(false);
      expect(activeSignal.aborted).toBe(true);
    },
  );

  it("makes start and dispose idempotent and blocks all post-disposal work", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.start();
    controller.start();
    expect(harness.client.status).toHaveBeenCalledTimes(1);
    expect(harness.client.policy).toHaveBeenCalledTimes(1);
    expect(harness.client.audit).toHaveBeenCalledTimes(1);
    const beforeDispose = controller.getSnapshot();
    listener.mockClear();

    controller.dispose();
    controller.dispose();
    expect(requestSignal(harness, "status", 0).aborted).toBe(true);
    expect(requestSignal(harness, "policy", 0).aborted).toBe(true);
    expect(requestSignal(harness, "audit", 0).aborted).toBe(true);
    for (const key of ["status", "policy", "audit"] as const) resolveRequest(harness, key, 0);
    await flushSettlements();
    expect(controller.getSnapshot()).toBe(beforeDispose);
    expect(listener).not.toHaveBeenCalled();

    controller.actions.refreshStatus();
    controller.actions.refreshPolicy();
    controller.actions.refreshAudit();
    controller.start();
    controller.subscribe(listener)();
    unsubscribe();
    expect(harness.client.status).toHaveBeenCalledTimes(1);
    expect(harness.client.policy).toHaveBeenCalledTimes(1);
    expect(harness.client.audit).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("freezes the server graph, controller graph, published channels, and values", async () => {
    expect(Object.isFrozen(MOBILE_SAFETY_SERVER_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(MOBILE_SAFETY_SERVER_SNAPSHOT.status)).toBe(true);
    expect(Object.isFrozen(MOBILE_SAFETY_SERVER_SNAPSHOT.policy)).toBe(true);
    expect(Object.isFrozen(MOBILE_SAFETY_SERVER_SNAPSHOT.audit)).toBe(true);
    expect(MOBILE_SAFETY_SERVER_SNAPSHOT.status).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT.policy);

    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    expect(Object.isFrozen(controller)).toBe(true);
    expect(Object.isFrozen(controller.actions)).toBe(true);
    expect(controller.getServerSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);
    expect(controller.getServerSnapshot()).toBe(controller.getServerSnapshot());
    expect(controller.getSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);

    controller.start();
    for (const key of ["status", "policy", "audit"] as const) resolveRequest(harness, key, 0);
    await flushSettlements();
    const snapshot = controller.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const key of ["status", "policy", "audit"] as const) {
      expect(Object.isFrozen(snapshot[key])).toBe(true);
      expect(Object.isFrozen(snapshot[key].value)).toBe(true);
    }
  });

  it("keeps snapshot references stable when no publish occurs", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    const listener = vi.fn();
    controller.subscribe(listener);
    const idle = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(idle);

    controller.start();
    const loading = controller.getSnapshot();
    listener.mockClear();
    controller.start();
    expect(controller.getSnapshot()).toBe(loading);
    expect(listener).not.toHaveBeenCalled();

    controller.dispose();
    harness.statusRequests[0]?.resolve(STATUS);
    await flushSettlements();
    expect(controller.getSnapshot()).toBe(loading);
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes a new top-level snapshot while preserving unrelated channel references", async () => {
    const harness = createPendingClient();
    const controller = createMobileSafetyController({ client: harness.client });
    controller.start();
    const loading = controller.getSnapshot();
    harness.statusRequests[0]?.resolve(STATUS);
    await flushSettlements();
    const ready = controller.getSnapshot();

    expect(ready).not.toBe(loading);
    expect(ready.status).not.toBe(loading.status);
    expect(ready.policy).toBe(loading.policy);
    expect(ready.audit).toBe(loading.audit);
  });
});
