"use client";

import {
  normalizeLive2DTransform,
  type L2DTransform,
} from "@/lib/live2dStore";

import {
  PresenceVisualInitializationError,
  type PresenceVisualJewelOwnership,
  type PresenceVisualJewelSnapshot,
  type PresenceVisualResource,
  type PresenceVisualSceneMetrics,
  type PresenceVisualSize,
} from "./presence-visual-runtime";
import {
  ensureCubismCore,
  LIVE2D_ASSET_LOCK,
  verifyLive2DAssetInventory,
} from "./live2d-assets";

export interface Live2DAdapterStage {
  readonly addChild: (child: unknown) => unknown;
  readonly removeChild: (child: unknown) => unknown;
}

export type Live2DAdapterTick = number | undefined;

export interface Live2DAdapterTicker {
  readonly deltaMS: number;
  readonly add: (listener: (frame?: Live2DAdapterTick) => void) => unknown;
  readonly remove: (listener: (frame?: Live2DAdapterTick) => void) => unknown;
}

export interface Live2DAdapterTexture {
  readonly baseTexture?: {
    readonly realWidth?: number;
    readonly realHeight?: number;
  };
}

export interface Live2DAdapterOwnedTexture extends Live2DAdapterTexture {
  readonly destroy: (destroyBase?: boolean) => unknown;
}

export interface Live2DAdapterModel {
  readonly anchor: { readonly set: (x: number, y: number) => unknown };
  readonly scale: { readonly set: (value: number) => unknown };
  x: number;
  y: number;
  readonly update: (deltaMS: number) => unknown;
  readonly destroy: (options?: {
    readonly children?: boolean;
    readonly texture?: boolean;
    readonly baseTexture?: boolean;
  }) => unknown;
  readonly expression?: (id?: number | string) => boolean | Promise<boolean>;
  readonly stopMotions?: () => unknown;
  readonly stopSpeaking?: () => unknown;
  readonly internalModel?: {
    readonly coreModel?: {
      readonly setParameterValueById?: (id: string, value: number) => unknown;
    };
    readonly motionManager?: {
      readonly expressionManager?: {
        reserveExpressionIndex: number;
        currentExpression?: unknown;
        readonly defaultExpression?: unknown;
        readonly resetExpression: () => unknown;
      };
    };
  };
  readonly textures?: readonly Live2DAdapterTexture[];
}

export interface Live2DAdapterModule {
  readonly Texture: {
    readonly fromURL: (url: string) => Promise<Live2DAdapterOwnedTexture>;
    readonly removeFromCache: (
      texture: Live2DAdapterOwnedTexture,
    ) => Live2DAdapterOwnedTexture | null;
  };
  readonly Live2DModel: {
    readonly fromSync: (
      source: string,
      options: {
        readonly autoUpdate: false;
        readonly autoHitTest: false;
        readonly autoFocus: false;
        readonly ticker: Live2DAdapterTicker;
        readonly onLoad: () => void;
        readonly onError: (error: Error) => void;
      },
    ) => Live2DAdapterModel;
  };
}

