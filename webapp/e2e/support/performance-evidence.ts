import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { Page } from "@playwright/test";

import evidenceSchema from "../evidence.schema.json";
import rawEvidenceSchema from "./presence-raw-evidence.schema.json";
import {
  AUTOMATED_METRIC_IDS,
  FIXED_HARDWARE_CERTIFICATION_IDS,
  MANUAL_CERTIFICATION_IDS,
  type AutomatedMetricId,
  type CertificationEvidence,
  type PresenceEvidence,
  type PresenceProfile,
  type PresenceRenderPath,
} from "./budget-evaluator";

export type PresenceMetricSamples = Record<
  Exclude<AutomatedMetricId, "inactive-raf-count">,
  readonly number[]
>;
export type InactiveRafStateId =
  | "reduced-motion"
  | "paused"
  | "offscreen"
  | "hidden";
export type InactiveRafStateInput =
  | { readonly status: "measured"; readonly samples: readonly number[]; readonly notes?: string }
  | { readonly status: "unsupported" | "not-run"; readonly notes: string };
export type InactiveRafStateInputs = Readonly<Record<InactiveRafStateId, InactiveRafStateInput>>;

export interface PresenceEvidenceEnvironment {
  readonly browser: string;
  readonly os: string;
  readonly cpu?: string;
  readonly gpu?: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly throttle: string;
}

export interface DynamicCertification {
  readonly status: CertificationEvidence["status"];
  readonly notes?: string;
}

export interface BuildPresenceEvidenceOptions {
  readonly profile: PresenceProfile;
  readonly renderPath: PresenceRenderPath;
  readonly capturedAt?: string;
  readonly environment: PresenceEvidenceEnvironment;
  readonly samples: Partial<PresenceMetricSamples>;
  readonly inactiveRafStates: InactiveRafStateInputs;
  readonly unavailable?: Partial<
    Record<
      AutomatedMetricId,
      {
        readonly status: "unsupported" | "not-run" | "not-applicable";
        readonly notes: string;
      }
    >
  >;
  readonly dynamicCertification: DynamicCertification;
  readonly fixedHardware?: readonly CertificationEvidence[];
  readonly manual?: readonly CertificationEvidence[];
}

export interface TransferResourceSample {
  readonly name: string;
  readonly transferSize: number;
}

export interface VisualTransferClassification {
  readonly baselineResources?: readonly TransferResourceSample[];
  readonly manifestVisualChunkPaths?: readonly string[];
}

export interface PresenceSoakEvidence {
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly heap: {
    readonly status: "measured" | "unsupported" | "not-run";
    readonly unit: "bytes";
    readonly samples: readonly number[];
    readonly postGcGrowthBytes: number | null;
    readonly limitBytes: number;
    readonly comparator: "less-than";
    readonly notes?: string;
  };
}

export interface PresenceProbeCapabilityState {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly observed: boolean;
}

export interface PresenceRawDiagnosticsEvidence {
  readonly schemaVersion: "1.0.0";
  readonly profile: PresenceProfile;
  readonly renderPath: PresenceRenderPath;
  readonly capturedAt: string;
  readonly probe: PresencePerformanceProbeSnapshot;
}

export interface PresencePerformanceProbeSnapshot {
  readonly support: {
    readonly raf: PresenceProbeCapabilityState;
    readonly canvas: PresenceProbeCapabilityState;
    readonly webgl: PresenceProbeCapabilityState;
    readonly longTask: PresenceProbeCapabilityState;
    readonly largestContentfulPaint: PresenceProbeCapabilityState;
    readonly eventTiming: PresenceProbeCapabilityState;
    readonly layoutShift: PresenceProbeCapabilityState;
  };
  readonly environment: {
    readonly platform: string;
    readonly hardwareConcurrency: number;
    readonly devicePixelRatio: number;
  };
  readonly raf: {
    readonly active: number;
    readonly maxActive: number;
    readonly samples: readonly number[];
    readonly cadenceMs: readonly number[];
    readonly callbackDurationMs: readonly number[];
    readonly missedTicks: readonly number[];
    readonly schedulerStacks: readonly {
      readonly stack: string;
      readonly classification: "pixi-application" | "application" | "other";
    }[];
    readonly scheduler: {
      readonly status: "measured" | "unsupported" | "not-applicable";
      readonly renderPath: "dynamic" | "static";
      readonly applicationOwnsSharedTicker: boolean | null;
      readonly applicationRootCount: number | null;
      readonly applicationTickerListenerCount: number | null;
      readonly sharedTickerListenerCount: number | null;
      readonly sharedTickerRafCount: number | null;
      readonly provenance:
        | "production-runtime-telemetry"
        | "telemetry-unavailable"
        | "no-renderer";
      readonly notes?: string;
    };
    readonly inactiveWindows: Readonly<
      Record<
        InactiveRafStateId,
        | {
            readonly status: "measured";
            readonly startTime: number;
            readonly endTime: number;
            readonly samples: readonly number[];
          }
        | {
            readonly status: "unsupported" | "not-run";
            readonly notes: string;
          }
      >
    >;
  };
  readonly webgl: {
    readonly contextCountSamples: readonly number[];
    readonly successfulContextCreationSamples: readonly number[];
    readonly drawCallSamples: readonly number[];
    readonly triangleSamples: readonly number[];
    readonly textureRtByteSamples: readonly number[];
  };
  readonly canvasDprSamples: readonly number[];
  readonly canvasBackingSizeSamples: readonly {
    readonly backingWidth: number;
    readonly backingHeight: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly dpr: number;
  }[];
  readonly longTaskDurationMs: readonly number[];
  readonly longTasks: readonly {
    readonly name: string;
    readonly startTime: number;
    readonly duration: number;
    readonly attribution: readonly {
      readonly name: string;
      readonly containerType: string;
      readonly containerName: string;
      readonly containerId: string;
      readonly containerSrc: string;
    }[];
  }[];
  readonly longTaskWindow: {
    readonly startTime: number | null;
    readonly endTime: number;
  };
  readonly performance: {
    readonly lcpMs: readonly number[];
    readonly inpMs: readonly number[];
    readonly clsSamples: readonly number[];
    readonly tbtMs: readonly number[];
  };
  readonly resources: readonly {
    readonly name: string;
    readonly initiatorType: string;
    readonly transferSize: number;
    readonly encodedBodySize: number;
    readonly decodedBodySize: number;
    readonly duration: number;
  }[];
  readonly dom: {
    readonly activeJewelCountSamples: readonly number[];
    readonly visualPhase: string | null;
    readonly canvasCount: number;
  };
}

const METRIC_UNITS: Readonly<Record<AutomatedMetricId, string>> = Object.freeze({
  "webgl-context-count": "count",
  "active-raf-count": "count",
  "inactive-raf-count": "count",
  "device-pixel-ratio": "ratio",
  "draw-calls": "count",
  triangles: "count",
  "texture-rt-bytes": "bytes",
  "visual-transfer-bytes": "bytes",
  "active-jewel-count": "count",
  "lens-gzip-bytes": "bytes",
  "stream-long-task-duration-ms": "milliseconds",
});

const DEFAULT_FIXED_HARDWARE: readonly CertificationEvidence[] = Object.freeze([
  Object.freeze({
    id: "visual-js-frame-p95",
    status: "not-run",
    notes: "Requires the declared fixed-hardware callback-duration profile.",
  }),
  Object.freeze({
    id: "visual-cadence",
    status: "not-run",
    notes: "Requires the declared fixed-hardware 30fps/24fps cadence profile.",
  }),
  Object.freeze({
    id: "cwv-fixed-profile",
    status: "not-run",
    notes: "Requires a declared fixed-hardware cold/warm profile.",
  }),
  Object.freeze({
    id: "gpu-timing",
    status: "unsupported",
    notes: "GPU timer and Spector evidence are not exposed by the default browser run.",
  }),
  Object.freeze({
    id: "thirty-minute-soak",
    status: "not-run",
    notes: "Run only through the opt-in Presence soak profile.",
  }),
]);

const DEFAULT_MANUAL: readonly CertificationEvidence[] = Object.freeze([
  Object.freeze({ id: "real-soft-keyboard", status: "not-run" }),
  Object.freeze({ id: "microsoft-ime", status: "not-run" }),
  Object.freeze({ id: "macos-ime", status: "not-run" }),
  Object.freeze({ id: "japanese-ime", status: "not-run" }),
  Object.freeze({ id: "gboard-ime", status: "not-run" }),
  Object.freeze({ id: "nvda", status: "not-run" }),
  Object.freeze({ id: "voiceover", status: "not-run" }),
  Object.freeze({ id: "talkback", status: "not-run" }),
]);

