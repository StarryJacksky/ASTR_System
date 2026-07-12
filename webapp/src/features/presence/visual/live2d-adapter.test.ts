import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { L2D_DEFAULT, type L2DTransform } from "@/lib/live2dStore";

import {
  createLive2DAdapter,
  type Live2DAdapterModel,
  type Live2DAdapterModule,
  type Live2DAdapterOptions,
  type Live2DTransformSource,
} from "./live2d-adapter";

type LoadCore = NonNullable<Live2DAdapterOptions["loadCore"]>;
type LoadModule = NonNullable<Live2DAdapterOptions["loadModule"]>;
type VerifyAssets = NonNullable<Live2DAdapterOptions["verifyAssets"]>;
type OnRuntimeError = NonNullable<Live2DAdapterOptions["onRuntimeError"]>;
type ModelFromSync = Live2DAdapterModule["Live2DModel"]["fromSync"];
type ModelExpression = NonNullable<Live2DAdapterModel["expression"]>;
type ModelUpdate = Live2DAdapterModel["update"];
type TextureFromURL = Live2DAdapterModule["Texture"]["fromURL"];
type RemoveTextureFromCache = Live2DAdapterModule["Texture"]["removeFromCache"];

describe("renderer-free Live2D adapter", () => {
  it("attaches to the existing stage/ticker with manual updates and tears down once", async () => {
    const harness = createHarness({ ownsLease: true });
    const adapter = await harness.create();

    expect(harness.fromSync).toHaveBeenCalledWith(
      "/live2d/haru/haru_greeter_t03.model3.json",
      expect.objectContaining({
        autoUpdate: false,
        autoHitTest: false,
        autoFocus: false,
        ticker: harness.ticker,
        onLoad: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(harness.textureFromURL.mock.calls.map(([url]) => url)).toEqual([
      "/live2d/haru/haru_greeter_t03.2048/texture_00.png",
      "/live2d/haru/haru_greeter_t03.2048/texture_01.png",
    ]);
    expect(harness.stage.addChild).toHaveBeenCalledWith(harness.model);
    expect(harness.ticker.add).toHaveBeenCalledTimes(1);

    harness.ticker.tick(16.5);
    expect(harness.model.update).toHaveBeenLastCalledWith(16.5);

    adapter.setMouth(0.72);
    harness.ticker.tick(17);
    expect(harness.model.coreParameter).toHaveBeenCalledWith(
      "ParamMouthOpenY",
      0.72,
    );

    harness.jewel.setOwned(false);
    expect(harness.model.coreParameter).toHaveBeenLastCalledWith(
      "ParamMouthOpenY",
      0,
    );
    expect(harness.model.stopMotions).toHaveBeenCalledTimes(1);
    expect(harness.model.stopSpeaking).toHaveBeenCalledTimes(1);
    expect(harness.model.resetExpression).toHaveBeenCalledTimes(1);
    const updateCountAtFreeze = harness.model.update.mock.calls.length;
    harness.ticker.tick(18);
    expect(harness.model.update).toHaveBeenCalledTimes(updateCountAtFreeze);

    harness.jewel.setOwned(true);
    harness.ticker.tick(19);
    expect(harness.model.update).toHaveBeenLastCalledWith(19);

    adapter.destroy();
    adapter.destroy();
    expect(harness.ticker.remove).toHaveBeenCalledTimes(1);
    expect(harness.stage.removeChild).toHaveBeenCalledTimes(1);
    expect(harness.model.destroy).toHaveBeenCalledTimes(1);
    expect(harness.model.destroy).toHaveBeenCalledWith({
      children: true,
      texture: true,
      baseTexture: true,
    });
    expect(harness.jewel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("applies a validated transform and reports only metrics backed by model textures", async () => {
    const harness = createHarness({
      ownsLease: true,
      viewport: { width: 1000, height: 800 },
      textures: [{ baseTexture: { realWidth: 2048, realHeight: 1024 } }],
    });
    const adapter = await harness.create();

    expect(harness.model.anchorSet).toHaveBeenCalledWith(0.5, 0.5);
    expect(harness.model.scaleSet).toHaveBeenLastCalledWith(L2D_DEFAULT.scale);
    expect(harness.model.x).toBe(530);
    expect(harness.model.y).toBe(1160);
    expect(adapter.readMetrics?.()).toEqual({ decodedTextureMiB: 8 });

    harness.transform.set({ scale: Number.NaN, x: 99, y: Number.NEGATIVE_INFINITY });
    expect(harness.model.scaleSet).toHaveBeenLastCalledWith(L2D_DEFAULT.scale);
    expect(harness.model.x).toBe(1000);
    expect(harness.model.y).toBe(1160);

    adapter.destroy();
  });

  it("fails expression changes safely and does not revive them after destroy", async () => {
    const expression = vi
      .fn<ModelExpression>()
      .mockRejectedValue(new Error("expression 404"));
    const harness = createHarness({ ownsLease: true, expression });
    const adapter = await harness.create();

    await expect(adapter.setExpression("f03")).resolves.toBe(false);
    adapter.destroy();
    await expect(adapter.setExpression("f04")).resolves.toBe(false);
    expect(expression).toHaveBeenCalledTimes(1);
  });

  it("invalidates an expression result across lease preemption and reacquisition", async () => {
    const expressionResult = deferred<boolean>();
    const expression = vi.fn<ModelExpression>(() => expressionResult.promise);
    const harness = createHarness({ ownsLease: true, expression });
    const adapter = await harness.create();

    const applying = adapter.setExpression("f05");
    harness.jewel.setOwned(false);
    harness.jewel.setOwned(true);
    expressionResult.resolve(true);

    await expect(applying).resolves.toBe(false);
    expect(harness.model.stopMotions).toHaveBeenCalledTimes(1);
    expect(harness.model.resetExpression).toHaveBeenCalledTimes(2);
    adapter.destroy();
  });

  it("invalidates async work when one owned lease token replaces another", async () => {
    const expressionResult = deferred<boolean>();
    const harness = createHarness({
      ownsLease: true,
      expression: vi.fn<ModelExpression>(() => expressionResult.promise),
    });
    const adapter = await harness.create();

    const applying = adapter.setExpression("f06");
    harness.jewel.replaceLease();
    expressionResult.resolve(true);

    await expect(applying).resolves.toBe(false);
    expect(harness.model.resetExpression).toHaveBeenCalledTimes(2);
    adapter.destroy();
  });

  it("keeps an explicit representative frame frozen until a new lease arrives", async () => {
    const harness = createHarness({ ownsLease: true });
    const adapter = await harness.create();
    harness.ticker.tick(16);
    expect(harness.model.update).toHaveBeenCalledTimes(1);

    adapter.freezeRepresentativeFrame();
    harness.ticker.tick(16);
    expect(harness.model.update).toHaveBeenCalledTimes(1);

    harness.jewel.replaceLease();
    harness.ticker.tick(16);
    expect(harness.model.update).toHaveBeenCalledTimes(2);
    adapter.destroy();
  });

  it("resets expression identity so the same expression can re-enter on a new lease", async () => {
    const harness = createHarness({ ownsLease: true });
    const selectedExpression = {};
    harness.model.expressionManager.currentExpression = selectedExpression;
    harness.model.expression.mockImplementation(async () => {
      if (harness.model.expressionManager.currentExpression === selectedExpression) {
        return false;
      }
      harness.model.expressionManager.currentExpression = selectedExpression;
      return true;
    });
    const adapter = await harness.create();

    adapter.freezeRepresentativeFrame();
    expect(harness.model.expressionManager.currentExpression).toBe(
      harness.model.expressionManager.defaultExpression,
    );
    harness.jewel.replaceLease();
    await expect(adapter.setExpression("f01")).resolves.toBe(true);
    expect(harness.model.expressionManager.currentExpression).toBe(selectedExpression);
    adapter.destroy();
  });

  it("contains a model update fault, freezes and releases instead of breaking the ticker", async () => {
    const updateError = new Error("model update failed");
    const onRuntimeError = vi.fn<OnRuntimeError>();
    const harness = createHarness({
      ownsLease: true,
      update: vi.fn(() => {
        throw updateError;
      }),
      onRuntimeError,
    });
    const adapter = await harness.create();

    expect(() => harness.ticker.tick(16)).not.toThrow();
    expect(harness.jewel.releaseOwned).toHaveBeenCalledWith("initialization-failed");
    expect(onRuntimeError).toHaveBeenCalledWith(updateError);
    expect(harness.model.update).toHaveBeenCalledTimes(1);
    harness.ticker.tick(16);
    expect(harness.model.update).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it("fails safe if abort occurs synchronously while the model is being attached", async () => {
    const controller = new AbortController();
    const harness = createHarness({ ownsLease: true, controller });
    harness.stage.addChild.mockImplementation(() => controller.abort());

    await expect(harness.create()).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.stage.removeChild).toHaveBeenCalledWith(harness.model);
    expect(harness.model.destroy).toHaveBeenCalledTimes(1);
    expect(harness.ticker.add).not.toHaveBeenCalled();
  });

  it("fails safe on a lease snapshot change even if a source notification is missed", async () => {
    const harness = createHarness({ ownsLease: true });
    const adapter = await harness.create();
    adapter.setMouth(0.8);

    harness.jewel.setOwnedSilently(false);
    harness.ticker.tick(16);

    expect(harness.model.coreParameter).toHaveBeenLastCalledWith(
      "ParamMouthOpenY",
      0,
    );
    expect(harness.model.stopMotions).toHaveBeenCalledTimes(1);
    expect(harness.model.update).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it("fails closed for Core, model, moc and texture HTTP errors", async () => {
    const coreFailure = createHarness({
      loadCore: vi
        .fn<LoadCore>()
        .mockRejectedValue(new Error("HTTP 404 Cubism Core")),
    });
    await expect(coreFailure.create()).rejects.toMatchObject({
      name: "PresenceVisualInitializationError",
      stage: "model",
    });
    expect(coreFailure.loadModule).not.toHaveBeenCalled();

    for (const missing of ["model3", "moc3", "texture_00.png"]) {
      const harness = createHarness({
        modelLoadError: new Error(`HTTP 404 ${missing}`),
      });
      await expect(harness.create()).rejects.toMatchObject({
        name: "PresenceVisualInitializationError",
        stage: "model",
      });
      expect(harness.stage.addChild).not.toHaveBeenCalled();
      expect(harness.model.destroy).toHaveBeenCalledWith({
        children: true,
        texture: true,
        baseTexture: true,
      });
    }
  });

  it("refuses a local integrity mismatch before loading Cubism Core", async () => {
    const verifyAssets = vi
      .fn<VerifyAssets>()
      .mockRejectedValue(new Error("texture digest mismatch"));
    const harness = createHarness({ verifyAssets });

    await expect(harness.create()).rejects.toMatchObject({
      name: "PresenceVisualInitializationError",
      stage: "model",
    });
    expect(harness.loadCore).not.toHaveBeenCalled();
    expect(harness.loadModule).not.toHaveBeenCalled();
  });

  it("aborts without advancing from the Core stage", async () => {
    const core = deferred<void>();
    const controller = new AbortController();
    const harness = createHarness({
      loadCore: vi.fn<LoadCore>(() => core.promise),
      controller,
    });

    const creation = harness.create();
    controller.abort();
    await expect(creation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.loadModule).not.toHaveBeenCalled();
  });

  it("aborts asset verification without advancing into Cubism Core", async () => {
    const verification = deferred<void>();
    const controller = new AbortController();
    const harness = createHarness({
      verifyAssets: vi.fn<VerifyAssets>(() => verification.promise),
      controller,
    });

    const creation = harness.create();
    controller.abort();
    await expect(creation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.loadCore).not.toHaveBeenCalled();
    expect(harness.loadModule).not.toHaveBeenCalled();
  });

  it("aborts without advancing from the module stage", async () => {
    const adapterModule = deferred<Live2DAdapterModule>();
    const controller = new AbortController();
    const harness = createHarness({
      loadModule: vi.fn<LoadModule>(() => adapterModule.promise),
      controller,
    });

    const creation = harness.create();
    await vi.waitFor(() => expect(harness.loadModule).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(creation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.fromSync).not.toHaveBeenCalled();
  });

  it("cleans every late texture handle when unmounted during preload", async () => {
    const controller = new AbortController();
    const harness = createHarness({ deferTextureLoad: true, controller });

    const creation = harness.create();
    await vi.waitFor(() => expect(harness.textureFromURL).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(creation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.fromSync).not.toHaveBeenCalled();

    harness.completeTextureLoads();
    await vi.waitFor(() =>
      expect(harness.removeTextureFromCache).toHaveBeenCalledTimes(2),
    );
    for (const texture of harness.preloadedTextures) {
      expect(texture.destroy).toHaveBeenCalledWith(true);
    }
  });

  it("cleans successful sibling textures when one preload rejects", async () => {
    const harness = createHarness({ textureLoadErrorAt: 1 });

    await expect(harness.create()).rejects.toMatchObject({
      name: "PresenceVisualInitializationError",
      stage: "model",
    });
    expect(harness.fromSync).not.toHaveBeenCalled();
    expect(harness.preloadedTextures[0].destroy).toHaveBeenCalledWith(true);
    expect(harness.preloadedTextures[1].destroy).not.toHaveBeenCalled();
  });

  it("retries final cleanup after a half-loaded dependency destroy throws", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      deferModelLoad: true,
      destroyBeforeLoadThrows: true,
      controller,
    });

    const creation = harness.create();
    await vi.waitFor(() => expect(harness.fromSync).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(creation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.model.destroy).toHaveBeenCalledTimes(1);
    expect(harness.removeTextureFromCache).toHaveBeenCalledTimes(2);
    harness.completeModelLoad();
    await vi.waitFor(() => expect(harness.model.destroy).toHaveBeenCalledTimes(2));
    expect(harness.stage.addChild).not.toHaveBeenCalled();
    expect(harness.ticker.add).not.toHaveBeenCalled();
  });

  it("keeps forbidden renderer and scheduler APIs inside the sole core runtime", () => {
    const visualDirectory = resolve(process.cwd(), "src/features/presence/visual");
    const legacyDirectory = resolve(process.cwd(), "src/components/astr");
    const productionSources = [
      ...sourceFiles(visualDirectory),
      ...[
        "Live2DStage.tsx",
        "Starfield.tsx",
        "DustMotes.tsx",
        "FlameCore.tsx",
        "Intro.tsx",
      ].map((file) => join(legacyDirectory, file)),
    ].filter((file) => !file.includes(".test.") && file !== join(visualDirectory, "presence-visual-runtime.ts"));

    const forbidden = [
      /requestAnimationFrame\s*\(/,
      /\.getContext\s*\(/,
      /registerTicker\s*\(/,
      /Ticker\.shared/,
      /new\s+(?:PIXI\.)?Application\s*\(/,
      /new\s+(?:PIXI\.)?Ticker\s*\(/,
    ];

    const violations: string[] = [];
    for (const file of productionSources) {
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern.source}`);
      }
    }

    expect(violations).toEqual([]);
    const host = readFileSync(join(visualDirectory, "PresenceVisualHost.tsx"), "utf8");
    expect(host).not.toMatch(/live2d|2048/i);
  });
});

interface HarnessOptions {
  readonly ownsLease?: boolean;
  readonly controller?: AbortController;
  readonly loadCore?: LoadCore;
  readonly loadModule?: LoadModule;
  readonly verifyAssets?: VerifyAssets;
  readonly fromSync?: ModelFromSync;
  readonly deferModelLoad?: boolean;
  readonly modelLoadError?: Error;
  readonly destroyBeforeLoadThrows?: boolean;
  readonly deferTextureLoad?: boolean;
  readonly textureLoadErrorAt?: number;
  readonly expression?: ModelExpression;
  readonly update?: ModelUpdate;
  readonly onRuntimeError?: OnRuntimeError;
  readonly viewport?: { width: number; height: number };
  readonly textures?: Live2DAdapterModel["textures"];
}

function createHarness(options: HarnessOptions = {}) {
  const controller = options.controller ?? new AbortController();
  const stage = {
    addChild: vi.fn(),
    removeChild: vi.fn(),
  };
  const ticker = new FakeTicker();
  const jewel = new FakeJewel(options.ownsLease ?? false);
  const transform = new FakeTransformSource();
  const coreParameter = vi.fn();
  const resetExpression = vi.fn();
  const update = vi.fn<ModelUpdate>(options.update ?? (() => undefined));
  const expression = vi.fn<ModelExpression>(
    options.expression ?? (async () => true),
  );
  const defaultExpression = {};
  const expressionManager = {
    reserveExpressionIndex: -1,
    currentExpression: {},
    defaultExpression,
    resetExpression,
  };
  const preloadedTextures = Array.from({ length: 2 }, () => ({
    baseTexture: { realWidth: 2048, realHeight: 2048 },
    destroy: vi.fn(),
  }));
  let modelLoaded = false;
  const modelTextures = options.textures ?? preloadedTextures;
  const destroy = vi.fn((destroyOptions?: { texture?: boolean; baseTexture?: boolean }) => {
    if (options.destroyBeforeLoadThrows && !modelLoaded) {
      throw new Error("internalModel is not ready");
    }
    if (destroyOptions?.texture) {
      for (const texture of modelTextures) {
        if ("destroy" in texture && typeof texture.destroy === "function") {
          texture.destroy(destroyOptions.baseTexture);
        }
      }
    }
  });
  const model = {
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
    update,
    destroy,
    expression,
    stopMotions: vi.fn(),
    stopSpeaking: vi.fn(),
    internalModel: {
      coreModel: { setParameterValueById: coreParameter },
      motionManager: {
        expressionManager,
      },
    },
    textures: modelTextures,
  } satisfies Live2DAdapterModel;
  let modelLoadOptions: Parameters<ModelFromSync>[1] | null = null;
  const fromSync =
    options.fromSync ??
    vi.fn<ModelFromSync>((_source, modelOptions) => {
      modelLoadOptions = modelOptions;
      if (!options.deferModelLoad) {
        queueMicrotask(() => {
          if (options.modelLoadError) modelOptions.onError(options.modelLoadError);
          else {
            modelLoaded = true;
            modelOptions.onLoad();
          }
        });
      }
      return model;
    });
  let textureIndex = 0;
  const textureGates = preloadedTextures.map(() => deferred<(typeof preloadedTextures)[number]>());
  const textureFromURL = vi.fn<TextureFromURL>(async () => {
    const index = textureIndex++;
    if (options.textureLoadErrorAt === index) {
      throw new Error(`texture ${index} failed`);
    }
    if (options.deferTextureLoad) return textureGates[index].promise;
    return preloadedTextures[index];
  });
  const removeTextureFromCache = vi.fn<RemoveTextureFromCache>(
    (texture) => texture,
  );
  const adapterModule = {
    Live2DModel: { fromSync },
    Texture: {
      fromURL: textureFromURL,
      removeFromCache: removeTextureFromCache,
    },
  } satisfies Live2DAdapterModule;
  const loadCore = options.loadCore ?? vi.fn<LoadCore>().mockResolvedValue(undefined);
  const verifyAssets =
    options.verifyAssets ?? vi.fn<VerifyAssets>().mockResolvedValue(undefined);
  const loadModule =
    options.loadModule ?? vi.fn<LoadModule>().mockResolvedValue(adapterModule);

  return {
    controller,
    stage,
    ticker,
    jewel,
    transform,
    model: Object.assign(model, {
      anchorSet: model.anchor.set,
      scaleSet: model.scale.set,
      coreParameter,
      resetExpression,
      expressionManager,
    }),
    fromSync,
    loadCore,
    loadModule,
    verifyAssets,
    preloadedTextures,
    textureFromURL,
    removeTextureFromCache,
    completeTextureLoads: () => {
      for (const [index, gate] of textureGates.entries()) {
        gate.resolve(preloadedTextures[index]);
      }
    },
    completeModelLoad: () => {
      modelLoaded = true;
      modelLoadOptions?.onLoad();
    },
    create: () =>
      createLive2DAdapter({
        stage,
        ticker,
        jewel,
        signal: controller.signal,
        loadCore,
        loadModule,
        verifyAssets,
        onRuntimeError: options.onRuntimeError,
        transformSource: transform,
        readViewport: () => options.viewport ?? { width: 800, height: 600 },
      }),
  };
}

class FakeTicker {
  deltaMS = 0;
  readonly listeners = new Set<(deltaTime?: number) => void>();
  readonly add = vi.fn((listener: (deltaTime?: number) => void) => {
    this.listeners.add(listener);
  });
  readonly remove = vi.fn((listener: (deltaTime?: number) => void) => {
    this.listeners.delete(listener);
  });

  tick(deltaMS: number): void {
    this.deltaMS = deltaMS;
    for (const listener of [...this.listeners]) listener(deltaMS / (1000 / 60));
  }
}

class FakeJewel {
  private owned: boolean;
  private leaseToken: object | null;
  private readonly listeners = new Set<() => void>();
  readonly unsubscribe = vi.fn();

  constructor(owned: boolean) {
    this.owned = owned;
    this.leaseToken = owned ? {} : null;
  }

  readonly getSnapshot: Live2DAdapterOptions["jewel"]["getSnapshot"] = () =>
    this.owned
      ? Object.freeze({ ownsLease: true, leaseToken: this.leaseToken! })
      : Object.freeze({ ownsLease: false, leaseToken: null });
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.unsubscribe();
    };
  };
  readonly releaseOwned = vi.fn();

  setOwned(owned: boolean): void {
    if (owned && !this.owned) this.leaseToken = {};
    if (!owned) this.leaseToken = null;
    this.owned = owned;
    for (const listener of [...this.listeners]) listener();
  }

  setOwnedSilently(owned: boolean): void {
    if (owned && !this.owned) this.leaseToken = {};
    if (!owned) this.leaseToken = null;
    this.owned = owned;
  }

  replaceLease(): void {
    this.owned = true;
    this.leaseToken = {};
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeTransformSource implements Live2DTransformSource {
  private snapshot: L2DTransform = L2D_DEFAULT;
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(snapshot: L2DTransform): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
