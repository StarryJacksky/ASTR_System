import { describe, expect, it, vi } from "vitest";

import type { AstrEvent } from "@/lib/types";

import {
  PRESENCE_SSE_EVENT_NAMES,
  PresenceStream,
  type PresenceEventSource,
  type PresenceEventSourceFactory,
  type PresenceStreamDiagnostic,
  type PresenceTransportState,
} from "./presence-stream";

type Listener = EventListenerOrEventListenerObject;

function invokeListener(listener: Listener, event: Event) {
  if (typeof listener === "function") listener(event);
  else listener.handleEvent(event);
}

class FakeEventSource implements PresenceEventSource {
  readonly added: Array<{ type: string; listener: Listener }> = [];
  readonly removed: Array<{ type: string; listener: Listener }> = [];
  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    this.added.push({ type, listener });
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.removed.push({ type, listener });
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data?: string): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of [...(this.listeners.get(type) ?? [])]) invokeListener(listener, event);
  }

  firstAdded(type: string): Listener {
    const listener = this.added.find((entry) => entry.type === type)?.listener;
    if (!listener) throw new Error(`Missing ${type} listener`);
    return listener;
  }
}

function wireEvent(type: string, id = `evt-${type}`): string {
  return JSON.stringify({
    id,
    ts: "2026-07-11T08:00:00Z",
    type,
    source: "soul.orchestrator",
    payload: {},
    trace_id: `trace-${type}`,
    schema_version: "1.0",
    auth: { astr_user_id: "owner", level: 2 },
  });
}