export interface Live2DTransformSource {
  readonly getSnapshot: () => L2DTransform;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface Live2DAdapterOptions {
  readonly stage: Live2DAdapterStage;
  readonly ticker: Live2DAdapterTicker;
  readonly jewel: PresenceVisualJewelOwnership;
  readonly signal: AbortSignal;
  readonly transformSource: Live2DTransformSource;
  readonly readViewport: () => PresenceVisualSize;
  readonly verifyAssets?: (signal: AbortSignal) => void | Promise<void>;
  readonly loadCore?: (signal: AbortSignal) => void | Promise<void>;
  readonly loadModule?: (signal: AbortSignal) =>
    | Live2DAdapterModule
    | Promise<Live2DAdapterModule>;
  readonly onRuntimeError?: (error: unknown) => void;
}

export interface Live2DAdapter extends PresenceVisualResource {
  readonly setExpression: (id: number | string) => Promise<boolean>;
  readonly setMouth: (openness: number) => void;
  readonly refreshTransform: () => void;
  readonly freezeRepresentativeFrame: () => void;
}

const CORE_PATH = "core/live2dcubismcore.min.js";
const DEFAULT_CORE_SRC = `${LIVE2D_ASSET_LOCK.publicBasePath}/${CORE_PATH}`;
const DEFAULT_MODEL_URL = `${LIVE2D_ASSET_LOCK.publicBasePath}/${LIVE2D_ASSET_LOCK.modelEntry}`;
const DEFAULT_TEXTURE_URLS = LIVE2D_ASSET_LOCK.assets
  .filter((asset) => asset.kind === "texture")
  .map((asset) => `${LIVE2D_ASSET_LOCK.publicBasePath}/${asset.path}`);
const MOUTH_PARAMETER = "ParamMouthOpenY";
const MEBIBYTE = 1024 * 1024;
const MODEL_DESTROY_OPTIONS = Object.freeze({
  children: true,
  texture: true,
  baseTexture: true,
});
const destroyedModels = new WeakSet<object>();
const destroyedTextures = new WeakSet<object>();

export async function createLive2DAdapter(
  options: Live2DAdapterOptions,
): Promise<Live2DAdapter> {
  throwIfAborted(options.signal);
  const verifyAssets = options.verifyAssets ?? defaultVerifyAssets;
  const loadCore = options.loadCore ?? defaultLoadCore;
  const loadModule = options.loadModule ?? defaultLoadModule;
  let constructedModel: Live2DAdapterModel | null = null;
  let modelReady: Promise<void> | null = null;
  let preloadedTextures: Live2DAdapterOwnedTexture[] = [];
  let textureModule: Live2DAdapterModule["Texture"] | null = null;
  let texturesTransferred = false;

  try {
    await waitForAbort(Promise.resolve(verifyAssets(options.signal)), options.signal);
    await waitForAbort(Promise.resolve(loadCore(options.signal)), options.signal);
    const adapterModule = await waitForAbort(
      Promise.resolve(loadModule(options.signal)),
      options.signal,
    );
    throwIfAborted(options.signal);
    textureModule = adapterModule.Texture;
    preloadedTextures = await preloadOwnedTextures(adapterModule.Texture, options.signal);
    throwIfAborted(options.signal);
    const modelLoad = beginOwnedModelLoad(
      adapterModule,
      DEFAULT_MODEL_URL,
      options.ticker,
    );
    constructedModel = modelLoad.model;
    modelReady = modelLoad.ready;
    await waitForAbort(modelLoad.ready, options.signal);
    throwIfAborted(options.signal);
    const adapter = attachModel(constructedModel, options);
    texturesTransferred = true;
    constructedModel = null;
    return adapter;
  } catch (error) {
    const aborted = isAbortError(error) || options.signal.aborted;
    if (constructedModel !== null) {
      const model = constructedModel;
      destroyModelSafely(model);
      if (aborted && modelReady !== null) {
        void modelReady.then(
          () => destroyModelSafely(model),
          () => destroyModelSafely(model),
        );
      }
    }
    if (!texturesTransferred && textureModule !== null) {
      destroyTexturesSafely(textureModule, preloadedTextures);
    }
    if (aborted) throw abortError();
    if (error instanceof PresenceVisualInitializationError) throw error;
    throw new PresenceVisualInitializationError(
      "model",
      `Live2D scene initialization failed: ${errorMessage(error)}`,
    );
  }
}

function beginOwnedModelLoad(
  adapterModule: Live2DAdapterModule,
  modelUrl: string,
  ticker: Live2DAdapterTicker,
): { readonly model: Live2DAdapterModel; readonly ready: Promise<void> } {
  let model: Live2DAdapterModel | null = null;
  let loadedBeforeReturn = false;
  let errorBeforeReturn: Error | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  model = adapterModule.Live2DModel.fromSync(modelUrl, {
    autoUpdate: false,
    autoHitTest: false,
    autoFocus: false,
    ticker,
    onLoad: () => {
      if (model === null) loadedBeforeReturn = true;
      else resolveReady();
    },
    onError: (error) => {
      if (model === null) errorBeforeReturn = error;
      else rejectReady(error);
    },
  });

  if (errorBeforeReturn !== null) rejectReady(errorBeforeReturn);
  else if (loadedBeforeReturn) resolveReady();
  return { model, ready };
}

async function preloadOwnedTextures(
  textureModule: Live2DAdapterModule["Texture"],
  signal: AbortSignal,
): Promise<Live2DAdapterOwnedTexture[]> {
  const loaded: Live2DAdapterOwnedTexture[] = [];
  const tasks = DEFAULT_TEXTURE_URLS.map(async (url) => {
    const texture = await textureModule.fromURL(url);
    loaded.push(texture);
    if (signal.aborted) {
      destroyTextureSafely(textureModule, texture);
      throw abortError();
    }
    return texture;
  });

  try {
    await waitForAbort(Promise.all(tasks), signal);
    return loaded;
  } catch (error) {
    destroyTexturesSafely(textureModule, loaded);
    void Promise.allSettled(tasks).then(() => {
      destroyTexturesSafely(textureModule, loaded);
    });
    throw error;
  }
}

function attachModel(
  model: Live2DAdapterModel,
  options: Live2DAdapterOptions,
): Live2DAdapter {
  let destroyed = false;
  let attached = false;
  let frozen = false;
  let desiredMouth = 0;
  let leaseGeneration = 0;
  let expressionRequestGeneration = 0;
  let releaseJewel: (() => void) | null = null;
  let releaseTransform: (() => void) | null = null;
  let tickerAttached = false;

  const resetMouth = (): void => {
    desiredMouth = 0;
    try {
      model.internalModel?.coreModel?.setParameterValueById?.(MOUTH_PARAMETER, 0);
    } catch {
      // A model without the conventional mouth parameter remains usable.
    }
  };

  const resetRepresentativeExpression = (): void => {
    const expressionManager = model.internalModel?.motionManager?.expressionManager;
    if (!expressionManager) return;
    try {
      expressionManager.reserveExpressionIndex = -1;
    } catch {
      // A read-only third-party manager still gets a best-effort reset below.
    }
    try {
      expressionManager.resetExpression();
      if (expressionManager.defaultExpression !== undefined) {
        expressionManager.currentExpression = expressionManager.defaultExpression;
      }
    } catch {
      // Expression support is optional for a valid Live2D shell.
    }
  };

  const refreshTransform = (): void => {
    if (destroyed) return;
    const transform = normalizeLive2DTransform(options.transformSource.getSnapshot());
    const viewport = normalizeViewport(options.readViewport());
    try {
      model.scale.set(transform.scale);
      model.x = viewport.width * (0.5 + transform.x);
      model.y = viewport.height * (0.5 + transform.y);
    } catch {
      // A broken model transform is isolated; the shared runtime remains owner.
    }
  };

  const freezeRepresentativeFrame = (): void => {
    if (destroyed || frozen) return;
    frozen = true;
    resetMouth();
    resetRepresentativeExpression();
    try {
      model.stopSpeaking?.();
    } catch {
      // Optional model capability.
    }
    try {
      model.stopMotions?.();
    } catch {
      // Optional model capability.
    }
  };

  let leaseToken = readLeaseToken(options.jewel.getSnapshot());
  const synchronizeLease = (): void => {
    const nextLeaseToken = readLeaseToken(options.jewel.getSnapshot());
    if (Object.is(nextLeaseToken, leaseToken)) return;
    if (leaseToken !== null) {
      frozen = false;
      freezeRepresentativeFrame();
    }
    leaseToken = nextLeaseToken;
    leaseGeneration += 1;
    if (leaseToken !== null) frozen = false;
    else freezeRepresentativeFrame();
  };

  const failRuntime = (error: unknown): void => {
    freezeRepresentativeFrame();
    try {
      if (leaseToken !== null) {
        options.jewel.releaseOwned("initialization-failed", leaseToken);
      }
    } catch {
      // The frozen model is already fail-closed even if lease release is unavailable.
    }
    try {
      options.onRuntimeError?.(error);
    } catch {
      // Observational fault callbacks cannot re-enter the shared ticker.
    }
  };

  const tick = (): void => {
    if (destroyed) return;
    synchronizeLease();
    if (leaseToken === null || frozen) return;
    refreshTransform();
    try {
      model.internalModel?.coreModel?.setParameterValueById?.(
        MOUTH_PARAMETER,
        desiredMouth,
      );
    } catch {
      // Mouth animation is optional; model animation may continue under the lease.
    }
    try {
      model.update(readDeltaMS(options.ticker.deltaMS));
    } catch (error) {
      failRuntime(error);
    }
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    options.signal.removeEventListener("abort", destroy);
    releaseTransform?.();
    releaseTransform = null;
    releaseJewel?.();
    releaseJewel = null;
    if (tickerAttached) {
      tickerAttached = false;
      try {
        options.ticker.remove(tick);
      } catch {
        // The model and stage must still be released.
      }
    }
    resetMouth();
    if (attached) {
      attached = false;
      try {
        options.stage.removeChild(model);
      } catch {
        // The model still owns resources even if the stage adapter is already gone.
      }
    }
    destroyModelSafely(model);
  };

  try {
    options.stage.addChild(model);
    attached = true;
    throwIfAborted(options.signal);
    model.anchor.set(0.5, 0.5);
    refreshTransform();
    releaseTransform = options.transformSource.subscribe(refreshTransform);
    releaseJewel = options.jewel.subscribe(synchronizeLease);
    options.ticker.add(tick);
    tickerAttached = true;
    options.signal.addEventListener("abort", destroy, { once: true });
    if (leaseToken === null) freezeRepresentativeFrame();
    throwIfAborted(options.signal);
  } catch (error) {
    destroy();
    throw error;
  }

  const setExpression = async (id: number | string): Promise<boolean> => {
    synchronizeLease();
    if (destroyed || leaseToken === null || frozen || !model.expression) {
      return false;
    }
    const expressionLeaseGeneration = leaseGeneration;
    const expressionLeaseToken = leaseToken;
    const expressionRequest = ++expressionRequestGeneration;
    try {
      const applied = await model.expression(id);
      const valid =
        !destroyed &&
        applied === true &&
        expressionLeaseGeneration === leaseGeneration &&
        Object.is(expressionLeaseToken, readLeaseToken(options.jewel.getSnapshot()));
      if (!valid && expressionRequest === expressionRequestGeneration) {
        resetRepresentativeExpression();
      }
      return valid;
    } catch {
      if (expressionRequest === expressionRequestGeneration) {
        resetRepresentativeExpression();
      }
      return false;
    }
  };

  const setMouth = (openness: number): void => {
    synchronizeLease();
    if (destroyed || leaseToken === null || frozen) {
      resetMouth();
      return;
    }
    desiredMouth = Number.isFinite(openness)
      ? Math.min(1, Math.max(0, openness))
      : 0;
  };

  const readMetrics = (): PresenceVisualSceneMetrics =>
    readTextureMetrics(model.textures);

  return Object.freeze({
    destroy,
    readMetrics,
    setExpression,
    setMouth,
    refreshTransform,
    freezeRepresentativeFrame,
  });
}

async function defaultLoadCore(signal: AbortSignal): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("Cubism Core requires a browser document.");
  }
  await ensureCubismCore({
    document,
    global: globalThis as { Live2DCubismCore?: unknown },
    src: DEFAULT_CORE_SRC,
    signal,
  });
}

