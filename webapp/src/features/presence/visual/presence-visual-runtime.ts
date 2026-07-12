import {
  recordRuntimeMetric,
  type RuntimeMetricName,
} from "@/lib/runtime-metrics";
import type { SemanticEvent, SemanticState } from "@/lib/semantic-state";

const DESKTOP_DPR_CAP = 1.5;
const COMPACT_DPR_CAP = 1.25;
const DESKTOP_FPS = 30;
const COMPACT_FPS = 24;

let liveWebglContextCount = 0;
let liveAppTickerCount = 0;

export type PresenceVisualSemanticSnapshot = Pick<
  SemanticState,
  "visibility" | "motion" | "visualRuntime"
>;

export type PresenceVisualSemanticEvent = Extract<
  SemanticEvent,
  { type: "WEBGL_READY" | "WEBGL_LOST" | "VISUAL_RETRY" }
>;

export type PresenceVisualFailureStage = "module" | "application" | "model" | "pass";
export type PresenceVisualWebglAvailability =
  | "unknown"
  | "available"
  | "unavailable";
export type PresenceVisualRuntimePhase =
  | "idle"
  | "waitingForSize"
  | "loading"
  | "ready"
  | "static"
  | "destroyed";

export type PresenceVisualReleaseReason =
  | "environment"
  | "zero-size"
  | "context-lost"
  | "initialization-failed"
  | "retry"
  | "destroy";

export interface PresenceVisualRuntimeSnapshot {
  readonly phase: PresenceVisualRuntimePhase;
  readonly failureStage: PresenceVisualFailureStage | null;
  readonly retryRequired: boolean;
  readonly webglAvailability: PresenceVisualWebglAvailability;
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly fps: 24 | 30;
  readonly compact: boolean;
  readonly generation: number;
}

export interface PresenceVisualSemanticSource {
  readonly getSnapshot: () => PresenceVisualSemanticSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (event: PresenceVisualSemanticEvent) => void;
}

export interface PresenceVisualJewelSnapshot {
  readonly ownsLease: boolean;
}

export interface PresenceVisualJewelOwnership {
  readonly getSnapshot: () => PresenceVisualJewelSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly releaseOwned: (reason: PresenceVisualReleaseReason) => void;
}

export interface PresenceVisualEvent {
  readonly preventDefault?: () => void;
}

export type PresenceVisualEventListener = (event: PresenceVisualEvent) => void;

export interface PresenceVisualEventTarget {
  readonly addEventListener: (type: string, listener: PresenceVisualEventListener) => void;
  readonly removeEventListener: (type: string, listener: PresenceVisualEventListener) => void;
}

export interface PresenceVisualWindow extends PresenceVisualEventTarget {
  devicePixelRatio: number;
}

export interface PresenceVisualSize {
  readonly width: number;
  readonly height: number;
}

export interface PresenceVisualSurface {
  readonly getSize: () => PresenceVisualSize;
  readonly attach: (view: PresenceVisualEventTarget) => void;
  readonly detach: (view: PresenceVisualEventTarget) => void;
}

export interface PresenceVisualResizeObserver {
  readonly observe: (target: PresenceVisualSurface) => void;
  readonly disconnect: () => void;
}

export interface PresenceVisualTicker {
  maxFPS: number;
  readonly start: () => void;
  readonly stop: () => void;
}

export interface PresenceVisualRenderer {
  resolution: number;
  readonly resize: (width: number, height: number) => void;
  readonly getBackingSize?: () => PresenceVisualSize;
}

export interface PresenceVisualApplication {
  readonly view: PresenceVisualEventTarget;
  readonly stage: unknown;
  readonly ticker: PresenceVisualTicker;
  readonly renderer: PresenceVisualRenderer;
  readonly destroy: () => void;
}

export interface PresenceVisualApplicationOptions {
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly autoStart: false;
  readonly sharedTicker: false;
  readonly backgroundAlpha: 0;
  readonly antialias: true;
}

export interface PresenceVisualApplicationConstructor {
  new (options: PresenceVisualApplicationOptions): PresenceVisualApplication;
}

