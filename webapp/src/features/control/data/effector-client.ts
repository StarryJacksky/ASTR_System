import type {
  EffectorAudit,
  EffectorAuditEntry,
  EffectorClient,
  EffectorPolicy,
  EffectorStatus,
  EffectorStopResult,
  PolicyPatch,
} from "./effector-types";

export type {
  EffectorAudit,
  EffectorAuditEntry,
  EffectorClient,
  EffectorPolicy,
  EffectorStatus,
  EffectorStopResult,
  PolicyPatch,
} from "./effector-types";

export type EffectorClientOperation =
  | "policy"
  | "patch-policy"
  | "audit"
  | "status"
  | "estop"
  | "reset";

export type EffectorClientErrorKind =
  | "input"
  | "network"
  | "http"
  | "json"
  | "remote"
  | "shape";

export class EffectorClientError extends Error {
  readonly name = "EffectorClientError";

  constructor(
    readonly kind: EffectorClientErrorKind,
    readonly operation: EffectorClientOperation,
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type EffectorFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface EffectorClientOptions {
  readonly fetch?: EffectorFetch;
  readonly baseUrl?: string;
}

type JsonValue = null | string | number | boolean | JsonValue[] | JsonRecord;
type JsonRecord = { [key: string]: JsonValue };
type JsonCloneResult =
  | { readonly valid: true; readonly value: JsonValue }
  | { readonly valid: false };

const DEFAULT_BASE_URL = "/api/core";

export function createEffectorClient(options: EffectorClientOptions = {}): EffectorClient {
  const fetchImpl: EffectorFetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);

  return Object.freeze({
    policy: (signal?: AbortSignal) =>
      requestJson(
        fetchImpl,
        baseUrl,
        "policy",
        "/v1/admin/effector/policy",
        { cache: "no-store", signal },
        parsePolicy,
      ),
    patchPolicy: (patch: PolicyPatch, signal?: AbortSignal) => {
      const body = parsePolicyPatch(patch);
      if (body === null) {
        return Promise.reject(
          new EffectorClientError(
            "input",
            "patch-policy",
            "patch-policy received an invalid patch",
          ),
        );
      }
      return requestJson(
        fetchImpl,
        baseUrl,
        "patch-policy",
        "/v1/admin/effector/policy",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
        parsePolicy,
      );
    },
    audit: (date?: string, limit?: number, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (date !== undefined) params.set("date", date);
      params.set("limit", String(normalizeAuditLimit(limit)));
      return requestJson(
        fetchImpl,
        baseUrl,
        "audit",
        `/v1/admin/effector/audit?${params.toString()}`,
        { cache: "no-store", signal },
        parseAudit,
      );
    },
    status: (signal?: AbortSignal) =>
      requestJson(
        fetchImpl,
        baseUrl,
        "status",
        "/v1/effector/status",
        { cache: "no-store", signal },
        parseStatus,
      ),
    estop: (signal?: AbortSignal) =>
      requestJson(
        fetchImpl,
        baseUrl,
        "estop",
        "/v1/effector/estop",
        { method: "POST", signal },
        parseStopResult,
      ),
    reset: (signal?: AbortSignal) =>
      requestJson(
        fetchImpl,
        baseUrl,
        "reset",
        "/v1/effector/estop/reset",
        { method: "POST", signal },
        parseStopResult,
      ),
  });
}

async function requestJson<T>(
  fetchImpl: EffectorFetch,
  baseUrl: string,
  operation: EffectorClientOperation,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, init);
  } catch (cause) {
    throw new EffectorClientError(
      "network",
      operation,
      `${operation} request failed`,
      undefined,
      cause,
    );
  }

  if (!response.ok) {
    throw new EffectorClientError(
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
    throw new EffectorClientError(
      "json",
      operation,
      `${operation} returned invalid JSON`,
      undefined,
      cause,
    );
  }

  if (isPlainRecord(value) && Object.hasOwn(value, "error")) {
    throw new EffectorClientError(
      "remote",
      operation,
      `${operation} returned an error response`,
    );
  }

  let parsed: T | null = null;
  try {
    parsed = parse(value);
  } catch {
    // Treat unusual accessors/proxies as an invalid response without surfacing their details.
  }
  if (parsed === null) {
    throw new EffectorClientError(
      "shape",
      operation,
      `${operation} returned an invalid response shape`,
    );
  }
  return parsed;
}

