"use client";

import {
  presenceControllerOwner,
  type PresenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";
import type { PresenceControllerSnapshot } from "@/features/presence/controller/create-presence-controller";
import { live2DTransformSource } from "@/lib/live2dStore";

import {
  createJewelOwnership,
  jewelRuntime,
  type JewelRuntime,
  type JewelRuntimeSnapshot,
} from "./jewel-runtime";
import {
  createLive2DAdapter as createDefaultLive2DAdapter,
  type Live2DAdapter,
  type Live2DAdapterOptions,
  type Live2DAdapterStage,
  type Live2DAdapterTicker,
  type Live2DTransformSource,
} from "./live2d-adapter";
import {
  PresenceVisualInitializationError,
  type PresenceVisualResource,
  type PresenceVisualSceneContext,
  type PresenceVisualSceneMetrics,
  type PresenceVisualSize,
} from "./presence-visual-runtime";
import {
  createSoulLensPass as createDefaultSoulLensPass,
  type SoulLensPass,
  type SoulLensPassOptions,
  type SoulLensStage,
  type SoulLensTicker,
  type SoulLensTruthSnapshot,
  type SoulLensTruthSource,
} from "./soul-lens-pass";

export interface PresenceVisualPresenceSource {
  readonly getSnapshot: () => PresenceControllerSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface PresenceVisualSceneOptions {
  readonly jewelRuntime?: JewelRuntime;
  readonly presenceSource?: PresenceVisualPresenceSource;
  readonly transformSource?: Live2DTransformSource;
  readonly createLensPass?: (
    options: SoulLensPassOptions,
  ) => SoulLensPass | Promise<SoulLensPass>;
  readonly createLive2DAdapter?: (
    options: Live2DAdapterOptions,
  ) => Live2DAdapter | Promise<Live2DAdapter>;
}

const UNPROVIDED_PROVENANCE = Object.freeze({ kind: "unprovided" as const });
const REST_ENDPOINT = Object.freeze({ kind: "rest" as const });

export function createSoulLensTruthSource(
  runtime: JewelRuntime,
  presence: PresenceVisualPresenceSource,
): SoulLensTruthSource {
  let snapshot = deriveTruth(runtime.getSnapshot(), presence.getSnapshot());

  const refresh = (): SoulLensTruthSnapshot => {
    const next = deriveTruth(runtime.getSnapshot(), presence.getSnapshot());
    if (sameTruth(snapshot, next)) return snapshot;
    snapshot = next;
    return snapshot;
  };

  return Object.freeze({
    getSnapshot: refresh,
    subscribe: (listener: () => void) => {
      let previous = refresh();
      const notify = () => {
        const next = refresh();
        if (next === previous) return;
        previous = next;
        listener();
      };
      let releaseRuntime: (() => void) | null = null;
      let releasePresence: (() => void) | null = null;
      try {
        releaseRuntime = runtime.subscribe(notify);
        releasePresence = presence.subscribe(notify);
      } catch (error) {
        releasePresence?.();
        releaseRuntime?.();
        throw error;
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        releasePresence?.();
        releaseRuntime?.();
      };
    },
  });
}

export async function initializePresenceVisualScene(
  context: PresenceVisualSceneContext,
  options: PresenceVisualSceneOptions = {},
): Promise<PresenceVisualResource> {
  const runtime = options.jewelRuntime ?? jewelRuntime;
  const presence =
    options.presenceSource ??
    (presenceControllerOwner as PresenceControllerOwner & PresenceVisualPresenceSource);
  const transformSource = options.transformSource ?? live2DTransformSource;
  const createLensPass = options.createLensPass ?? createDefaultSoulLensPass;
  const createLive2DAdapter =
    options.createLive2DAdapter ?? createDefaultLive2DAdapter;
  const stage = requireStage(context.application.stage);
  const ticker = requireTicker(context.application.ticker);
  const lensOwnership = createJewelOwnership(runtime, ["soulLens"]);
  const live2dOwnership = createJewelOwnership(runtime, ["live2d"]);
  const truthSource = createSoulLensTruthSource(runtime, presence);
  let lens: SoulLensPass | null = null;
  let live2d: Live2DAdapter | null = null;
  let phase: "pass" | "model" = "pass";

  try {
    lens = await createLensPass({
      stage,
      ticker,
      jewel: lensOwnership,
      truthSource,
      readViewport: context.readViewport,
      signal: context.signal,
    });
    context.registerResource(lens);
    phase = "model";
    live2d = await createLive2DAdapter({
      stage,
      ticker,
      jewel: live2dOwnership,
      signal: context.signal,
      transformSource,
      readViewport: context.readViewport,
    });
    throwIfAborted(context.signal);
  } catch (error) {
    safely(() => live2d?.destroy());
    safely(() => lens?.destroy());
    if (isAbortError(error) || context.signal.aborted) throw abortError();
    if (error instanceof PresenceVisualInitializationError) throw error;
    throw new PresenceVisualInitializationError(
      phase,
      `Presence visual ${phase} initialization failed: ${errorMessage(error)}`,
    );
  }

  const ownedLens = lens;
  const ownedLive2D = live2d;
  let destroyed = false;

  return Object.freeze({
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // Reverse construction order: model first, analytical pass second.
      safely(() => ownedLive2D.destroy());
      safely(() => ownedLens.destroy());
    },
    resize: (size: PresenceVisualSize) => {
      if (destroyed) return;
      ownedLens.resize(size);
      ownedLive2D.refreshTransform();
    },
    readMetrics: () => readMeasuredSceneMetrics(ownedLive2D),
  });
}

function deriveTruth(
  jewel: JewelRuntimeSnapshot,
  presence: PresenceControllerSnapshot,
): SoulLensTruthSnapshot {
  const modelKey = normalizeNonblank(presence.status?.model);
  const activeLens = jewel.lease;
  const endpoint =
    activeLens?.owner === "soulLens" &&
    activeLens.mode === "streamStage" &&
    isNonblank(activeLens.traceId) &&
    isNonblank(activeLens.semanticEnd)
      ? Object.freeze({
          kind: "stage" as const,
          traceId: activeLens.traceId,
          stage: activeLens.semanticEnd,
        })
      : jewel.endpoint.kind === "stage"
        ? Object.freeze({
            kind: "stage" as const,
            traceId: jewel.endpoint.traceId,
            stage: jewel.endpoint.stage,
          })
        : REST_ENDPOINT;

  return Object.freeze({
    modelKey,
    provenance: UNPROVIDED_PROVENANCE,
    endpoint,
  });
}

function sameTruth(
  left: SoulLensTruthSnapshot,
  right: SoulLensTruthSnapshot,
): boolean {
  return (
    left.modelKey === right.modelKey &&
    left.provenance === right.provenance &&
    left.endpoint.kind === right.endpoint.kind &&
    (left.endpoint.kind === "rest" ||
      (right.endpoint.kind === "stage" &&
        left.endpoint.traceId === right.endpoint.traceId &&
        left.endpoint.stage === right.endpoint.stage))
  );
}

function requireStage(value: unknown): SoulLensStage & Live2DAdapterStage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("addChild" in value) ||
    typeof value.addChild !== "function" ||
    !("removeChild" in value) ||
    typeof value.removeChild !== "function"
  ) {
    throw new PresenceVisualInitializationError(
      "pass",
      "Presence visual stage does not expose addChild/removeChild.",
    );
  }
  return value as SoulLensStage & Live2DAdapterStage;
}

