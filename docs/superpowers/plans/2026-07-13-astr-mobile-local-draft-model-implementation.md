# ASTR Mobile Local Draft Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strict, fail-closed, deeply immutable local task-draft schema and an injected browser Storage adapter without creating any task, device, Dispatch, or network semantics.

**Architecture:** A pure decoder validates an unknown value through own data-property descriptors, rejects hostile/prototype/extra/symbol inputs, copies accepted records into null-prototype frozen objects, and enforces count/text/time/ID invariants. A separate adapter owns only the versioned localStorage key, distinguishes unavailable storage from malformed data, and validates again before every write.

**Tech Stack:** TypeScript, Web Storage interface, Vitest, Node source inspection.

## Global Constraints

- Create only four files under `webapp/src/features/mobile/tasks/`: model, model test, storage adapter, storage test.
- Storage key is exactly `astr.mobile.task-drafts.v1`; schema version is exactly `1`.
- A draft ID starts with `local_draft_`, never `task_id`; accepted suffix is 1..128 ASCII letters, digits, `_`, or `-`.
- Body text is 1..4000 JavaScript string code units after rejecting whitespace-only values; preserve the user's original whitespace when valid.
- At most 12 drafts; duplicate IDs are malformed.
- Times are canonical ISO strings where `new Date(value).toISOString() === value`; `created_at <= updated_at`.
- Reject missing/extra/prototype keys, symbol keys, accessors, arrays as records, hostile proxies, non-records, and non-finite/incorrect field types.
- Accepted records have a null prototype; each record, the array, and the result object are frozen.
- Storage read exceptions return `reason: "unavailable"`; parse/schema failures return `reason: "malformed"`.
- Invalid writes return false without calling `setItem`; successful writes persist only the revalidated canonical projection.
- No module captures `window.localStorage`; no fetch, clipboard, sessionStorage, Core client, device route, queue state, or backend change.
- Commands run from `D:\ASTR_System\astr\webapp`; Git commands run from `D:\ASTR_System\astr`.

---

### Task 1: Implement the strict local draft decoder

**Files:**

- Create: `webapp/src/features/mobile/tasks/local-task-draft.test.ts`
- Create: `webapp/src/features/mobile/tasks/local-task-draft.ts`

- [ ] **Step 1: Write the failing decoder tests**

Create `webapp/src/features/mobile/tasks/local-task-draft.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";

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
```

- [ ] **Step 2: Run the decoder test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/local-task-draft.test.ts
```

Expected: FAIL because `./local-task-draft` does not exist.

- [ ] **Step 3: Implement the strict decoder**

Create `webapp/src/features/mobile/tasks/local-task-draft.ts` with exactly:

```ts
export const LOCAL_TASK_DRAFT_STORAGE_KEY = "astr.mobile.task-drafts.v1";
export const LOCAL_TASK_DRAFT_LIMIT = 12;
export const LOCAL_TASK_DRAFT_TEXT_LIMIT = 4_000;

export interface LocalTaskDraft {
  readonly schema_version: 1;
  readonly draft_id: `local_draft_${string}`;
  readonly text: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type LocalDraftReadResult =
  | { readonly ok: true; readonly drafts: readonly LocalTaskDraft[] }
  | {
      readonly ok: false;
      readonly drafts: readonly [];
      readonly reason: "unavailable" | "malformed";
    };

const EXPECTED_KEYS = [
  "schema_version",
  "draft_id",
  "text",
  "created_at",
  "updated_at",
] as const;
const EXPECTED_KEY_SET = new Set<string>(EXPECTED_KEYS);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DRAFT_ID = /^local_draft_[A-Za-z0-9_-]{1,128}$/;
const EMPTY_DRAFTS = Object.freeze([]) as readonly [];
const MALFORMED_RESULT = Object.freeze({
  ok: false,
  drafts: EMPTY_DRAFTS,
  reason: "malformed",
} as const);

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function readOwnDataValues(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== EXPECTED_KEYS.length || keys.some((key) => typeof key !== "string")) {
    return null;
  }
  const stringKeys = keys as string[];
  if (
    stringKeys.some((key) => DANGEROUS_KEYS.has(key) || !EXPECTED_KEY_SET.has(key)) ||
    EXPECTED_KEYS.some((key) => !stringKeys.includes(key))
  ) {
    return null;
  }

  const values = Object.create(null) as Record<string, unknown>;
  for (const key of EXPECTED_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    values[key] = descriptor.value;
  }
  return values;
}

function decodeOne(value: unknown): LocalTaskDraft | null {
  const fields = readOwnDataValues(value);
  if (!fields) return null;
  const { schema_version, draft_id, text, created_at, updated_at } = fields;
  if (
    schema_version !== 1 ||
    typeof draft_id !== "string" ||
    !DRAFT_ID.test(draft_id) ||
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > LOCAL_TASK_DRAFT_TEXT_LIMIT ||
    !isCanonicalIso(created_at) ||
    !isCanonicalIso(updated_at) ||
    created_at > updated_at
  ) {
    return null;
  }

  const draft = Object.create(null) as {
    schema_version: 1;
    draft_id: `local_draft_${string}`;
    text: string;
    created_at: string;
    updated_at: string;
  };
  draft.schema_version = 1;
  draft.draft_id = draft_id as `local_draft_${string}`;
  draft.text = text;
  draft.created_at = created_at;
  draft.updated_at = updated_at;
  return Object.freeze(draft);
}

