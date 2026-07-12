import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPresenceVisualRuntimeOwner } from "./presence-visual-owner";
import type {
  PresenceVisualApplicationOptions,
  PresenceVisualJewelOwnership,
  PresenceVisualSemanticEvent,
  PresenceVisualSemanticSnapshot,
  PresenceVisualSemanticSource,
} from "./presence-visual-runtime";
import {
  PresenceVisualMount,
  loadPixiApplicationModule,
} from "./pixi-runtime-loader";

const pixiHarness = vi.hoisted(() => ({
  applications: [] as FakeApplication[],
}));

vi.mock("pixi.js", () => ({
  RENDERER_TYPE: { WEBGL: 1 },
  Application: function Application(options: PresenceVisualApplicationOptions) {
    const application = new FakeApplication(options);
    pixiHarness.applications.push(application);
    return application;
  },
}));

class FakeApplication {
  readonly view = document.createElement("canvas");
  readonly stage = {};
  readonly ticker = {
    maxFPS: 0,
    start: vi.fn(),
    stop: vi.fn(),
  };
  readonly renderer = {
    type: 1,
    resolution: 1,
    resize: vi.fn(),
  };
  readonly destroy = vi.fn();

  constructor(readonly options: PresenceVisualApplicationOptions) {}
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
}