export interface PresenceVisualApplicationModule {
  readonly Application: PresenceVisualApplicationConstructor;
  /** Validates the renderer chosen by Pixi without a Host-side getContext probe. */
  readonly isWebglApplication: (application: PresenceVisualApplication) => boolean;
  /** Classifies the pinned Pixi constructor path when no renderer can be selected. */
  readonly isWebglUnavailableError: (error: unknown) => boolean;
}

export interface PresenceVisualResource {
  readonly destroy: () => void;
  readonly readMetrics?: () => PresenceVisualSceneMetrics;
}

export interface PresenceVisualSceneMetrics {
  readonly drawCalls?: number;
  readonly gpuMemoryMiB?: number;
  readonly decodedTextureMiB?: number;
}

export interface PresenceVisualSceneContext {
  readonly application: PresenceVisualApplication;
  readonly signal: AbortSignal;
  readonly jewel: PresenceVisualJewelOwnership;
  readonly registerResource: (resource: PresenceVisualResource) => void;
}

export type PresenceVisualSceneInitializer = (
  context: PresenceVisualSceneContext,
) => PresenceVisualResource | Promise<PresenceVisualResource>;

export interface PresenceVisualClock {
  readonly now: () => number;
}

export interface PresenceVisualActivityProfile extends PresenceVisualSize {
  readonly resolution: number;
  readonly fps: 24 | 30;
  readonly compact: boolean;
}

export interface PresenceVisualRuntimeOptions {
  readonly surface: PresenceVisualSurface;
  readonly window: PresenceVisualWindow;
  readonly createResizeObserver: (callback: () => void) => PresenceVisualResizeObserver;
  readonly semantic: PresenceVisualSemanticSource;
  readonly jewel: PresenceVisualJewelOwnership;
  readonly compact: boolean | ((size: PresenceVisualSize) => boolean);
  readonly loadApplicationModule: (
    signal: AbortSignal,
  ) => PresenceVisualApplicationModule | Promise<PresenceVisualApplicationModule>;
  /** A complete, usable scene is mandatory. Application construction is never readiness. */
  readonly initializeScene: PresenceVisualSceneInitializer;
  readonly activityAllowed?: (
    profile: PresenceVisualActivityProfile,
    semantic: PresenceVisualSemanticSnapshot,
  ) => boolean;
  readonly clock?: PresenceVisualClock;
  readonly recordMetric?: (name: RuntimeMetricName, value: number, at: number) => void;
}

export type PresenceVisualBrowserRuntimeOptions = Omit<
  PresenceVisualRuntimeOptions,
  "surface" | "window" | "createResizeObserver"
> & {
  readonly target: HTMLDivElement;
};

export interface PresenceVisualRuntime {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PresenceVisualRuntimeSnapshot;
  readonly mount: () => Promise<void>;
  readonly refreshLayout: () => void;
  readonly refreshMetrics: () => void;
  readonly retry: () => Promise<boolean>;
  readonly destroy: () => void;
}

export class PresenceVisualInitializationError extends Error {
  readonly stage: "model" | "pass";

  constructor(stage: "model" | "pass", message: string) {
    super(message);
    this.name = "PresenceVisualInitializationError";
    this.stage = stage;
  }
}

export function resolvePresenceVisualDpr(deviceDpr: number, compact: boolean): number {
  const normalized = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.min(Math.max(1, normalized), compact ? COMPACT_DPR_CAP : DESKTOP_DPR_CAP);
}

