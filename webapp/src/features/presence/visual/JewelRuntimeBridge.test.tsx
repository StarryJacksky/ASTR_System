import { StrictMode, act, useRef } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/system/AppShell";
import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState, type SemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";
import type { AstrEvent } from "@/lib/types";

const defaultPresenceOwnerMock = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/features/presence/controller/use-presence-controller", () => ({
  presenceControllerOwner: defaultPresenceOwnerMock,
}));

import { createJewelRuntime, jewelRuntime } from "./jewel-runtime";
import {
  JewelRuntimeBridge,
  createJewelRuntimeBridgeOwner,
  type JewelPresenceSource,
  type JewelSemanticSource,
} from "./JewelRuntimeBridge";
import { PresenceVisibilityBridge } from "./PresenceVisibilityBridge";

const READY_SEMANTIC: SemanticState = {
  ...initialSemanticState,
  visibility: "visible",
  motion: "full",
  visualRuntime: "ready",
};

function stageEvent(id = "stage-1"): AstrEvent {
  return {
    id,
    trace_id: "trace-active",
    type: "agent.thought",
    source: "soul.orchestrator",
    ts: "2026-07-12T00:00:00.000Z",
    payload: { text: "processing", stage: "compose" },
  };
}

function presence(
  overrides: Partial<PresenceControllerSnapshot> = {},
): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: Object.freeze({ ...READY_SEMANTIC }),
    conversation: {
      messages: [],
      receipt: { event_id: "ingest-1", trace_id: "trace-active" },
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    },
    lifeEvents: [],
    ...overrides,
  });
}

