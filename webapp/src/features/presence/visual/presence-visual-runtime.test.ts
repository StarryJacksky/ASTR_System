import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRuntimeMetrics,
  readRuntimeMetrics,
  type RuntimeMetricName,
} from "@/lib/runtime-metrics";
import type { MotionState, SemanticState, VisibilityState } from "@/lib/semantic-state";
import {
  PresenceVisualInitializationError,
  createBrowserPresenceVisualRuntime,
  createPresenceVisualRuntime,
  resolvePresenceVisualDpr,
  type PresenceVisualApplication,
  type PresenceVisualApplicationModule,
  type PresenceVisualApplicationOptions,
  type PresenceVisualEvent,
  type PresenceVisualEventListener,
  type PresenceVisualEventTarget,
  type PresenceVisualJewelOwnership,
  type PresenceVisualReleaseReason,
  type PresenceVisualResizeObserver,
  type PresenceVisualResource,
  type PresenceVisualSceneInitializer,
  type PresenceVisualSemanticEvent,
  type PresenceVisualSemanticSource,
  type PresenceVisualSurface,
  type PresenceVisualWindow,
} from "./presence-visual-runtime";

const harnessRuntimes = new Set<{ destroy: () => void }>();

afterEach(() => {
  for (const runtime of harnessRuntimes) runtime.destroy();
  harnessRuntimes.clear();
  clearRuntimeMetrics();
});

describe("resolvePresenceVisualDpr", () => {
  it.each([
    [1, false, 1],
    [2, false, 1.5],
    [3, false, 1.5],
    [1, true, 1],
    [2, true, 1.25],
    [3, true, 1.25],
    [Number.NaN, false, 1],
    [0, true, 1],
  ])("caps device DPR %s for compact=%s at %s", (deviceDpr, compact, expected) => {
    expect(resolvePresenceVisualDpr(deviceDpr, compact)).toBe(expected);
  });
});