function parsePolicy(value: unknown): EffectorPolicy | null {
  if (!isPlainRecord(value)) return null;
  const approvalMode = own(value, "approval_mode");
  const headlessScope = own(value, "headless_scope");
  const headlessCwd = own(value, "headless_cwd");
  const headlessFolders = parseStringArray(own(value, "headless_folders"));
  const appWhitelist = parseStringArray(own(value, "app_whitelist"));
  const loginSitesWhitelist = parseStringArray(own(value, "login_sites_whitelist"));
  const dangerousCategories = parseStringArray(own(value, "dangerous_categories"));
  const dangerousKeywords = parseStringArray(own(value, "dangerous_keywords"));
  const maxSteps = own(value, "max_steps_per_task");
  const sandboxDir = own(value, "sandbox_dir");
  const coreDangerousCategories = parseStringArray(
    own(value, "core_dangerous_categories"),
  );
  const coreDangerousKeywords = parseStringArray(own(value, "core_dangerous_keywords"));
  const locked = parseStringArray(own(value, "locked"));
  const overlayPath = own(value, "overlay_path");

  if (
    !isOneOf(approvalMode, ["ask", "audited", "auto"]) ||
    !isOneOf(headlessScope, ["cwd", "folders", "full"]) ||
    typeof headlessCwd !== "string" ||
    headlessFolders === null ||
    appWhitelist === null ||
    loginSitesWhitelist === null ||
    dangerousCategories === null ||
    dangerousKeywords === null ||
    !isIntegerInRange(maxSteps, 1, 100) ||
    typeof sandboxDir !== "string" ||
    coreDangerousCategories === null ||
    coreDangerousKeywords === null ||
    locked === null ||
    typeof overlayPath !== "string"
  ) {
    return null;
  }

  return Object.freeze({
    approval_mode: approvalMode,
    headless_scope: headlessScope,
    headless_cwd: headlessCwd,
    headless_folders: headlessFolders,
    app_whitelist: appWhitelist,
    login_sites_whitelist: loginSitesWhitelist,
    dangerous_categories: dangerousCategories,
    dangerous_keywords: dangerousKeywords,
    max_steps_per_task: maxSteps,
    sandbox_dir: sandboxDir,
    core_dangerous_categories: coreDangerousCategories,
    core_dangerous_keywords: coreDangerousKeywords,
    locked,
    overlay_path: overlayPath,
  });
}

function parsePolicyPatch(value: unknown): Readonly<Record<string, unknown>> | null {
  if (
    !isPlainRecord(value) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.keys(value).length === 0
  ) {
    return null;
  }

  const patch = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const field = own(value, key);
    switch (key) {
      case "approval_mode":
        if (!isOneOf(field, ["ask", "audited", "auto"])) return null;
        defineOwn(patch, key, field);
        break;
      case "headless_scope":
        if (!isOneOf(field, ["cwd", "folders", "full"])) return null;
        defineOwn(patch, key, field);
        break;
      case "headless_cwd":
        if (typeof field !== "string") return null;
        defineOwn(patch, key, field);
        break;
      case "headless_folders":
      case "app_whitelist":
      case "login_sites_whitelist":
      case "dangerous_categories":
      case "dangerous_keywords": {
        const strings = parseStringArray(field);
        if (strings === null) return null;
        defineOwn(patch, key, strings);
        break;
      }
      case "max_steps_per_task":
        if (!isIntegerInRange(field, 1, 100)) return null;
        defineOwn(patch, key, field);
        break;
      default:
        return null;
    }
  }
  return Object.freeze(patch);
}

function parseAudit(value: unknown): EffectorAudit | null {
  if (!isPlainRecord(value)) return null;
  const dates = parseStringArray(own(value, "dates"));
  const date = own(value, "date");
  const entriesValue = own(value, "entries");
  const total = own(value, "total");
  const chainValid = own(value, "chain_valid");
  if (
    dates === null ||
    (date !== null && typeof date !== "string") ||
    !Array.isArray(entriesValue) ||
    (Object.hasOwn(value, "total") && !isNonNegativeInteger(total)) ||
    (chainValid !== null && typeof chainValid !== "boolean")
  ) {
    return null;
  }

  const entries: EffectorAuditEntry[] = [];
  for (const entryValue of entriesValue) {
    const entry = cloneJsonRecord(entryValue);
    if (
      entry === null ||
      typeof own(entry, "ts") !== "string" ||
      typeof own(entry, "trace_id") !== "string" ||
      typeof own(entry, "track") !== "string" ||
      typeof own(entry, "description") !== "string" ||
      typeof own(entry, "decision") !== "string" ||
      typeof own(entry, "dangerous") !== "boolean"
    ) {
      return null;
    }
    entries.push(entry as EffectorAuditEntry);
  }

  return Object.freeze({
    dates,
    date,
    entries: Object.freeze(entries),
    ...(Object.hasOwn(value, "total") ? { total: total as number } : {}),
    chain_valid: chainValid,
  });
}

function parseStatus(value: unknown): EffectorStatus | null {
  if (!isPlainRecord(value)) return null;
  const stopped = own(value, "stopped");
  const pending = cloneJsonRecord(own(value, "pending"));
  const auditTailValue = own(value, "audit_tail");
  if (typeof stopped !== "boolean" || pending === null || !Array.isArray(auditTailValue)) {
    return null;
  }

  const auditTail: Readonly<Record<string, unknown>>[] = [];
  for (const entryValue of auditTailValue) {
    const entry = cloneJsonRecord(entryValue);
    if (entry === null) return null;
    auditTail.push(entry);
  }
  return Object.freeze({
    stopped,
    pending,
    audit_tail: Object.freeze(auditTail),
  });
}

function parseStopResult(value: unknown): EffectorStopResult | null {
  if (!isPlainRecord(value)) return null;
  const stopped = own(value, "stopped");
  return typeof stopped === "boolean" ? Object.freeze({ stopped }) : null;
}

function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return Object.freeze([...value]);
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
    if (Object.getOwnPropertySymbols(value).length > 0) return { valid: false };
    const cloned: JsonValue[] = [];
    for (const item of value) {
      const result = cloneJsonValue(item, nextAncestors);
      if (!result.valid) return result;
      cloned.push(result.value);
    }
    return { valid: true, value: Object.freeze(cloned) as unknown as JsonValue[] };
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return { valid: false };
  }

  const cloned = Object.create(null) as JsonRecord;
  for (const key of Object.keys(value)) {
    const result = cloneJsonValue(value[key], nextAncestors);
    if (!result.valid) return result;
    defineOwn(cloned, key, result.value);
  }
  return { valid: true, value: Object.freeze(cloned) };
}

function normalizeAuditLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOneOf<const T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