function createSemanticSource(initial = READY_SEMANTIC) {
  let state = initial;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const source: JewelSemanticSource = {
    getState: () => state,
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        unsubscribe();
      };
    }),
  };
  return {
    source,
    unsubscribe,
    emit(next: SemanticState) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function createPresenceSource(initial = presence()) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const source: JewelPresenceSource = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        unsubscribe();
      };
    }),
  };
  return {
    source,
    unsubscribe,
    emit(next: PresenceControllerSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function setup(initialPresence = presence()) {
  const semantic = createSemanticSource();
  const presenceSource = createPresenceSource(initialPresence);
  const runtime = createJewelRuntime();
  const microtasks: Array<() => void> = [];
  const scheduleMicrotask = (callback: () => void) => microtasks.push(callback);
  const owner = createJewelRuntimeBridgeOwner({
    runtime,
    semanticSource: semantic.source,
    presenceSource: presenceSource.source,
    scheduleMicrotask,
  });
  return {
    semantic,
    presenceSource,
    runtime,
    owner,
    scheduleMicrotask,
    flushMicrotasks() {
      while (microtasks.length > 0) microtasks.shift()?.();
    },
  };
}

function DefaultRuntimeIntegrationHarness() {
  const soulRef = useRef<HTMLDivElement>(null);
  return (
    <AppShell>
      <main id="main-content">
        <JewelRuntimeBridge />
        <PresenceVisibilityBridge targetRef={soulRef} />
        <div ref={soulRef}>Soul target</div>
      </main>
    </AppShell>
  );
}

describe("JewelRuntimeBridge owner", () => {
  it("shares one semantic and Presence subscription across subscribers and Strict remount", () => {
    const built = setup();
    const releaseFirst = built.owner.subscribe(vi.fn());
    const releaseSecond = built.owner.subscribe(vi.fn());

    expect(built.semantic.source.subscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.source.subscribe).toHaveBeenCalledTimes(1);

    releaseFirst();
    releaseSecond();
    expect(built.semantic.unsubscribe).not.toHaveBeenCalled();
    expect(built.presenceSource.unsubscribe).not.toHaveBeenCalled();

    const releaseReacquired = built.owner.subscribe(vi.fn());
    built.flushMicrotasks();
    expect(built.semantic.source.subscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.source.subscribe).toHaveBeenCalledTimes(1);
    expect(built.semantic.unsubscribe).not.toHaveBeenCalled();

    releaseReacquired();
    built.flushMicrotasks();
    expect(built.semantic.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.owner.getSnapshot()).toBe(built.owner.getServerSnapshot());
  });

  it("primes the current Presence snapshot without replaying historical stream motion", () => {
    const historical = presence({
      lifeEvents: [stageEvent("historical")],
      conversation: {
        messages: [],
        receipt: { event_id: "ingest-1", trace_id: "trace-active" },
        provisionalText: "already streaming",
        provisionalActive: true,
        authoritativeDecision: null,
        error: null,
      },
    });
    const built = setup(historical);
    const release = built.owner.subscribe(vi.fn());

    expect(built.owner.getSnapshot().lease).toBeNull();
    expect(built.owner.getSnapshot().activeDynamicJewelCount).toBe(0);

    release();
    built.flushMicrotasks();
  });

  it("renders one global instrumentation marker and updates it synchronously from Presence", () => {
    const built = setup();
    const view = render(<JewelRuntimeBridge owner={built.owner} />);

    expect(view.container.querySelectorAll("[data-dynamic-jewel]")).toHaveLength(1);
    expect(view.container.querySelector("[data-dynamic-jewel='inactive']")).not.toBeNull();

    act(() => {
      built.presenceSource.emit(
        presence({ lifeEvents: [stageEvent()] }),
      );
    });

    const active = view.container.querySelector("[data-dynamic-jewel='active']");
    expect(active).not.toBeNull();
    expect(active).toHaveAttribute("data-jewel-owner", "soulLens");
    expect(active).toHaveAttribute("data-jewel-mode", "streamStage");
    expect(view.container.querySelectorAll("[data-dynamic-jewel='active']")).toHaveLength(1);

    view.unmount();
    built.flushMicrotasks();
  });

  it("never renders two active markers when duplicate bridge instances are mounted", () => {
    const built = setup();
    const view = render(
      <>
        <JewelRuntimeBridge owner={built.owner} />
        <JewelRuntimeBridge owner={built.owner} />
      </>,
    );
    act(() => {
      built.presenceSource.emit(presence({ lifeEvents: [stageEvent()] }));
    });

    expect(view.container.querySelectorAll("[data-dynamic-jewel='active']")).toHaveLength(1);

    view.unmount();
    built.flushMicrotasks();
  });

  it("shares subscriptions, marker ownership, and teardown across distinct owners of one runtime", () => {
    const built = setup();
    const secondOwner = createJewelRuntimeBridgeOwner({
      runtime: built.runtime,
      semanticSource: built.semantic.source,
      presenceSource: built.presenceSource.source,
      scheduleMicrotask: built.scheduleMicrotask,
    });
    const view = render(
      <>
        <JewelRuntimeBridge key="first" owner={built.owner} />
        <JewelRuntimeBridge key="second" owner={secondOwner} />
      </>,
    );

    expect(built.semantic.source.subscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.source.subscribe).toHaveBeenCalledTimes(1);

    act(() => {
      built.presenceSource.emit(presence({ lifeEvents: [stageEvent()] }));
    });
    expect(view.container.querySelectorAll("[data-dynamic-jewel='active']")).toHaveLength(1);

    view.rerender(
      <JewelRuntimeBridge key="second" owner={secondOwner} />,
    );
    built.flushMicrotasks();
    expect(built.semantic.unsubscribe).not.toHaveBeenCalled();
    expect(built.presenceSource.unsubscribe).not.toHaveBeenCalled();
    expect(built.runtime.getSnapshot().lease?.owner).toBe("soulLens");

    view.unmount();
    built.flushMicrotasks();
    expect(built.semantic.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.runtime.getSnapshot()).toBe(built.runtime.getServerSnapshot());
  });

  it("rejects conflicting source ownership for an already registered runtime", () => {
    const built = setup();
    const otherSemantic = createSemanticSource();

    expect(() =>
      createJewelRuntimeBridgeOwner({
        runtime: built.runtime,
        semanticSource: otherSemantic.source,
        presenceSource: built.presenceSource.source,
      }),
    ).toThrow(/same semantic and Presence sources/i);
  });

  it("rolls back a partial connection when a source subscription throws", () => {
    const built = setup();
    vi.mocked(built.presenceSource.source.subscribe).mockImplementationOnce(() => {
      throw new Error("Presence source unavailable");
    });

    expect(() => built.owner.subscribe(vi.fn())).toThrow(
      "Presence source unavailable",
    );
    expect(built.semantic.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.runtime.getSnapshot()).toBe(built.runtime.getServerSnapshot());

    const release = built.owner.subscribe(vi.fn());
    expect(built.semantic.source.subscribe).toHaveBeenCalledTimes(2);
    expect(built.presenceSource.source.subscribe).toHaveBeenCalledTimes(2);
    release();
    built.flushMicrotasks();
    expect(built.semantic.unsubscribe).toHaveBeenCalledTimes(2);
    expect(built.presenceSource.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("server-renders and hydrates in Strict Mode without duplicate source ownership", async () => {
    const built = setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = (
      <StrictMode>
        <JewelRuntimeBridge owner={built.owner} />
      </StrictMode>
    );
    const html = renderToString(tree);

    expect(html).not.toContain('data-dynamic-jewel="active"');
    expect(built.semantic.source.subscribe).not.toHaveBeenCalled();
    expect(built.presenceSource.source.subscribe).not.toHaveBeenCalled();

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, tree);
      await Promise.resolve();
    });

    expect(built.semantic.source.subscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.source.subscribe).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-dynamic-jewel]")).toHaveLength(1);
    expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
      /hydration|maximum update depth|getSnapshot should be cached/i,
    );

    await act(async () => {
      root?.unmount();
      built.flushMicrotasks();
    });
    expect(built.semantic.unsubscribe).toHaveBeenCalledTimes(1);
    expect(built.presenceSource.unsubscribe).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it("releases immediately from semantic changes before any React rerender", () => {
    const built = setup();
    const release = built.owner.subscribe(vi.fn());
    built.presenceSource.emit(presence({ lifeEvents: [stageEvent()] }));
    expect(built.owner.getSnapshot().lease?.owner).toBe("soulLens");

    built.semantic.emit({ ...READY_SEMANTIC, visibility: "hidden" });

    expect(built.owner.getSnapshot().lease).toBeNull();
    expect(built.owner.getSnapshot().activeDynamicJewelCount).toBe(0);
    release();
    built.flushMicrotasks();
  });

  it("integrates the default singleton from AppShell visibility through IO and unmount release", async () => {
    let currentPresence = presence();
    const presenceListeners = new Set<() => void>();
    defaultPresenceOwnerMock.getSnapshot.mockImplementation(() => currentPresence);
    defaultPresenceOwnerMock.subscribe.mockImplementation((listener: () => void) => {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    });

    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);

    let intersectionCallback: IntersectionObserverCallback | null = null;
    let observedTarget: Element | null = null;
    const disconnect = vi.fn();
    class FakeIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0.15];

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe(target: Element) {
        observedTarget = target;
      }

      unobserve() {}
      disconnect() {
        disconnect();
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    semanticStore.setState({
      ...initialSemanticState,
      visualRuntime: "ready",
      announcement: null,
    });
    const visibilityTransitions: SemanticState["visibility"][] = [];
    const releaseVisibility = semanticStore.subscribe((state, previous) => {
      if (state.visibility !== previous.visibility) visibilityTransitions.push(state.visibility);
    });

    const view = render(<DefaultRuntimeIntegrationHarness />);

    expect(semanticStore.getState().visibility).toBe("offscreen");
    expect(visibilityTransitions).not.toContain("visible");
    expect(jewelRuntime.getSnapshot().lease).toBeNull();
    expect(observedTarget).not.toBeNull();

    act(() => {
      intersectionCallback?.(
        [
          {
            target: observedTarget,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(semanticStore.getState().visibility).toBe("visible");

    act(() => {
      currentPresence = presence({ lifeEvents: [stageEvent("integrated-stage")] });
      for (const listener of [...presenceListeners]) listener();
    });
    expect(jewelRuntime.getSnapshot().lease).toMatchObject({
      owner: "soulLens",
      mode: "streamStage",
    });
    expect(view.container.querySelectorAll("[data-dynamic-jewel='active']")).toHaveLength(1);

    view.unmount();
    expect(semanticStore.getState().visibility).toBe("offscreen");
    expect(jewelRuntime.getSnapshot().lease).toBeNull();
    await act(async () => Promise.resolve());
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(jewelRuntime.getSnapshot()).toBe(jewelRuntime.getServerSnapshot());

    releaseVisibility();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (visibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });
});