describe("createPresenceVisualRuntime", () => {
  it("owns the browser surface, inert Canvas, ResizeObserver, and window cleanup in core", async () => {
    const target = document.createElement("div");
    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 360 },
    });
    const observe = vi.fn();
    const disconnect = vi.fn();
    class BrowserResizeObserver {
      constructor(readonly callback: ResizeObserverCallback) {}
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", BrowserResizeObserver);
    const semantic = new FakeSemanticSource();
    const jewel = new FakeJewelOwnership();
    const canvas = document.createElement("canvas");
    const destroyApplication = vi.fn();
    const applicationModule: PresenceVisualApplicationModule = {
      Application: function BrowserApplication() {
        return {
          view: canvas,
          stage: {},
          ticker: { maxFPS: 0, start: vi.fn(), stop: vi.fn() },
          renderer: { resolution: 1, resize: vi.fn() },
          destroy: destroyApplication,
        };
      } as unknown as PresenceVisualApplicationModule["Application"],
      isWebglApplication: () => true,
      isWebglUnavailableError: () => false,
    };
    const runtime = createBrowserPresenceVisualRuntime({
      target,
      semantic,
      jewel,
      compact: false,
      loadApplicationModule: async () => applicationModule,
      initializeScene: async () => createResource(),
    });

    await runtime.mount();

    expect(observe).toHaveBeenCalledWith(target);
    expect(target.firstElementChild).toBe(canvas);
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveAttribute("tabindex", "-1");
    expect(canvas.style.pointerEvents).toBe("none");

    runtime.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(target).toBeEmptyDOMElement();
    expect(destroyApplication).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("waits for a positive surface and creates exactly one complete desktop scene", async () => {
    const harness = createHarness({ width: 0, height: 0, deviceDpr: 3 });

    await harness.runtime.mount();
    harness.resize.emit();
    harness.resize.emit();

    expect(harness.loadModule).not.toHaveBeenCalled();
    expect(harness.applications).toHaveLength(0);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      phase: "waitingForSize",
      width: 0,
      height: 0,
      resolution: 1.5,
      fps: 30,
    });

    harness.surface.setSize(640, 360);
    harness.resize.emit();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));
    await vi.waitFor(() => expect(harness.runtime.getSnapshot().phase).toBe("ready"));
    await harness.runtime.mount();

    const application = harness.applications[0];
    expect(harness.loadModule).toHaveBeenCalledTimes(1);
    expect(harness.factory.create).toHaveBeenCalledTimes(1);
    expect(harness.initializeScene).toHaveBeenCalledTimes(1);
    expect(harness.factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 640,
        height: 360,
        resolution: 1.5,
        autoStart: false,
        sharedTicker: false,
        backgroundAlpha: 0,
        antialias: true,
      }),
    );
    expect(application.renderer.resize).toHaveBeenCalledTimes(1);
    expect(application.renderer.resize).toHaveBeenCalledWith(640, 360);
    expect(application.ticker.maxFPS).toBe(30);
    expect(application.ticker.start).toHaveBeenCalledTimes(1);
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toHaveLength(1);
    expect(harness.surface.attached).toEqual([application.view]);

    const metrics = readRuntimeMetrics();
    expect(metrics).toContainEqual(expect.objectContaining({ name: "webgl-context", value: 1 }));
    expect(metrics).toContainEqual(
      expect.objectContaining({ name: "canvas-backing-width", value: 960 }),
    );
    expect(metrics).toContainEqual(
      expect.objectContaining({ name: "canvas-backing-height", value: 540 }),
    );
  });

  it("does not advertise ready after Application construction until the required scene resolves", async () => {
    const scene = deferred<PresenceVisualResource>();
    const harness = createHarness({
      initializeScene: vi.fn(() => scene.promise),
    });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));

    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toEqual([]);
    expect(harness.applications[0].ticker.start).not.toHaveBeenCalled();
    expect(harness.runtime.getSnapshot().phase).toBe("loading");

    scene.resolve(createResource());
    await mounting;

    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toHaveLength(1);
    expect(harness.runtime.getSnapshot().phase).toBe("ready");
  });

  it("resets stale semantic readiness before loading a new generation", async () => {
    const scene = deferred<PresenceVisualResource>();
    const harness = createHarness({
      initialVisualRuntime: "ready",
      initializeScene: vi.fn(() => scene.promise),
    });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));

    expect(harness.semantic.events).toEqual([{ type: "VISUAL_RETRY" }]);
    expect(harness.semantic.getSnapshot().visualRuntime).toBe("loading");
    expect(harness.jewel.releases).toEqual(["retry"]);

    scene.resolve(createResource());
    await mounting;

    expect(harness.semantic.events).toEqual([
      { type: "VISUAL_RETRY" },
      { type: "WEBGL_READY" },
    ]);
  });

  it("revokes readiness that arrives while the complete scene is still loading", async () => {
    const scene = deferred<PresenceVisualResource>();
    const harness = createHarness({ initializeScene: vi.fn(() => scene.promise) });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));
    harness.semantic.set({ visualRuntime: "ready" });

    expect(harness.semantic.getSnapshot().visualRuntime).toBe("loading");
    expect(harness.semantic.events).toEqual([{ type: "VISUAL_RETRY" }]);
    expect(harness.jewel.releases).toEqual(["retry"]);

    scene.resolve(createResource());
    await mounting;
    expect(harness.semantic.events.at(-1)).toEqual({ type: "WEBGL_READY" });
  });

  it.each([
    { compact: false, deviceDpr: 2, resolution: 1.5, fps: 30 },
    { compact: true, deviceDpr: 2, resolution: 1.25, fps: 24 },
  ])("uses the one app ticker at $fps fps for compact=$compact", async (profile) => {
    const harness = createHarness(profile);

    await harness.runtime.mount();

    const application = harness.applications[0];
    expect(application.ticker.maxFPS).toBe(profile.fps);
    expect(harness.factory.create).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: profile.resolution, autoStart: false }),
    );
    expect(application.ticker.start).toHaveBeenCalledTimes(1);
    expect(application.ticker.stop).toHaveBeenCalledTimes(1);
  });

  it("records only finite scene-provided draw and texture estimates", async () => {
    const scene = {
      destroy: vi.fn(),
      readMetrics: () => ({
        drawCalls: 7,
        gpuMemoryMiB: 12.5,
        decodedTextureMiB: 8,
        ignoredInvalidEstimate: Number.NaN,
      }),
    };
    const harness = createHarness({ initializeScene: vi.fn(() => scene) });

    await harness.runtime.mount();

    expect(readRuntimeMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "draw-calls", value: 7 }),
        expect.objectContaining({ name: "gpu-memory-mib", value: 12.5 }),
        expect.objectContaining({ name: "decoded-texture-mib", value: 8 }),
      ]),
    );
    expect(readRuntimeMetrics().some((sample) => !Number.isFinite(sample.value))).toBe(false);
  });

  it("keeps a complete scene ready when optional metric inspection is unsupported", async () => {
    const harness = createHarness({
      initializeScene: vi.fn(() => ({
        destroy: vi.fn(),
        readMetrics: () => {
          throw new Error("renderer statistics unavailable");
        },
      })),
    });

    await harness.runtime.mount();

    expect(harness.runtime.getSnapshot().phase).toBe("ready");
    expect(harness.semantic.events.at(-1)).toEqual({ type: "WEBGL_READY" });
  });

  it("does not fabricate zero backing dimensions when a renderer reports invalid data", async () => {
    const harness = createHarness({
      backingSize: { width: Number.NaN, height: -1 },
    });

    await harness.runtime.mount();

    expect(
      readRuntimeMetrics().filter(
        (metric) =>
          metric.name === "canvas-backing-width" || metric.name === "canvas-backing-height",
      ),
    ).toEqual([]);
  });

  it("stops immediately and releases Jewel ownership for every semantic animation gate", async () => {
    const harness = createHarness();
    await harness.runtime.mount();
    const application = harness.applications[0];

    const gates: Array<{
      semantic: Partial<Pick<SemanticState, "visibility" | "motion" | "visualRuntime">>;
      restore: Partial<Pick<SemanticState, "visibility" | "motion" | "visualRuntime">>;
    }> = [
      { semantic: { visibility: "hidden" }, restore: { visibility: "visible" } },
      { semantic: { visibility: "offscreen" }, restore: { visibility: "visible" } },
      { semantic: { motion: "reduced" }, restore: { motion: "full" } },
      { semantic: { motion: "paused" }, restore: { motion: "full" } },
      { semantic: { visualRuntime: "loading" }, restore: { visualRuntime: "ready" } },
    ];

    for (const gate of gates) {
      const stopsBefore = application.ticker.stop.mock.calls.length;
      const releasesBefore = harness.jewel.releases.length;
      harness.semantic.set(gate.semantic);

      expect(application.ticker.stop).toHaveBeenCalledTimes(stopsBefore + 1);
      expect(harness.jewel.releases).toHaveLength(releasesBefore + 1);
      expect(readRuntimeMetrics().at(-1)).toEqual(
        expect.objectContaining({ name: "app-raf", value: 0 }),
      );

      harness.semantic.set(gate.restore);
      expect(application.ticker.start).toHaveBeenCalledTimes(releasesBefore + 1);
      harness.jewel.setOwned(true);
      expect(application.ticker.start).toHaveBeenCalledTimes(releasesBefore + 2);
    }
  });

  it("never resizes or starts at zero size and recalculates DPR from the injected window", async () => {
    const harness = createHarness({ width: 480, height: 320, deviceDpr: 1 });
    await harness.runtime.mount();
    const application = harness.applications[0];

    harness.surface.setSize(0, 0);
    harness.resize.emit();

    expect(application.renderer.resize).toHaveBeenCalledTimes(1);
    expect(application.ticker.stop).toHaveBeenCalledTimes(2);
    expect(harness.jewel.releases.at(-1)).toBe("zero-size");

    harness.window.devicePixelRatio = 3;
    harness.surface.setSize(400, 240);
    harness.window.emit("resize");

    expect(application.renderer.resolution).toBe(1.5);
    expect(application.renderer.resize).toHaveBeenLastCalledWith(400, 240);
    expect(application.renderer.resize).toHaveBeenCalledTimes(2);
  });

  it("keeps the same visual mount but stops activity across a desktop to compact transition", async () => {
    const harness = createHarness({
      width: 900,
      deviceDpr: 2,
      compact: (size) => size.width < 768,
      activityAllowed: (profile) => !profile.compact,
    });
    await harness.runtime.mount();
    const application = harness.applications[0];

    harness.surface.setSize(700, 420);
    harness.resize.emit();

    expect(harness.applications).toHaveLength(1);
    expect(application.destroy).not.toHaveBeenCalled();
    expect(application.ticker.maxFPS).toBe(24);
    expect(application.renderer.resolution).toBe(1.25);
    expect(application.ticker.stop).toHaveBeenCalledTimes(2);
    expect(harness.jewel.releases.at(-1)).toBe("environment");
    expect(harness.runtime.getSnapshot()).toMatchObject({
      phase: "static",
      compact: true,
    });

    harness.surface.setSize(900, 480);
    harness.resize.emit();
    harness.jewel.setOwned(true);

    expect(harness.applications).toHaveLength(1);
    expect(application.ticker.maxFPS).toBe(30);
    expect(application.renderer.resolution).toBe(1.5);
    expect(application.ticker.start).toHaveBeenCalledTimes(2);
    expect(harness.runtime.getSnapshot()).toMatchObject({ phase: "ready", compact: false });
  });

  it.each(["module", "application", "model", "pass"] as const)(
    "cleans the single lifecycle path after a %s initialization failure",
    async (failureStage) => {
      const partial = createResource();
      const harness = createHarness({ failureStage, partial });

      await harness.runtime.mount();

      expect(harness.runtime.getSnapshot()).toMatchObject({
        phase: "static",
        failureStage,
        retryRequired: true,
      });
      expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toEqual([]);
      expect(harness.jewel.releases.at(-1)).toBe("initialization-failed");
      expect(harness.surface.attached).toEqual([]);
      if (failureStage === "model" || failureStage === "pass") {
        expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
      }
      if (failureStage === "pass") {
        expect(partial.destroy).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("rejects and destroys a non-WebGL Application fallback before attach or context metrics", async () => {
    const harness = createHarness({ webgl: false });

    await harness.runtime.mount();

    expect(harness.applications).toHaveLength(1);
    expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(harness.surface.attached).toEqual([]);
    expect(harness.initializeScene).not.toHaveBeenCalled();
    expect(harness.runtime.getSnapshot()).toMatchObject({
      phase: "static",
      failureStage: "application",
      retryRequired: false,
      webglAvailability: "unavailable",
    });
    expect(
      readRuntimeMetrics().filter((metric) => metric.name === "webgl-context"),
    ).toEqual([]);
  });

  it("classifies Pixi's constructor-level no-renderer failure as terminal WebGL unavailability", async () => {
    const harness = createHarness({
      applicationError: new Error("Unable to auto-detect a suitable renderer."),
    });

    await harness.runtime.mount();

    expect(harness.factory.create).toHaveBeenCalledTimes(1);
    expect(harness.applications).toEqual([]);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      phase: "static",
      failureStage: "application",
      retryRequired: false,
      webglAvailability: "unavailable",
    });
    await expect(harness.runtime.retry()).resolves.toBe(false);
    expect(harness.factory.create).toHaveBeenCalledTimes(1);
  });

  it("preserves a registered resource receiver while cleaning a failed scene", async () => {
    const contextualResource = {
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    const harness = createHarness({ failureStage: "pass", partial: contextualResource });

    await harness.runtime.mount();

    expect(contextualResource.destroyed).toBe(true);
    expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a scene exactly once when the initializer also registered that scene", async () => {
    const scene = createResource();
    const harness = createHarness({
      initializeScene: vi.fn((context) => {
        context.registerResource(scene);
        return scene;
      }),
    });
    await harness.runtime.mount();

    harness.runtime.destroy();

    expect(scene.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps lifecycle cleanup authoritative when an injected metric sink fails", async () => {
    const harness = createHarness({
      recordMetric: () => {
        throw new Error("metric sink unavailable");
      },
    });

    await harness.runtime.mount();

    expect(harness.runtime.getSnapshot().phase).toBe("ready");
    harness.runtime.destroy();
    expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight scene and destroys resources that resolve after final teardown", async () => {
    const scene = deferred<PresenceVisualResource>();
    let sceneSignal: AbortSignal | null = null;
    const initializeScene = vi.fn<PresenceVisualSceneInitializer>((context) => {
      sceneSignal = context.signal;
      return scene.promise;
    });
    const harness = createHarness({ initializeScene });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));
    harness.runtime.destroy();

    expect((sceneSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(harness.runtime.getSnapshot().phase).toBe("destroyed");

    const lateScene = createResource();
    scene.resolve(lateScene);
    await mounting;

    expect(lateScene.destroy).toHaveBeenCalledTimes(1);
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toEqual([]);
  });

  it("does not construct an Application when its lazy module resolves after teardown", async () => {
    const harness = createHarness({ deferModule: true });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.loadModule).toHaveBeenCalledTimes(1));
    harness.runtime.destroy();

    harness.applicationModuleGate.resolve(harness.applicationModule);
    await mounting;

    expect(harness.factory.create).not.toHaveBeenCalled();
    expect(harness.applications).toEqual([]);
    expect(readRuntimeMetrics().filter((metric) => metric.name === "webgl-context")).toEqual([]);
  });

  it("reports the module-global live context count across accidentally concurrent runtimes", async () => {
    const first = createHarness();
    const second = createHarness();

    await Promise.all([first.runtime.mount(), second.runtime.mount()]);

    expect(
      readRuntimeMetrics().filter((metric) => metric.name === "webgl-context").at(-1),
    ).toEqual(expect.objectContaining({ value: 2 }));

    first.runtime.destroy();
    expect(
      readRuntimeMetrics().filter((metric) => metric.name === "webgl-context").at(-1),
    ).toEqual(expect.objectContaining({ value: 1 }));

    second.runtime.destroy();
    expect(
      readRuntimeMetrics().filter((metric) => metric.name === "webgl-context").at(-1),
    ).toEqual(expect.objectContaining({ value: 0 }));
  });

  it("keeps stale async generations from destroying or readying the explicit retry generation", async () => {
    const firstScene = deferred<PresenceVisualResource>();
    const secondScene = deferred<PresenceVisualResource>();
    const initializeScene = vi
      .fn<PresenceVisualSceneInitializer>()
      .mockImplementationOnce(() => firstScene.promise)
      .mockImplementationOnce(() => secondScene.promise);
    const harness = createHarness({ initializeScene });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));
    const retrying = harness.runtime.retry();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(2));

    expect(harness.applications[0].destroy).toHaveBeenCalledTimes(1);
    expect(harness.applications[1].destroy).not.toHaveBeenCalled();

    const staleResource = createResource();
    firstScene.resolve(staleResource);
    await mounting;
    expect(staleResource.destroy).toHaveBeenCalledTimes(1);
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toEqual([]);

    secondScene.resolve(createResource());
    await retrying;

    expect(harness.runtime.getSnapshot().phase).toBe("ready");
    expect(harness.applications[1].destroy).not.toHaveBeenCalled();
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toHaveLength(1);
  });

  it("never reports ready when context is lost during asynchronous scene initialization", async () => {
    const scene = deferred<PresenceVisualResource>();
    const harness = createHarness({ initializeScene: () => scene.promise });

    const mounting = harness.runtime.mount();
    await vi.waitFor(() => expect(harness.applications).toHaveLength(1));
    const application = harness.applications[0];

    application.view.emit("webglcontextlost", createPreventableEvent().event);
    scene.resolve(createResource());
    await mounting;

    expect(harness.runtime.getSnapshot()).toMatchObject({
      phase: "static",
      retryRequired: false,
    });
    expect(harness.semantic.getSnapshot().visualRuntime).toBe("contextLost");
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toEqual([]);
  });

  it("prevents context loss, makes one automatic restore attempt, then requires explicit retry", async () => {
    const initializeScene = vi
      .fn<PresenceVisualSceneInitializer>()
      .mockImplementationOnce(() => createResource())
      .mockImplementationOnce(() => {
        throw new PresenceVisualInitializationError("pass", "restore pass failed");
      })
      .mockImplementationOnce(() => createResource());
    const harness = createHarness({ initializeScene });
    await harness.runtime.mount();
    const firstApplication = harness.applications[0];
    const lost = createPreventableEvent();

    firstApplication.view.emit("webglcontextlost", lost.event);
    firstApplication.view.emit("webglcontextlost", lost.event);

    expect(lost.preventDefault).toHaveBeenCalledTimes(2);
    expect(firstApplication.ticker.stop).toHaveBeenCalledTimes(2);
    expect(harness.jewel.releases.at(-1)).toBe("context-lost");
    expect(harness.semantic.events.at(-1)).toEqual({ type: "WEBGL_LOST" });
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_LOST")).toHaveLength(1);
    expect(harness.runtime.getSnapshot().phase).toBe("static");

    firstApplication.view.emit("webglcontextrestored", {});
    await vi.waitFor(() => expect(harness.applications).toHaveLength(2));
    await vi.waitFor(() => expect(harness.runtime.getSnapshot().retryRequired).toBe(true));

    expect(harness.applications[1].destroy).toHaveBeenCalledTimes(1);
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toHaveLength(1);
    expect(harness.semantic.events.filter((event) => event.type === "VISUAL_RETRY")).toHaveLength(1);

    await harness.runtime.retry();

    expect(harness.applications).toHaveLength(3);
    expect(harness.runtime.getSnapshot()).toMatchObject({ phase: "ready", retryRequired: false });
    expect(harness.semantic.events.filter((event) => event.type === "VISUAL_RETRY")).toHaveLength(2);
    expect(harness.semantic.events.filter((event) => event.type === "WEBGL_READY")).toHaveLength(2);
  });

  it("destroys observers, window/context listeners, subscriptions, ticker and app exactly once", async () => {
    const harness = createHarness();
    await harness.runtime.mount();
    const application = harness.applications[0];

    harness.runtime.destroy();
    harness.runtime.destroy();

    expect(harness.resize.observer.observe).toHaveBeenCalledTimes(1);
    expect(harness.resize.observer.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.window.listenerCount()).toBe(0);
    expect(application.view.listenerCount()).toBe(0);
    expect(harness.semantic.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.jewel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(application.ticker.stop).toHaveBeenCalledTimes(2);
    expect(application.destroy).toHaveBeenCalledTimes(1);
    expect(harness.surface.detached).toEqual([application.view]);
    expect(harness.runtime.getSnapshot().phase).toBe("destroyed");
    expect(harness.semantic.events.at(-1)).toEqual({ type: "VISUAL_RETRY" });
    expect(readRuntimeMetrics()).toContainEqual(
      expect.objectContaining({ name: "webgl-context", value: 0 }),
    );
  });

  it.each(["ticker", "jewel"] as const)(
    "continues the idempotent destroy path when %s cleanup throws",
    async (fault) => {
      const harness = createHarness();
      await harness.runtime.mount();
      const application = harness.applications[0];

      if (fault === "ticker") {
        application.ticker.stop.mockImplementationOnce(() => {
          throw new Error("ticker stop failed");
        });
      } else {
        vi.spyOn(harness.jewel, "releaseOwned").mockImplementation(() => {
          throw new Error("Jewel release failed");
        });
      }

      expect(() => harness.runtime.destroy()).not.toThrow();
      expect(application.destroy).toHaveBeenCalledTimes(1);
      expect(harness.resize.observer.disconnect).toHaveBeenCalledTimes(1);
      expect(harness.window.listenerCount()).toBe(0);
      expect(application.view.listenerCount()).toBe(0);
      expect(harness.runtime.getSnapshot().phase).toBe("destroyed");
    },
  );

  it("leaves zero live applications, scenes, observers and listeners after twenty cycles", async () => {
    const live = { applications: 0, scenes: 0, observers: 0, listeners: 0 };

    for (let cycle = 0; cycle < 20; cycle += 1) {
      const harness = createHarness({
        live,
        initializeScene: () => {
          live.scenes += 1;
          let active = true;
          return {
            destroy: () => {
              if (!active) return;
              active = false;
              live.scenes -= 1;
            },
          };
        },
      });
      await harness.runtime.mount();
      harness.runtime.destroy();
    }

    expect(live).toEqual({ applications: 0, scenes: 0, observers: 0, listeners: 0 });
  });
});

