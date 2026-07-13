import type {
  MobileLocalAuditProjection,
  MobileLocalPolicyProjection,
  MobileLocalStatusProjection,
  MobileSafetyClient,
} from "./mobile-safety-types";

export type MobileSafetyOperation = "status" | "policy" | "audit";

export type MobileSafetyClientErrorKind =
  | "network"
  | "http"
  | "json"
  | "remote"
  | "shape";

export class MobileSafetyClientError extends Error {
  readonly kind: MobileSafetyClientErrorKind;
  readonly operation: MobileSafetyOperation;
  readonly status?: number;

  constructor(
    kind: MobileSafetyClientErrorKind,
    operation: MobileSafetyOperation,
    message: string,
    status?: number,
  ) {
    super(message);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "MobileSafetyClientError",
    });
    this.kind = kind;
    this.operation = operation;
    if (status !== undefined) {
      Object.defineProperty(this, "status", {
        enumerable: true,
        value: status,
      });
    }
  }
}

export type MobileSafetyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface MobileSafetyClientOptions {
  readonly fetch?: MobileSafetyFetch;
}

type ProjectionParser<T> = (value: Readonly<Record<string, unknown>>) => T | null;

export function createMobileSafetyClient(
  options: MobileSafetyClientOptions = {},
): MobileSafetyClient {
  const fetchImpl: MobileSafetyFetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return Object.freeze({
    status: (signal?: AbortSignal) =>
      requestProjection(
        fetchImpl,
        "status",
        "/api/core/v1/effector/status",
        signal,
        parseStatus,
      ),
    policy: (signal?: AbortSignal) =>
      requestProjection(
        fetchImpl,
        "policy",
        "/api/core/v1/admin/effector/policy",
        signal,
        parsePolicy,
      ),
    audit: (signal?: AbortSignal) =>
      requestProjection(
        fetchImpl,
        "audit",
        "/api/core/v1/admin/effector/audit",
        signal,
        parseAudit,
      ),
  });
}

async function requestProjection<T>(
  fetchImpl: MobileSafetyFetch,
  operation: MobileSafetyOperation,
  path: string,
  signal: AbortSignal | undefined,
  parse: ProjectionParser<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "GET",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new MobileSafetyClientError(
      "network",
      operation,
      `${operation} request failed`,
    );
  }

  let ok: unknown;
  try {
    ok = response.ok;
  } catch {
    throw shapeError(operation);
  }
  if (typeof ok !== "boolean") throw shapeError(operation);

  if (!ok) {
    let status: unknown;
    try {
      status = response.status;
    } catch {
      throw shapeError(operation);
    }
    if (!isSafeIntegerInRange(status, 0, 999)) throw shapeError(operation);
    throw new MobileSafetyClientError(
      "http",
      operation,
      `${operation} returned HTTP ${status}`,
      status,
    );
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new MobileSafetyClientError(
      "json",
      operation,
      `${operation} returned invalid JSON`,
    );
  }

  let remoteError = false;
  let projection: T | null = null;
  try {
    if (isPlainSymbolFreeRecord(value)) {
      remoteError = Object.hasOwn(value, "error");
      if (!remoteError) projection = parse(value);
    }
  } catch {
    // Hostile accessors and proxy traps are invalid shape, never caller-visible causes.
  }

  if (remoteError) {
    throw new MobileSafetyClientError(
      "remote",
      operation,
      `${operation} returned an error response`,
    );
  }
  if (projection === null) throw shapeError(operation);
  return projection;
}

function parseStatus(
  value: Readonly<Record<string, unknown>>,
): MobileLocalStatusProjection | null {
  const stopped = own(value, "stopped");
  const pending = own(value, "pending");
  const auditTail = own(value, "audit_tail");
  if (
    typeof stopped !== "boolean" ||
    !isPlainSymbolFreeRecord(pending) ||
    !isSymbolFreeArray(auditTail)
  ) {
    return null;
  }

  const pendingCount = Object.keys(pending).length;
  const auditTailCount = auditTail.length;
  if (!isSafeIntegerInRange(auditTailCount, 0, Number.MAX_SAFE_INTEGER)) return null;
  return Object.freeze({
    stopped,
    pending_count: pendingCount,
    audit_tail_count: auditTailCount,
  });
}

function parsePolicy(
  value: Readonly<Record<string, unknown>>,
): MobileLocalPolicyProjection | null {
  const approvalMode = own(value, "approval_mode");
  const headlessScope = own(value, "headless_scope");
  const maxSteps = own(value, "max_steps_per_task");
  if (
    !isOneOf(approvalMode, ["ask", "audited", "auto"]) ||
    !isOneOf(headlessScope, ["cwd", "folders", "full"]) ||
    !isSafeIntegerInRange(maxSteps, 1, 100)
  ) {
    return null;
  }

  return Object.freeze({
    approval_mode: approvalMode,
    headless_scope: headlessScope,
    max_steps_per_task: maxSteps,
  });
}

function parseAudit(
  value: Readonly<Record<string, unknown>>,
): MobileLocalAuditProjection | null {
  const date = own(value, "date");
  const hasTotal = Object.hasOwn(value, "total");
  const total = hasTotal ? own(value, "total") : null;
  const chainValid = own(value, "chain_valid");
  if (
    (date !== null && typeof date !== "string") ||
    (hasTotal && !isSafeIntegerInRange(total, 0, Number.MAX_SAFE_INTEGER)) ||
    (chainValid !== null && typeof chainValid !== "boolean")
  ) {
    return null;
  }

  return Object.freeze({
    audit_date: date,
    audit_total: hasTotal ? (total as number) : null,
    chain_valid: chainValid,
  });
}

function shapeError(operation: MobileSafetyOperation): MobileSafetyClientError {
  return new MobileSafetyClientError(
    "shape",
    operation,
    `${operation} returned an invalid response shape`,
  );
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isPlainSymbolFreeRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isSymbolFreeArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getOwnPropertySymbols(value).length === 0;
}

function isOneOf<const T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