function setup(url = "http://core.test/v1/stream") {
  const source = new FakeEventSource();
  const eventSourceFactory = vi.fn<PresenceEventSourceFactory>(() => source);
  const events: AstrEvent[] = [];
  const states: PresenceTransportState[] = [];
  const diagnostics: PresenceStreamDiagnostic[] = [];
  const stream = new PresenceStream({
    url,
    eventSourceFactory,
    now: () => 1234,
    onEvent: (event) => events.push(event),
    onState: (state) => states.push(state),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { stream, source, eventSourceFactory, events, states, diagnostics };
}

describe("PresenceStream", () => {
  it("uses one physical source for every named reply and life event without replay claims", () => {
    const { stream, source, eventSourceFactory, events } = setup();

    stream.start();
    stream.start();

    expect(PRESENCE_SSE_EVENT_NAMES).toEqual([
      "agent.thought",
      "soul.stream",
      "soul.decision",
      "presentation.express",
      "moa.report",
    ]);
    expect(eventSourceFactory).toHaveBeenCalledTimes(1);
    expect(eventSourceFactory).toHaveBeenCalledWith("http://core.test/v1/stream");
    expect(eventSourceFactory.mock.calls[0]?.[0]).not.toMatch(/[?&](?:cursor|lastEventId|replay)=/i);
    expect(new Set(source.added.map(({ type }) => type))).toEqual(
      new Set(["open", "error", ...PRESENCE_SSE_EVENT_NAMES]),
    );
    expect(source.added.some(({ type }) => type === "message")).toBe(false);

    for (const eventName of PRESENCE_SSE_EVENT_NAMES) {
      source.emit(eventName, wireEvent(eventName));
    }

    expect(events.map(({ type }) => type)).toEqual(PRESENCE_SSE_EVENT_NAMES);
    expect(events.map(({ id }) => id)).toEqual(
      PRESENCE_SSE_EVENT_NAMES.map((eventName) => `evt-${eventName}`),
    );
    expect(eventSourceFactory).toHaveBeenCalledTimes(1);
  });

  it("uses native EventSource reconnection for deterministic state transitions", () => {
    vi.useFakeTimers();
    try {
      const { stream, source, eventSourceFactory, states } = setup();

      stream.start();
      source.emit("open");
      source.emit("error");

      expect(states).toEqual(["connecting", "open", "retrying"]);
      expect(source.close).not.toHaveBeenCalled();
      expect(eventSourceFactory).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      source.emit("open");
      stream.close();

      expect(states).toEqual(["connecting", "open", "retrying", "open", "closed"]);
      expect(source.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("diagnoses and skips malformed frames without affecting a later valid event", () => {
    const { stream, source, events, states, diagnostics } = setup();
    stream.start();
    source.emit("open");

    source.emit("agent.thought", "not-json");
    source.emit("agent.thought", wireEvent("soul.decision", "evt-mismatch"));
    source.emit(
      "moa.report",
      JSON.stringify({
        id: " ",
        ts: "2026-07-11T08:00:00Z",
        type: "moa.report",
        source: "soul.moa",
        payload: {},
        trace_id: "trace-moa",
      }),
    );

    source.emit("soul.stream", wireEvent("soul.stream", "evt-valid-after-malformed"));

    expect(diagnostics).toEqual([
      {
        code: "MALFORMED_SSE_FRAME",
        eventName: "agent.thought",
        reason: "json",
        at: 1234,
      },
      {
        code: "MALFORMED_SSE_FRAME",
        eventName: "agent.thought",
        reason: "type-mismatch",
        at: 1234,
      },
      {
        code: "MALFORMED_SSE_FRAME",
        eventName: "moa.report",
        reason: "shape",
        at: 1234,
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("evt-valid-after-malformed");
    expect(states).toEqual(["connecting", "open"]);
    expect(source.close).not.toHaveBeenCalled();
  });

  it("returns an owned JSON-safe payload with dangerous keys preserved as data", () => {
    const { stream, source, events } = setup();
    stream.start();
    source.emit(
      "soul.decision",
      '{"id":"evt-owned","ts":"2026-07-11T08:00:00Z","type":"soul.decision","source":"soul.orchestrator","payload":{"__proto__":{"reply_text":"nested"},"constructor":"owned","prototype":"owned","nested":{"__proto__":{"x":1}}},"trace_id":"trace-owned"}',
    );

    const payload = events[0]?.payload;
    expect(payload).toBeDefined();
    expect(Object.hasOwn(payload ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(payload ?? {}, "constructor")).toBe(true);
    expect(Object.hasOwn(payload ?? {}, "prototype")).toBe(true);
    expect(Object.getPrototypeOf(payload)).toBeNull();
    expect(Object.getPrototypeOf(payload?.nested)).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toEqual(
      JSON.parse(
        '{"__proto__":{"reply_text":"nested"},"constructor":"owned","prototype":"owned","nested":{"__proto__":{"x":1}}}',
      ),
    );
  });

  it("removes the exact listeners, closes once, and ignores late callbacks", () => {
    const { stream, source, eventSourceFactory, events, states, diagnostics } = setup();
    stream.start();
    const lateEvent = source.firstAdded("soul.stream");
    const lateOpen = source.firstAdded("open");
    const added = [...source.added];

    stream.close();
    stream.close();
    stream.start();

    expect(source.removed).toHaveLength(added.length);
    for (const registration of added) {
      expect(source.removed).toContainEqual(registration);
    }
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(eventSourceFactory).toHaveBeenCalledTimes(1);

    invokeListener(lateEvent, new MessageEvent("soul.stream", { data: wireEvent("soul.stream") }));
    invokeListener(lateOpen, new Event("open"));

    expect(events).toEqual([]);
    expect(diagnostics).toEqual([]);
    expect(states).toEqual(["connecting", "closed"]);
  });

  it("is terminal when closed before start and derives the default URL without a cursor", () => {
    const first = setup();
    first.stream.close();
    first.stream.start();
    expect(first.eventSourceFactory).not.toHaveBeenCalled();
    expect(first.states).toEqual(["closed"]);

    vi.stubEnv("NEXT_PUBLIC_ASTR_CORE", "http://env-core.test/");
    try {
      const source = new FakeEventSource();
      const factory = vi.fn<PresenceEventSourceFactory>(() => source);
      const stream = new PresenceStream({
        eventSourceFactory: factory,
        onEvent: vi.fn(),
        onState: vi.fn(),
        onDiagnostic: vi.fn(),
      });
      stream.start();
      expect(factory).toHaveBeenCalledWith("http://env-core.test/v1/stream");
      stream.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