type FailureStage = "module" | "application" | "model" | "pass";

interface HarnessOptions {
  readonly width?: number;
  readonly height?: number;
  readonly deviceDpr?: number;
  readonly compact?: boolean | ((size: { width: number; height: number }) => boolean);
  readonly activityAllowed?: (
    profile: { compact: boolean; width: number; height: number; resolution: number; fps: 24 | 30 },
    semantic: Pick<SemanticState, "visibility" | "motion" | "visualRuntime">,
  ) => boolean;
  readonly fps?: number;
  readonly resolution?: number;
  readonly initializeScene?: PresenceVisualSceneInitializer;
  readonly failureStage?: FailureStage;
  readonly partial?: PresenceVisualResource;
  readonly deferModule?: boolean;
  readonly initialVisualRuntime?: SemanticState["visualRuntime"];
  readonly backingSize?: { width: number; height: number };
  readonly webgl?: boolean;
  readonly applicationError?: Error;
  readonly recordMetric?: (name: RuntimeMetricName, value: number, at: number) => void;
  readonly live?: { applications: number; observers: number; listeners: number };
}

function createHarness(options: HarnessOptions = {}) {
  const live = options.live ?? { applications: 0, observers: 0, listeners: 0 };
  const semantic = new FakeSemanticSource(options.initialVisualRuntime);
  const jewel = new FakeJewelOwnership();
  const surface = new FakeSurface(options.width ?? 720, options.height ?? 480);
  const window = new FakeWindow(options.deviceDpr ?? 1, live);
  const resize = new FakeResizeHarness(live);
  const applications: FakeApplication[] = [];
  const applicationModuleGate = deferred<PresenceVisualApplicationModule>();
  const factory = {
    create: vi.fn((applicationOptions: PresenceVisualApplicationOptions) => {
      void applicationOptions;
      if (options.applicationError !== undefined) throw options.applicationError;
      if (options.failureStage === "application") throw new Error("application failed");
      const application = new FakeApplication(live);
      if (options.backingSize !== undefined) {
        application.renderer.getBackingSize = () => options.backingSize!;
      }
      applications.push(application);
      return application;
    }),
  };
  const applicationModule: PresenceVisualApplicationModule = {
    Application: function FakeApplicationConstructor(options: PresenceVisualApplicationOptions) {
      return factory.create(options);
    } as unknown as PresenceVisualApplicationModule["Application"],
    isWebglApplication: () => options.webgl !== false,
    isWebglUnavailableError: (error) =>
      error instanceof Error &&
      error.message === "Unable to auto-detect a suitable renderer.",
  };
  const loadModule = vi.fn(async () => {
    if (options.failureStage === "module") throw new Error("module failed");
    return options.deferModule ? applicationModuleGate.promise : applicationModule;
  });
  const defaultInitializer = vi.fn<PresenceVisualSceneInitializer>((context) => {
    if (options.failureStage === "model") {
      throw new PresenceVisualInitializationError("model", "model failed");
    }
    if (options.failureStage === "pass") {
      context.registerResource(options.partial ?? createResource());
      throw new PresenceVisualInitializationError("pass", "pass failed");
    }
    return createResource();
  });
  const initializeScene = vi.fn(options.initializeScene ?? defaultInitializer);
  let now = 0;
  const runtime = createPresenceVisualRuntime({
    surface,
    window,
    createResizeObserver: resize.create,
    semantic,
    jewel,
    compact: options.compact ?? false,
    loadApplicationModule: loadModule,
    initializeScene,
    activityAllowed: options.activityAllowed,
    recordMetric: options.recordMetric,
    clock: { now: () => (now += 1) },
  });
  harnessRuntimes.add(runtime);

  return {
    runtime,
    semantic,
    jewel,
    surface,
    window,
    resize,
    applications,
    factory,
    loadModule,
    initializeScene,
    applicationModule,
    applicationModuleGate,
  };
}