async function defaultVerifyAssets(signal: AbortSignal): Promise<void> {
  const inventory = await verifyLive2DAssetInventory(LIVE2D_ASSET_LOCK, { signal });
  if (!inventory.ready) {
    const failures = [...inventory.missing, ...inventory.mismatched].slice(0, 4);
    throw new Error(
      `Local Live2D assets failed integrity preflight: ${failures.join(", ")}.`,
    );
  }
}

async function defaultLoadModule(): Promise<Live2DAdapterModule> {
  const [adapterModule, pixiCore] = await Promise.all([
    import("pixi-live2d-display-lipsyncpatch/cubism4"),
    import("@pixi/core"),
  ]);
  return {
    Live2DModel: adapterModule.Live2DModel,
    Texture: pixiCore.Texture,
  } as unknown as Live2DAdapterModule;
}

function readLeaseToken(
  snapshot: PresenceVisualJewelSnapshot,
): object | string | number | null {
  if (!snapshot.ownsLease) return null;
  return snapshot.leaseToken;
}

function readDeltaMS(tickerDelta: number): number {
  return Number.isFinite(tickerDelta) && tickerDelta >= 0 ? tickerDelta : 0;
}

function normalizeViewport(viewport: PresenceVisualSize): PresenceVisualSize {
  return {
    width:
      Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 0,
    height:
      Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 0,
  };
}

