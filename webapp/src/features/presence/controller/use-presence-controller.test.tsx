import { StrictMode, act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/features/presence/model/presence-types";

import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceController,
  type PresenceControllerSnapshot,
} from "./create-presence-controller";
import {
  createPresenceControllerOwner,
  usePresenceController,
  type PresenceControllerOwner,
} from "./use-presence-controller";

interface FakeController extends PresenceController {
  readonly emit: (snapshot: PresenceControllerSnapshot) => void;
}

function createFakeController(): FakeController {
  let snapshot = PRESENCE_CONTROLLER_SERVER_SNAPSHOT;
  const listeners = new Set<() => void>();
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const updateDraft = vi.fn();
  const send = vi.fn(async () => true);
  const retryFailed = vi.fn(async () => true);
  const transcribe = vi.fn(async () => ({ text: "delegated transcript" }));
  const estop = vi.fn(async () => true);
  const reset = vi.fn(async () => true);

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    actions: { updateDraft, send, retryFailed, transcribe, estop, reset },
    start: vi.fn(),
    dispose: vi.fn(),
    emit: (next) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function snapshotWithCore(core: PresenceControllerSnapshot["semantic"]["core"]): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: Object.freeze({ ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT.semantic, core }),
  });
}

function setupOwner() {
  const controllers: FakeController[] = [];
  const createController = vi.fn(() => {
    const controller = createFakeController();
    controllers.push(controller);
    return controller;
  });
  const owner = createPresenceControllerOwner({
    createController,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (handle) => clearTimeout(handle),
  });
  return { owner, controllers, createController };
}

function Probe({ owner }: { readonly owner: PresenceControllerOwner }) {
  const { snapshot, actions } = usePresenceController(owner);
  return (
    <output data-actions-stable={String(actions === owner.actions)}>
      {snapshot.semantic.core}
    </output>
  );
}

describe("Presence controller external owner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates nothing during snapshot reads, starts on first acquire, and shares one controller", () => {
    const { owner, controllers, createController } = setupOwner();
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    expect(owner.getSnapshot()).toBe(PRESENCE_CONTROLLER_SERVER_SNAPSHOT);
    expect(owner.getServerSnapshot()).toBe(PRESENCE_CONTROLLER_SERVER_SNAPSHOT);
    expect(owner.getServerSnapshot()).toBe(owner.getServerSnapshot());
    expect(createController).not.toHaveBeenCalled();

    const releaseFirst = owner.subscribe(firstListener);
    const releaseSecond = owner.subscribe(secondListener);

    expect(createController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.subscribe).toHaveBeenCalledTimes(2);

    controllers[0]?.emit(snapshotWithCore("reachable"));
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().semantic.core).toBe("reachable");

    releaseFirst();
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
    releaseSecond();
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
  });

  it("cancels deferred disposal on Strict Mode-style reacquire and creates fresh after real disposal", async () => {
    const { owner, controllers, createController } = setupOwner();
    const releaseFirst = owner.subscribe(vi.fn());
    releaseFirst();

    const releaseReacquired = owner.subscribe(vi.fn());
    await vi.runAllTimersAsync();

    expect(createController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();

    releaseReacquired();
    await vi.runAllTimersAsync();
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot()).toBe(PRESENCE_CONTROLLER_SERVER_SNAPSHOT);

    const releaseFresh = owner.subscribe(vi.fn());
    expect(createController).toHaveBeenCalledTimes(2);
    expect(controllers[1]?.start).toHaveBeenCalledTimes(1);
    expect(controllers[1]).not.toBe(controllers[0]);
    releaseFresh();
  });

  it("keeps stable actions that delegate only to the currently acquired controller", async () => {
    const { owner, controllers } = setupOwner();
    const actions = owner.actions;
    const value: DraftSnapshot = {
      revision: 4,
      text: "delegate",
      selectionStart: 2,
      selectionEnd: 5,
    };
    const abort = new AbortController();

    expect(owner.actions).toBe(actions);
    expect(await actions.send(value)).toBe(false);
    expect(await actions.retryFailed()).toBe(false);
    await expect(actions.transcribe("wav", abort.signal)).rejects.toThrow(
      "Presence controller is unavailable",
    );
    const release = owner.subscribe(vi.fn());
    actions.updateDraft(value);
    expect(await actions.send(value)).toBe(true);
    expect(await actions.retryFailed()).toBe(true);
    await expect(actions.transcribe("wav", abort.signal)).resolves.toEqual({
      text: "delegated transcript",
    });
    expect(controllers[0]?.actions.updateDraft).toHaveBeenCalledWith(value);
    expect(controllers[0]?.actions.send).toHaveBeenCalledWith(value);
    expect(controllers[0]?.actions.retryFailed).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.actions.transcribe).toHaveBeenCalledWith("wav", abort.signal);

    release();
    await vi.runAllTimersAsync();
    expect(await actions.estop()).toBe(false);
    expect(await actions.reset()).toBe(false);
  });

  it("server-renders and hydrates in Strict Mode without duplicate controllers or warnings", async () => {
    const { owner, controllers, createController } = setupOwner();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const html = renderToString(
      <StrictMode>
        <Probe owner={owner} />
      </StrictMode>,
    );
    expect(html).toContain("cold");
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
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
    expect(container.textContent).toBe("cold");
    expect(
      consoleError.mock.calls.some(([message]) =>
        /hydration|maximum update depth|result of getSnapshot should be cached/i.test(String(message)),
      ),
    ).toBe(false);

    await act(async () => {
      controllers[0]?.emit(snapshotWithCore("reachable"));
      await flushHydration();
    });
    expect(container.textContent).toBe("reachable");

    await act(async () => {
      root?.unmount();
      await vi.runAllTimersAsync();
    });
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
    container.remove();
  });
});

async function flushHydration(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}