export function buildPresenceEvidence({
  profile,
  renderPath,
  capturedAt = new Date().toISOString(),
  environment,
  samples,
  inactiveRafStates,
  unavailable = {},
  dynamicCertification,
  fixedHardware = DEFAULT_FIXED_HARDWARE,
  manual = DEFAULT_MANUAL,
}: BuildPresenceEvidenceOptions): PresenceEvidence {
  const automated = Object.fromEntries(
    AUTOMATED_METRIC_IDS.map((id) => {
      if (id === "inactive-raf-count") {
        return [
          id,
          Object.freeze({
            unit: METRIC_UNITS[id],
            states: Object.freeze(
              Object.fromEntries(
                Object.entries(inactiveRafStates).map(([state, evidence]) => [
                  state,
                  Object.freeze({
                    ...evidence,
                    unit: METRIC_UNITS[id],
                    ...(evidence.status === "measured"
                      ? { samples: Object.freeze([...evidence.samples]) }
                      : {}),
                  }),
                ]),
              ),
            ),
          }),
        ];
      }
      const rawSamples = samples[id];
      const unavailableMetric = unavailable[id];
      if (unavailableMetric !== undefined) {
        if (rawSamples !== undefined) {
          throw new TypeError(`${id} cannot be both measured and unavailable.`);
        }
        return [
          id,
          Object.freeze({
            status: unavailableMetric.status,
            unit: METRIC_UNITS[id],
            notes: unavailableMetric.notes,
          }),
        ];
      }
      assertRawSamples(id, rawSamples);
      return [
        id,
        Object.freeze({
          status: "measured" as const,
          unit: METRIC_UNITS[id],
          samples: Object.freeze([...rawSamples]),
        }),
      ];
    }),
  ) as PresenceEvidence["automated"];
  const evidence: PresenceEvidence = {
    schemaVersion: "1.0.0",
    profile,
    renderPath,
    dynamicCertification: {
      status: dynamicCertification.status,
      ...(dynamicCertification.notes === undefined
        ? {}
        : { notes: dynamicCertification.notes }),
    },
    capturedAt,
    environment: {
      ...environment,
      viewport: { ...environment.viewport },
    },
    automated,
    fixedHardware: fixedHardware.map((entry) => ({ ...entry })),
    manual: manual.map((entry) => ({ ...entry })),
  };

  assertPresenceEvidenceSchema(evidence);
  return evidence;
}

export function createCumulativeVisualTransferSamples(
  resources: readonly TransferResourceSample[],
  classification: VisualTransferClassification = {},
): readonly number[] {
  const baseline = new Set(
    (classification.baselineResources ?? []).map((resource) => normalizeResourcePath(resource.name)),
  );
  const manifestVisualChunks = new Set(
    (classification.manifestVisualChunkPaths ?? []).map(normalizeManifestChunkPath),
  );
  const requestDeltaChunks = new Set(
    resources
      .map((resource) => normalizeResourcePath(resource.name))
      .filter((pathname) => isNextProductionChunk(pathname) && !baseline.has(pathname)),
  );
  const visualEntryLoaded = resources.some((resource) =>
    manifestVisualChunks.has(normalizeResourcePath(resource.name)),
  );
  let total = 0;
  const samples = [0];
  for (const resource of resources) {
    if (!Number.isFinite(resource.transferSize) || resource.transferSize < 0) {
      throw new TypeError(`Resource ${resource.name} has an invalid transfer size.`);
    }
    const pathname = normalizeResourcePath(resource.name);
    const requestDeltaChunk = requestDeltaChunks.has(pathname);
    const manifestVisualChunk = manifestVisualChunks.has(pathname);
    if (
      !isOptionalVisualResource(pathname) &&
      !manifestVisualChunk &&
      !(visualEntryLoaded && requestDeltaChunk)
    ) {
      continue;
    }
    total += resource.transferSize;
    samples.push(total);
  }
  return Object.freeze(samples);
}

function isOptionalVisualResource(resourceName: string): boolean {
  const pathname = normalizeResourcePath(resourceName);
  return pathname === "/live2d" || pathname.startsWith("/live2d/");
}

function normalizeResourcePath(resourceName: string): string {
  try {
    return new URL(resourceName, "http://astr.local").pathname.toLowerCase();
  } catch {
    return resourceName.toLowerCase();
  }
}

function normalizeManifestChunkPath(chunkPath: string): string {
  const normalized = chunkPath.replaceAll("\\", "/").replace(/^\/+/, "");
  return normalizeResourcePath(
    normalized.startsWith("_next/") ? `/${normalized}` : `/_next/${normalized}`,
  );
}

function isNextProductionChunk(pathname: string): boolean {
  return pathname.startsWith("/_next/static/chunks/") && pathname.endsWith(".js");
}