beforeEach(() => {
  pixiHarness.applications.length = 0;
  FakeResizeObserver.instances.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lazy Pixi runtime loader", () => {
  it("returns only the lazy Application constructor and WebGL validator without constructing it", async () => {
    const applicationModule = await loadPixiApplicationModule();

    expect(applicationModule).toHaveProperty("Application");
    expect(applicationModule.isWebglApplication({ renderer: { type: 1 } } as never)).toBe(true);
    expect(applicationModule.isWebglApplication({ renderer: { type: 2 } } as never)).toBe(false);
    expect(
      applicationModule.isWebglUnavailableError(
        new Error("Unable to auto-detect a suitable renderer."),
      ),
    ).toBe(true);
    expect(applicationModule.isWebglUnavailableError(new Error("context failed")))
      .toBe(false);
    expect(pixiHarness.applications).toHaveLength(0);
  });

  it("delegates Application construction and lifecycle to the single core runtime", async () => {
    const semantic = createSemanticSource();
    const owner = createPresenceVisualRuntimeOwner();
    const releaseHost = owner.retainHost(semantic.source);
    const surfaceRef = createRef<HTMLDivElement>();
    const surface = document.createElement("div");
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 420 },
    });
    surfaceRef.current = surface;
    const scene = { destroy: vi.fn() };
    const sceneLoader = vi.fn(async () => scene);

    const view = render(
      <PresenceVisualMount
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={surfaceRef}
      />,
    );

    await waitFor(() => expect(sceneLoader).toHaveBeenCalledTimes(1));
    expect(pixiHarness.applications).toHaveLength(1);
    expect(pixiHarness.applications[0].options).toMatchObject({
      autoStart: false,
      sharedTicker: false,
      resolution: 1.5,
    });
    expect(surface.querySelector("canvas")).toBe(pixiHarness.applications[0].view);
    expect(owner.getSnapshot().activeRuntimeCount).toBe(1);

    view.unmount();
    await Promise.resolve();
    expect(pixiHarness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
    releaseHost();
  });

  it("keeps the core activity gate closed on compact production even if mounted", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const semantic = createSemanticSource();
    const owner = createPresenceVisualRuntimeOwner();
    const releaseHost = owner.retainHost(semantic.source);
    const surfaceRef = createRef<HTMLDivElement>();
    const surface = document.createElement("div");
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 320 },
    });
    surfaceRef.current = surface;
    const sceneLoader = vi.fn(async () => ({ destroy: vi.fn() }));

    const view = render(
      <PresenceVisualMount
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={surfaceRef}
      />,
    );

    await waitFor(() => expect(owner.getSnapshot().activeRuntimeCount).toBe(1));
    expect(sceneLoader).not.toHaveBeenCalled();
    expect(pixiHarness.applications).toHaveLength(0);
    expect(owner.getSnapshot().phase).toBe("static");

    view.unmount();
    releaseHost();
  });

  it("recreates the owned runtime when the Jewel ownership adapter changes", async () => {
    const semantic = createSemanticSource();
    const owner = createPresenceVisualRuntimeOwner();
    const releaseHost = owner.retainHost(semantic.source);
    const surfaceRef = createSizedSurfaceRef(640, 420);
    const sceneLoader = vi.fn(async () => ({ destroy: vi.fn() }));
    const firstJewel = createJewelOwnership();
    const secondJewel = createJewelOwnership();

    const view = render(
      <PresenceVisualMount
        jewelOwnership={firstJewel}
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={surfaceRef}
      />,
    );
    await waitFor(() => expect(pixiHarness.applications).toHaveLength(1));

    view.rerender(
      <PresenceVisualMount
        jewelOwnership={secondJewel}
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={surfaceRef}
      />,
    );

    await waitFor(() => expect(pixiHarness.applications).toHaveLength(2));
    expect(pixiHarness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(pixiHarness.applications[1].destroy).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() =>
      expect(pixiHarness.applications[1].destroy).toHaveBeenCalledTimes(1),
    );
    releaseHost();
  });

  it("promotes a duplicate Host onto its own surface after the primary departs", async () => {
    const semantic = createSemanticSource();
    const owner = createPresenceVisualRuntimeOwner();
    const releaseHost = owner.retainHost(semantic.source);
    const firstSurfaceRef = createSizedSurfaceRef(640, 420);
    const secondSurfaceRef = createSizedSurfaceRef(560, 360);
    const sceneLoader = vi.fn(async () => ({ destroy: vi.fn() }));

    const firstView = render(
      <PresenceVisualMount
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={firstSurfaceRef}
      />,
    );
    const secondView = render(
      <PresenceVisualMount
        owner={owner}
        sceneLoader={sceneLoader}
        semanticSource={semantic.source}
        surfaceRef={secondSurfaceRef}
      />,
    );

    await waitFor(() => expect(pixiHarness.applications).toHaveLength(1));
    expect(firstSurfaceRef.current?.querySelector("canvas"))
      .toBe(pixiHarness.applications[0].view);
    expect(secondSurfaceRef.current?.querySelector("canvas")).toBeNull();

    firstView.unmount();
    await waitFor(() => expect(pixiHarness.applications).toHaveLength(2));
    expect(pixiHarness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(secondSurfaceRef.current?.querySelector("canvas"))
      .toBe(pixiHarness.applications[1].view);

    secondView.unmount();
    await waitFor(() =>
      expect(pixiHarness.applications[1].destroy).toHaveBeenCalledTimes(1),
    );
    releaseHost();
  });
});

function createSizedSurfaceRef(width: number, height: number) {
  const surfaceRef = createRef<HTMLDivElement>();
  const surface = document.createElement("div");
  Object.defineProperties(surface, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  surfaceRef.current = surface;
  return surfaceRef;
}

function createJewelOwnership(): PresenceVisualJewelOwnership {
  const snapshot = Object.freeze({ ownsLease: false });
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    releaseOwned: () => undefined,
  });
}

function createSemanticSource() {
  let snapshot: PresenceVisualSemanticSnapshot = Object.freeze({
    visibility: "visible",
    motion: "full",
    visualRuntime: "loading",
  });
  const listeners = new Set<() => void>();
  const events: PresenceVisualSemanticEvent[] = [];
  const source: PresenceVisualSemanticSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (event) => {
      events.push(event);
      snapshot = Object.freeze({
        ...snapshot,
        visualRuntime:
          event.type === "WEBGL_READY"
            ? "ready"
            : event.type === "WEBGL_LOST"
              ? "contextLost"
              : "loading",
      });
      for (const listener of [...listeners]) listener();
    },
  };
  return { source, events };
}