function requireTicker(value: unknown): SoulLensTicker & Live2DAdapterTicker {
  if (
    typeof value !== "object" ||
    value === null ||
    !("deltaMS" in value) ||
    typeof value.deltaMS !== "number" ||
    !("add" in value) ||
    typeof value.add !== "function" ||
    !("remove" in value) ||
    typeof value.remove !== "function"
  ) {
    throw new PresenceVisualInitializationError(
      "pass",
      "Presence visual ticker does not expose deltaMS/add/remove.",
    );
  }
  return value as SoulLensTicker & Live2DAdapterTicker;
}

function readMeasuredSceneMetrics(
  live2d: Live2DAdapter,
): PresenceVisualSceneMetrics {
  let measured: PresenceVisualSceneMetrics | undefined;
  try {
    measured = live2d.readMetrics?.();
  } catch {
    return Object.freeze({});
  }
  if (measured === undefined) return Object.freeze({});
  const result: {
    gpuMemoryMiB?: number;
    decodedTextureMiB?: number;
  } = {};
  if (isNonnegativeFinite(measured.gpuMemoryMiB)) {
    result.gpuMemoryMiB = measured.gpuMemoryMiB;
  }
  if (isNonnegativeFinite(measured.decodedTextureMiB)) {
    result.decodedTextureMiB = measured.decodedTextureMiB;
  }
  // Live2D part count is not known here. Reporting the Lens's one draw call as
  // a whole-scene total would be fabricated telemetry.
  return Object.freeze(result);
}

function isNonnegativeFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function normalizeNonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safely(action: () => unknown): void {
  try {
    action();
  } catch {
    // Cleanup of one adapter cannot prevent cleanup of the other.
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
