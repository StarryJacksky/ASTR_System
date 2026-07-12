import { describe, expect, it, vi } from "vitest";

import type {
  PresenceVisualRuntime,
  PresenceVisualRuntimeSnapshot,
  PresenceVisualSemanticEvent,
  PresenceVisualSemanticSnapshot,
  PresenceVisualSemanticSource,
} from "./presence-visual-runtime";
import {
  PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT,
  createPresenceVisualRuntimeOwner,
} from "./presence-visual-owner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSemanticSource(visualRuntime: PresenceVisualSemanticSnapshot["visualRuntime"] = "ready") {
  let snapshot: PresenceVisualSemanticSnapshot = {
    visibility: "visible",
    motion: "full",
    visualRuntime,
  };
  const listeners = new Set<() => void>();
  const events: PresenceVisualSemanticEvent[] = [];
  const sequence: string[] = [];
  const source: PresenceVisualSemanticSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (event) => {
      events.push(event);
      sequence.push(`dispatch:${event.type}`);
      if (event.type === "VISUAL_RETRY") {
        snapshot = { ...snapshot, visualRuntime: "loading" };
      } else if (event.type === "WEBGL_READY") {
        snapshot = { ...snapshot, visualRuntime: "ready" };
      } else {
        snapshot = { ...snapshot, visualRuntime: "contextLost" };
      }
      for (const listener of [...listeners]) listener();
    },
  };
  return {
    source,
    events,
    sequence,
    setVisualRuntime(next: PresenceVisualSemanticSnapshot["visualRuntime"]) {
      snapshot = { ...snapshot, visualRuntime: next };
      for (const listener of [...listeners]) listener();
    },
  };
}

const RUNTIME_SNAPSHOT: PresenceVisualRuntimeSnapshot = Object.freeze({
  phase: "ready",
  failureStage: null,
  retryRequired: false,
  webglAvailability: "available",
  width: 720,
  height: 480,
  resolution: 1.5,
  fps: 30,
  compact: false,
  generation: 1,
});

function createFakeRuntime(sequence: string[] = []) {
  let snapshot = RUNTIME_SNAPSHOT;
  const listeners = new Set<() => void>();
  const runtime: PresenceVisualRuntime = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    mount: vi.fn(async () => undefined),
    refreshLayout: vi.fn(),
    refreshMetrics: vi.fn(),
    retry: vi.fn(async () => {
      sequence.push("runtime:retry");
      return true;
    }),
    destroy: vi.fn(),
  };
  return {
    runtime,
    emit(patch: Partial<PresenceVisualRuntimeSnapshot>) {
      snapshot = Object.freeze({ ...snapshot, ...patch });
      for (const listener of [...listeners]) listener();
    },
  };
}

function createHarness() {
  const microtasks: Array<() => void> = [];
  const owner = createPresenceVisualRuntimeOwner({
    scheduleMicrotask: (callback) => microtasks.push(callback),
  });
  return {
    owner,
    flushMicrotasks() {
      while (microtasks.length > 0) microtasks.shift()?.();
    },
  };
}

