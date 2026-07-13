import { StrictMode, act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultClientMock = vi.hoisted(() => {
  const client = Object.freeze({
    status: vi.fn(async () =>
      Object.freeze({ stopped: false, pending_count: 0, audit_tail_count: 0 }),
    ),
    policy: vi.fn(async () =>
      Object.freeze({
        approval_mode: "ask" as const,
        headless_scope: "cwd" as const,
        max_steps_per_task: 1,
      }),
    ),
    audit: vi.fn(async () =>
      Object.freeze({ audit_date: null, audit_total: null, chain_valid: null }),
    ),
  });
  return { client, factory: vi.fn(() => client) };
});

vi.mock("./mobile-safety-client", () => ({
  createMobileSafetyClient: defaultClientMock.factory,
}));

import {
  MOBILE_SAFETY_SERVER_SNAPSHOT,
  type MobileSafetyController,
  type MobileSafetySnapshot,
} from "./create-mobile-safety-controller";
import {
  createMobileSafetyControllerOwner,
  mobileSafetyControllerOwner,
  useMobileSafetyController,
  type MobileSafetyControllerOwner,
} from "./use-mobile-safety-controller";

interface FakeController extends MobileSafetyController {
  readonly emit: (snapshot: MobileSafetySnapshot) => void;
  readonly metrics: {
    activeSubscriptions: number;
    peakSubscriptions: number;
  };
}

function createFakeController(): FakeController {
  let snapshot = MOBILE_SAFETY_SERVER_SNAPSHOT;
  const listeners = new Set<() => void>();
  const metrics = { activeSubscriptions: 0, peakSubscriptions: 0 };
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    metrics.activeSubscriptions += 1;
    metrics.peakSubscriptions = Math.max(
      metrics.peakSubscriptions,
      metrics.activeSubscriptions,
    );
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      metrics.activeSubscriptions -= 1;
    };
  });
  const actions = Object.freeze({
    refreshStatus: vi.fn(),
    refreshPolicy: vi.fn(),
    refreshAudit: vi.fn(),
  });

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => MOBILE_SAFETY_SERVER_SNAPSHOT,
    start: vi.fn(),
    dispose: vi.fn(),
    actions,
    emit: (next) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    metrics,
  };
}

function createReadyStatusSnapshot(): MobileSafetySnapshot {
  return Object.freeze({
    ...MOBILE_SAFETY_SERVER_SNAPSHOT,
    status: Object.freeze({
      phase: "ready" as const,
      value: Object.freeze({ stopped: false, pending_count: 3, audit_tail_count: 5 }),
      error: null,
      verified_at: "2026-07-14T00:00:00.000Z",
    }),
  });
}

function setupOwner() {
  const controllers: FakeController[] = [];
  const createController = vi.fn(() => {
    const controller = createFakeController();
    controllers.push(controller);
    return controller;
  });
  const owner = createMobileSafetyControllerOwner({
    createController,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (handle) => clearTimeout(handle),
  });
  return { owner, controllers, createController };
}

function Probe({ owner }: { readonly owner: MobileSafetyControllerOwner }) {
  const { snapshot, actions } = useMobileSafetyController(owner);
  return (
    <output data-actions-stable={String(actions === owner.actions)}>
      {snapshot.status.phase}
    </output>
  );
}

