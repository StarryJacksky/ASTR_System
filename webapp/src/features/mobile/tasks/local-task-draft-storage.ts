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
