"use client";

import { useEffect, useRef, useState } from "react";

import { semanticStore } from "@/lib/semantic-store";

import {
  LOCAL_TASK_DRAFT_LIMIT,
  LOCAL_TASK_DRAFT_TEXT_LIMIT,
  decodeLocalTaskDrafts,
  type LocalDraftReadResult,
  type LocalTaskDraft,
} from "./local-task-draft";
import {
  createLocalTaskDraftStorage,
  type LocalTaskDraftStorage,
} from "./local-task-draft-storage";
import styles from "./LocalTaskDraftRegion.module.css";

export interface LocalTaskDraftRegionProps {
  readonly storage?: LocalTaskDraftStorage;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

type StoragePhase = "checking" | "ready" | "unavailable";
type EditorConflict = "updated" | "deleted" | null;

interface EditSelection {
  readonly baseline: LocalTaskDraft;
}

interface StorageSnapshot {
  readonly adapter: LocalTaskDraftStorage;
  readonly drafts: readonly LocalTaskDraft[];
}

function createDefaultIdSeed() {
  try {
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // A local record key is not an authority identity; fall through to a non-secure seed.
  }
  const random = Math.random().toString(36).slice(2, 14) || "local";
  return `${Date.now().toString(36)}_${random}`;
}

function allocateDraftId(
  seed: string,
  drafts: readonly LocalTaskDraft[],
): LocalTaskDraft["draft_id"] | null {
  const base = seed.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "local";
  const ids = new Set(drafts.map(({ draft_id }) => draft_id));
  for (let suffix = 0; suffix <= LOCAL_TASK_DRAFT_LIMIT; suffix += 1) {
    const candidate = `local_draft_${base}${suffix === 0 ? "" : `_${suffix}`}` as LocalTaskDraft["draft_id"];
    if (!ids.has(candidate)) return candidate;
  }
  return null;
}

function sameRevision(left: LocalTaskDraft, right: LocalTaskDraft) {
  return (
    left.draft_id === right.draft_id &&
    left.text === right.text &&
    left.created_at === right.created_at &&
    left.updated_at === right.updated_at
  );
}

export function LocalTaskDraftRegion({
  storage,
  now = () => new Date(),
  createId = createDefaultIdSeed,
}: LocalTaskDraftRegionProps) {
  const storageRef = useRef<LocalTaskDraftStorage | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [drafts, setDrafts] = useState<readonly LocalTaskDraft[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<EditSelection | null>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [editorConflict, setEditorConflict] = useState<EditorConflict>(null);
  const [storagePhase, setStoragePhase] = useState<StoragePhase>("checking");
  const [notice, setNotice] = useState("核验本地存储");
  const dirty = text !== (editing?.baseline.text ?? "");

  useEffect(() => {
    let active = true;
    let adapter: LocalTaskDraftStorage | null = null;
    let result: LocalDraftReadResult | null = null;
    try {
      adapter = storage ?? createLocalTaskDraftStorage(window.localStorage);
      storageRef.current = adapter;
      result = adapter.read();
    } catch {
      if (adapter === null) storageRef.current = null;
    }

    queueMicrotask(() => {
      if (!active) return;
      if (result?.ok) {
        setDrafts(result.drafts);
        setStoragePhase("ready");
        setNotice("本地存储可用");
      } else {
        setDrafts([]);
        setStoragePhase("unavailable");
        setNotice(
          result?.reason === "malformed"
            ? "本地草稿不可读取，未持久化"
            : "本地存储不可用，未持久化",
        );
      }
    });

    return () => {
      active = false;
      if (storageRef.current === adapter) storageRef.current = null;
    };
  }, [storage]);

  const publish = (
    message: string,
    nextStoragePhase: StoragePhase,
    politeness: "polite" | "assertive" = "polite",
  ) => {
    setStoragePhase(nextStoragePhase);
    setNotice(message);
    semanticStore.getState().announce(message, politeness);
  };

  const readLatest = (): StorageSnapshot | null => {
    const adapter = storageRef.current;
    if (!adapter) {
      publish("本地存储不可用，未持久化", "unavailable", "assertive");
      return null;
    }
    let result: LocalDraftReadResult;
    try {
      result = adapter.read();
    } catch {
      publish("本地存储不可用，未持久化", "unavailable", "assertive");
      return null;
    }
    if (!result.ok) {
      publish(
        result.reason === "malformed"
          ? "本地草稿不可读取，未持久化"
          : "本地存储不可用，未持久化",
        "unavailable",
        "assertive",
      );
      return null;
    }
    return { adapter, drafts: result.drafts };
  };

  const persist = (
    snapshot: StorageSnapshot,
    next: readonly LocalTaskDraft[],
    success: string,
    failure: string,
  ) => {
    const canonical = decodeLocalTaskDrafts(next);
    let written = false;
    try {
      written = canonical.ok && snapshot.adapter.write(canonical.drafts);
    } catch {
      written = false;
    }
    if (!canonical.ok || !written) {
      setDrafts(snapshot.drafts);
      publish(failure, "unavailable", "assertive");
      return null;
    }
    setDrafts(canonical.drafts);
    publish(success, "ready");
    return canonical.drafts;
  };

  const save = () => {
    if (text.length > LOCAL_TASK_DRAFT_TEXT_LIMIT) {
      publish("正文超过 4000 字，未持久化", storagePhase);
      return;
    }
    if (text.trim().length === 0) {
      publish("正文不能为空，未持久化", storagePhase);
      return;
    }
    const snapshot = readLatest();
    if (!snapshot) return;
    const latest = snapshot.drafts;

    let timestamp: string;
    let next: readonly LocalTaskDraft[];
    try {
      timestamp = now().toISOString();
      if (editing) {
        const existingIndex = latest.findIndex(
          ({ draft_id }) => draft_id === editing.baseline.draft_id,
        );
        if (existingIndex < 0) {
          setDrafts(latest);
          setEditing(null);
          setEditorConflict("deleted");
          publish("编辑目标已在另一上下文删除，未持久化", "ready", "assertive");
          return;
        }
        const existing = latest[existingIndex];
        if (!sameRevision(existing, editing.baseline)) {
          setDrafts(latest);
          setEditorConflict("updated");
          publish("草稿已在另一上下文更新，未持久化", "ready", "assertive");
          return;
        }
        next = latest.map((item, index) => index === existingIndex ? {
          ...existing,
          text,
          updated_at: timestamp,
        } : item);
      } else {
        if (latest.length >= LOCAL_TASK_DRAFT_LIMIT) {
          setDrafts(latest);
          publish("已达 12 条本地草稿上限，未持久化", "ready");
          return;
        }
        const draftId = allocateDraftId(createId(), latest);
        if (!draftId) throw new Error("draft id unavailable");
        next = [...latest, {
          schema_version: 1,
          draft_id: draftId,
          text,
          created_at: timestamp,
          updated_at: timestamp,
        }];
      }
    } catch {
      setDrafts(latest);
      publish("无法生成本地草稿标识，未持久化", "ready", "assertive");
      return;
    }

    if (persist(snapshot, next, "已保存到此浏览器", "保存失败，未持久化")) {
      setText("");
      setEditing(null);
      setPendingEditId(null);
      setEditorConflict(null);
    }
  };

  const selectDraft = (
    draft: LocalTaskDraft,
    ordinal: number,
    discardedDirtyText = false,
  ) => {
    setText(draft.text);
    setEditing({ baseline: draft });
    setPendingEditId(null);
    setEditorConflict(null);
    publish(
      discardedDirtyText
        ? `已放弃未保存内容；已载入第 ${ordinal} 条本地草稿`
        : `已载入第 ${ordinal} 条本地草稿`,
      storagePhase,
    );
    textareaRef.current?.focus();
  };

  const requestEdit = (draft: LocalTaskDraft, ordinal: number) => {
    if (
      editing !== null &&
      sameRevision(editing.baseline, draft)
    ) {
      publish(`正在编辑第 ${ordinal} 条本地草稿`, storagePhase);
      return;
    }
    if (dirty) {
      setPendingEditId(draft.draft_id);
      publish("当前有未保存内容；切换前请显式确认", storagePhase, "assertive");
      return;
    }
    selectDraft(draft, ordinal);
  };

  const cancelEdit = () => {
    setText("");
    setEditing(null);
    setPendingEditId(null);
    setEditorConflict(null);
    publish("已放弃未保存编辑", storagePhase);
    textareaRef.current?.focus();
  };

  const remove = (draft: LocalTaskDraft) => {
    const snapshot = readLatest();
    if (!snapshot) return;
    const current = snapshot.drafts.find(({ draft_id }) => draft_id === draft.draft_id);
    if (!current) {
      setDrafts(snapshot.drafts);
      if (editing?.baseline.draft_id === draft.draft_id) {
        setEditing(null);
        setEditorConflict("deleted");
      }
      publish("草稿已在另一上下文删除", "ready");
      textareaRef.current?.focus();
      return;
    }
    if (!sameRevision(current, draft)) {
      setDrafts(snapshot.drafts);
      if (editing?.baseline.draft_id === draft.draft_id) setEditorConflict("updated");
      publish("草稿已在另一上下文更新，未删除", "ready", "assertive");
      return;
    }
    const next = snapshot.drafts.filter(({ draft_id }) => draft_id !== draft.draft_id);
    const deletingEdited = editing?.baseline.draft_id === draft.draft_id;
    const preserveDirtyText = deletingEdited && dirty;
    const success = preserveDirtyText
      ? "已删除已保存草稿；当前未保存文字仍保留"
      : "已从此浏览器删除";
    if (!persist(snapshot, next, success, "删除失败，未持久化")) return;
    if (deletingEdited) {
      setEditing(null);
      setEditorConflict(null);
      if (!preserveDirtyText) setText("");
    }
    if (pendingEditId === draft.draft_id) setPendingEditId(null);
    textareaRef.current?.focus();
  };

  return (
    <section className={styles.region} aria-labelledby="mobile-tasks-title">
      <header className={styles.intro}>
        <p className={styles.eyebrow}>02 / TASKS · LOCAL DRAFT</p>
        <h1 id="mobile-tasks-title">任务 · 本地草稿</h1>
        <p className={styles.lede}>
          在 Secure Dispatch 的设备身份、授权、审批与 ACK 合同成立前，这里只保存文字草稿。
        </p>
      </header>

      <ul className={styles.factRail} aria-label="任务真实性边界">
        <li>目标设备：未绑定</li>
        <li>状态：本地草稿</li>
        <li>风险：尚未由 Guard 评估</li>
        <li>下一动作：继续编辑</li>
        <li>说明：未发送；不会在电脑执行</li>
      </ul>

      <div className={styles.workspace}>
        <section className={styles.editor} aria-labelledby="local-draft-editor-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionIndex}>02—A</p>
              <h2 id="local-draft-editor-title">未发送的编辑场</h2>
            </div>
            <span id="mobile-local-draft-count">
              {text.length} / {LOCAL_TASK_DRAFT_TEXT_LIMIT}
            </span>
          </div>
          <label className={styles.label} htmlFor="mobile-local-task-draft">
            本地任务草稿
          </label>
          <textarea
            aria-describedby="mobile-local-draft-count mobile-local-draft-state mobile-local-draft-privacy mobile-local-draft-concurrency mobile-local-draft-leave mobile-local-draft-dispatch"
            className={styles.textarea}
            id="mobile-local-task-draft"
            maxLength={LOCAL_TASK_DRAFT_TEXT_LIMIT}
            onChange={(event) => {
              const nextText = event.currentTarget.value;
              setText(nextText);
              setPendingEditId(null);
              setNotice(
                storagePhase === "ready"
                  ? "本地存储可用"
                  : storagePhase === "checking"
                    ? "正在核验本地存储"
                    : "本地存储不可用，未持久化",
              );
            }}
            placeholder="写下意图、上下文与期望结果；此处不会执行。"
            ref={textareaRef}
            value={text}
          />
          <div className={styles.actions}>
            <button className={styles.saveButton} type="button" onClick={save}>
              保存到此浏览器
            </button>
            {editing !== null && (
              <button className={styles.secondaryButton} type="button" onClick={cancelEdit}>
                放弃本次编辑
              </button>
            )}
          </div>
          <p className={styles.persistence} data-storage-phase={storagePhase}>{notice}</p>
          <p className={styles.draftState} id="mobile-local-draft-state">
            {editorConflict === "deleted"
              ? "原保存版本已在另一上下文删除；当前文字未保存"
              : editorConflict === "updated"
                ? "原保存版本已在另一上下文更新；当前文字未保存"
                : dirty
                  ? "当前内容未保存"
                  : editing
                    ? "当前内容与已保存版本一致"
                    : "当前编辑区为空"}
          </p>
          <p className={styles.privacy} id="mobile-local-draft-privacy">
            本机浏览器存储，未加密，请勿写入凭据
          </p>
          <p className={styles.concurrency} id="mobile-local-draft-concurrency">
            跨标签页冲突检测为尽力而为；请勿同时编辑同一草稿。
          </p>
          <p className={styles.leaveWarning} id="mobile-local-draft-leave">
            离开此页会丢失未保存内容；请先显式保存。
          </p>
          <p className={styles.dispatchBoundary} id="mobile-local-draft-dispatch">
            Secure Dispatch 尚未获得设备身份、授权、审批与 ACK 合同；此处不会发送任务。
          </p>
        </section>

        <section className={styles.archive} aria-labelledby="local-draft-archive-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionIndex}>02—B</p>
              <h2 id="local-draft-archive-title">此浏览器中的草稿</h2>
            </div>
            <span>{drafts.length} / {LOCAL_TASK_DRAFT_LIMIT}</span>
          </div>
          {drafts.length === 0 ? (
            <p className={styles.empty}>此浏览器尚无已保存草稿</p>
          ) : (
            <ol className={styles.draftList}>
              {drafts.map((draft, index) => (
                <li className={styles.draftItem} key={draft.draft_id}>
                  <p>{draft.text}</p>
                  <time dateTime={draft.updated_at}>{draft.updated_at}</time>
                  <div className={styles.itemActions}>
                    <button
                      aria-label={`继续编辑第 ${index + 1} 条草稿`}
                      id={`mobile-local-draft-edit-${draft.draft_id}`}
                      type="button"
                      onClick={() => requestEdit(draft, index + 1)}
                    >
                      继续编辑
                    </button>
                    {pendingEditId === draft.draft_id && (
                      <div className={styles.discardPrompt}>
                        <p>当前文字尚未保存；切换会放弃它。</p>
                        <div className={styles.actions}>
                          <button
                            aria-label={`放弃未保存内容并编辑第 ${index + 1} 条草稿`}
                            className={styles.dangerButton}
                            type="button"
                            onClick={() => selectDraft(draft, index + 1, true)}
                          >
                            放弃并切换
                          </button>
                          <button
                            className={styles.secondaryButton}
                            type="button"
                            onClick={() => {
                              setPendingEditId(null);
                              publish("已保留当前未保存内容", storagePhase);
                              document
                                .getElementById(`mobile-local-draft-edit-${draft.draft_id}`)
                                ?.focus();
                            }}
                          >
                            保留当前未保存内容
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      aria-label={`删除第 ${index + 1} 条本地草稿`}
                      className={styles.deleteButton}
                      type="button"
                      onClick={() => remove(draft)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
