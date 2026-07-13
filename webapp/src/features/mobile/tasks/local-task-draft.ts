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
    text.length > LOCAL_TASK_DRAFT_TEXT_LIMIT ||
    text.trim().length === 0 ||
    !isCanonicalIso(created_at) ||
    !isCanonicalIso(updated_at) ||
    Date.parse(created_at) > Date.parse(updated_at)
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