function readTextureMetrics(
  textures: readonly Live2DAdapterTexture[] | undefined,
): PresenceVisualSceneMetrics {
  if (!textures || textures.length === 0) return Object.freeze({});
  const seen = new Set<object>();
  let decodedBytes = 0;

  for (const texture of textures) {
    const base = texture.baseTexture;
    if (!base || seen.has(base)) continue;
    const width = base.realWidth;
    const height = base.realHeight;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    seen.add(base);
    decodedBytes += width * height * 4;
  }

  return decodedBytes > 0
    ? Object.freeze({ decodedTextureMiB: decodedBytes / MEBIBYTE })
    : Object.freeze({});
}

function destroyModelSafely(model: Live2DAdapterModel): void {
  if (destroyedModels.has(model)) return;
  try {
    model.destroy(MODEL_DESTROY_OPTIONS);
    destroyedModels.add(model);
  } catch {
    // A half-loaded third-party model may throw until its ready/error settlement.
  }
}

function destroyTexturesSafely(
  textureModule: Live2DAdapterModule["Texture"],
  textures: readonly Live2DAdapterOwnedTexture[],
): void {
  for (const texture of textures) destroyTextureSafely(textureModule, texture);
}

function destroyTextureSafely(
  textureModule: Live2DAdapterModule["Texture"],
  texture: Live2DAdapterOwnedTexture,
): void {
  if (destroyedTextures.has(texture)) return;
  destroyedTextures.add(texture);
  try {
    textureModule.removeFromCache(texture);
  } catch {
    // Cache ownership is advisory; the texture handle is still destroyed below.
  }
  try {
    texture.destroy(true);
  } catch {
    // One failed texture cannot prevent cleanup of the remaining owned handles.
  }
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The Live2D adapter load was aborted.", "AbortError");
  }
  const error = new Error("The Live2D adapter load was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
