import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_TASK_DRAFT_LIMIT,
  LOCAL_TASK_DRAFT_TEXT_LIMIT,
  decodeLocalTaskDrafts,
  type LocalTaskDraft,
} from "./local-task-draft";

const VALID_DRAFT: LocalTaskDraft = {
  schema_version: 1,
  draft_id: "local_draft_00000000-0000-4000-8000-000000000001",
  text: "整理今天的记录",
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:01.000Z",
};

function decodeOne(overrides: Record<string, unknown> = {}) {
  return decodeLocalTaskDrafts([{ ...VALID_DRAFT, ...overrides }]);
}

describe("decodeLocalTaskDrafts", () => {
  it("returns null-prototype deeply frozen canonical copies", () => {
    const input = [{ ...VALID_DRAFT }];
    const result = decodeLocalTaskDrafts(input);

    expect(result).toEqual({ ok: true, drafts: [VALID_DRAFT] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.drafts)).toBe(true);
    expect(Object.isFrozen(result.drafts[0])).toBe(true);
    expect(Object.getPrototypeOf(result.drafts[0])).toBeNull();
    expect(result.drafts[0]).not.toBe(input[0]);
  });

  it("accepts the exact upper count and text limits", () => {
    const drafts = Array.from({ length: LOCAL_TASK_DRAFT_LIMIT }, (_, index) => ({
      ...VALID_DRAFT,
      draft_id: `local_draft_${String(index).padStart(2, "0")}`,
      text: index === 0 ? "星".repeat(LOCAL_TASK_DRAFT_TEXT_LIMIT) : `draft ${index}`,
    }));

    const result = decodeLocalTaskDrafts(drafts);
    expect(result.ok).toBe(true);
    expect(result.drafts).toHaveLength(12);
    expect(result.drafts[0]?.text).toHaveLength(4000);
  });

  it("rejects an extended positive created year after a four-digit updated year", () => {
    const result = decodeOne({ created_at: "+010000-01-01T00:00:00.000Z" });

    expect(result.ok).toBe(false);
  });

  it("accepts a four-digit created year before an extended positive updated year", () => {
    const result = decodeOne({ updated_at: "+010000-01-01T00:00:00.000Z" });

    expect(result.ok).toBe(true);
  });

  it("rejects overlong text without invoking trim", () => {
    const trim = vi.spyOn(String.prototype, "trim");
    let trimCallCount = -1;
    let result: ReturnType<typeof decodeOne>;

    try {
      result = decodeOne({ text: "x".repeat(LOCAL_TASK_DRAFT_TEXT_LIMIT + 1) });
      trimCallCount = trim.mock.calls.length;
    } finally {
      trim.mockRestore();
    }

    expect(result.ok).toBe(false);
    expect(trimCallCount).toBe(0);
  });

  it.each([
    ["top-level null", null],
    ["top-level record", {}],
    ["top-level string", "drafts"],
    ["record null", [null]],
    ["record array", [[]]],
    ["missing field", [{ schema_version: 1 }]],
    ["extra field", [{ ...VALID_DRAFT, task_id: "fake" }]],
    ["bad schema", [{ ...VALID_DRAFT, schema_version: 2 }]],
    ["bad id prefix", [{ ...VALID_DRAFT, draft_id: "task_1" }]],
    ["empty id suffix", [{ ...VALID_DRAFT, draft_id: "local_draft_" }]],
    ["unsafe id suffix", [{ ...VALID_DRAFT, draft_id: "local_draft_has space" }]],
    ["empty text", [{ ...VALID_DRAFT, text: "" }]],
    ["whitespace text", [{ ...VALID_DRAFT, text: " \n\t" }]],
    ["overlong text", [{ ...VALID_DRAFT, text: "x".repeat(4001) }]],
    ["invalid created time", [{ ...VALID_DRAFT, created_at: "today" }]],
    ["noncanonical created time", [{ ...VALID_DRAFT, created_at: "2026-07-13T00:00:00Z" }]],
    ["invalid updated time", [{ ...VALID_DRAFT, updated_at: "never" }]],
    [
      "created after updated",
      [{ ...VALID_DRAFT, created_at: "2026-07-13T00:00:02.000Z" }],
    ],
    ["thirteen drafts", Array.from({ length: 13 }, (_, i) => ({
      ...VALID_DRAFT,
      draft_id: `local_draft_${i}`,
    }))],
    ["duplicate id", [VALID_DRAFT, { ...VALID_DRAFT }]],
  ])("rejects %s", (_name, input) => {
    expect(decodeLocalTaskDrafts(input)).toEqual({
      ok: false,
      drafts: [],
      reason: "malformed",
    });
  });

  it("rejects prototype and symbol keys", () => {
    const prototypeKey = JSON.parse(
      `[{"schema_version":1,"draft_id":"local_draft_x","text":"x","created_at":"2026-07-13T00:00:00.000Z","updated_at":"2026-07-13T00:00:00.000Z","__proto__":{}}]`,
    );
    const symbolKey = { ...VALID_DRAFT, [Symbol("secret")]: "hidden" };

    expect(decodeLocalTaskDrafts(prototypeKey).ok).toBe(false);
    expect(decodeLocalTaskDrafts([symbolKey]).ok).toBe(false);
  });

  it("rejects non-string timestamps before attempting canonical date parsing", () => {
    expect(decodeOne({ created_at: null }).ok).toBe(false);
  });

  it("rejects an exact-length record that substitutes an unknown key", () => {
    const substituted = { ...VALID_DRAFT } as Record<string, unknown>;
    delete substituted.text;
    substituted.task_id = "remote_task_1";

    expect(decodeLocalTaskDrafts([substituted]).ok).toBe(false);
  });

  it("rejects accessor records without invoking their getters", () => {
    let invoked = false;
    const accessor = { ...VALID_DRAFT } as Record<string, unknown>;
    Object.defineProperty(accessor, "text", {
      enumerable: true,
      get() {
        invoked = true;
        return "secret";
      },
    });

    expect(decodeLocalTaskDrafts([accessor]).ok).toBe(false);
    expect(invoked).toBe(false);
  });

  it("fails closed on hostile reflection traps", () => {
    const hostile = new Proxy({ ...VALID_DRAFT }, {
      ownKeys() {
        throw new Error("secret trap");
      },
    });

    expect(decodeLocalTaskDrafts([hostile])).toEqual({
      ok: false,
      drafts: [],
      reason: "malformed",
    });
  });

  it("preserves valid user whitespace instead of trimming the stored body", () => {
    const result = decodeOne({ text: "  有意留白  " });
    expect(result.ok).toBe(true);
    expect(result.drafts[0]?.text).toBe("  有意留白  ");
  });
});
