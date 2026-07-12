import rawAssetLock from "../../../../live2d-assets.lock.json";

export type Live2DAssetKind =
  | "core"
  | "model"
  | "moc"
  | "texture"
  | "physics"
  | "pose"
  | "expression"
  | "motion"
  | "audio";

export interface Live2DAssetDescriptor {
  readonly kind: Live2DAssetKind;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly url: string;
}

export interface Live2DAssetLock {
  readonly schemaVersion: 1;
  readonly publicBasePath: string;
  readonly localRoot: string;
  readonly modelEntry: string;
  readonly modelSource: {
    readonly repository: string;
    readonly commit: string;
    readonly license: string;
    readonly licenseUrl: string;
    readonly sampleTermsUrl: string;
    readonly samplePageUrl: string;
    readonly requiredCopyrightNotice: string;
  };
  readonly coreSource: {
    readonly url: string;
    readonly snapshotDate: string;
    readonly versionPolicy: string;
    readonly license: string;
    readonly licenseUrl: string;
  };
  readonly knownMissingOptionalReferences: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  readonly assets: readonly Live2DAssetDescriptor[];
}

export interface Live2DAssetFingerprint {
  readonly bytes: number;
  readonly sha256: string;
}

export interface Live2DAssetInventoryAssessment {
  readonly ready: boolean;
  readonly missing: string[];
  readonly mismatched: string[];
}

export interface Live2DAssetResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface VerifyLive2DAssetInventoryOptions {
  readonly signal?: AbortSignal;
  readonly fetcher?: (
    url: string,
    init: { readonly signal?: AbortSignal; readonly cache: "no-cache" },
  ) => Promise<Live2DAssetResponse>;
  readonly digest?: (bytes: ArrayBuffer) => Promise<string>;
}

export interface Live2DModelReferenceAssessment {
  readonly missingRequired: string[];
  readonly knownMissingOptional: string[];
  readonly missingOptional: string[];
  readonly invalidReferences: string[];
}

export interface EnsureCubismCoreOptions {
  readonly document: Document;
  readonly global: { Live2DCubismCore?: unknown };
  readonly src: string;
  readonly signal?: AbortSignal;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

export const LIVE2D_ASSET_LOCK = deepFreeze(
  rawAssetLock as Live2DAssetLock,
) as Live2DAssetLock;

export function assessLive2DAssetInventory(
  lock: Pick<Live2DAssetLock, "assets">,
  inventory: ReadonlyMap<string, Live2DAssetFingerprint>,
): Live2DAssetInventoryAssessment {
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const asset of lock.assets) {
    const actual = inventory.get(asset.path);
    if (!actual) {
      missing.push(asset.path);
      continue;
    }

    if (
      actual.bytes !== asset.bytes ||
      actual.sha256.toLowerCase() !== asset.sha256.toLowerCase()
    ) {
      mismatched.push(asset.path);
    }
  }

