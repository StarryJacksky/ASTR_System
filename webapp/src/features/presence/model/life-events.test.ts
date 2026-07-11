import { describe, expect, it } from "vitest";

import type { AstrEvent } from "@/lib/types";

import {
  LIFE_PROJECTION_DIAGNOSTIC_CAPACITY,
  LIFE_SUMMARY_CAPACITY,
  formatUtcTimestamp,
  projectLifeEvents,
} from "./life-events";

function event(
  type: string,
  id: string,
  payload: Readonly<Record<string, unknown>>,
  overrides: Partial<AstrEvent> = {},
): AstrEvent {
  return {
    id,
    type,
    payload,
    source: "soul.orchestrator",
    trace_id: `trace-${id}`,
    ts: "2026-07-11T03:04:05.000Z",
    ...overrides,
  };
}

describe("projectLifeEvents", () => {
  it("locks the visible summary capacity to 60", () => {
    expect(LIFE_SUMMARY_CAPACITY).toBe(60);
  });

  it("projects one truthful summary per supported event and keeps activity separate", () => {
    const projection = projectLifeEvents(
      [
        event("agent.thought", "thought-1", { text: "  正在整理上下文  ", stage: "recall" }),
        event("moa.report", "moa-1", {
          summary: "多席位意见已经汇总",
          seats: [{ seat: "logic", suggested_strategy: "不要展开成第二条" }],
        }),
        event("soul.decision", "decision-1", { reply_text: "这是权威终稿" }),
        event("soul.stream", "stream-1", { delta: "不可进入生活区", seq: 1 }),
        event("presentation.express", "express-1", { text: "也不可进入" }),
      ],
      "  正在阅读  ",
    );

    expect(projection.currentActivity).toEqual({
      text: "正在阅读",
      source: "Core status",
      occurredAt: null,
    });
    expect(projection.summaries).toEqual([
      {
        id: "thought-1",
        eventType: "agent.thought",
        kind: "processing",
        label: "处理片段",
        text: "正在整理上下文",
        source: "soul.orchestrator",
        occurredAt: "2026-07-11T03:04:05.000Z",
      },
      {
        id: "moa-1",
        eventType: "moa.report",
        kind: "processing",
        label: "处理片段",
        text: "多席位意见已经汇总",
        source: "soul.orchestrator",
        occurredAt: "2026-07-11T03:04:05.000Z",
      },
      {
        id: "decision-1",
        eventType: "soul.decision",
        kind: "record",
        label: "生活记录",
        text: "这是权威终稿",
        source: "soul.orchestrator",
        occurredAt: "2026-07-11T03:04:05.000Z",
      },
    ]);
    expect(projection.diagnostics).toEqual([]);
  });

  it("accepts only own non-blank payload strings and reports malformed supported events", () => {
    const inherited = Object.create({ text: "继承字段不能读取" }) as Record<string, unknown>;
    const projection = projectLifeEvents([
      event("agent.thought", "inherited", inherited),
      event("moa.report", "blank", { summary: "   " }),
      event("soul.decision", "wrong-type", { reply_text: 42 }),
      event("agent.thought", "valid", { text: "真实自有字段" }, { ts: "invalid" }),
    ]);

    expect(projection.summaries).toEqual([
      expect.objectContaining({ id: "valid", text: "真实自有字段", occurredAt: null }),
    ]);
    expect(projection.diagnostics).toHaveLength(3);
    expect(projection.diagnostics.map(({ eventId }) => eventId)).toEqual([
      "inherited",
      "blank",
      "wrong-type",
    ]);
    expect(projection.currentActivity).toBeNull();
  });

  it("preserves arrival order, keeps the first duplicate id, and caps summaries", () => {
    const events = Array.from({ length: LIFE_SUMMARY_CAPACITY + 5 }, (_, index) =>
      event("agent.thought", `event-${index}`, { text: `片段 ${index}` }),
    );
    events.splice(
      2,
      0,
      event("soul.decision", "event-1", { reply_text: "重复 id 不得覆盖第一条" }),
    );

    const projection = projectLifeEvents(events);

    expect(projection.summaries).toHaveLength(LIFE_SUMMARY_CAPACITY);
    expect(projection.summaries[0]?.id).toBe("event-5");
    expect(projection.summaries.at(-1)?.id).toBe(`event-${LIFE_SUMMARY_CAPACITY + 4}`);
    expect(projection.summaries.some(({ text }) => text.includes("不得覆盖"))).toBe(false);
  });

  it("keeps first-id arrival semantics in a small sequence", () => {
    const projection = projectLifeEvents([
      event("agent.thought", "first", { text: "第一条" }),
      event("soul.decision", "first", { reply_text: "同 id 后到，不得替换" }),
      event("moa.report", "second", { summary: "第二条" }),
    ]);

    expect(projection.summaries.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "first", text: "第一条" },
      { id: "second", text: "第二条" },
    ]);
  });

  it("accepts null-prototype payloads and never falls through to another event field", () => {
    const nullPrototypePayload = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nullPrototypePayload, "text", {
      value: "null prototype 的真实文本",
      enumerable: true,
    });
    const projection = projectLifeEvents([
      event("agent.thought", "null-prototype", nullPrototypePayload),
      event("moa.report", "wrong-moa-field", { text: "不能串读 text" }),
      event("soul.decision", "wrong-decision-field", { summary: "不能串读 summary" }),
    ]);

    expect(projection.summaries).toEqual([
      expect.objectContaining({ id: "null-prototype", text: "null prototype 的真实文本" }),
    ]);
    expect(projection.diagnostics.map(({ eventId }) => eventId)).toEqual([
      "wrong-moa-field",
      "wrong-decision-field",
    ]);
  });

  it("bounds malformed-event diagnostics independently of visible summaries", () => {
    const malformedCount = LIFE_PROJECTION_DIAGNOSTIC_CAPACITY + 7;
    const projection = projectLifeEvents(
      Array.from({ length: malformedCount }, (_, index) =>
        event("agent.thought", `bad-${index}`, { text: " " }),
      ),
    );

    expect(projection.summaries).toEqual([]);
    expect(projection.diagnostics).toHaveLength(LIFE_PROJECTION_DIAGNOSTIC_CAPACITY);
    expect(projection.diagnostics[0]?.eventId).toBe("bad-7");
    expect(projection.malformedCount).toBe(malformedCount);
  });

  it("formats valid timestamps in deterministic UTC and never fabricates invalid time", () => {
    expect(formatUtcTimestamp(Date.UTC(2026, 6, 11, 3, 4, 5))).toEqual({
      dateTime: "2026-07-11T03:04:05.000Z",
      label: "2026-07-11 · 03:04 UTC",
    });
    expect(formatUtcTimestamp("2026-07-11T11:04:05+08:00")).toEqual({
      dateTime: "2026-07-11T03:04:05.000Z",
      label: "2026-07-11 · 03:04 UTC",
    });
    expect(formatUtcTimestamp("not-a-date")).toBeNull();
    expect(formatUtcTimestamp("2026-07-11T03:04:05")).toBeNull();
    expect(formatUtcTimestamp(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("rejects RFC3339 calendar overflow instead of accepting Date normalization", () => {
    expect(formatUtcTimestamp("2026-02-29T03:04:05Z")).toBeNull();
    expect(formatUtcTimestamp("2026-04-31T03:04:05Z")).toBeNull();
  });

  it("validates the local calendar date before applying an RFC3339 offset", () => {
    expect(formatUtcTimestamp("2023-02-29T23:30:00+08:00")).toBeNull();
    expect(formatUtcTimestamp("2024-02-29T23:30:00+08:00")).toEqual({
      dateTime: "2024-02-29T15:30:00.000Z",
      label: "2024-02-29 · 15:30 UTC",
    });
  });
});
