import type { AstrEvent } from "@/lib/types";

export const PRESENCE_SSE_EVENT_NAMES = [
  "agent.thought",
  "soul.stream",
  "soul.decision",
  "presentation.express",
  "moa.report",
] as const;

export type PresenceSseEventName = (typeof PRESENCE_SSE_EVENT_NAMES)[number];
export type PresenceTransportState = "connecting" | "open" | "retrying" | "closed";
export type PresenceStreamDiagnosticReason = "json" | "shape" | "type-mismatch";

export interface PresenceStreamDiagnostic {
  readonly code: "MALFORMED_SSE_FRAME";
  readonly eventName: PresenceSseEventName;
  readonly reason: PresenceStreamDiagnosticReason;
  readonly at: number;
}

export interface PresenceEventSource {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  close(): void;
}

export type PresenceEventSourceFactory = (url: string) => PresenceEventSource;

export interface PresenceStreamOptions {
  readonly url?: string;
  readonly eventSourceFactory?: PresenceEventSourceFactory;
  readonly now?: () => number;
  readonly onEvent: (event: AstrEvent) => void;
  readonly onState: (state: PresenceTransportState) => void;
  readonly onDiagnostic?: (diagnostic: PresenceStreamDiagnostic) => void;
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonCloneResult = { readonly valid: true; readonly value: JsonValue } | { readonly valid: false };
type Registration = readonly [type: string, listener: EventListener];
type ParsedEvent =
  | { readonly valid: true; readonly event: AstrEvent }
  | { readonly valid: false; readonly reason: Exclude<PresenceStreamDiagnosticReason, "json"> };

const DEFAULT_SSE_BASE = "http://127.0.0.1:8300";

export class PresenceStream {
  private readonly url: string;
  private readonly eventSourceFactory: PresenceEventSourceFactory;
  private readonly now: () => number;
  private readonly onEvent: (event: AstrEvent) => void;
  private readonly onState: (state: PresenceTransportState) => void;
  private readonly onDiagnostic: (diagnostic: PresenceStreamDiagnostic) => void;
  private readonly registrations: Registration[] = [];
  private source: PresenceEventSource | null = null;
  private state: PresenceTransportState | null = null;
  private started = false;
  private closed = false;

  constructor(options: PresenceStreamOptions) {
    this.url = options.url ?? defaultStreamUrl();
    this.eventSourceFactory = options.eventSourceFactory ?? ((url) => new EventSource(url));
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    this.onState = options.onState;
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.emitState("connecting");
    if (this.closed) return;

    const source = this.eventSourceFactory(this.url);
    this.source = source;
    this.register("open", () => {
      if (!this.closed) this.emitState("open");
    });
    this.register("error", () => {
      if (!this.closed) this.emitState("retrying");
    });
    for (const eventName of PRESENCE_SSE_EVENT_NAMES) {
      this.register(eventName, (event) => this.acceptEvent(eventName, event));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const source = this.source;
    if (source) {
      for (const [type, listener] of this.registrations) {
        source.removeEventListener(type, listener);
      }
      this.registrations.length = 0;
      source.close();
      this.source = null;
    }
    this.emitState("closed");
  }

  private register(type: string, listener: EventListener): void {
    const source = this.source;
    if (!source || this.closed) return;
    this.registrations.push([type, listener]);
    source.addEventListener(type, listener);
  }

  private acceptEvent(eventName: PresenceSseEventName, event: Event): void {
    if (this.closed) return;
    const data = (event as MessageEvent<unknown>).data;
    if (typeof data !== "string") {
      this.report(eventName, "shape");
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      this.report(eventName, "json");
      return;
    }

    const parsed = parseAstrEvent(value, eventName);
    if (!parsed.valid) {
      this.report(eventName, parsed.reason);
      return;
    }
    this.onEvent(parsed.event);
  }

  private report(eventName: PresenceSseEventName, reason: PresenceStreamDiagnosticReason): void {
    this.onDiagnostic({ code: "MALFORMED_SSE_FRAME", eventName, reason, at: this.now() });
  }

  private emitState(state: PresenceTransportState): void {
    if (this.state === state) return;
    this.state = state;
    this.onState(state);
  }
}

function defaultStreamUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_ASTR_CORE ?? DEFAULT_SSE_BASE;
  return `${baseUrl.replace(/\/+$/, "")}/v1/stream`;
}

function parseAstrEvent(value: unknown, eventName: PresenceSseEventName): ParsedEvent {
  if (!isPlainRecord(value)) return { valid: false, reason: "shape" };
  const id = own(value, "id");
  const ts = own(value, "ts");
  const type = own(value, "type");
  const source = own(value, "source");
  const traceId = own(value, "trace_id");
  if (typeof type === "string" && type !== eventName) {
    return { valid: false, reason: "type-mismatch" };
  }
  const payload = cloneJsonRecord(own(value, "payload"));
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(ts) ||
    type !== eventName ||
    !isNonBlankString(source) ||
    !isNonBlankString(traceId) ||
    payload === null
  ) {
    return { valid: false, reason: "shape" };
  }
  return {
    valid: true,
    event: { id, ts, type: eventName, source, payload, trace_id: traceId },
  };
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
    Object.defineProperty(cloned, key, {
      value: result.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { valid: true, value: cloned };
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