export function decodeLocalTaskDrafts(value: unknown): LocalDraftReadResult {
  try {
    if (!Array.isArray(value) || value.length > LOCAL_TASK_DRAFT_LIMIT) {
      return MALFORMED_RESULT;
    }
    const ids = new Set<string>();
    const drafts: LocalTaskDraft[] = [];
    for (const candidate of value) {
      const draft = decodeOne(candidate);
      if (!draft || ids.has(draft.draft_id)) return MALFORMED_RESULT;
      ids.add(draft.draft_id);
      drafts.push(draft);
    }
    return Object.freeze({ ok: true, drafts: Object.freeze(drafts) });
  } catch {
    return MALFORMED_RESULT;
  }
}
```

- [ ] **Step 4: Run the decoder test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/local-task-draft.test.ts
```

Expected: PASS.

### Task 2: Implement the injected versioned Storage adapter

**Files:**

- Create: `webapp/src/features/mobile/tasks/local-task-draft-storage.test.ts`
- Create: `webapp/src/features/mobile/tasks/local-task-draft-storage.ts`

- [ ] **Step 1: Write the failing Storage adapter tests**

Create `webapp/src/features/mobile/tasks/local-task-draft-storage.test.ts` with exactly:

```ts
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
```

- [ ] **Step 2: Run the Storage adapter test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/local-task-draft-storage.test.ts
```

Expected: FAIL because `./local-task-draft-storage` does not exist.

- [ ] **Step 3: Implement the injected Storage adapter**

Create `webapp/src/features/mobile/tasks/local-task-draft-storage.ts` with exactly:

```ts
import {
  LOCAL_TASK_DRAFT_STORAGE_KEY,
  decodeLocalTaskDrafts,
  type LocalDraftReadResult,
  type LocalTaskDraft,
} from "./local-task-draft";

export interface LocalTaskDraftStorage {
  readonly read: () => LocalDraftReadResult;
  readonly write: (drafts: readonly LocalTaskDraft[]) => boolean;
}

const EMPTY_DRAFTS = Object.freeze([]) as readonly [];
const EMPTY_RESULT = Object.freeze({ ok: true, drafts: EMPTY_DRAFTS } as const);
const UNAVAILABLE_RESULT = Object.freeze({
  ok: false,
  drafts: EMPTY_DRAFTS,
  reason: "unavailable",
} as const);
const MALFORMED_RESULT = Object.freeze({
  ok: false,
  drafts: EMPTY_DRAFTS,
  reason: "malformed",
} as const);

export function createLocalTaskDraftStorage(storage: Storage): LocalTaskDraftStorage {
  return Object.freeze({
    read(): LocalDraftReadResult {
      let raw: string | null;
      try {
        raw = storage.getItem(LOCAL_TASK_DRAFT_STORAGE_KEY);
      } catch {
        return UNAVAILABLE_RESULT;
      }
      if (raw === null) return EMPTY_RESULT;
      try {
        return decodeLocalTaskDrafts(JSON.parse(raw));
      } catch {
        return MALFORMED_RESULT;
      }
    },
    write(drafts: readonly LocalTaskDraft[]): boolean {
      const decoded = decodeLocalTaskDrafts(drafts);
      if (!decoded.ok) return false;
      try {
        storage.setItem(LOCAL_TASK_DRAFT_STORAGE_KEY, JSON.stringify(decoded.drafts));
        return true;
      } catch {
        return false;
      }
    },
  });
}
```

- [ ] **Step 4: Run the Storage adapter test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/local-task-draft-storage.test.ts
```

Expected: PASS.

### Task 3: Verify and commit the local draft foundation

- [ ] **Step 1: Run all local draft foundation tests**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/local-task-draft.test.ts src/features/mobile/tasks/local-task-draft-storage.test.ts
```

Expected: both files PASS.

- [ ] **Step 2: Run lint on the four files**

Run:

```powershell
npx eslint src/features/mobile/tasks/local-task-draft.ts src/features/mobile/tasks/local-task-draft.test.ts src/features/mobile/tasks/local-task-draft-storage.ts src/features/mobile/tasks/local-task-draft-storage.test.ts --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Scan production draft files for forbidden capability**

Run:

```powershell
rg -n "fetch\(|navigator\.|sessionStorage|/v1/|task_id|queued|running|completed|device" src/features/mobile/tasks/local-task-draft.ts src/features/mobile/tasks/local-task-draft-storage.ts
```

Expected: exit 1 with no matches.

- [ ] **Step 5: Stage the exact four foundation files**

Run from `D:\ASTR_System\astr`:

```powershell
git add webapp/src/features/mobile/tasks/local-task-draft.ts webapp/src/features/mobile/tasks/local-task-draft.test.ts webapp/src/features/mobile/tasks/local-task-draft-storage.ts webapp/src/features/mobile/tasks/local-task-draft-storage.test.ts
```

Expected: only the four files are staged.

- [ ] **Step 6: Commit the foundation**

Run from `D:\ASTR_System\astr`:

```powershell
git commit -m "feat: add strict browser-local Mobile drafts"
```

Expected: commit succeeds with the four local draft foundation files.
