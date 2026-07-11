import type {
  CoreStatus,
  EffectorPendingAction,
  EffectorStatus,
  EffectorStopResult,
  IngestReceipt,
  SoulEmotion,
  TranscriptionResult,
} from "@/lib/types";

export type CoreClientOperation =
  | "status"
  | "ingest"
  | "transcribe"
  | "effector-status"
  | "estop"
  | "reset";

export type CoreClientErrorKind = "network" | "http" | "json" | "shape";

export class CoreClientError extends Error {
  readonly name = "CoreClientError";

  constructor(
    readonly kind: CoreClientErrorKind,
    readonly operation: CoreClientOperation,
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type CoreFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CoreClientOptions {
  readonly fetch?: CoreFetch;
  readonly baseUrl?: string;
}

export interface IngestRequest {
  readonly text: string;
  readonly platform?: string;
  readonly lang?: string;
  readonly user_id?: string;
}

export interface CoreClient {
  status(signal?: AbortSignal): Promise<CoreStatus>;
  ingest(request: IngestRequest, signal?: AbortSignal): Promise<IngestReceipt>;
  transcribe(wavB64: string, signal?: AbortSignal): Promise<TranscriptionResult>;
  effectorStatus(signal?: AbortSignal): Promise<EffectorStatus>;
  estop(signal?: AbortSignal): Promise<EffectorStopResult>;
  reset(signal?: AbortSignal): Promise<EffectorStopResult>;
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonCloneResult = { readonly valid: true; readonly value: JsonValue } | { readonly valid: false };

const DEFAULT_BASE_URL = "/api/core";

export function createCoreClient(options: CoreClientOptions = {}): CoreClient {
  const fetchImpl: CoreFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);

  return {
    status: (signal) =>
      request(fetchImpl, baseUrl, "status", "/v1/status", { cache: "no-store", signal }, parseStatus),
    ingest: (input, signal) => {
      const body: IngestRequest = {
        text: input.text,
        ...(input.platform === undefined ? {} : { platform: input.platform }),
        ...(input.lang === undefined ? {} : { lang: input.lang }),
        ...(input.user_id === undefined ? {} : { user_id: input.user_id }),
      };
      return request(
        fetchImpl,
        baseUrl,
        "ingest",
        "/v1/ingest",
        jsonPost(body, signal),
        parseIngestReceipt,
      );
    },
    transcribe: (wavB64, signal) =>
      request(
        fetchImpl,
        baseUrl,
        "transcribe",
        "/v1/voice/transcribe",
        jsonPost({ wav_b64: wavB64 }, signal),
        parseTranscription,
      ),
    effectorStatus: (signal) =>
      request(
        fetchImpl,
        baseUrl,
        "effector-status",
        "/v1/effector/status",
        { cache: "no-store", signal },
        parseEffectorStatus,
      ),
    estop: (signal) =>
      request(
        fetchImpl,
        baseUrl,
        "estop",
        "/v1/effector/estop",
        { method: "POST", signal },
        parseEffectorStopResult,
      ),
    reset: (signal) =>
      request(
        fetchImpl,
        baseUrl,
        "reset",
        "/v1/effector/estop/reset",
        { method: "POST", signal },
        parseEffectorStopResult,
      ),
  };
}

async function request<T>(
  fetchImpl: CoreFetch,
  baseUrl: string,
  operation: CoreClientOperation,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, init);
  } catch (cause) {
    throw new CoreClientError("network", operation, `${operation} request failed`, undefined, cause);
  }

  if (!response.ok) {
    throw new CoreClientError(
      "http",
      operation,
      `${operation} returned HTTP ${response.status}`,
      response.status,
    );
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new CoreClientError("json", operation, `${operation} returned invalid JSON`, undefined, cause);
  }

  const parsed = parse(value);
  if (parsed === null) {
    throw new CoreClientError("shape", operation, `${operation} returned an invalid response shape`);
  }
  return parsed;
}

