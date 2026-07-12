import { describe, expect, it, vi } from "vitest";

import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState } from "@/lib/semantic-state";

import { createJewelRuntime } from "./jewel-runtime";
import type { Live2DAdapterOptions } from "./live2d-adapter";
import {
  PresenceVisualInitializationError,
  type PresenceVisualSceneContext,
} from "./presence-visual-runtime";
import type { SoulLensPassOptions } from "./soul-lens-pass";
import {
  createSoulLensTruthSource,
  initializePresenceVisualScene,
  type PresenceVisualPresenceSource,
} from "./visual-scene";

const READY_SEMANTIC = Object.freeze({
  ...initialSemanticState,
  visibility: "visible" as const,
  motion: "full" as const,
  visualRuntime: "ready" as const,
});

describe("Presence visual scene", () => {
  it("hands one stage and ticker to owner-scoped Lens and Live2D adapters", async () => {
    const runtime = createJewelRuntime();
    const presence = new FakePresenceSource(activePresence("astr-shell-a"));
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(presence.getSnapshot());
    runtime.syncPresence(
      activePresence("astr-shell-a", {
        lifeEvents: [stageEvent("stage-1", "recall")],
      }),
    );
    const harness = createSceneHarness(runtime, presence);
    const scene = await harness.initialize();
    const lensJewel = harness.lensOptions?.jewel;
    const live2dJewel = harness.live2dOptions?.jewel;

    expect(harness.lensOptions?.stage).toBe(harness.context.application.stage);
    expect(harness.live2dOptions?.stage).toBe(harness.context.application.stage);
    expect(harness.lensOptions?.ticker).toBe(harness.context.application.ticker);
    expect(harness.live2dOptions?.ticker).toBe(harness.context.application.ticker);
    expect(harness.lensOptions?.signal).toBe(harness.context.signal);
    expect(harness.live2dOptions?.signal).toBe(harness.context.signal);
    expect(lensJewel?.getSnapshot().ownsLease).toBe(true);
    expect(live2dJewel?.getSnapshot().ownsLease).toBe(false);

    const ownershipOrder: string[] = [];
    const releaseLens = lensJewel?.subscribe(() => {
      ownershipOrder.push(lensJewel.getSnapshot().ownsLease ? "lens:on" : "lens:off");
    });
    const releaseLive2D = live2dJewel?.subscribe(() => {
      ownershipOrder.push(
        live2dJewel.getSnapshot().ownsLease ? "live2d:on" : "live2d:off",
      );
    });

    const withDelta = activePresence("astr-shell-a", {
      lifeEvents: [stageEvent("stage-1", "recall")],
      provisionalText: "第一段真实回复",
    });
    presence.set(withDelta);
    runtime.syncPresence(withDelta);

    expect(ownershipOrder).toEqual(["lens:off", "live2d:on"]);
    expect(lensJewel?.getSnapshot().ownsLease).toBe(false);
    expect(live2dJewel?.getSnapshot().ownsLease).toBe(true);
    expect(
      Number(lensJewel?.getSnapshot().ownsLease) +
        Number(live2dJewel?.getSnapshot().ownsLease),
    ).toBe(1);
    expect(harness.lensOptions?.truthSource.getSnapshot().endpoint).toEqual({
      kind: "stage",
      traceId: "trace-active",
      stage: "recall",
    });

    releaseLive2D?.();
    releaseLens?.();
    scene.destroy();
    scene.destroy();
    expect(harness.live2d.destroy).toHaveBeenCalledTimes(1);
    expect(harness.lens.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps identity implicit, maps only the real model shell, and fixes provenance to unprovided", () => {
    const runtime = createJewelRuntime();
    const presence = new FakePresenceSource(activePresence("astr-shell-a"));
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(presence.getSnapshot());
    const truth = createSoulLensTruthSource(runtime, presence);
    const initial = truth.getSnapshot();

    expect(initial).toEqual({
      modelKey: "astr-shell-a",
      provenance: { kind: "unprovided" },
      endpoint: { kind: "rest" },
    });
    expect(truth.getSnapshot()).toBe(initial);
    expect(initial).not.toHaveProperty("identity");
    expect(initial).not.toHaveProperty("continuityPercent");

    const listener = vi.fn();
    const release = truth.subscribe(listener);
    presence.set(activePresence("astr-shell-b"));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(truth.getSnapshot()).toEqual({
      modelKey: "astr-shell-b",
      provenance: { kind: "unprovided" },
      endpoint: { kind: "rest" },
    });
    expect(truth.getSnapshot().provenance).toBe(initial.provenance);
    release();
  });

  it("does not report the Lens topology as a fabricated whole-scene draw-call total", async () => {
    const runtime = createJewelRuntime();
    const presence = new FakePresenceSource(activePresence("astr-shell"));
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(presence.getSnapshot());
    const harness = createSceneHarness(runtime, presence, {
      lensMetrics: { drawCalls: 1 },
      live2dMetrics: { drawCalls: 7, decodedTextureMiB: 8 },
    });

    const scene = await harness.initialize();

    expect(scene.readMetrics?.()).toEqual({ decodedTextureMiB: 8 });
    expect(scene.readMetrics?.()).not.toHaveProperty("drawCalls");
  });

  it("rolls back the Lens when Live2D model initialization fails", async () => {
    const runtime = createJewelRuntime();
    const presence = new FakePresenceSource(activePresence("astr-shell"));
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(presence.getSnapshot());
    const harness = createSceneHarness(runtime, presence, { live2dFailure: true });

    await expect(harness.initialize()).rejects.toMatchObject({
      name: "PresenceVisualInitializationError",
      stage: "model",
    });
    expect(harness.lens.destroy).toHaveBeenCalledTimes(1);
    expect(harness.context.registerResource).toHaveBeenCalledWith(harness.lens);
  });
});

function createSceneHarness(
  runtime: ReturnType<typeof createJewelRuntime>,
  presence: PresenceVisualPresenceSource,
  options: {
    readonly lensMetrics?: { readonly drawCalls?: number };
    readonly live2dMetrics?: {
      readonly drawCalls?: number;
      readonly decodedTextureMiB?: number;
    };
    readonly live2dFailure?: boolean;
  } = {},
) {
  const controller = new AbortController();
  const stage = { addChild: vi.fn(), removeChild: vi.fn() };
  const ticker = {
    deltaMS: 16,
    maxFPS: 30,
    start: vi.fn(),
    stop: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const context: PresenceVisualSceneContext = {
    application: {
      view: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      stage,
      ticker,
      renderer: { resolution: 1, resize: vi.fn() },
      destroy: vi.fn(),
    },
    signal: controller.signal,
    jewel: {
      getSnapshot: () => ({ ownsLease: false, leaseToken: null }),
      subscribe: () => () => undefined,
      releaseOwned: () => undefined,
    },
    readViewport: () => ({ width: 720, height: 900 }),
    registerResource: vi.fn(),
  };
  const lens = {
    destroy: vi.fn(),
    resize: vi.fn(),
    readTopology: vi.fn(),
    readMetrics: () => options.lensMetrics ?? {},
  };
  const live2d = {
    destroy: vi.fn(),
    refreshTransform: vi.fn(),
    freezeRepresentativeFrame: vi.fn(),
    setExpression: vi.fn(async () => true),
    setMouth: vi.fn(),
    readMetrics: () => options.live2dMetrics ?? {},
  };
  let lensOptions: SoulLensPassOptions | null = null;
  let live2dOptions: Live2DAdapterOptions | null = null;

  return {
    context,
    lens,
    live2d,
    get lensOptions() {
      return lensOptions;
    },
    get live2dOptions() {
      return live2dOptions;
    },
    initialize: () =>
      initializePresenceVisualScene(context, {
        jewelRuntime: runtime,
        presenceSource: presence,
        transformSource: { getSnapshot: () => ({ scale: 0.2, x: 0, y: 0 }), subscribe: () => () => undefined },
        createLensPass: async (received) => {
          lensOptions = received;
          return lens;
        },
        createLive2DAdapter: async (received) => {
          live2dOptions = received;
          if (options.live2dFailure) {
            throw new PresenceVisualInitializationError("model", "model failed");
          }
          return live2d;
        },
      }),
  };
}

class FakePresenceSource implements PresenceVisualPresenceSource {
  private snapshot: PresenceControllerSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(initial: PresenceControllerSnapshot) {
    this.snapshot = initial;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(snapshot: PresenceControllerSnapshot) {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}

function activePresence(
  model: string,
  options: {
    readonly lifeEvents?: readonly ReturnType<typeof stageEvent>[];
    readonly provisionalText?: string;
  } = {},
): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: READY_SEMANTIC,
    status: Object.freeze({
      internalHandle: "private-handle",
      model,
      costTodayUsd: 0,
      dailyBudgetUsd: 0,
      emotion: { loneliness: 0, talkativeness: 0, irritation: 0, excitement: 0 },
    }),
    conversation: Object.freeze({
      messages: [],
      receipt: { event_id: "ingest-1", trace_id: "trace-active" },
      provisionalText: options.provisionalText ?? "",
      provisionalActive: Boolean(options.provisionalText),
      authoritativeDecision: null,
      error: null,
    }),
    lifeEvents: options.lifeEvents ?? [],
  });
}

function stageEvent(id: string, stage: string) {
  return Object.freeze({
    id,
    ts: "2026-07-13T00:00:00.000Z",
    type: "agent.thought",
    source: "soul.orchestrator",
    trace_id: "trace-active",
    payload: Object.freeze({ text: stage, stage }),
  });
}