describe("Mobile Safety controller owner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    defaultClientMock.factory.mockClear();
    defaultClientMock.client.status.mockClear();
    defaultClientMock.client.policy.mockClear();
    defaultClientMock.client.audit.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not create from reads or actions and shares one controller after first subscribe", () => {
    const { owner, controllers, createController } = setupOwner();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const actions = owner.actions;

    expect(owner.getSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);
    expect(owner.getServerSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);
    expect(owner.getServerSnapshot()).toBe(owner.getServerSnapshot());
    expect(owner.actions).toBe(actions);
    expect(Object.isFrozen(actions)).toBe(true);
    actions.refreshStatus();
    actions.refreshPolicy();
    actions.refreshAudit();
    expect(createController).not.toHaveBeenCalled();

    const releaseFirst = owner.subscribe(firstListener);
    const releaseSecond = owner.subscribe(secondListener);
    expect(createController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.subscribe).toHaveBeenCalledTimes(2);

    controllers[0]?.emit(createReadyStatusSnapshot());
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().status.phase).toBe("ready");

    releaseFirst();
    releaseFirst();
    expect(controllers[0]?.metrics.activeSubscriptions).toBe(1);
    releaseSecond();
    releaseSecond();
    expect(controllers[0]?.metrics.activeSubscriptions).toBe(0);
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
  });

  it("delegates stable actions only while at least one subscriber is active", async () => {
    const { owner, controllers, createController } = setupOwner();
    const actions = owner.actions;
    actions.refreshStatus();
    expect(createController).not.toHaveBeenCalled();

    const release = owner.subscribe(vi.fn());
    actions.refreshStatus();
    actions.refreshPolicy();
    actions.refreshAudit();
    expect(controllers[0]?.actions.refreshStatus).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.actions.refreshPolicy).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.actions.refreshAudit).toHaveBeenCalledTimes(1);

    release();
    actions.refreshStatus();
    actions.refreshPolicy();
    actions.refreshAudit();
    expect(controllers[0]?.actions.refreshStatus).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.actions.refreshPolicy).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.actions.refreshAudit).toHaveBeenCalledTimes(1);

    const releaseReacquired = owner.subscribe(vi.fn());
    expect(owner.actions).toBe(actions);
    actions.refreshStatus();
    expect(controllers[0]?.actions.refreshStatus).toHaveBeenCalledTimes(2);
    releaseReacquired();
    await vi.runAllTimersAsync();
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);

    actions.refreshStatus();
    expect(controllers[0]?.actions.refreshStatus).toHaveBeenCalledTimes(2);
    expect(createController).toHaveBeenCalledTimes(1);
  });

  it("cancels zero-delay disposal on StrictMode-style reacquire and creates fresh after true release", async () => {
    const { owner, controllers, createController } = setupOwner();
    const releaseFirst = owner.subscribe(vi.fn());
    releaseFirst();
    const releaseReacquired = owner.subscribe(vi.fn());
    await vi.runAllTimersAsync();

    expect(createController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
    expect(controllers[0]?.metrics.activeSubscriptions).toBe(1);

    releaseReacquired();
    releaseReacquired();
    await vi.runAllTimersAsync();
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);

    const releaseFresh = owner.subscribe(vi.fn());
    expect(createController).toHaveBeenCalledTimes(2);
    expect(controllers[1]).not.toBe(controllers[0]);
    expect(controllers[1]?.start).toHaveBeenCalledTimes(1);
    releaseFresh();
    await vi.runAllTimersAsync();
    expect(controllers[1]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps the default owner client factory lazy until its first subscription", async () => {
    const actions = mobileSafetyControllerOwner.actions;
    expect(mobileSafetyControllerOwner.getSnapshot()).toBe(MOBILE_SAFETY_SERVER_SNAPSHOT);
    expect(mobileSafetyControllerOwner.getServerSnapshot()).toBe(
      MOBILE_SAFETY_SERVER_SNAPSHOT,
    );
    actions.refreshStatus();
    actions.refreshPolicy();
    actions.refreshAudit();
    expect(defaultClientMock.factory).not.toHaveBeenCalled();

    const release = mobileSafetyControllerOwner.subscribe(vi.fn());
    expect(defaultClientMock.factory).toHaveBeenCalledTimes(1);
    expect(defaultClientMock.client.status).toHaveBeenCalledTimes(1);
    expect(defaultClientMock.client.policy).toHaveBeenCalledTimes(1);
    expect(defaultClientMock.client.audit).toHaveBeenCalledTimes(1);
    await flushHydration();

    release();
    await vi.runAllTimersAsync();
    actions.refreshStatus();
    expect(defaultClientMock.factory).toHaveBeenCalledTimes(1);
    expect(defaultClientMock.client.status).toHaveBeenCalledTimes(1);
  });

  it("server-renders and hydrates in StrictMode with one controller and one peak subscription", async () => {
    const { owner, controllers, createController } = setupOwner();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = renderToString(
      <StrictMode>
        <Probe owner={owner} />
      </StrictMode>,
    );
    expect(html).toContain("idle");
    expect(html).toContain('data-actions-stable="true"');
    expect(createController).not.toHaveBeenCalled();

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <Probe owner={owner} />
        </StrictMode>,
      );
      await flushHydration();
    });

    expect(createController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.metrics.activeSubscriptions).toBe(1);
    expect(controllers[0]?.metrics.peakSubscriptions).toBe(1);
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
    expect(container.textContent).toBe("idle");
    expect(
      consoleError.mock.calls.some(([message]) =>
        /hydration|maximum update depth|result of getSnapshot should be cached/i.test(
          String(message),
        ),
      ),
    ).toBe(false);

    await act(async () => {
      controllers[0]?.emit(createReadyStatusSnapshot());
      await flushHydration();
    });
    expect(container.textContent).toBe("ready");

    await act(async () => {
      root?.unmount();
      await vi.runAllTimersAsync();
    });
    expect(controllers[0]?.metrics.activeSubscriptions).toBe(0);
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(createController).toHaveBeenCalledTimes(1);
    container.remove();
    consoleError.mockRestore();
  });
});

async function flushHydration(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}