describe("Presence visual runtime owner", () => {
  it("publishes stable frozen server snapshots and resets stale visual readiness once per host group", () => {
    const built = createHarness();
    const semantic = createSemanticSource("ready");

    expect(built.owner.getServerSnapshot()).toBe(PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT);
    expect(built.owner.getServerSnapshot()).toBe(built.owner.getServerSnapshot());
    expect(Object.isFrozen(built.owner.getSnapshot())).toBe(true);

    const releaseFirst = built.owner.retainHost(semantic.source);
    const releaseSecond = built.owner.retainHost(semantic.source);
    expect(semantic.events).toEqual([{ type: "VISUAL_RETRY" }]);

    releaseFirst();
    releaseSecond();
    const releaseStrictRemount = built.owner.retainHost(semantic.source);
    built.flushMicrotasks();
    expect(semantic.events).toEqual([{ type: "VISUAL_RETRY" }]);

    releaseStrictRemount();
    built.flushMicrotasks();
    expect(built.owner.getSnapshot()).toBe(PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT);
  });

  it("shares one in-flight creation and one runtime across duplicate mount retainers", async () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const gate = deferred<PresenceVisualRuntime>();
    const createRuntime = vi.fn(() => gate.promise);
    const configurationKey = {};

    const releaseFirst = built.owner.acquireRuntime({ configurationKey, createRuntime });
    const releaseSecond = built.owner.acquireRuntime({ configurationKey, createRuntime });
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(built.owner.getSnapshot()).toMatchObject({
      hasStartedRuntime: true,
      activeRuntimeCount: 0,
      phase: "loading",
    });

    const fake = createFakeRuntime();
    gate.resolve(fake.runtime);
    await vi.waitFor(() => expect(fake.runtime.mount).toHaveBeenCalledTimes(1));
    expect(built.owner.getSnapshot()).toMatchObject({
      hasStartedRuntime: true,
      activeRuntimeCount: 1,
      phase: "ready",
    });

    releaseFirst();
    built.flushMicrotasks();
    expect(fake.runtime.destroy).not.toHaveBeenCalled();

    releaseSecond();
    built.flushMicrotasks();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(built.owner.getSnapshot().activeRuntimeCount).toBe(0);

    releaseHost();
    built.flushMicrotasks();
  });

  it("promotes the remaining Host only after destroying the departed primary runtime", async () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const configurationKey = {};
    const firstMount = {};
    const secondMount = {};
    const first = createFakeRuntime();
    const second = createFakeRuntime();
    const createFirst = vi.fn(() => first.runtime);
    const createSecond = vi.fn(() => second.runtime);

    const releaseFirst = built.owner.acquireRuntime({
      configurationKey,
      mountKey: firstMount,
      createRuntime: createFirst,
    });
    const releaseSecond = built.owner.acquireRuntime({
      configurationKey,
      mountKey: secondMount,
      createRuntime: createSecond,
    });
    await vi.waitFor(() => expect(first.runtime.mount).toHaveBeenCalledTimes(1));
    expect(createSecond).not.toHaveBeenCalled();

    releaseFirst();
    await vi.waitFor(() => expect(createSecond).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(second.runtime.mount).toHaveBeenCalledTimes(1));
    expect(first.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(first.runtime.destroy).mock.invocationCallOrder[0]).toBeLessThan(
      createSecond.mock.invocationCallOrder[0],
    );
    expect(built.owner.getSnapshot().activeRuntimeCount).toBe(1);

    releaseSecond();
    built.flushMicrotasks();
    expect(second.runtime.destroy).toHaveBeenCalledTimes(1);
    releaseHost();
    built.flushMicrotasks();
  });

  it("destroys a late runtime generation without mounting or publishing it", async () => {
    const built = createHarness();
    const semantic = createSemanticSource("loading");
    const releaseHost = built.owner.retainHost(semantic.source);
    const gate = deferred<PresenceVisualRuntime>();
    const releaseRuntime = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => gate.promise,
    });

    releaseRuntime();
    built.flushMicrotasks();
    const fake = createFakeRuntime();
    gate.resolve(fake.runtime);
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.runtime.mount).not.toHaveBeenCalled();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(built.owner.getSnapshot().activeRuntimeCount).toBe(0);
    releaseHost();
    built.flushMicrotasks();
  });

  it("rejects a conflicting configuration instead of constructing a second runtime", () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const firstKey = {};
    const releaseRuntime = built.owner.acquireRuntime({
      configurationKey: firstKey,
      createRuntime: () => createFakeRuntime().runtime,
    });

    expect(() =>
      built.owner.acquireRuntime({
        configurationKey: {},
        createRuntime: () => createFakeRuntime().runtime,
      }),
    ).toThrow(/same configuration/i);

    releaseRuntime();
    built.flushMicrotasks();
    releaseHost();
    built.flushMicrotasks();
  });

  it("switches configuration serially after the previous final retainer releases", async () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const first = createFakeRuntime();
    const second = createFakeRuntime();
    const createSecond = vi.fn(() => second.runtime);
    const releaseFirst = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => first.runtime,
    });
    await vi.waitFor(() => expect(first.runtime.mount).toHaveBeenCalledTimes(1));

    releaseFirst();
    const releaseSecond = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: createSecond,
    });

    await vi.waitFor(() => expect(second.runtime.mount).toHaveBeenCalledTimes(1));
    expect(first.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(first.runtime.destroy).mock.invocationCallOrder[0]).toBeLessThan(
      createSecond.mock.invocationCallOrder[0],
    );

    releaseSecond();
    built.flushMicrotasks();
    releaseHost();
    built.flushMicrotasks();
  });

  it("relays cached runtime snapshots and dispatches loading before explicit retry", async () => {
    const built = createHarness();
    const semantic = createSemanticSource("contextLost");
    const releaseHost = built.owner.retainHost(semantic.source);
    const fake = createFakeRuntime(semantic.sequence);
    const releaseRuntime = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => fake.runtime,
    });
    await vi.waitFor(() => expect(fake.runtime.mount).toHaveBeenCalledTimes(1));

    fake.emit({ phase: "static", retryRequired: true });
    semantic.setVisualRuntime("contextLost");
    const retrySnapshot = built.owner.getSnapshot();
    expect(retrySnapshot).toMatchObject({ phase: "static", retryRequired: true });
    expect(built.owner.getSnapshot()).toBe(retrySnapshot);

    const retryEventsBefore = semantic.events.filter(
      (event) => event.type === "VISUAL_RETRY",
    ).length;
    vi.mocked(fake.runtime.retry).mockImplementation(async () => {
      semantic.source.dispatch({ type: "VISUAL_RETRY" });
      semantic.sequence.push("runtime:retry");
      return true;
    });

    await expect(built.owner.retry()).resolves.toBe(true);
    expect(semantic.sequence.slice(-2)).toEqual([
      "dispatch:VISUAL_RETRY",
      "runtime:retry",
    ]);
    expect(
      semantic.events.filter((event) => event.type === "VISUAL_RETRY"),
    ).toHaveLength(retryEventsBefore + 1);

    releaseRuntime();
    built.flushMicrotasks();
    releaseHost();
    built.flushMicrotasks();
  });

  it("relays terminal WebGL unavailability without offering a futile retry", async () => {
    const built = createHarness();
    const semantic = createSemanticSource("loading");
    const releaseHost = built.owner.retainHost(semantic.source);
    const fake = createFakeRuntime();
    const releaseRuntime = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => fake.runtime,
    });
    await vi.waitFor(() => expect(fake.runtime.mount).toHaveBeenCalledTimes(1));

    fake.emit({
      phase: "static",
      retryRequired: false,
      webglAvailability: "unavailable",
    });

    expect(built.owner.getSnapshot()).toMatchObject({
      phase: "static",
      retryRequired: false,
      webglAvailability: "unavailable",
    });

    releaseRuntime();
    built.flushMicrotasks();
    releaseHost();
    built.flushMicrotasks();
  });

  it("final host teardown destroys the runtime once even if a child release arrives later", async () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const fake = createFakeRuntime();
    const releaseRuntime = built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => fake.runtime,
    });
    await vi.waitFor(() => expect(fake.runtime.mount).toHaveBeenCalledTimes(1));

    releaseHost();
    built.flushMicrotasks();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(built.owner.getSnapshot()).toBe(PRESENCE_VISUAL_OWNER_SERVER_SNAPSHOT);

    releaseRuntime();
    built.flushMicrotasks();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not destroy a runtime twice when its mount settles after final Host teardown", async () => {
    const built = createHarness();
    const semantic = createSemanticSource();
    const releaseHost = built.owner.retainHost(semantic.source);
    const mountGate = deferred<void>();
    const fake = createFakeRuntime();
    vi.mocked(fake.runtime.mount).mockReturnValue(mountGate.promise);
    built.owner.acquireRuntime({
      configurationKey: {},
      createRuntime: () => fake.runtime,
    });
    await vi.waitFor(() => expect(fake.runtime.mount).toHaveBeenCalledTimes(1));

    releaseHost();
    built.flushMicrotasks();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);

    mountGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
  });
});
