import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_TASK_DRAFT_STORAGE_KEY,
  type LocalTaskDraft,
} from "./local-task-draft";
import { createLocalTaskDraftStorage } from "./local-task-draft-storage";

const VALID_DRAFT: LocalTaskDraft = {
  schema_version: 1,
  draft_id: "local_draft_1",
  text: "只在此浏览器保存",
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:00.000Z",
};

function storageWith(initial: string | null = null): Storage & {
  readonly getItem: ReturnType<typeof vi.fn>;
  readonly setItem: ReturnType<typeof vi.fn>;
} {
  let value = initial;
  return {
    get length() { return value === null ? 0 : 1; },
    clear: vi.fn(() => { value = null; }),
    getItem: vi.fn(() => value),
    key: vi.fn(() => (value === null ? null : LOCAL_TASK_DRAFT_STORAGE_KEY)),
    removeItem: vi.fn(() => { value = null; }),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}

describe("createLocalTaskDraftStorage", () => {
  it("reads a missing key as an empty valid collection", () => {
    const native = storageWith();
    const result = createLocalTaskDraftStorage(native).read();

    expect(native.getItem).toHaveBeenCalledWith(LOCAL_TASK_DRAFT_STORAGE_KEY);
    expect(result).toEqual({ ok: true, drafts: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.drafts)).toBe(true);
  });

  it("reads and canonicalizes a valid versioned array", () => {
    const result = createLocalTaskDraftStorage(
      storageWith(JSON.stringify([VALID_DRAFT])),
    ).read();

    expect(result).toEqual({ ok: true, drafts: [VALID_DRAFT] });
    expect(Object.getPrototypeOf(result.drafts[0])).toBeNull();
  });

  it.each(["not json", "{}", JSON.stringify([{ ...VALID_DRAFT, task_id: "fake" }])])(
    "returns malformed for invalid stored payload %s",
    (payload) => {
      expect(createLocalTaskDraftStorage(storageWith(payload)).read()).toEqual({
        ok: false,
        drafts: [],
        reason: "malformed",
      });
    },
  );

  it("returns unavailable when getItem throws", () => {
    const native = storageWith();
    native.getItem.mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });

    expect(createLocalTaskDraftStorage(native).read()).toEqual({
      ok: false,
      drafts: [],
      reason: "unavailable",
    });
  });

  it("writes the exact validated canonical projection once", () => {
    const native = storageWith();
    const adapter = createLocalTaskDraftStorage(native);

    expect(adapter.write([VALID_DRAFT])).toBe(true);
    expect(native.setItem).toHaveBeenCalledTimes(1);
    expect(native.setItem).toHaveBeenCalledWith(
      LOCAL_TASK_DRAFT_STORAGE_KEY,
      JSON.stringify([VALID_DRAFT]),
    );
  });

  it("refuses an invalid write before setItem", () => {
    const native = storageWith();
    const adapter = createLocalTaskDraftStorage(native);
    const invalid = [{ ...VALID_DRAFT, text: " " }] as unknown as LocalTaskDraft[];

    expect(adapter.write(invalid)).toBe(false);
    expect(native.setItem).not.toHaveBeenCalled();
  });

  it("returns false when setItem throws", () => {
    const native = storageWith();
    native.setItem.mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(createLocalTaskDraftStorage(native).write([VALID_DRAFT])).toBe(false);
  });

  it("captures no browser singleton and owns no network capability", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/mobile/tasks/local-task-draft-storage.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/window\.|localStorage|sessionStorage|fetch\s*\(|navigator\.|\/v1\//);
  });
});