function jsonPost(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseStatus(value: unknown): CoreStatus | null {
  if (!isPlainRecord(value) || !isPlainRecord(own(value, "emotion"))) return null;
  const emotion = parseEmotion(own(value, "emotion"));
  const soulName = own(value, "soul_name");
  const displayName = own(value, "display_name");
  const model = own(value, "local_llm_model");
  const cost = own(value, "cost_today_usd");
  const budget = own(value, "daily_budget_usd");
  const activity = own(value, "activity");
  if (
    typeof soulName !== "string" ||
    typeof model !== "string" ||
    !isFiniteNumber(cost) ||
    !isFiniteNumber(budget) ||
    emotion === null ||
    (Object.hasOwn(value, "display_name") && typeof displayName !== "string") ||
    (Object.hasOwn(value, "activity") && typeof activity !== "string")
  ) {
    return null;
  }
  return {
    soul_name: soulName,
    ...(displayName === undefined ? {} : { display_name: displayName as string }),
    local_llm_model: model,
    cost_today_usd: cost,
    daily_budget_usd: budget,
    emotion,
    ...(activity === undefined ? {} : { activity: activity as string }),
  };
}

function parseEmotion(value: unknown): SoulEmotion | null {
  if (!isPlainRecord(value)) return null;
  const loneliness = own(value, "loneliness");
  const talkativeness = own(value, "talkativeness");
  const irritation = own(value, "irritation");
  const excitement = own(value, "excitement");
  const updatedAt = own(value, "updated_at");
  if (
    !isUnitInterval(loneliness) ||
    !isUnitInterval(talkativeness) ||
    !isUnitInterval(irritation) ||
    !isUnitInterval(excitement) ||
    (Object.hasOwn(value, "updated_at") && typeof updatedAt !== "string")
  ) {
    return null;
  }
  return {
    loneliness,
    talkativeness,
    irritation,
    excitement,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt as string }),
  };
}

function parseIngestReceipt(value: unknown): IngestReceipt | null {
  if (!isPlainRecord(value)) return null;
  const eventId = own(value, "event_id");
  const traceId = own(value, "trace_id");
  if (!isNonBlankString(eventId) || !isNonBlankString(traceId)) return null;
  return { event_id: eventId, trace_id: traceId };
}

function parseTranscription(value: unknown): TranscriptionResult | null {
  if (!isPlainRecord(value)) return null;
  const text = own(value, "text");
  return typeof text === "string" ? { text } : null;
}

function parseEffectorStatus(value: unknown): EffectorStatus | null {
  if (!isPlainRecord(value)) return null;
  const stopped = own(value, "stopped");
  const pendingValue = own(value, "pending");
  const auditValue = own(value, "audit_tail");
  if (typeof stopped !== "boolean" || !isPlainRecord(pendingValue) || !Array.isArray(auditValue)) {
    return null;
  }

  const pending = Object.create(null) as Record<string, EffectorPendingAction>;
  for (const key of Object.keys(pendingValue)) {
    const entry = pendingValue[key];
    if (!isPlainRecord(entry)) return null;
    const summary = own(entry, "summary");
    const tool = own(entry, "tool");
    if (typeof summary !== "string" || typeof tool !== "string") return null;
    defineOwn(pending, key, { summary, tool });
  }

  const auditTail: Readonly<Record<string, unknown>>[] = [];
  for (const entry of auditValue) {
    const cloned = cloneJsonRecord(entry);
    if (cloned === null) return null;
    auditTail.push(cloned);
  }
  return { stopped, pending, audit_tail: auditTail };
}

function parseEffectorStopResult(value: unknown): EffectorStopResult | null {
  if (!isPlainRecord(value)) return null;
  const stopped = own(value, "stopped");
  return typeof stopped === "boolean" ? { stopped } : null;
}

function cloneJsonRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!isPlainRecord(value)) return null;
  const result = cloneJsonValue(value, []);
  return result.valid && isPlainRecord(result.value) ? result.value : null;
}

function cloneJsonValue(value: unknown, ancestors: readonly object[]): JsonCloneResult {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { valid: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  }
  if (typeof value !== "object" || ancestors.includes(value)) return { valid: false };
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    const cloned: JsonValue[] = [];
    for (const item of value) {
      const result = cloneJsonValue(item, nextAncestors);
      if (!result.valid) return result;
      cloned.push(result.value);
    }
    return { valid: true, value: cloned };
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return { valid: false };
  }
  const cloned = Object.create(null) as { [key: string]: JsonValue };
  for (const key of Object.keys(value)) {
    const result = cloneJsonValue(value[key], nextAncestors);
    if (!result.valid) return result;
    defineOwn(cloned, key, result.value);
  }
  return { valid: true, value: cloned };
}

function defineOwn<T extends object>(target: T, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