  return {
    ready: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

export async function verifyLive2DAssetInventory(
  lock: Pick<Live2DAssetLock, "assets" | "publicBasePath">,
  {
    signal,
    fetcher = fetchLocalAsset,
    digest = digestSha256,
  }: VerifyLive2DAssetInventoryOptions = {},
): Promise<Live2DAssetInventoryAssessment> {
  if (signal?.aborted) throw abortError();
  const inventory = new Map<string, Live2DAssetFingerprint>();
  const publicBase = lock.publicBasePath.replace(/\/$/, "");

  await Promise.all(
    lock.assets.map(async (asset) => {
      const response = await fetcher(`${publicBase}/${asset.path}`, {
        signal,
        cache: "no-cache",
      });
      if (!response.ok) return;
      const bytes = await response.arrayBuffer();
      if (signal?.aborted) throw abortError();
      const sha256 = (await digest(bytes)).toLowerCase();
      if (signal?.aborted) throw abortError();
      inventory.set(asset.path, {
        bytes: bytes.byteLength,
        sha256,
      });
    }),
  );

  return assessLive2DAssetInventory(lock, inventory);
}

async function fetchLocalAsset(
  url: string,
  init: { readonly signal?: AbortSignal; readonly cache: "no-cache" },
): Promise<Live2DAssetResponse> {
  if (typeof fetch !== "function") {
    throw new Error("Live2D asset verification requires the browser Fetch API.");
  }
  return fetch(url, {
    cache: init.cache,
    credentials: "same-origin",
    signal: init.signal,
  });
}

async function digestSha256(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Live2D asset verification requires Web Crypto SHA-256.");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normaliseAssetPath(path: string): string | undefined {
  const parts: string[] = [];
  const cleanPath = path.replaceAll("\\", "/").replace(/^\/+/, "");

  for (const part of cleanPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

function resolveModelReference(modelPath: string, reference: string): string | undefined {
  if (
    reference.includes("\\") ||
    reference.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
  ) {
    return undefined;
  }
  const modelDirectory = modelPath.replaceAll("\\", "/").split("/").slice(0, -1);
  const resolved = normaliseAssetPath([...modelDirectory, reference].join("/"));
  return resolved && /^(?:core|haru|shizuku)\//.test(resolved)
    ? resolved
    : undefined;
}

function addReference(
  target: Set<string>,
  invalid: Set<string>,
  modelPath: string,
  reference: unknown,
  label: string,
  required = false,
): void {
  if (reference === undefined || reference === null) {
    if (required) invalid.add(`${label}: missing`);
    return;
  }
  if (typeof reference !== "string" || reference.length === 0) {
    invalid.add(`${label}: expected non-empty string`);
    return;
  }
  const resolved = resolveModelReference(modelPath, reference);
  if (resolved) target.add(resolved);
  else invalid.add(reference);
}

export function validateLive2DModelReferences(
  model: unknown,
  modelPath: string,
  lock: Pick<Live2DAssetLock, "assets" | "knownMissingOptionalReferences">,
): Live2DModelReferenceAssessment {
  const required = new Set<string>();
  const optional = new Set<string>();
  const invalid = new Set<string>();
  const modelRecord = isRecord(model) ? model : {};
  const rawFileReferences = modelRecord.FileReferences;
  const hasFileReferences = isRecord(rawFileReferences);
  const fileReferences: Record<string, unknown> = hasFileReferences
    ? rawFileReferences
    : {};
  if (!hasFileReferences) invalid.add("FileReferences: expected object");

  addReference(required, invalid, modelPath, fileReferences.Moc, "Moc", true);
  for (const key of ["Physics", "Pose", "UserData"] as const) {
    addReference(required, invalid, modelPath, fileReferences[key], key);
  }

  if (Array.isArray(fileReferences.Textures)) {
    if (fileReferences.Textures.length === 0) invalid.add("Textures: empty");
    for (const [index, texture] of fileReferences.Textures.entries()) {
      addReference(required, invalid, modelPath, texture, `Textures[${index}]`, true);
    }
  } else {
    invalid.add("Textures: expected non-empty array");
  }

  if (Array.isArray(fileReferences.Expressions)) {
    for (const [index, expression] of fileReferences.Expressions.entries()) {
      if (isRecord(expression)) {
        addReference(
          required,
          invalid,
          modelPath,
          expression.File,
          `Expressions[${index}].File`,
          true,
        );
      } else invalid.add(`Expressions[${index}]: expected object`);
    }
  } else if (fileReferences.Expressions !== undefined) {
    invalid.add("Expressions: expected array");
  }

  if (isRecord(fileReferences.Motions)) {
    for (const [groupName, group] of Object.entries(fileReferences.Motions)) {
      if (!Array.isArray(group)) {
        invalid.add(`Motions.${groupName}: expected array`);
        continue;
      }
      for (const [index, motion] of group.entries()) {
        if (!isRecord(motion)) {
          invalid.add(`Motions.${groupName}[${index}]: expected object`);
          continue;
        }
        addReference(
          required,
          invalid,
          modelPath,
          motion.File,
          `Motions.${groupName}[${index}].File`,
          true,
        );
        addReference(
          required,
          invalid,
          modelPath,
          motion.Sound,
          `Motions.${groupName}[${index}].Sound`,
        );
      }
    }
  } else if (fileReferences.Motions !== undefined) {
    invalid.add("Motions: expected object");
  }

  addReference(
    optional,
    invalid,
    modelPath,
    fileReferences.DisplayInfo,
    "DisplayInfo",
  );

  const available = new Set(lock.assets.map((asset) => asset.path));
  const knownMissing = new Set(
    lock.knownMissingOptionalReferences.map((reference) => reference.path),
  );
  const missingRequired = [...required].filter((path) => !available.has(path)).sort();
  const knownMissingOptional = [...optional]
    .filter((path) => !available.has(path) && knownMissing.has(path))
    .sort();
  const missingOptional = [...optional]
    .filter((path) => !available.has(path) && !knownMissing.has(path))
    .sort();

  return {
    missingRequired,
    knownMissingOptional,
    missingOptional,
    invalidReferences: [...invalid].sort(),
  };
}

const coreLoads = new WeakMap<Document, Map<string, Promise<void>>>();

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The Cubism Core load was aborted.", "AbortError");
  }

  const error = new Error("The Cubism Core load was aborted.");
  error.name = "AbortError";
  return error;
}

function waitWithAbort(shared: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function ensureCubismCore({
  document,
  global,
  src,
  signal,
}: EnsureCubismCoreOptions): Promise<void> {
  if (global.Live2DCubismCore) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError());

  let documentLoads = coreLoads.get(document);
  if (!documentLoads) {
    documentLoads = new Map();
    coreLoads.set(document, documentLoads);
  }

  const existingLoad = documentLoads.get(src);
  if (existingLoad) return waitWithAbort(existingLoad, signal);

  const sharedLoad = new Promise<void>((resolve, reject) => {
    const staleScript = [...document.scripts].find(
      (candidate) => candidate.getAttribute("src") === src,
    );
    staleScript?.remove();
    const script = document.createElement("script");

    const cleanupListeners = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = (message: string) => {
      cleanupListeners();
      script.remove();
      reject(new Error(message));
    };
    const onLoad = () => {
      if (!global.Live2DCubismCore) {
        fail("Cubism Core script loaded without exposing Live2DCubismCore.");
        return;
      }
      cleanupListeners();
      resolve();
    };
    const onError = () => fail(`Cubism Core failed to load from ${src}.`);

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    script.src = src;
    script.async = true;
    script.dataset.astrLive2dCore = "true";
    document.head.append(script);
  });

  documentLoads.set(src, sharedLoad);
  void sharedLoad.then(
    () => {
      if (documentLoads?.get(src) === sharedLoad) documentLoads.delete(src);
    },
    () => {
      if (documentLoads?.get(src) === sharedLoad) documentLoads.delete(src);
    },
  );

  return waitWithAbort(sharedLoad, signal);
}