class FakeSemanticSource implements PresenceVisualSemanticSource {
  private state: Pick<SemanticState, "visibility" | "motion" | "visualRuntime">;
  private readonly listeners = new Set<() => void>();
  readonly events: PresenceVisualSemanticEvent[] = [];
  readonly unsubscribe = vi.fn();

  constructor(visualRuntime: SemanticState["visualRuntime"] = "loading") {
    this.state = {
      visibility: "visible",
      motion: "full",
      visualRuntime,
    };
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      this.unsubscribe();
    };
  };

  dispatch = (event: PresenceVisualSemanticEvent) => {
    this.events.push(event);
    if (event.type === "WEBGL_READY") this.state = { ...this.state, visualRuntime: "ready" };
    if (event.type === "WEBGL_LOST") this.state = { ...this.state, visualRuntime: "contextLost" };
    if (event.type === "VISUAL_RETRY") this.state = { ...this.state, visualRuntime: "loading" };
    this.emit();
  };

  set(
    patch: Partial<{
      visibility: VisibilityState;
      motion: MotionState;
      visualRuntime: SemanticState["visualRuntime"];
    }>,
  ) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeJewelOwnership implements PresenceVisualJewelOwnership {
  private owned = true;
  private leaseToken = {};
  private readonly listeners = new Set<() => void>();
  readonly releases: PresenceVisualReleaseReason[] = [];
  readonly unsubscribe = vi.fn();

  getSnapshot: PresenceVisualJewelOwnership["getSnapshot"] = () =>
    this.owned
      ? Object.freeze({ ownsLease: true, leaseToken: this.leaseToken })
      : Object.freeze({ ownsLease: false, leaseToken: null });

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      this.unsubscribe();
    };
  };

  releaseOwned = (reason: PresenceVisualReleaseReason) => {
    if (!this.owned) return;
    this.releases.push(reason);
    this.setOwned(false);
  };

  setOwned(owned: boolean) {
    if (this.owned === owned) return;
    if (owned) this.leaseToken = {};
    this.owned = owned;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeSurface implements PresenceVisualSurface {
  readonly attached: PresenceVisualEventTarget[] = [];
  readonly detached: PresenceVisualEventTarget[] = [];

  constructor(
    private width: number,
    private height: number,
  ) {}

  getSize = () => ({ width: this.width, height: this.height });

  attach = (view: PresenceVisualEventTarget) => {
    this.attached.push(view);
  };

  detach = (view: PresenceVisualEventTarget) => {
    const index = this.attached.indexOf(view);
    if (index >= 0) this.attached.splice(index, 1);
    this.detached.push(view);
  };

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

class FakeResizeHarness {
  private callback: (() => void) | null = null;
  readonly observer: PresenceVisualResizeObserver & {
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  constructor(private readonly live: { observers: number }) {
    this.observer = {
      observe: vi.fn(() => {
        this.live.observers += 1;
      }),
      disconnect: vi.fn(() => {
        this.live.observers -= 1;
      }),
    };
  }

  create = (callback: () => void) => {
    this.callback = callback;
    return this.observer;
  };

  emit() {
    this.callback?.();
  }
}

class FakeEventTarget implements PresenceVisualEventTarget {
  private readonly listeners = new Map<string, Set<PresenceVisualEventListener>>();

  constructor(private readonly live: { listeners: number }) {}

  addEventListener = (type: string, listener: PresenceVisualEventListener) => {
    const bucket = this.listeners.get(type) ?? new Set<PresenceVisualEventListener>();
    if (!bucket.has(listener)) {
      bucket.add(listener);
      this.live.listeners += 1;
    }
    this.listeners.set(type, bucket);
  };

  removeEventListener = (type: string, listener: PresenceVisualEventListener) => {
    const bucket = this.listeners.get(type);
    if (bucket?.delete(listener)) this.live.listeners -= 1;
    if (bucket?.size === 0) this.listeners.delete(type);
  };

  emit(type: string, event: PresenceVisualEvent = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((sum, bucket) => sum + bucket.size, 0);
  }
}

class FakeWindow extends FakeEventTarget implements PresenceVisualWindow {
  constructor(
    public devicePixelRatio: number,
    live: { listeners: number },
  ) {
    super(live);
  }
}

class FakeApplication implements PresenceVisualApplication {
  readonly view: FakeEventTarget;
  readonly stage = Object.freeze({ kind: "fake-stage" });
  readonly ticker = {
    maxFPS: 0,
    start: vi.fn(),
    stop: vi.fn(),
  };
  readonly renderer = {
    resolution: 1,
    resize: vi.fn(),
    getBackingSize: undefined as (() => { width: number; height: number }) | undefined,
  };
  readonly destroy = vi.fn(() => {
    this.live.applications -= 1;
  });

  constructor(private readonly live: { applications: number; listeners: number }) {
    this.live.applications += 1;
    this.view = new FakeEventTarget(live);
  }
}

function createResource() {
  return { destroy: vi.fn() };
}

function createPreventableEvent() {
  const preventDefault = vi.fn();
  return { event: { preventDefault }, preventDefault };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
