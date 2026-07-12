"use client";

import {
  PresenceVisualInitializationError,
  type PresenceVisualJewelOwnership,
  type PresenceVisualJewelToken,
  type PresenceVisualResource,
  type PresenceVisualSceneMetrics,
  type PresenceVisualSize,
} from "./presence-visual-runtime";
import {
  SOUL_LENS_FRAGMENT_SHADER,
  SOUL_LENS_VERTEX_SHADER,
} from "./soul-lens-shader";

export type SoulLensEndpoint =
  | Readonly<{ kind: "rest" }>
  | Readonly<{ kind: "stage"; traceId: string; stage: string }>;

export interface SoulLensTruthSnapshot {
  readonly modelKey: string | null;
  readonly provenance: Readonly<{ kind: "unprovided" }>;
  readonly endpoint: SoulLensEndpoint;
}

export interface SoulLensTruthSource {
  readonly getSnapshot: () => SoulLensTruthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface SoulLensStage {
  readonly addChild: (child: unknown) => unknown;
  readonly removeChild: (child: unknown) => unknown;
}

export interface SoulLensTicker {
  readonly deltaMS: number;
  readonly add: (listener: () => void) => unknown;
  readonly remove: (listener: () => void) => unknown;
}

export interface SoulLensGeometry {
  readonly addAttribute: (
    id: string,
    buffer: Float32Array,
    size: number,
  ) => SoulLensGeometry;
  readonly addIndex: (buffer: Uint16Array) => unknown;
  readonly destroy: () => unknown;
}

export interface SoulLensShader {
  readonly uniforms: Record<string, unknown>;
  readonly destroy: () => unknown;
}

export interface SoulLensMesh {
  size: number;
  eventMode: string;
  visible: boolean;
  readonly destroy: () => unknown;
}

export interface SoulLensPixiModule {
  readonly Geometry: new () => SoulLensGeometry;
  readonly Shader: {
    readonly from: (
      vertex: string,
      fragment: string,
      uniforms: Record<string, unknown>,
    ) => SoulLensShader;
  };
  readonly Mesh: new (
    geometry: SoulLensGeometry,
    shader: SoulLensShader,
    state: undefined,
    drawMode: number,
  ) => SoulLensMesh;
  readonly DRAW_MODES: Readonly<{ TRIANGLES: number }>;
}

export interface SoulLensTopology {
  readonly vertices: 4;
  readonly indices: 6;
  readonly triangles: 2;
  readonly passes: 1;
  readonly drawCalls: 1;
  readonly textureBytes: 0;
  readonly renderTargetBytes: 0;
}

export interface SoulLensPass extends PresenceVisualResource {
  readonly readTopology: () => SoulLensTopology;
  readonly resize: (size: PresenceVisualSize) => void;
}

export interface SoulLensPassOptions {
  readonly stage: SoulLensStage;
  readonly ticker: SoulLensTicker;
  readonly jewel: PresenceVisualJewelOwnership;
  readonly truthSource: SoulLensTruthSource;
  readonly readViewport: () => PresenceVisualSize;
  readonly signal: AbortSignal;
  readonly readMaterial?: () => "dark" | "light";
  readonly loadPixi?: (
    signal: AbortSignal,
  ) => SoulLensPixiModule | Promise<SoulLensPixiModule>;
}

const QUAD_POSITIONS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
const TOPOLOGY: SoulLensTopology = Object.freeze({
  vertices: 4,
  indices: 6,
  triangles: 2,
  passes: 1,
  drawCalls: 1,
  textureBytes: 0,
  renderTargetBytes: 0,
});
const LENS_METRICS: PresenceVisualSceneMetrics = Object.freeze({ drawCalls: 1 });
const MAX_FRAME_DELTA_MS = 50;

interface SoulLensUniforms extends Record<string, unknown> {
  uViewport: Float32Array;
  uTime: number;
  uMotion: number;
  uStageSignature: Float32Array;
  uModelSignature: Float32Array;
  uModelPresent: number;
  uProvenanceState: 0;
  uLightMaterial: number;
}

export async function createSoulLensPass(
  options: SoulLensPassOptions,
): Promise<SoulLensPass> {
  throwIfAborted(options.signal);
  const loadPixi = options.loadPixi ?? loadDefaultPixi;
  const readMaterial = options.readMaterial ?? readDocumentMaterial;
  let geometry: SoulLensGeometry | null = null;
  let shader: SoulLensShader | null = null;
  let mesh: SoulLensMesh | null = null;
  let attached = false;
  let tickerAttached = false;
  let releaseTruth: (() => void) | null = null;
  let releaseJewel: (() => void) | null = null;
  let destroyed = false;
  let cleanupComplete = false;
  let tickerListener: (() => void) | null = null;
  let abortListener: (() => void) | null = null;

  const cleanup = (): void => {
    if (cleanupComplete) return;
    cleanupComplete = true;
    destroyed = true;
    if (abortListener !== null) {
      options.signal.removeEventListener("abort", abortListener);
      abortListener = null;
    }
    if (tickerAttached && tickerListener !== null) {
      tickerAttached = false;
      safely(() => options.ticker.remove(tickerListener as () => void));
    }
    const ownedJewelRelease = releaseJewel;
    releaseJewel = null;
    if (ownedJewelRelease !== null) safely(ownedJewelRelease);
    const ownedTruthRelease = releaseTruth;
    releaseTruth = null;
    if (ownedTruthRelease !== null) safely(ownedTruthRelease);
    if (attached && mesh !== null) {
      attached = false;
      safely(() => options.stage.removeChild(mesh));
    }
    if (mesh !== null) safely(() => mesh?.destroy());
    if (shader !== null) safely(() => shader?.destroy());
    if (geometry !== null) safely(() => geometry?.destroy());
  };

  try {
    const pixi = await waitForAbort(
      Promise.resolve(loadPixi(options.signal)),
      options.signal,
    );
    throwIfAborted(options.signal);

    let pendingViewport = viewportVector(options.readViewport());
    let pendingMaterial = normalizeMaterial(readMaterial());
    const uniforms: SoulLensUniforms = {
      uViewport: new Float32Array(pendingViewport),
      uTime: 0,
      uMotion: 0,
      uStageSignature: new Float32Array([0, 0]),
      uModelSignature: new Float32Array([0, 0]),
      uModelPresent: 0,
      uProvenanceState: 0,
      uLightMaterial: pendingMaterial === "light" ? 1 : 0,
    };

    geometry = new pixi.Geometry();
    geometry
      .addAttribute("aVertexPosition", new Float32Array(QUAD_POSITIONS), 2)
      .addIndex(new Uint16Array(QUAD_INDICES));
    shader = pixi.Shader.from(
      SOUL_LENS_VERTEX_SHADER,
      SOUL_LENS_FRAGMENT_SHADER,
      uniforms,
    );
    mesh = new pixi.Mesh(
      geometry,
      shader,
      undefined,
      pixi.DRAW_MODES.TRIANGLES,
    );
    mesh.size = QUAD_INDICES.length;
    mesh.eventMode = "none";

    let leaseToken = readLeaseToken(options.jewel.getSnapshot());
    let pendingModelKey: string | null = null;
    let pendingEndpoint: SoulLensEndpoint = Object.freeze({ kind: "rest" });
    let appliedModelKey: string | null = null;
    let appliedEndpointKey = "rest";

    const applyPendingTruth = (): void => {
      if (pendingModelKey !== appliedModelKey) {
        appliedModelKey = pendingModelKey;
        writeSignature(
          uniforms.uModelSignature,
          appliedModelKey,
          0x811c9dc5,
        );
        uniforms.uModelPresent = appliedModelKey === null ? 0 : 1;
      }
      const nextEndpointKey = serializeEndpoint(pendingEndpoint);
      if (nextEndpointKey !== appliedEndpointKey) {
        appliedEndpointKey = nextEndpointKey;
        writeSignature(
          uniforms.uStageSignature,
          pendingEndpoint.kind === "stage" ? pendingEndpoint.stage : null,
          0x9e3779b1,
        );
      }
      uniforms.uViewport[0] = pendingViewport[0];
      uniforms.uViewport[1] = pendingViewport[1];
      uniforms.uLightMaterial = pendingMaterial === "light" ? 1 : 0;
      // The backend exposes no provenance projection. This value cannot be
      // promoted by model or stage changes.
      uniforms.uProvenanceState = 0;
    };

    const synchronizeTruth = (): void => {
      if (destroyed) return;
      const truth = options.truthSource.getSnapshot();
      pendingModelKey = normalizeNonblank(truth.modelKey);
      pendingEndpoint = truth.endpoint;
      if (leaseToken !== null) applyPendingTruth();
      else if (mesh !== null) mesh.visible = pendingEndpoint.kind === "stage";
    };

    const synchronizeLease = (): void => {
      if (destroyed || mesh === null) return;
      const nextToken = readLeaseToken(options.jewel.getSnapshot());
      if (Object.is(nextToken, leaseToken)) return;
      synchronizeTruth();
      leaseToken = nextToken;
      if (leaseToken !== null) {
        pendingMaterial = normalizeMaterial(readMaterial());
        applyPendingTruth();
        uniforms.uTime = 0;
      }
      uniforms.uMotion = leaseToken === null ? 0 : 1;
      mesh.visible = leaseToken !== null || pendingEndpoint.kind === "stage";
    };

    const failClosed = (error: unknown): void => {
      uniforms.uMotion = 0;
      if (mesh !== null) mesh.visible = false;
      if (leaseToken === null) return;
      try {
        options.jewel.releaseOwned("initialization-failed", leaseToken);
      } catch {
        // The pass is already frozen; cleanup remains owned by the scene.
      }
      void error;
    };

    const tick = (): void => {
      if (destroyed) return;
      try {
        synchronizeLease();
        if (leaseToken === null) return;
        const deltaMS = normalizeDelta(options.ticker.deltaMS);
        const nextMaterial = normalizeMaterial(readMaterial());
        if (nextMaterial !== pendingMaterial) {
          pendingMaterial = nextMaterial;
          applyPendingTruth();
        }
        uniforms.uTime += deltaMS / 1_000;
        uniforms.uMotion = 1;
      } catch (error) {
        failClosed(error);
      }
    };

    synchronizeTruth();
    uniforms.uMotion = leaseToken === null ? 0 : 1;
    mesh.visible = leaseToken !== null;
    options.stage.addChild(mesh);
    attached = true;
    throwIfAborted(options.signal);
    releaseTruth = options.truthSource.subscribe(() => {
      try {
        synchronizeTruth();
      } catch (error) {
        failClosed(error);
      }
    });
    releaseJewel = options.jewel.subscribe(synchronizeLease);
    tickerListener = tick;
    options.ticker.add(tickerListener);
    tickerAttached = true;
    abortListener = cleanup;
    options.signal.addEventListener("abort", abortListener, { once: true });
    throwIfAborted(options.signal);

    return Object.freeze({
      destroy: cleanup,
      readMetrics: () => LENS_METRICS,
      readTopology: () => TOPOLOGY,
      resize: (size: PresenceVisualSize) => {
        if (destroyed) return;
        pendingViewport = viewportVector(size);
        if (leaseToken !== null) applyPendingTruth();
      },
    });
  } catch (error) {
    cleanup();
    if (isAbortError(error) || options.signal.aborted) throw abortError();
    if (error instanceof PresenceVisualInitializationError) throw error;
    throw new PresenceVisualInitializationError(
      "pass",
      `Soul Lens pass initialization failed: ${errorMessage(error)}`,
    );
  }
}

async function loadDefaultPixi(): Promise<SoulLensPixiModule> {
  const pixi = await import("pixi.js");
  return pixi as unknown as SoulLensPixiModule;
}

function readLeaseToken(
  snapshot: ReturnType<PresenceVisualJewelOwnership["getSnapshot"]>,
): PresenceVisualJewelToken | null {
  return snapshot.ownsLease ? snapshot.leaseToken : null;
}

function normalizeDelta(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_FRAME_DELTA_MS);
}

function normalizeMaterial(value: unknown): "dark" | "light" {
  return value === "light" ? "light" : "dark";
}

function readDocumentMaterial(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function viewportVector(size: PresenceVisualSize): Float32Array {
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
  return new Float32Array([width, height]);
}

function serializeEndpoint(endpoint: SoulLensEndpoint): string {
  return endpoint.kind === "stage"
    ? `stage\u0000${endpoint.traceId}\u0000${endpoint.stage}`
    : "rest";
}

function normalizeNonblank(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function writeSignature(
  target: Float32Array,
  value: string | null,
  seed: number,
): void {
  if (value === null) {
    target[0] = 0;
    target[1] = 0;
    return;
  }
  target[0] = hashUnit(value, seed);
  target[1] = hashUnit(value, seed ^ 0x85ebca6b);
}

function hashUnit(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0xffffffff;
}

function safely(action: () => unknown): void {
  try {
    action();
  } catch {
    // Every resource still receives its own cleanup attempt.
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