export async function collectVisualProductionChunkPaths(
  resources: readonly TransferResourceSample[],
  baselineResources: readonly TransferResourceSample[],
  manifestVisualChunkPaths: readonly string[],
  root = process.cwd(),
): Promise<readonly string[]> {
  const baseline = new Set(baselineResources.map((resource) => normalizeResourcePath(resource.name)));
  const manifest = new Set(manifestVisualChunkPaths.map(normalizeManifestChunkPath));
  const candidates = new Set<string>();
  const resourcePaths = resources
    .map((resource) => normalizeResourcePath(resource.name))
    .filter(isNextProductionChunk);
  const presentManifestPaths = resourcePaths.filter((pathname) => manifest.has(pathname));
  if (presentManifestPaths.length === 0) {
    throw new TypeError("Visual resources do not contain a production manifest entry chunk.");
  }
  const deltaPaths = resourcePaths.filter((pathname) => !baseline.has(pathname));
  for (const pathname of [...presentManifestPaths, ...deltaPaths]) {
    const relative = pathname.replace(/^\/_next\//, "");
    candidates.add(resolve(root, ".next", relative));
  }
  const resolved = [...candidates];
  await Promise.all(
    resolved.map(async (path) => {
      await access(path);
    }),
  );
  return Object.freeze(resolved.sort());
}

export async function collectLensProductionChunkPaths(
  resources: readonly TransferResourceSample[],
  baselineResources: readonly TransferResourceSample[],
  root = process.cwd(),
): Promise<readonly string[]> {
  const baseline = new Set(
    baselineResources.map((resource) => normalizeResourcePath(resource.name)),
  );
  const chunkRoot = resolve(root, ".next", "static", "chunks");
  const requestedCandidates = resources
    .map((resource) => normalizeResourcePath(resource.name))
    .filter((pathname) => isNextProductionChunk(pathname) && !baseline.has(pathname))
    .map((pathname) => resolve(root, ".next", pathname.replace(/^\/_next\//, "")));
  const builtCandidates = (await readdir(chunkRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => resolve(chunkRoot, entry.name));
  const lensChunks: string[] = [];
  for (const candidate of new Set([...requestedCandidates, ...builtCandidates])) {
    const contents = await readFile(candidate, "utf8");
    if (
      contents.includes("uProvenanceState") &&
      contents.includes("Soul Lens pass initialization failed")
    ) {
      lensChunks.push(candidate);
    }
  }
  if (lensChunks.length === 0) {
    throw new TypeError("Production build contains no Soul Lens chunk.");
  }
  return Object.freeze(lensChunks.sort());
}

export async function readPresenceVisualManifestChunkPaths(
  root = process.cwd(),
): Promise<readonly string[]> {
  const manifestPath = resolve(
    root,
    ".next",
    "server",
    "app",
    "page",
    "react-loadable-manifest.json",
  );
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Presence visual production manifest must be an object.");
  }
  const files = new Set<string>();
  for (const entry of Object.values(parsed)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidateFiles = (entry as { readonly files?: unknown }).files;
    if (!Array.isArray(candidateFiles)) continue;
    for (const candidate of candidateFiles) {
      if (
        typeof candidate === "string" &&
        candidate.startsWith("static/chunks/") &&
        candidate.endsWith(".js")
      ) {
        files.add(candidate);
      }
    }
  }
  if (files.size === 0) {
    throw new TypeError("Presence visual production manifest contains no JavaScript chunk.");
  }
  return Object.freeze([...files].sort());
}

export async function measureLensGzipBytes(
  productionChunkPaths: readonly string[],
): Promise<number> {
  if (productionChunkPaths.length === 0) {
    throw new TypeError("Lens gzip measurement requires production build chunks.");
  }
  const chunks = await Promise.all(productionChunkPaths.map((chunkPath) => readFile(chunkPath)));
  const merged = Buffer.concat(
    chunks.flatMap((chunk, index) => index === 0 ? [chunk] : [Buffer.from("\n"), chunk]),
  );
  return gzipSync(merged).byteLength;
}

export async function writePresenceEvidenceArtifact(
  evidence: PresenceEvidence,
  root = process.cwd(),
): Promise<string> {
  assertPresenceEvidenceSchema(evidence);
  const directory = join(root, "test-results", "presence-evidence");
  const artifactPath = join(directory, `${evidence.profile}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return artifactPath;
}

export async function writePresenceRawDiagnosticsArtifact(
  profile: PresenceProfile,
  renderPath: PresenceRenderPath,
  diagnostics: PresencePerformanceProbeSnapshot,
  root = process.cwd(),
): Promise<string> {
  const evidence: PresenceRawDiagnosticsEvidence = {
    schemaVersion: "1.0.0",
    profile,
    renderPath,
    capturedAt: new Date().toISOString(),
    probe: diagnostics,
  };
  assertPresenceRawDiagnosticsSchema(evidence);
  const serialized = JSON.stringify(evidence, null, 2);
  if (serialized === undefined) {
    throw new TypeError("Presence raw diagnostics must be JSON serializable.");
  }
  return writeArtifact(`${profile}-raw.json`, `${serialized}\n`, root);
}

export async function writePresenceSoakArtifact(
  evidence: PresenceSoakEvidence,
  root = process.cwd(),
): Promise<string> {
  if (!Number.isFinite(Date.parse(evidence.capturedAt))) {
    throw new TypeError("Soak capturedAt must be a date-time string.");
  }
  if (!Number.isSafeInteger(evidence.durationMs) || evidence.durationMs <= 0) {
    throw new TypeError("Soak durationMs must be a positive integer.");
  }
  if (
    evidence.heap.unit !== "bytes" ||
    evidence.heap.comparator !== "less-than" ||
    !Number.isFinite(evidence.heap.limitBytes) ||
    evidence.heap.limitBytes <= 0
  ) {
    throw new TypeError("Soak heap budget metadata is invalid.");
  }
  if (
    evidence.heap.samples.some(
      (sample) => !Number.isFinite(sample) || sample < 0,
    )
  ) {
    throw new TypeError("Soak heap samples must be non-negative and finite.");
  }
  if (evidence.heap.status === "measured") {
    if (evidence.heap.samples.length === 0) {
      throw new TypeError("Measured soak evidence requires raw heap samples.");
    }
    if (
      evidence.heap.postGcGrowthBytes === null ||
      !Number.isFinite(evidence.heap.postGcGrowthBytes)
    ) {
      throw new TypeError("Measured soak evidence requires finite post-GC growth.");
    }
  } else if (evidence.heap.postGcGrowthBytes !== null) {
    throw new TypeError("Unavailable soak evidence cannot claim post-GC growth.");
  }
  return writeArtifact(
    "soak.json",
    `${JSON.stringify(evidence, null, 2)}\n`,
    root,
  );
}

/**
 * Runs as a Playwright init script. Keep every dependency inside this function:
 * Playwright serializes the function body into the browser before application code.
 */
export function installPresencePerformanceProbe(): void {
  type UnknownMethod = (this: object, ...args: unknown[]) => unknown;
  type AllocationBindings = {
    readonly textures: Map<number, object | null>;
    renderbuffer: object | null;
  };
  type ProbeApi = {
    readonly snapshot: () => PresencePerformanceProbeSnapshot;
    readonly clearLongTasks: () => void;
    readonly beginInactiveRafWindow: (state: InactiveRafStateId) => void;
  };
  type ProbeWindow = Window & {
    __ASTR_PRESENCE_PERFORMANCE__?: ProbeApi;
  };

  const probeWindow = window as ProbeWindow;
  if (probeWindow.__ASTR_PRESENCE_PERFORMANCE__ !== undefined) return;
  const SAMPLE_LIMIT = 4096;
  const rafSamples: number[] = [0];
  const rafCadenceMs: number[] = [];
  const rafCallbackDurationMs: number[] = [];
  const rafMissedTicks: number[] = [];
  const schedulerStacks: {
    stack: string;
    classification: "pixi-application" | "application" | "other";
  }[] = [];
  const activeRafs = new Set<number>();
  const seenSchedulerStacks = new Set<string>();
  const contextCountSamples: number[] = [0];
  const successfulContextCreationSamples: number[] = [0];
  const drawCallSamples: number[] = [0];
  const triangleSamples: number[] = [0];
  const textureRtByteSamples: number[] = [0];
  const canvasDprSamples: number[] = [];
  const canvasBackingSizeSamples: {
    backingWidth: number;
    backingHeight: number;
    clientWidth: number;
    clientHeight: number;
    dpr: number;
  }[] = [];
  let longTaskDurationMs: number[] = [];
  let longTasks: {
    name: string;
    startTime: number;
    duration: number;
    attribution: {
      name: string;
      containerType: string;
      containerName: string;
      containerId: string;
      containerSrc: string;
    }[];
  }[] = [];
  let longTaskWindowStart: number | null = null;
  const lcpMs: number[] = [];
  const inpMs: number[] = [];
  const clsSamples: number[] = [];
  let tbtMs: number[] = [0];
  const activeJewelCountSamples: number[] = [0];
  const seenContexts = new WeakSet<object>();
  const successfulContextsByCanvas = new WeakMap<
    HTMLCanvasElement,
    Set<object>
  >();
  const attachedPresenceCanvases = new Set<HTMLCanvasElement>();
  const activePresenceContexts = new Set<object>();
  const bindings = new WeakMap<object, AllocationBindings>();
  const resourceAllocations = new WeakMap<object, Map<string, number>>();
  let contextCount = 0;
  let successfulContextCreationCount = 0;
  let frameDrawCalls = 0;
  let frameTriangles = 0;
  let textureRtBytes = 0;
  let maxActiveRaf = 0;
  let previousRafAt: number | null = null;
  type MutableInactiveRafWindow =
    | { status: "measured"; startTime: number; samples: number[] }
    | { status: "unsupported" | "not-run"; notes: string };
  const inactiveRafWindows: Record<InactiveRafStateId, MutableInactiveRafWindow> = {
    "reduced-motion": { status: "not-run", notes: "Reduced-motion window not captured." },
    paused: { status: "not-run", notes: "Paused window not captured." },
    offscreen: { status: "not-run", notes: "Offscreen window not captured." },
    hidden: { status: "not-run", notes: "Hidden lifecycle window not captured." },
  };
  let activeInactiveRafState: InactiveRafStateId | null = null;
  let probeSnapshotObserved = false;

  const push = (samples: number[], value: number): void => {
    if (!Number.isFinite(value)) return;
    samples.push(value);
    if (samples.length > SAMPLE_LIMIT) {
      samples.splice(0, samples.length - SAMPLE_LIMIT);
    }
  };

  const sampleRaf = (): void => {
    push(rafSamples, activeRafs.size);
    if (activeInactiveRafState !== null) {
      const inactiveWindow = inactiveRafWindows[activeInactiveRafState];
      if (inactiveWindow.status === "measured") {
        push(inactiveWindow.samples, activeRafs.size);
      }
    }
    maxActiveRaf = Math.max(maxActiveRaf, activeRafs.size);
  };

  const contextsForCanvas = (canvas: HTMLCanvasElement): Set<object> => {
    const existing = successfulContextsByCanvas.get(canvas);
    if (existing !== undefined) return existing;
    const created = new Set<object>();
    successfulContextsByCanvas.set(canvas, created);
    return created;
  };

  const recordActiveContextCount = (): void => {
    contextCount = activePresenceContexts.size;
    push(contextCountSamples, contextCount);
  };

  const attachPresenceCanvas = (canvas: HTMLCanvasElement): void => {
    if (attachedPresenceCanvases.has(canvas)) return;
    attachedPresenceCanvases.add(canvas);
    for (const context of contextsForCanvas(canvas)) activePresenceContexts.add(context);
    recordActiveContextCount();
  };

  const detachPresenceCanvas = (canvas: HTMLCanvasElement): void => {
    if (!attachedPresenceCanvases.delete(canvas)) return;
    for (const context of contextsForCanvas(canvas)) activePresenceContexts.delete(context);
    recordActiveContextCount();
  };

  const flushFrame = (): void => {
    push(drawCallSamples, frameDrawCalls);
    push(triangleSamples, frameTriangles);
    frameDrawCalls = 0;
    frameTriangles = 0;
  };

  const rafSupported =
    typeof window.requestAnimationFrame === "function" &&
    typeof window.cancelAnimationFrame === "function";
  let rafHookInstalled = false;
  if (rafSupported) {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const classifySchedulerStack = (
      stack: string,
    ): "pixi-application" | "application" | "other" => {
      const normalized = stack.toLowerCase();
      if (normalized.includes("pixi") || normalized.includes("ticker")) {
        return "pixi-application";
      }
      if (
        normalized.includes("/_next/") ||
        normalized.includes("webpack") ||
        normalized.includes("/src/")
      ) {
        return "application";
      }
      return "other";
    };
    const instrumentedRequestAnimationFrame = (
      callback: FrameRequestCallback,
    ): number => {
      const stack = new Error().stack ?? "requestAnimationFrame stack unavailable";
      if (!seenSchedulerStacks.has(stack) && schedulerStacks.length < 32) {
        seenSchedulerStacks.add(stack);
        schedulerStacks.push({
          stack,
          classification: classifySchedulerStack(stack),
        });
      }
      let requestId = 0;
      requestId = nativeRequestAnimationFrame((at) => {
        activeRafs.delete(requestId);
        sampleRaf();
        if (previousRafAt !== null) {
          const cadence = Math.max(0, at - previousRafAt);
          push(rafCadenceMs, cadence);
          const targetMs = 1_000 / (window.innerWidth <= 767 ? 24 : 30);
          push(rafMissedTicks, Math.max(0, Math.floor(cadence / targetMs) - 1));
        }
        previousRafAt = at;
        const callbackStartedAt = performance.now();
        try {
          callback(at);
        } finally {
          push(
            rafCallbackDurationMs,
            Math.max(0, performance.now() - callbackStartedAt),
          );
          flushFrame();
          sampleRaf();
        }
      });
      activeRafs.add(requestId);
      sampleRaf();
      return requestId;
    };
    const instrumentedCancelAnimationFrame = (requestId: number): void => {
      activeRafs.delete(requestId);
      sampleRaf();
      nativeCancelAnimationFrame(requestId);
    };
    try {
      window.requestAnimationFrame = instrumentedRequestAnimationFrame;
      window.cancelAnimationFrame = instrumentedCancelAnimationFrame;
      rafHookInstalled =
        window.requestAnimationFrame === instrumentedRequestAnimationFrame &&
        window.cancelAnimationFrame === instrumentedCancelAnimationFrame;
    } catch {
      rafHookInstalled = false;
    }
  }

  const patchMethod = (
    prototype: object,
    name: string,
    wrap: (original: UnknownMethod) => UnknownMethod,
  ): boolean => {
    const original = Reflect.get(prototype, name);
    if (typeof original !== "function") return false;
    try {
      const wrapped = wrap(original as UnknownMethod);
      if (!Reflect.set(prototype, name, wrapped)) return false;
      return Reflect.get(prototype, name) === wrapped;
    } catch {
      // A non-writable browser prototype is reported through support state/samples.
      return false;
    }
  };

  const isObject = (value: unknown): value is object =>
    (typeof value === "object" && value !== null) || typeof value === "function";

  const numberAt = (args: readonly unknown[], index: number): number => {
    const value = args[index];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  const triangleCount = (mode: number, count: number): number => {
    const normalized = Math.max(0, Math.trunc(count));
    if (mode === 4) return Math.floor(normalized / 3);
    if (mode === 5 || mode === 6) return Math.max(0, normalized - 2);
    return 0;
  };

  const recordDraw = (mode: number, count: number, instances = 1): void => {
    frameDrawCalls += 1;
    frameTriangles += triangleCount(mode, count) * Math.max(0, Math.trunc(instances));
  };

  const bindingFor = (context: object): AllocationBindings => {
    const existing = bindings.get(context);
    if (existing !== undefined) return existing;
    const created: AllocationBindings = { textures: new Map(), renderbuffer: null };
    bindings.set(context, created);
    return created;
  };

  const normalizedTextureTarget = (target: number): number =>
    target >= 34069 && target <= 34074 ? 34067 : target;

  const replaceAllocation = (resource: object, key: string, bytes: number): void => {
    const normalized = Math.max(0, Math.round(bytes));
    let allocations = resourceAllocations.get(resource);
    if (allocations === undefined) {
      allocations = new Map();
      resourceAllocations.set(resource, allocations);
    }
    const previous = allocations.get(key) ?? 0;
    allocations.set(key, normalized);
    textureRtBytes = Math.max(0, textureRtBytes - previous + normalized);
    push(textureRtByteSamples, textureRtBytes);
  };

  const releaseAllocation = (resource: object): void => {
    const allocations = resourceAllocations.get(resource);
    if (allocations === undefined) return;
    let released = 0;
    for (const value of allocations.values()) released += value;
    resourceAllocations.delete(resource);
    textureRtBytes = Math.max(0, textureRtBytes - released);
    push(textureRtByteSamples, textureRtBytes);
  };

  const textureResource = (context: object, target: number): object | null =>
    bindingFor(context).textures.get(normalizedTextureTarget(target)) ?? null;

  const componentCount = (format: number): number => {
    if (format === 6407 || format === 36248) return 3;
    if (format === 6408 || format === 36249) return 4;
    if (format === 6410 || format === 33319 || format === 33320) return 2;
    return 1;
  };

  const bytesPerPixel = (format: number, type: number): number => {
    if (type === 32819 || type === 32820 || type === 33635) return 2;
    if (type === 34042 || type === 36269 || type === 33640) return 4;
    const componentBytes = type === 5126 ? 4 : type === 5131 || type === 36193 ? 2 : 1;
    return componentCount(format) * componentBytes;
  };

  const sourceSize = (source: unknown): { width: number; height: number } => {
    if (!isObject(source)) return { width: 0, height: 0 };
    const candidate = source as {
      readonly width?: unknown;
      readonly height?: unknown;
      readonly videoWidth?: unknown;
      readonly videoHeight?: unknown;
      readonly naturalWidth?: unknown;
      readonly naturalHeight?: unknown;
    };
    const width = [candidate.width, candidate.videoWidth, candidate.naturalWidth]
      .find((value) => typeof value === "number" && Number.isFinite(value));
    const height = [candidate.height, candidate.videoHeight, candidate.naturalHeight]
      .find((value) => typeof value === "number" && Number.isFinite(value));
    return {
      width: typeof width === "number" ? width : 0,
      height: typeof height === "number" ? height : 0,
    };
  };

  const bufferByteLength = (value: unknown): number => {
    if (!isObject(value)) return 0;
    const candidate = value as { readonly byteLength?: unknown };
    return typeof candidate.byteLength === "number" && Number.isFinite(candidate.byteLength)
      ? candidate.byteLength
      : 0;
  };

  const renderbufferBytesPerPixel = (internalFormat: number): number => {
    if (internalFormat === 33189 || internalFormat === 36194) return 2;
    if (internalFormat === 33190) return 3;
    return 4;
  };

  let installedWebglMethodHooks = 0;
  const patchWebglPrototype = (prototype: object): void => {
    const install = (
      name: string,
      wrap: (original: UnknownMethod) => UnknownMethod,
    ): void => {
      if (patchMethod(prototype, name, wrap)) installedWebglMethodHooks += 1;
    };
    install("drawArrays", (original) => function (...args) {
      recordDraw(numberAt(args, 0), numberAt(args, 2));
      return Reflect.apply(original, this, args);
    });
    install("drawElements", (original) => function (...args) {
      recordDraw(numberAt(args, 0), numberAt(args, 1));
      return Reflect.apply(original, this, args);
    });
    install("drawArraysInstanced", (original) => function (...args) {
      recordDraw(numberAt(args, 0), numberAt(args, 2), numberAt(args, 3));
      return Reflect.apply(original, this, args);
    });
    install("drawElementsInstanced", (original) => function (...args) {
      recordDraw(numberAt(args, 0), numberAt(args, 1), numberAt(args, 4));
      return Reflect.apply(original, this, args);
    });
    install("bindTexture", (original) => function (...args) {
      const target = normalizedTextureTarget(numberAt(args, 0));
      bindingFor(this).textures.set(target, isObject(args[1]) ? args[1] : null);
      return Reflect.apply(original, this, args);
    });
    install("deleteTexture", (original) => function (...args) {
      if (isObject(args[0])) releaseAllocation(args[0]);
      return Reflect.apply(original, this, args);
    });
    install("texImage2D", (original) => function (...args) {
      const target = numberAt(args, 0);
      const level = numberAt(args, 1);
      const texture = textureResource(this, target);
      if (texture !== null) {
        const explicitDimensions = args.length >= 9;
        const size = explicitDimensions
          ? { width: numberAt(args, 3), height: numberAt(args, 4) }
          : sourceSize(args[5]);
        const format = numberAt(args, explicitDimensions ? 6 : 3);
        const type = numberAt(args, explicitDimensions ? 7 : 4);
        replaceAllocation(
          texture,
          `image:${target}:${level}`,
          size.width * size.height * bytesPerPixel(format, type),
        );
      }
      return Reflect.apply(original, this, args);
    });
    install("compressedTexImage2D", (original) => function (...args) {
      const target = numberAt(args, 0);
      const texture = textureResource(this, target);
      if (texture !== null) {
        replaceAllocation(
          texture,
          `compressed:${target}:${numberAt(args, 1)}`,
          bufferByteLength(args.at(-1)),
        );
      }
      return Reflect.apply(original, this, args);
    });
    install("texStorage2D", (original) => function (...args) {
      const target = numberAt(args, 0);
      const levels = Math.max(1, Math.trunc(numberAt(args, 1)));
      const texture = textureResource(this, target);
      if (texture !== null) {
        let width = numberAt(args, 3);
        let height = numberAt(args, 4);
        let bytes = 0;
        for (let level = 0; level < levels; level += 1) {
          bytes += Math.max(1, width) * Math.max(1, height) * 4;
          width = Math.max(1, Math.floor(width / 2));
          height = Math.max(1, Math.floor(height / 2));
        }
        replaceAllocation(texture, `storage:${target}`, bytes);
      }
      return Reflect.apply(original, this, args);
    });
    install("generateMipmap", (original) => function (...args) {
      const target = numberAt(args, 0);
      const texture = textureResource(this, target);
      if (texture !== null) {
        const allocations = resourceAllocations.get(texture);
        if (allocations !== undefined && !allocations.has(`mipmap:${target}`)) {
          let baseBytes = 0;
          for (const [key, value] of allocations) {
            if (key.startsWith("image:")) baseBytes += value;
          }
          replaceAllocation(texture, `mipmap:${target}`, Math.ceil(baseBytes / 3));
        }
      }
      return Reflect.apply(original, this, args);
    });
    install("bindRenderbuffer", (original) => function (...args) {
      bindingFor(this).renderbuffer = isObject(args[1]) ? args[1] : null;
      return Reflect.apply(original, this, args);
    });
    install("renderbufferStorage", (original) => function (...args) {
      const renderbuffer = bindingFor(this).renderbuffer;
      if (renderbuffer !== null) {
        replaceAllocation(
          renderbuffer,
          "renderbuffer",
          numberAt(args, 2) *
            numberAt(args, 3) *
            renderbufferBytesPerPixel(numberAt(args, 1)),
        );
      }
      return Reflect.apply(original, this, args);
    });
    install("deleteRenderbuffer", (original) => function (...args) {
      if (isObject(args[0])) releaseAllocation(args[0]);
      return Reflect.apply(original, this, args);
    });
  };

  let webglSupported = false;
  const webglPrototypes: object[] = [];
  if (typeof WebGLRenderingContext === "function") {
    webglSupported = true;
    webglPrototypes.push(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext === "function") {
    webglSupported = true;
    webglPrototypes.push(WebGL2RenderingContext.prototype);
  }
  for (const prototype of webglPrototypes) patchWebglPrototype(prototype);

  const canvasContextHookInstalled = patchMethod(
    HTMLCanvasElement.prototype,
    "getContext",
    (original) => function (...args) {
    const context = Reflect.apply(original, this, args);
    const kind = typeof args[0] === "string" ? args[0].toLowerCase() : "";
    if (
      this instanceof HTMLCanvasElement &&
      isObject(context) &&
      (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
    ) {
      if (!seenContexts.has(context)) {
        seenContexts.add(context);
        successfulContextCreationCount += 1;
        push(successfulContextCreationSamples, successfulContextCreationCount);
        contextsForCanvas(this).add(context);
        if (attachedPresenceCanvases.has(this)) {
          activePresenceContexts.add(context);
          recordActiveContextCount();
        }
      }
    }
    return context;
    },
  );

  const sampleDom = (): void => {
    const activeJewels = document.querySelectorAll("[data-dynamic-jewel='active']").length;
    push(activeJewelCountSamples, activeJewels);
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      "[data-presence-visual-surface] canvas",
    )) {
      sampleCanvasBacking(canvas);
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth <= 0 || cssHeight <= 0) continue;
      const ratio = Math.max(canvas.width / cssWidth, canvas.height / cssHeight);
      if (Number.isFinite(ratio) && ratio > 0) push(canvasDprSamples, ratio);
    }
  };

  function sampleCanvasBacking(canvas: HTMLCanvasElement): void {
    const backingWidth = canvas.width;
    const backingHeight = canvas.height;
    const clientWidth = canvas.clientWidth;
    const clientHeight = canvas.clientHeight;
    if (
      !Number.isFinite(backingWidth) ||
      !Number.isFinite(backingHeight) ||
      !Number.isFinite(clientWidth) ||
      !Number.isFinite(clientHeight) ||
      backingWidth <= 0 ||
      backingHeight <= 0 ||
      clientWidth <= 0 ||
      clientHeight <= 0
    ) {
      return;
    }
    const dpr = Math.max(
      backingWidth / clientWidth,
      backingHeight / clientHeight,
    );
    if (!Number.isFinite(dpr) || dpr <= 0) return;
    canvasBackingSizeSamples.push({
      backingWidth,
      backingHeight,
      clientWidth,
      clientHeight,
      dpr,
    });
    if (canvasBackingSizeSamples.length > SAMPLE_LIMIT) {
      canvasBackingSizeSamples.splice(
        0,
        canvasBackingSizeSamples.length - SAMPLE_LIMIT,
      );
    }
  }

  let installedCanvasDimensionHooks = 0;
  for (const dimension of ["width", "height"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      dimension,
    );
    if (descriptor?.get === undefined || descriptor.set === undefined) continue;
    const nativeGet = descriptor.get;
    const nativeSet = descriptor.set;
    try {
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
        ...descriptor,
        get: nativeGet,
        set(this: HTMLCanvasElement, value: number) {
          Reflect.apply(nativeSet, this, [value]);
          sampleCanvasBacking(this);
        },
      });
      installedCanvasDimensionHooks += 1;
    } catch {
      // The attached-canvas DPR sampler remains available when setters are sealed.
    }
  }

  const replaceChildrenHookInstalled = patchMethod(
    Element.prototype,
    "replaceChildren",
    (original) => function (...args) {
    const presenceSurface =
      this instanceof Element && this.hasAttribute("data-presence-visual-surface");
    if (presenceSurface) {
      for (const canvas of this.querySelectorAll("canvas")) {
        if (canvas instanceof HTMLCanvasElement) detachPresenceCanvas(canvas);
      }
      for (const child of args) {
        if (child instanceof HTMLCanvasElement) attachPresenceCanvas(child);
      }
    }
    const result = Reflect.apply(original, this, args);
    if (presenceSurface) {
      for (const child of args) {
        if (child instanceof HTMLCanvasElement) {
          sampleCanvasBacking(child);
          queueMicrotask(sampleDom);
        }
      }
    }
    return result;
    },
  );
  const removeChildHookInstalled = patchMethod(
    Node.prototype,
    "removeChild",
    (original) => function (...args) {
    const child = args[0];
    if (
      child instanceof HTMLCanvasElement &&
      this instanceof Element &&
      this.hasAttribute("data-presence-visual-surface")
    ) {
      detachPresenceCanvas(child);
    }
    return Reflect.apply(original, this, args);
    },
  );

  let domSamplingInstalled = false;
  const beginDomSampling = (): void => {
    sampleDom();
    try {
      const observer = new MutationObserver(sampleDom);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["data-dynamic-jewel", "data-visual-phase", "height", "style", "width"],
      });
      window.addEventListener("resize", sampleDom);
      domSamplingInstalled = true;
    } catch {
      domSamplingInstalled = false;
    }
  };
  if (document.documentElement === null) {
    document.addEventListener("DOMContentLoaded", beginDomSampling, { once: true });
  } else {
    beginDomSampling();
  }

  const supportedEntryTypes = new Set(
    typeof PerformanceObserver === "function"
      ? PerformanceObserver.supportedEntryTypes ?? []
      : [],
  );
  const observe = (
    type: string,
    listener: (entry: PerformanceEntry) => void,
    options: PerformanceObserverInit = { type, buffered: true },
  ): boolean => {
    if (typeof PerformanceObserver !== "function" || !supportedEntryTypes.has(type)) {
      return false;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) listener(entry);
      });
      observer.observe(options);
      return true;
    } catch {
      return false;
    }
  };

  const longTaskObserverInstalled = observe("longtask", (entry) => {
    const timing = entry as PerformanceEntry & {
      readonly attribution?: readonly {
        readonly name?: string;
        readonly containerType?: string;
        readonly containerName?: string;
        readonly containerId?: string;
        readonly containerSrc?: string;
      }[];
    };
    if (longTaskWindowStart === null || entry.startTime < longTaskWindowStart) return;
    longTasks.push({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      attribution: (timing.attribution ?? []).map((item) => ({
        name: item.name ?? "",
        containerType: item.containerType ?? "",
        containerName: item.containerName ?? "",
        containerId: item.containerId ?? "",
        containerSrc: item.containerSrc ?? "",
      })),
    });
    if (longTasks.length > SAMPLE_LIMIT) {
      longTasks.splice(0, longTasks.length - SAMPLE_LIMIT);
    }
    push(longTaskDurationMs, Math.max(0, entry.duration));
    push(tbtMs, (tbtMs.at(-1) ?? 0) + Math.max(0, entry.duration - 50));
  });
  const lcpObserverInstalled = observe("largest-contentful-paint", (entry) => {
    push(lcpMs, Math.max(0, entry.startTime));
  });
  const eventObserverOptions: PerformanceObserverInit & {
    readonly durationThreshold: number;
  } = { type: "event", buffered: true, durationThreshold: 16 };
  const eventTimingObserverInstalled = observe(
    "event",
    (entry) => push(inpMs, Math.max(0, entry.duration)),
    eventObserverOptions,
  );
  const layoutShiftObserverInstalled = observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & {
      readonly value?: number;
      readonly hadRecentInput?: boolean;
    };
    if (!shift.hadRecentInput && typeof shift.value === "number") {
      push(clsSamples, Math.max(0, shift.value));
    }
  });

  probeWindow.__ASTR_PRESENCE_PERFORMANCE__ = Object.freeze({
    beginInactiveRafWindow: (state) => {
      inactiveRafWindows[state] = {
        status: "measured",
        startTime: performance.now(),
        samples: [activeRafs.size],
      };
      activeInactiveRafState = state;
    },
    clearLongTasks: () => {
      longTaskDurationMs = [];
      longTasks = [];
      tbtMs = [0];
      longTaskWindowStart = performance.now();
    },
    snapshot: (): PresencePerformanceProbeSnapshot => {
      probeSnapshotObserved = true;
      flushFrame();
      sampleRaf();
      sampleDom();
      const snapshotAt = performance.now();
      const resources = performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          transferSize: Math.max(0, entry.transferSize),
          encodedBodySize: Math.max(0, entry.encodedBodySize),
          decodedBodySize: Math.max(0, entry.decodedBodySize),
          duration: Math.max(0, entry.duration),
        }));
      const visualPhase = document
        .querySelector("[data-presence-visual-host]")
        ?.getAttribute("data-visual-phase") ?? null;
      const canvasCount = document.querySelectorAll(
        "[data-presence-visual-surface] canvas",
      ).length;
      const dynamicRenderer = visualPhase === "ready" && canvasCount === 1;
      const visualSurface = document.querySelector<HTMLElement>(
        "[data-presence-visual-surface]",
      );
      const schedulerDataset = visualSurface?.dataset;
      const nonnegativeInteger = (value: string | undefined): number | null => {
        if (value === undefined || value.trim() === "") return null;
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      };
      const booleanValue = (value: string | undefined): boolean | null =>
        value === "true" ? true : value === "false" ? false : null;
      const applicationOwnsSharedTicker = booleanValue(
        schedulerDataset?.applicationOwnsSharedTicker,
      );
      const applicationTickerListenerCount = nonnegativeInteger(
        schedulerDataset?.applicationTickerListenerCount,
      );
      const applicationTickerRafCount = nonnegativeInteger(
        schedulerDataset?.applicationTickerRafCount,
      );
      const sharedTickerListenerCount = nonnegativeInteger(
        schedulerDataset?.sharedTickerListenerCount,
      );
      const sharedTickerRafCount = nonnegativeInteger(
        schedulerDataset?.sharedTickerRafCount,
      );
      const schedulerMeasured =
        schedulerDataset?.schedulerEvidence === "measured" &&
        applicationOwnsSharedTicker !== null &&
        applicationTickerListenerCount !== null &&
        applicationTickerRafCount !== null &&
        sharedTickerListenerCount !== null &&
        sharedTickerRafCount !== null;
      return {
        support: {
          raf: {
            supported: rafSupported,
            installed: rafHookInstalled,
            observed: probeSnapshotObserved && rafHookInstalled,
          },
          canvas: {
            supported: typeof HTMLCanvasElement === "function",
            installed:
              domSamplingInstalled &&
              installedCanvasDimensionHooks > 0 &&
              replaceChildrenHookInstalled &&
              removeChildHookInstalled,
            observed: canvasBackingSizeSamples.length > 0,
          },
          webgl: {
            supported: webglSupported,
            installed:
              canvasContextHookInstalled && installedWebglMethodHooks > 0,
            observed:
              probeSnapshotObserved &&
              canvasContextHookInstalled &&
              installedWebglMethodHooks > 0,
          },
          longTask: {
            supported: supportedEntryTypes.has("longtask"),
            installed: longTaskObserverInstalled,
            observed: longTaskObserverInstalled && longTaskWindowStart !== null,
          },
          largestContentfulPaint: {
            supported: supportedEntryTypes.has("largest-contentful-paint"),
            installed: lcpObserverInstalled,
            observed: lcpObserverInstalled && probeSnapshotObserved,
          },
          eventTiming: {
            supported: supportedEntryTypes.has("event"),
            installed: eventTimingObserverInstalled,
            observed: eventTimingObserverInstalled && probeSnapshotObserved,
          },
          layoutShift: {
            supported: supportedEntryTypes.has("layout-shift"),
            installed: layoutShiftObserverInstalled,
            observed: layoutShiftObserverInstalled && probeSnapshotObserved,
          },
        },
        environment: {
          platform: navigator.platform || "unknown",
          hardwareConcurrency: navigator.hardwareConcurrency || 1,
          devicePixelRatio: window.devicePixelRatio,
        },
        raf: {
          active: activeRafs.size,
          maxActive: maxActiveRaf,
          samples: [...rafSamples],
          cadenceMs: [...rafCadenceMs],
          callbackDurationMs: [...rafCallbackDurationMs],
          missedTicks: [...rafMissedTicks],
          schedulerStacks: schedulerStacks.map((sample) => ({ ...sample })),
          scheduler: dynamicRenderer
            ? schedulerMeasured
              ? {
                  status: "measured",
                  renderPath: "dynamic",
                  applicationOwnsSharedTicker,
                  applicationRootCount: applicationTickerRafCount,
                  applicationTickerListenerCount,
                  sharedTickerListenerCount,
                  sharedTickerRafCount,
                  provenance: "production-runtime-telemetry",
                }
              : {
                  status: "unsupported",
                  renderPath: "dynamic",
                  applicationOwnsSharedTicker: null,
                  applicationRootCount: null,
                  applicationTickerListenerCount: null,
                  sharedTickerListenerCount: null,
                  sharedTickerRafCount: null,
                  provenance: "telemetry-unavailable",
                  notes:
                    "Dynamic renderer was ready without complete production Pixi scheduler telemetry.",
                }
            : {
                status: "not-applicable",
                renderPath: "static",
                applicationOwnsSharedTicker: null,
                applicationRootCount: null,
                applicationTickerListenerCount: null,
                sharedTickerListenerCount: null,
                sharedTickerRafCount: null,
                provenance: "no-renderer",
              },
          inactiveWindows: Object.fromEntries(
            Object.entries(inactiveRafWindows).map(([state, window]) => [
              state,
              window.status === "measured"
                ? {
                    status: "measured",
                    startTime: window.startTime,
                    endTime: snapshotAt,
                    samples: [...window.samples],
                  }
                : { ...window },
            ]),
          ) as PresencePerformanceProbeSnapshot["raf"]["inactiveWindows"],
        },
        webgl: {
          contextCountSamples: [...contextCountSamples],
          successfulContextCreationSamples: [
            ...successfulContextCreationSamples,
          ],
          drawCallSamples: [...drawCallSamples],
          triangleSamples: [...triangleSamples],
          textureRtByteSamples: [...textureRtByteSamples],
        },
        canvasDprSamples: [...canvasDprSamples],
        canvasBackingSizeSamples: canvasBackingSizeSamples.map((sample) => ({
          ...sample,
        })),
        longTaskDurationMs: [...longTaskDurationMs],
        longTasks: longTasks.map((entry) => ({
          ...entry,
          attribution: entry.attribution.map((item) => ({ ...item })),
        })),
        longTaskWindow: {
          startTime: longTaskWindowStart,
          endTime: snapshotAt,
        },
        performance: {
          lcpMs: [...lcpMs],
          inpMs: [...inpMs],
          clsSamples: [...clsSamples],
          tbtMs: [...tbtMs],
        },
        resources,
        dom: {
          activeJewelCountSamples: [...activeJewelCountSamples],
          visualPhase,
          canvasCount,
        },
      };
    },
  });
}

export async function readPresencePerformanceProbe(
  page: Page,
): Promise<PresencePerformanceProbeSnapshot> {
  return page.evaluate(() => {
    const probe = (window as Window & {
      __ASTR_PRESENCE_PERFORMANCE__?: {
        readonly snapshot: () => PresencePerformanceProbeSnapshot;
      };
    }).__ASTR_PRESENCE_PERFORMANCE__;
    if (probe === undefined) throw new Error("Presence performance probe was not installed.");
    return probe.snapshot();
  });
}

export async function clearPresenceLongTaskSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as Window & {
      __ASTR_PRESENCE_PERFORMANCE__?: { readonly clearLongTasks: () => void };
    }).__ASTR_PRESENCE_PERFORMANCE__;
    if (probe === undefined) throw new Error("Presence performance probe was not installed.");
    probe.clearLongTasks();
  });
}

export async function beginPresenceInactiveRafWindow(
  page: Page,
  state: InactiveRafStateId,
): Promise<void> {
  await page.evaluate((inactiveState) => {
    const probe = (window as Window & {
      __ASTR_PRESENCE_PERFORMANCE__?: {
        readonly beginInactiveRafWindow: (state: InactiveRafStateId) => void;
      };
    }).__ASTR_PRESENCE_PERFORMANCE__;
    if (probe === undefined) throw new Error("Presence performance probe was not installed.");
    probe.beginInactiveRafWindow(inactiveState);
  }, state);
}

export function assertPresenceEvidenceSchema(
  value: unknown,
): asserts value is PresenceEvidence {
  const root = requireRecord(value, "evidence");
  assertExactKeys(root, evidenceSchema.required, "evidence");
  if (root.schemaVersion !== "1.0.0") throw new TypeError("Invalid schemaVersion.");
  if (root.profile !== "desktop" && root.profile !== "mobile") {
    throw new TypeError("Invalid profile.");
  }
  if (root.renderPath !== "dynamic" && root.renderPath !== "static-fallback") {
    throw new TypeError("Invalid renderPath.");
  }
  const dynamicCertification = requireRecord(
    root.dynamicCertification,
    "dynamicCertification",
  );
  assertExactKeys(
    dynamicCertification,
    ["status", "notes"],
    "dynamicCertification",
    ["notes"],
  );
  if (
    dynamicCertification.status !== "passed" &&
    dynamicCertification.status !== "failed" &&
    dynamicCertification.status !== "unsupported" &&
    dynamicCertification.status !== "not-run"
  ) {
    throw new TypeError("dynamicCertification.status is invalid.");
  }
  if (
    "notes" in dynamicCertification &&
    typeof dynamicCertification.notes !== "string"
  ) {
    throw new TypeError("dynamicCertification.notes must be a string.");
  }
  if (
    typeof root.capturedAt !== "string" ||
    root.capturedAt.length === 0 ||
    !Number.isFinite(Date.parse(root.capturedAt))
  ) {
    throw new TypeError("capturedAt must be a date-time string.");
  }

  const environment = requireRecord(root.environment, "environment");
  assertExactKeys(
    environment,
    ["browser", "os", "cpu", "gpu", "viewport", "devicePixelRatio", "throttle"],
    "environment",
    ["cpu", "gpu"],
  );
  for (const key of ["browser", "os", "throttle"] as const) {
    if (typeof environment[key] !== "string" || environment[key].length === 0) {
      throw new TypeError(`environment.${key} must be a non-empty string.`);
    }
  }
  for (const key of ["cpu", "gpu"] as const) {
    if (
      key in environment &&
      (typeof environment[key] !== "string" || environment[key].length === 0)
    ) {
      throw new TypeError(`environment.${key} must be a non-empty string.`);
    }
  }
  const viewport = requireRecord(environment.viewport, "environment.viewport");
  assertExactKeys(viewport, ["width", "height"], "environment.viewport");
  for (const key of ["width", "height"] as const) {
    if (!Number.isInteger(viewport[key]) || Number(viewport[key]) < 1) {
      throw new TypeError(`environment.viewport.${key} must be a positive integer.`);
    }
  }
  if (
    typeof environment.devicePixelRatio !== "number" ||
    !Number.isFinite(environment.devicePixelRatio) ||
    environment.devicePixelRatio <= 0
  ) {
    throw new TypeError("environment.devicePixelRatio must be positive and finite.");
  }

  const automated = requireRecord(root.automated, "automated");
  assertExactKeys(automated, AUTOMATED_METRIC_IDS, "automated");
  for (const id of AUTOMATED_METRIC_IDS) {
    const metric = requireRecord(automated[id], `automated.${id}`);
    if (id === "inactive-raf-count") {
      assertExactKeys(metric, ["unit", "states"], `automated.${id}`);
      if (metric.unit !== METRIC_UNITS[id]) {
        throw new TypeError(`automated.${id} has the wrong unit.`);
      }
      const states = requireRecord(metric.states, `automated.${id}.states`);
      const stateIds: readonly InactiveRafStateId[] = [
        "reduced-motion",
        "paused",
        "offscreen",
        "hidden",
      ];
      assertExactKeys(states, stateIds, `automated.${id}.states`);
      for (const state of stateIds) {
        const stateEvidence = requireRecord(
          states[state],
          `automated.${id}.states.${state}`,
        );
        const unavailableState =
          stateEvidence.status === "unsupported" || stateEvidence.status === "not-run";
        assertExactKeys(
          stateEvidence,
          unavailableState
            ? ["status", "unit", "notes"]
            : ["status", "unit", "samples", "notes"],
          `automated.${id}.states.${state}`,
          ["notes"],
        );
        if (stateEvidence.status !== "measured" && !unavailableState) {
          throw new TypeError(`automated.${id}.states.${state} has an invalid status.`);
        }
        if (stateEvidence.unit !== METRIC_UNITS[id]) {
          throw new TypeError(`automated.${id}.states.${state} has the wrong unit.`);
        }
        if (!unavailableState) assertRawSamples(id, stateEvidence.samples);
        if (
          "notes" in stateEvidence &&
          typeof stateEvidence.notes !== "string"
        ) {
          throw new TypeError(`automated.${id}.states.${state}.notes must be a string.`);
        }
      }
      continue;
    }
    const unavailable =
      metric.status === "unsupported" ||
      metric.status === "not-run" ||
      metric.status === "not-applicable";
    assertExactKeys(
      metric,
      unavailable ? ["status", "unit", "notes"] : ["status", "unit", "samples", "notes"],
      `automated.${id}`,
      ["notes"],
    );
    if (metric.status !== "measured" && !unavailable) {
      throw new TypeError(`automated.${id} has an invalid status.`);
    }
    if (metric.unit !== METRIC_UNITS[id]) {
      throw new TypeError(`automated.${id} has the wrong unit.`);
    }
    if (!unavailable) assertRawSamples(id, metric.samples);
    if ("notes" in metric && typeof metric.notes !== "string") {
      throw new TypeError(`automated.${id}.notes must be a string.`);
    }
  }

  assertCertificationCollection(
    root.fixedHardware,
    "fixedHardware",
    FIXED_HARDWARE_CERTIFICATION_IDS,
  );
  assertCertificationCollection(root.manual, "manual", MANUAL_CERTIFICATION_IDS);
}

export function assertPresenceRawDiagnosticsSchema(
  value: unknown,
): asserts value is PresenceRawDiagnosticsEvidence {
  const root = requireRecord(value, "raw evidence");
  assertExactKeys(root, rawEvidenceSchema.required, "raw evidence");
  if (root.schemaVersion !== "1.0.0") {
    throw new TypeError("Raw evidence has an invalid schemaVersion.");
  }
  if (root.profile !== "desktop" && root.profile !== "mobile") {
    throw new TypeError("Raw evidence has an invalid profile.");
  }
  if (root.renderPath !== "dynamic" && root.renderPath !== "static-fallback") {
    throw new TypeError("Raw evidence has an invalid renderPath.");
  }
  if (
    typeof root.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(root.capturedAt))
  ) {
    throw new TypeError("Raw evidence capturedAt must be a date-time string.");
  }

  const probe = requireRecord(root.probe, "raw evidence.probe");
  assertExactKeys(probe, rawEvidenceSchema.$defs.probe.required, "raw evidence.probe");

  const support = requireRecord(probe.support, "raw evidence.probe.support");
  const supportKeys = rawEvidenceSchema.$defs.probe.properties.support.required;
  assertExactKeys(support, supportKeys, "raw evidence.probe.support");
  for (const key of supportKeys) {
    assertProbeCapability(support[key], `raw evidence.probe.support.${key}`);
  }

  const environment = requireRecord(
    probe.environment,
    "raw evidence.probe.environment",
  );
  assertExactKeys(
    environment,
    ["platform", "hardwareConcurrency", "devicePixelRatio"],
    "raw evidence.probe.environment",
  );
  if (typeof environment.platform !== "string" || environment.platform.length === 0) {
    throw new TypeError("raw evidence.probe.environment.platform must be non-empty.");
  }
  assertNonNegativeInteger(
    environment.hardwareConcurrency,
    "raw evidence.probe.environment.hardwareConcurrency",
    1,
  );
  assertPositiveFinite(
    environment.devicePixelRatio,
    "raw evidence.probe.environment.devicePixelRatio",
  );

  const raf = requireRecord(probe.raf, "raw evidence.probe.raf");
  assertExactKeys(
    raf,
    rawEvidenceSchema.$defs.probe.properties.raf.required,
    "raw evidence.probe.raf",
  );
  assertNonNegativeInteger(raf.active, "raw evidence.probe.raf.active");
  assertNonNegativeInteger(raf.maxActive, "raw evidence.probe.raf.maxActive");
  for (const key of [
    "samples",
    "cadenceMs",
    "callbackDurationMs",
    "missedTicks",
  ] as const) {
    assertNonNegativeSamples(raf[key], `raw evidence.probe.raf.${key}`);
  }
  if (!Array.isArray(raf.schedulerStacks)) {
    throw new TypeError("raw evidence.probe.raf.schedulerStacks must be an array.");
  }
  for (const [index, candidate] of raf.schedulerStacks.entries()) {
    const stack = requireRecord(
      candidate,
      `raw evidence.probe.raf.schedulerStacks[${index}]`,
    );
    assertExactKeys(
      stack,
      ["stack", "classification"],
      `raw evidence.probe.raf.schedulerStacks[${index}]`,
    );
    if (typeof stack.stack !== "string" || stack.stack.length === 0) {
      throw new TypeError(`raw evidence.probe.raf.schedulerStacks[${index}].stack must be non-empty.`);
    }
    if (
      stack.classification !== "pixi-application" &&
      stack.classification !== "application" &&
      stack.classification !== "other"
    ) {
      throw new TypeError(`raw evidence.probe.raf.schedulerStacks[${index}].classification is invalid.`);
    }
  }
  const scheduler = requireRecord(raf.scheduler, "raw evidence.probe.raf.scheduler");
  assertExactKeys(
    scheduler,
    [
      "status",
      "renderPath",
      "applicationOwnsSharedTicker",
      "applicationRootCount",
      "applicationTickerListenerCount",
      "sharedTickerListenerCount",
      "sharedTickerRafCount",
      "provenance",
      "notes",
    ],
    "raw evidence.probe.raf.scheduler",
    ["notes"],
  );
  if (scheduler.renderPath !== "dynamic" && scheduler.renderPath !== "static") {
    throw new TypeError("raw evidence.probe.raf.scheduler.renderPath is invalid.");
  }
  if (scheduler.status === "measured") {
    if (scheduler.applicationOwnsSharedTicker !== true &&
        scheduler.applicationOwnsSharedTicker !== false) {
      throw new TypeError(
        "raw evidence.probe.raf.scheduler.applicationOwnsSharedTicker must be boolean.",
      );
    }
    for (const key of [
      "applicationRootCount",
      "applicationTickerListenerCount",
      "sharedTickerListenerCount",
      "sharedTickerRafCount",
    ] as const) {
      assertNonNegativeInteger(
        scheduler[key],
        `raw evidence.probe.raf.scheduler.${key}`,
      );
    }
    if (scheduler.provenance !== "production-runtime-telemetry") {
      throw new TypeError("raw evidence.probe.raf.scheduler.provenance is invalid.");
    }
  } else if (
    scheduler.status === "unsupported" ||
    scheduler.status === "not-applicable"
  ) {
    for (const key of [
      "applicationOwnsSharedTicker",
      "applicationRootCount",
      "applicationTickerListenerCount",
      "sharedTickerListenerCount",
      "sharedTickerRafCount",
    ] as const) {
      if (scheduler[key] !== null) {
        throw new TypeError(`raw evidence.probe.raf.scheduler.${key} must be null.`);
      }
    }
    const expectedProvenance = scheduler.status === "unsupported"
      ? "telemetry-unavailable"
      : "no-renderer";
    if (scheduler.provenance !== expectedProvenance) {
      throw new TypeError("raw evidence.probe.raf.scheduler.provenance is invalid.");
    }
  } else {
    throw new TypeError("raw evidence.probe.raf.scheduler.status is invalid.");
  }
  if ("notes" in scheduler &&
      (typeof scheduler.notes !== "string" || scheduler.notes.length === 0)) {
    throw new TypeError("raw evidence.probe.raf.scheduler.notes must be non-empty.");
  }
  if (
    scheduler.provenance !== "production-runtime-telemetry" &&
    scheduler.provenance !== "telemetry-unavailable" &&
    scheduler.provenance !== "no-renderer"
  ) {
    throw new TypeError("raw evidence.probe.raf.scheduler.provenance is invalid.");
  }
  const inactiveWindows = requireRecord(
    raf.inactiveWindows,
    "raw evidence.probe.raf.inactiveWindows",
  );
  const inactiveStates: readonly InactiveRafStateId[] = [
    "reduced-motion",
    "paused",
    "offscreen",
    "hidden",
  ];
  assertExactKeys(
    inactiveWindows,
    inactiveStates,
    "raw evidence.probe.raf.inactiveWindows",
  );
  for (const state of inactiveStates) {
    const label = `raw evidence.probe.raf.inactiveWindows.${state}`;
    const inactive = requireRecord(inactiveWindows[state], label);
    if (inactive.status === "measured") {
      assertExactKeys(
        inactive,
        ["status", "startTime", "endTime", "samples"],
        label,
      );
      assertNonNegativeFinite(inactive.startTime, `${label}.startTime`);
      assertNonNegativeFinite(inactive.endTime, `${label}.endTime`);
      assertNonNegativeSamples(inactive.samples, `${label}.samples`, 1);
      continue;
    }
    assertExactKeys(inactive, ["status", "notes"], label);
    if (inactive.status !== "unsupported" && inactive.status !== "not-run") {
      throw new TypeError(`${label}.status is invalid.`);
    }
    if (typeof inactive.notes !== "string" || inactive.notes.length === 0) {
      throw new TypeError(`${label}.notes must be non-empty.`);
    }
  }

  const webgl = requireRecord(probe.webgl, "raw evidence.probe.webgl");
  assertExactKeys(
    webgl,
    rawEvidenceSchema.$defs.probe.properties.webgl.required,
    "raw evidence.probe.webgl",
  );
  for (const key of rawEvidenceSchema.$defs.probe.properties.webgl.required) {
    assertNonNegativeSamples(webgl[key], `raw evidence.probe.webgl.${key}`);
  }
  assertNonNegativeSamples(
    probe.canvasDprSamples,
    "raw evidence.probe.canvasDprSamples",
  );
  if (!Array.isArray(probe.canvasBackingSizeSamples)) {
    throw new TypeError("raw evidence.probe.canvasBackingSizeSamples must be an array.");
  }
  for (const [index, candidate] of probe.canvasBackingSizeSamples.entries()) {
    const sample = requireRecord(
      candidate,
      `raw evidence.probe.canvasBackingSizeSamples[${index}]`,
    );
    const keys = [
      "backingWidth",
      "backingHeight",
      "clientWidth",
      "clientHeight",
      "dpr",
    ];
    assertExactKeys(
      sample,
      keys,
      `raw evidence.probe.canvasBackingSizeSamples[${index}]`,
    );
    for (const key of keys) {
      assertPositiveFinite(
        sample[key],
        `raw evidence.probe.canvasBackingSizeSamples[${index}].${key}`,
      );
    }
  }

  assertNonNegativeSamples(
    probe.longTaskDurationMs,
    "raw evidence.probe.longTaskDurationMs",
  );
  assertLongTasks(probe.longTasks);
  const longTaskWindow = requireRecord(
    probe.longTaskWindow,
    "raw evidence.probe.longTaskWindow",
  );
  assertExactKeys(
    longTaskWindow,
    ["startTime", "endTime"],
    "raw evidence.probe.longTaskWindow",
  );
  if (longTaskWindow.startTime !== null) {
    assertNonNegativeFinite(
      longTaskWindow.startTime,
      "raw evidence.probe.longTaskWindow.startTime",
    );
  }
  assertNonNegativeFinite(
    longTaskWindow.endTime,
    "raw evidence.probe.longTaskWindow.endTime",
  );

  const performanceEvidence = requireRecord(
    probe.performance,
    "raw evidence.probe.performance",
  );
  assertExactKeys(
    performanceEvidence,
    ["lcpMs", "inpMs", "clsSamples", "tbtMs"],
    "raw evidence.probe.performance",
  );
  for (const key of ["lcpMs", "inpMs", "clsSamples", "tbtMs"] as const) {
    assertNonNegativeSamples(
      performanceEvidence[key],
      `raw evidence.probe.performance.${key}`,
    );
  }
  assertResources(probe.resources);

  const dom = requireRecord(probe.dom, "raw evidence.probe.dom");
  assertExactKeys(
    dom,
    ["activeJewelCountSamples", "visualPhase", "canvasCount"],
    "raw evidence.probe.dom",
  );
  assertNonNegativeSamples(
    dom.activeJewelCountSamples,
    "raw evidence.probe.dom.activeJewelCountSamples",
  );
  if (dom.visualPhase !== null && typeof dom.visualPhase !== "string") {
    throw new TypeError("raw evidence.probe.dom.visualPhase must be string or null.");
  }
  assertNonNegativeInteger(dom.canvasCount, "raw evidence.probe.dom.canvasCount");
}

function assertProbeCapability(value: unknown, label: string): void {
  const capability = requireRecord(value, label);
  assertExactKeys(capability, ["supported", "installed", "observed"], label);
  for (const key of ["supported", "installed", "observed"] as const) {
    if (typeof capability[key] !== "boolean") {
      throw new TypeError(`${label}.${key} must be boolean.`);
    }
  }
}

function assertLongTasks(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new TypeError("raw evidence.probe.longTasks must be an array.");
  }
  for (const [index, candidate] of value.entries()) {
    const label = `raw evidence.probe.longTasks[${index}]`;
    const task = requireRecord(candidate, label);
    assertExactKeys(task, ["name", "startTime", "duration", "attribution"], label);
    if (typeof task.name !== "string") throw new TypeError(`${label}.name must be a string.`);
    assertNonNegativeFinite(task.startTime, `${label}.startTime`);
    assertNonNegativeFinite(task.duration, `${label}.duration`);
    if (!Array.isArray(task.attribution)) {
      throw new TypeError(`${label}.attribution must be an array.`);
    }
    for (const [attributionIndex, candidateAttribution] of task.attribution.entries()) {
      const attributionLabel = `${label}.attribution[${attributionIndex}]`;
      const attribution = requireRecord(candidateAttribution, attributionLabel);
      const keys = [
        "name",
        "containerType",
        "containerName",
        "containerId",
        "containerSrc",
      ];
      assertExactKeys(attribution, keys, attributionLabel);
      for (const key of keys) {
        if (typeof attribution[key] !== "string") {
          throw new TypeError(`${attributionLabel}.${key} must be a string.`);
        }
      }
    }
  }
}

function assertResources(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new TypeError("raw evidence.probe.resources must be an array.");
  }
  for (const [index, candidate] of value.entries()) {
    const label = `raw evidence.probe.resources[${index}]`;
    const resource = requireRecord(candidate, label);
    assertExactKeys(
      resource,
      [
        "name",
        "initiatorType",
        "transferSize",
        "encodedBodySize",
        "decodedBodySize",
        "duration",
      ],
      label,
    );
    if (typeof resource.name !== "string" || resource.name.length === 0) {
      throw new TypeError(`${label}.name must be non-empty.`);
    }
    if (typeof resource.initiatorType !== "string") {
      throw new TypeError(`${label}.initiatorType must be a string.`);
    }
    for (const key of [
      "transferSize",
      "encodedBodySize",
      "decodedBodySize",
      "duration",
    ] as const) {
      assertNonNegativeFinite(resource[key], `${label}.${key}`);
    }
  }
}

function assertCertificationCollection(
  value: unknown,
  label: string,
  expectedIds: readonly string[],
): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const entry = requireRecord(candidate, `${label}[${index}]`);
    assertExactKeys(entry, ["id", "status", "notes"], `${label}[${index}]`, ["notes"]);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new TypeError(`${label}[${index}].id must be a non-empty string.`);
    }
    if (!expectedIds.includes(entry.id)) {
      throw new TypeError(`${label}.${entry.id} is unexpected.`);
    }
    if (seen.has(entry.id)) {
      throw new TypeError(`${label}.${entry.id} is duplicated.`);
    }
    seen.add(entry.id);
    if (
      entry.status !== "passed" &&
      entry.status !== "failed" &&
      entry.status !== "unsupported" &&
      entry.status !== "not-run"
    ) {
      throw new TypeError(`${label}[${index}].status is invalid.`);
    }
    if ("notes" in entry && typeof entry.notes !== "string") {
      throw new TypeError(`${label}[${index}].notes must be a string.`);
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) throw new TypeError(`${label}.${id} is missing.`);
  }
}

function assertRawSamples(
  id: AutomatedMetricId,
  samples: unknown,
): asserts samples is readonly number[] {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some(
      (sample) => typeof sample !== "number" || !Number.isFinite(sample) || sample < 0,
    )
  ) {
    throw new TypeError(`${id} requires non-negative finite raw samples.`);
  }
}

function assertNonNegativeSamples(
  value: unknown,
  label: string,
  minimumLength = 0,
): asserts value is readonly number[] {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new TypeError(`${label} must be an array with at least ${minimumLength} samples.`);
  }
  for (const sample of value) assertNonNegativeFinite(sample, label);
}

function assertNonNegativeFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must contain only non-negative finite numbers.`);
  }
}

function assertPositiveFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive and finite.`);
  }
}

function assertNonNegativeInteger(
  value: unknown,
  label: string,
  minimum = 0,
): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} has unexpected property ${key}.`);
  }
  for (const key of allowed) {
    if (!optionalSet.has(key) && !(key in value)) {
      throw new TypeError(`${label} is missing ${key}.`);
    }
  }
}

async function writeArtifact(
  filename: string,
  contents: string,
  root: string,
): Promise<string> {
  const directory = join(root, "test-results", "presence-evidence");
  const artifactPath = join(directory, filename);
  await mkdir(directory, { recursive: true });
  await writeFile(artifactPath, contents, "utf8");
  return artifactPath;
}