export function createPresenceVisualRuntime(
  options: PresenceVisualRuntimeOptions,
): PresenceVisualRuntime {
  const listeners = new Set<() => void>();
  const clock = options.clock ?? defaultClock;
  const metric = options.recordMetric ?? recordRuntimeMetric;
  let mounted = false;
  let destroyed = false;
  let suppressInitialization = false;
  let generation = 0;
  let snapshot = freezeSnapshot({
    phase: "idle",
    failureStage: null,
    retryRequired: false,
    webglAvailability: "unknown",
    ...readProfile(),
    generation,
  });
  let observer: PresenceVisualResizeObserver | null = null;
  let unsubscribeSemantic: (() => void) | null = null;
  let unsubscribeJewel: (() => void) | null = null;
  let run: VisualRun | null = null;
  let pendingInitialization: Promise<void> | null = null;
  let application: PresenceVisualApplication | null = null;
  let sceneReady = false;
  let activeScene: PresenceVisualResource | null = null;
  let tickerRunning = false;
  let contextLost = false;
  let automaticRestoreUsed = false;
  let appliedLayout: AppliedLayout | null = null;

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function publish(patch: Partial<PresenceVisualRuntimeSnapshot>): void {
    const next = freezeSnapshot({ ...snapshot, ...patch });
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function record(name: RuntimeMetricName, value: number): void {
    try {
      metric(name, value, clock.now());
    } catch {
      // Instrumentation is observational and must never own the visual lifecycle.
    }
  }

  function refreshMetrics(): void {
    let estimates: PresenceVisualSceneMetrics | undefined;
    try {
      estimates = activeScene?.readMetrics?.();
    } catch {
      return;
    }
    if (estimates === undefined) return;
    recordEstimate("draw-calls", estimates.drawCalls);
    recordEstimate("gpu-memory-mib", estimates.gpuMemoryMiB);
    recordEstimate("decoded-texture-mib", estimates.decodedTextureMiB);
  }

  function recordEstimate(name: RuntimeMetricName, value: number | undefined): void {
    if (value === undefined || !Number.isFinite(value) || value < 0) return;
    record(name, value);
  }

  function readProfile(): Pick<
    PresenceVisualActivityProfile,
    "width" | "height" | "resolution" | "fps" | "compact"
  > {
    const measured = options.surface.getSize();
    const size = normalizeSize(measured);
    const compact =
      typeof options.compact === "function" ? options.compact(size) : options.compact;
    return {
      ...size,
      resolution: resolvePresenceVisualDpr(options.window.devicePixelRatio, compact),
      fps: compact ? COMPACT_FPS : DESKTOP_FPS,
      compact,
    };
  }

  function activityAllowed(
    profile: PresenceVisualActivityProfile,
    semantic: PresenceVisualSemanticSnapshot,
  ): boolean {
    return options.activityAllowed?.(profile, semantic) ?? true;
  }

  function currentRunIs(candidate: VisualRun): boolean {
    return !destroyed && mounted && run === candidate && !candidate.controller.signal.aborted;
  }

  function startTicker(): void {
    if (application === null || tickerRunning) return;
    application.ticker.start();
    tickerRunning = true;
    liveAppTickerCount += 1;
    record("app-raf", liveAppTickerCount);
  }

  function stopTicker(): void {
    if (application !== null && tickerRunning) {
      tickerRunning = false;
      liveAppTickerCount = Math.max(0, liveAppTickerCount - 1);
      try {
        application.ticker.stop();
      } catch {
        // A broken adapter must not block the shared resource destroy path.
      }
      record("app-raf", liveAppTickerCount);
    }
  }

  function stopAndRelease(reason: PresenceVisualReleaseReason): void {
    stopTicker();
    try {
      if (options.jewel.getSnapshot().ownsLease) options.jewel.releaseOwned(reason);
    } catch {
      // Lease cleanup is fail-safe; renderer resources must still be released.
    }
  }

  function phaseForCurrentFacts(profile: ReturnType<typeof readProfile>): PresenceVisualRuntimePhase {
    if (destroyed) return "destroyed";
    if (profile.width === 0 || profile.height === 0) {
      return application === null ? "waitingForSize" : "static";
    }
    if (
      snapshot.retryRequired ||
      snapshot.webglAvailability === "unavailable" ||
      contextLost
    ) {
      return "static";
    }
    if (pendingInitialization !== null && !sceneReady) return "loading";
    const semantic = options.semantic.getSnapshot();
    if (
      semantic.visibility !== "visible" ||
      semantic.motion !== "full" ||
      !activityAllowed(profile, semantic)
    ) {
      return "static";
    }
    if (sceneReady) return semantic.visualRuntime === "ready" ? "ready" : "static";
    return mounted ? "loading" : "idle";
  }

  function applyLayout(profile: ReturnType<typeof readProfile>, force = false): void {
    if (application === null || profile.width === 0 || profile.height === 0) return;
    const next: AppliedLayout = {
      width: profile.width,
      height: profile.height,
      resolution: profile.resolution,
      fps: profile.fps,
    };
    if (!force && appliedLayout !== null && sameLayout(appliedLayout, next)) return;
    application.ticker.maxFPS = profile.fps;
    application.renderer.resolution = profile.resolution;
    application.renderer.resize(profile.width, profile.height);
    appliedLayout = next;
    const backing = application.renderer.getBackingSize?.() ?? {
      width: Math.round(profile.width * profile.resolution),
      height: Math.round(profile.height * profile.resolution),
    };
    recordEstimate("canvas-backing-width", backing.width);
    recordEstimate("canvas-backing-height", backing.height);
  }

  function reconcile(): void {
    if (!mounted || destroyed) return;
    const profile = readProfile();
    const semantic = options.semantic.getSnapshot();
    if (
      !suppressInitialization &&
      run !== null &&
      !sceneReady &&
      semantic.visualRuntime === "ready"
    ) {
      suppressInitialization = true;
      stopAndRelease("retry");
      options.semantic.dispatch({ type: "VISUAL_RETRY" });
      suppressInitialization = false;
      return;
    }
    publish({ ...profile, phase: phaseForCurrentFacts(profile) });

    if (profile.width === 0 || profile.height === 0) {
      if (application === null && !sceneReady) stopTicker();
      else stopAndRelease("zero-size");
      return;
    }

    applyLayout(profile);
    const eligible =
      semantic.visibility === "visible" &&
      semantic.motion === "full" &&
      activityAllowed(profile, semantic);
    const canRun =
      eligible &&
      semantic.visualRuntime === "ready" &&
      sceneReady &&
      options.jewel.getSnapshot().ownsLease;

    if (canRun) startTicker();
    else if (!eligible || (sceneReady && semantic.visualRuntime !== "ready")) {
      stopAndRelease("environment");
    }
    else stopTicker();

    if (
      !suppressInitialization &&
      eligible &&
      semantic.visualRuntime !== "contextLost" &&
      run === null &&
      pendingInitialization === null &&
      !snapshot.retryRequired &&
      snapshot.webglAvailability !== "unavailable"
    ) {
      void ensureInitialized();
    }
  }

  function refreshLayout(): void {
    reconcile();
  }

  async function mount(): Promise<void> {
    if (destroyed) return;
    if (!mounted) {
      mounted = true;
      observer = options.createResizeObserver(refreshLayout);
      observer.observe(options.surface);
      options.window.addEventListener("resize", refreshLayout);
      unsubscribeSemantic = options.semantic.subscribe(reconcile);
      unsubscribeJewel = options.jewel.subscribe(reconcile);
    }
    reconcile();
    if (pendingInitialization !== null) await pendingInitialization;
  }

  async function ensureInitialized(): Promise<void> {
    if (pendingInitialization !== null) return pendingInitialization;
    if (
      !mounted ||
      destroyed ||
      run !== null ||
      snapshot.retryRequired ||
      snapshot.webglAvailability === "unavailable"
    ) {
      return;
    }
    const profile = readProfile();
    const semantic = options.semantic.getSnapshot();
    if (
      profile.width === 0 ||
      profile.height === 0 ||
      semantic.visibility !== "visible" ||
      semantic.motion !== "full" ||
      !activityAllowed(profile, semantic) ||
      semantic.visualRuntime === "contextLost"
    ) {
      publish({ ...profile, phase: phaseForCurrentFacts(profile) });
      return;
    }

    if (semantic.visualRuntime !== "loading") {
      suppressInitialization = true;
      stopAndRelease("retry");
      options.semantic.dispatch({ type: "VISUAL_RETRY" });
      suppressInitialization = false;
    }

    const candidate: VisualRun = {
      generation: ++generation,
      controller: new AbortController(),
      resources: createResourceScope(),
    };
    run = candidate;
    sceneReady = false;
    appliedLayout = null;
    publish({
      ...profile,
      phase: "loading",
      failureStage: null,
      retryRequired: false,
      generation,
    });

    const initialization = initializeRun(candidate, profile);
    pendingInitialization = initialization;
    try {
      await initialization;
    } finally {
      if (pendingInitialization === initialization) pendingInitialization = null;
      if (mounted && !destroyed) {
        const latestProfile = readProfile();
        publish({ ...latestProfile, phase: phaseForCurrentFacts(latestProfile) });
      }
    }
  }

  async function initializeRun(
    candidate: VisualRun,
    initialProfile: ReturnType<typeof readProfile>,
  ): Promise<void> {
    let stage: "module" | "application" | "scene" = "module";
    let applicationModule: PresenceVisualApplicationModule | null = null;
    try {
      applicationModule = await options.loadApplicationModule(candidate.controller.signal);
      if (!currentRunIs(candidate)) return;

      stage = "application";
      const createdApplication = new applicationModule.Application({
        width: initialProfile.width,
        height: initialProfile.height,
        resolution: initialProfile.resolution,
        autoStart: false,
        sharedTicker: false,
        backgroundAlpha: 0,
        antialias: true,
      });
      let isWebglApplication = false;
      try {
        isWebglApplication = applicationModule.isWebglApplication(createdApplication);
      } catch {
        isWebglApplication = false;
      }
      if (!isWebglApplication) {
        destroySafely(createdApplication);
        throw new PresenceVisualWebglUnavailableError();
      }
      publish({ webglAvailability: "available" });
      liveWebglContextCount += 1;
      record("webgl-context", liveWebglContextCount);
      candidate.resources.own({
        destroy: once(() => {
          try {
            createdApplication.destroy();
          } finally {
            liveWebglContextCount = Math.max(0, liveWebglContextCount - 1);
            record("webgl-context", liveWebglContextCount);
          }
        }),
      });
      if (!currentRunIs(candidate)) return;

      application = createdApplication;
      application.ticker.maxFPS = initialProfile.fps;
      application.ticker.stop();
      tickerRunning = false;
      record("app-raf", liveAppTickerCount);
      options.surface.attach(application.view);
      candidate.resources.own({
        destroy: once(() => options.surface.detach(createdApplication.view)),
      });

      const onContextLost: PresenceVisualEventListener = (event) => {
        if (!currentRunIs(candidate)) return;
        event.preventDefault?.();
        if (contextLost) return;
        contextLost = true;
        stopAndRelease("context-lost");
        publish({ phase: "static" });
        options.semantic.dispatch({ type: "WEBGL_LOST" });
      };
      const onContextRestored: PresenceVisualEventListener = () => {
        if (!currentRunIs(candidate) || !contextLost) return;
        if (automaticRestoreUsed) {
          publish({ phase: "static", retryRequired: true });
          return;
        }
        automaticRestoreUsed = true;
        void restoreAutomatically();
      };
      application.view.addEventListener("webglcontextlost", onContextLost);
      application.view.addEventListener("webglcontextrestored", onContextRestored);
      candidate.resources.own({
        destroy: once(() => {
          createdApplication.view.removeEventListener("webglcontextlost", onContextLost);
          createdApplication.view.removeEventListener("webglcontextrestored", onContextRestored);
        }),
      });

      applyLayout(readProfile(), true);
      stage = "scene";
      const scene = await options.initializeScene({
        application: createdApplication,
        signal: candidate.controller.signal,
        jewel: options.jewel,
        registerResource: (resource) => candidate.resources.own(resource),
      });
      candidate.resources.own(scene);
      if (!currentRunIs(candidate)) return;
      if (
        contextLost ||
        options.semantic.getSnapshot().visualRuntime === "contextLost"
      ) {
        sceneReady = false;
        activeScene = null;
        publish({ phase: "static", failureStage: null, retryRequired: false });
        return;
      }

      activeScene = scene;
      sceneReady = true;
      contextLost = false;
      refreshMetrics();
      publish({ failureStage: null, retryRequired: false });
      options.semantic.dispatch({ type: "WEBGL_READY" });
      reconcile();
    } catch (error) {
      if (!currentRunIs(candidate)) return;
      let moduleClassifiesWebglUnavailable = false;
      if (stage === "application" && applicationModule !== null) {
        try {
          moduleClassifiesWebglUnavailable =
            applicationModule.isWebglUnavailableError(error);
        } catch {
          moduleClassifiesWebglUnavailable = false;
        }
      }
      const webglUnavailable =
        error instanceof PresenceVisualWebglUnavailableError ||
        moduleClassifiesWebglUnavailable;
      const failureStage = resolveFailureStage(stage, error);
      stopAndRelease("initialization-failed");
      candidate.controller.abort();
      candidate.resources.close();
      if (run === candidate) run = null;
      application = null;
      sceneReady = false;
      activeScene = null;
      tickerRunning = false;
      appliedLayout = null;
      publish({
        phase: "static",
        failureStage,
        retryRequired: !webglUnavailable,
        webglAvailability: webglUnavailable
          ? "unavailable"
          : snapshot.webglAvailability,
      });
    }
  }

  function teardownVisual(reason: PresenceVisualReleaseReason): void {
    const active = run;
    if (active === null) {
      stopAndRelease(reason);
      application = null;
      sceneReady = false;
      activeScene = null;
      appliedLayout = null;
      return;
    }
    stopAndRelease(reason);
    run = null;
    pendingInitialization = null;
    active.controller.abort();
    active.resources.close();
    application = null;
    sceneReady = false;
    activeScene = null;
    tickerRunning = false;
    appliedLayout = null;
  }

  async function restoreAutomatically(): Promise<void> {
    if (!mounted || destroyed) return;
    suppressInitialization = true;
    teardownVisual("retry");
    contextLost = false;
    publish({ phase: "loading", failureStage: null, retryRequired: false });
    options.semantic.dispatch({ type: "VISUAL_RETRY" });
    suppressInitialization = false;
    await ensureInitialized();
  }

  async function retry(): Promise<boolean> {
    if (
      !mounted ||
      destroyed ||
      snapshot.webglAvailability === "unavailable"
    ) {
      return false;
    }
    suppressInitialization = true;
    teardownVisual("retry");
    contextLost = false;
    automaticRestoreUsed = false;
    publish({ phase: "loading", failureStage: null, retryRequired: false });
    options.semantic.dispatch({ type: "VISUAL_RETRY" });
    suppressInitialization = false;
    await ensureInitialized();
    return sceneReady;
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    mounted = false;
    unsubscribeSemantic?.();
    unsubscribeSemantic = null;
    unsubscribeJewel?.();
    unsubscribeJewel = null;
    observer?.disconnect();
    observer = null;
    options.window.removeEventListener("resize", refreshLayout);
    teardownVisual("destroy");
    if (options.semantic.getSnapshot().visualRuntime !== "loading") {
      options.semantic.dispatch({ type: "VISUAL_RETRY" });
    }
    publish({ phase: "destroyed", retryRequired: false });
  }

  return Object.freeze({
    subscribe,
    getSnapshot: () => snapshot,
    mount,
    refreshLayout,
    refreshMetrics,
    retry,
    destroy,
  });
}

/**
 * Browser ownership adapter kept in the core runtime so React and the lazy
 * loader never own Canvas, ResizeObserver, or window-listener lifecycles.
 */
export function createBrowserPresenceVisualRuntime({
  target,
  ...options
}: PresenceVisualBrowserRuntimeOptions): PresenceVisualRuntime {
  const browserWindow = window;
  const surface: PresenceVisualSurface = {
    getSize: () => ({
      width: target.clientWidth,
      height: target.clientHeight,
    }),
    attach: (view) => {
      if (!(view instanceof Node)) {
        throw new TypeError("Presence visual Application view must be a DOM Node.");
      }
      if (view instanceof HTMLElement) {
        view.setAttribute("aria-hidden", "true");
        view.tabIndex = -1;
        view.style.pointerEvents = "none";
      }
      target.replaceChildren(view);
    },
    detach: (view) => {
      if (view instanceof Node && view.parentNode === target) target.removeChild(view);
    },
  };
  const runtimeWindow: PresenceVisualWindow = {
    get devicePixelRatio() {
      return browserWindow.devicePixelRatio;
    },
    addEventListener: (type, listener) => {
      browserWindow.addEventListener(type, listener as EventListener);
    },
    removeEventListener: (type, listener) => {
      browserWindow.removeEventListener(type, listener as EventListener);
    },
  };

  return createPresenceVisualRuntime({
    ...options,
    surface,
    window: runtimeWindow,
    createResizeObserver: (callback) => {
      if (typeof ResizeObserver !== "function") {
        return {
          observe: () => undefined,
          disconnect: () => undefined,
        };
      }
      const observer = new ResizeObserver(() => callback());
      return {
        observe: (observedSurface) => {
          void observedSurface;
          observer.observe(target);
        },
        disconnect: () => observer.disconnect(),
      };
    },
  });
}

interface VisualRun {
  readonly generation: number;
  readonly controller: AbortController;
  readonly resources: ResourceScope;
}

interface AppliedLayout {
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly fps: 24 | 30;
}

interface ResourceScope {
  readonly own: (resource: PresenceVisualResource) => void;
  readonly close: () => void;
}

function createResourceScope(): ResourceScope {
  const resources: PresenceVisualResource[] = [];
  const resourceIdentities = new Set<PresenceVisualResource>();
  let closed = false;
  return {
    own(resource) {
      if (resourceIdentities.has(resource)) return;
      resourceIdentities.add(resource);
      const owned = { destroy: once(() => resource.destroy()) };
      if (closed) destroySafely(owned);
      else resources.push(owned);
    },
    close() {
      if (closed) return;
      closed = true;
      for (let index = resources.length - 1; index >= 0; index -= 1) {
        destroySafely(resources[index]);
      }
      resources.length = 0;
    },
  };
}

function destroySafely(resource: PresenceVisualResource): void {
  try {
    resource.destroy();
  } catch {
    // One adapter must never prevent the remaining owned resources from being released.
  }
}

function resolveFailureStage(
  stage: "module" | "application" | "scene",
  error: unknown,
): PresenceVisualFailureStage {
  if (stage !== "scene") return stage;
  return error instanceof PresenceVisualInitializationError ? error.stage : "model";
}

function normalizeSize(size: PresenceVisualSize): PresenceVisualSize {
  return {
    width: normalizeDimension(size.width),
    height: normalizeDimension(size.height),
  };
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function sameLayout(left: AppliedLayout, right: AppliedLayout): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.resolution === right.resolution &&
    left.fps === right.fps
  );
}

function freezeSnapshot(snapshot: PresenceVisualRuntimeSnapshot): PresenceVisualRuntimeSnapshot {
  return Object.freeze(snapshot);
}

function sameSnapshot(
  left: PresenceVisualRuntimeSnapshot,
  right: PresenceVisualRuntimeSnapshot,
): boolean {
  return (
    left.phase === right.phase &&
    left.failureStage === right.failureStage &&
    left.retryRequired === right.retryRequired &&
    left.webglAvailability === right.webglAvailability &&
    left.width === right.width &&
    left.height === right.height &&
    left.resolution === right.resolution &&
    left.fps === right.fps &&
    left.compact === right.compact &&
    left.generation === right.generation
  );
}

class PresenceVisualWebglUnavailableError extends Error {
  constructor() {
    super("Pixi did not create a WebGL renderer.");
    this.name = "PresenceVisualWebglUnavailableError";
  }
}

function once(callback: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    callback();
  };
}

const defaultClock: PresenceVisualClock = {
  now: () => {
    if (typeof performance !== "undefined") return performance.now();
    return Date.now();
  },
};
