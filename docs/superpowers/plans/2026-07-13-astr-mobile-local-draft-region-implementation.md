# ASTR Mobile Local Draft Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the roomy Mobile Tasks editor for explicit browser-local drafts, with truthful non-Dispatch facts, reliable edit/delete failure semantics, and no hidden persistence.

**Architecture:** A Client Component keeps unsaved text and edit selection only in route-mount React state. On mount it creates or accepts an injected Storage adapter and reads only saved drafts; every save/delete produces a strict decoder projection, writes first, and publishes UI state only after success.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, user-event, existing strict local draft decoder/storage adapter.

## Global Constraints

- Create only `LocalTaskDraftRegion.tsx`, its test, and its CSS module under `webapp/src/features/mobile/tasks/`.
- The component owns the Tasks route's sole h1; it does not render a main element.
- Render these five exact facts: `目标设备：未绑定`, `状态：本地草稿`, `风险：尚未由 Guard 评估`, `下一动作：继续编辑`, `说明：未发送；不会在电脑执行`.
- Render exact privacy copy `本机浏览器存储，未加密，请勿写入凭据` and a persistent warning that leaving the page loses unsaved text.
- Typing, IME, newline, route mount, and render never write storage; only explicit Save/Delete do.
- Successful edit preserves `draft_id` and `created_at`, changes text and `updated_at`, and keeps array length.
- At 12 records, editing an existing draft remains allowed; a new 13th record is rejected before storage write.
- A read/write/delete failure keeps the current editor value; failed delete also keeps the list item.
- No clipboard, fetch, task/device/queue/terminal state, Dispatch action, sessionStorage, module singleton, navigation blocker, fake disabled control, or backend change.
- No extra `aria-live`; the global AppShell StateAnnouncer remains the only live region.
- CSS uses existing `--astr-*` tokens, no green, gradient, glass, backdrop filter, keyframes, animation, glow, Canvas, or 3D.
- Commands run from `D:\ASTR_System\astr\webapp`; Git commands run from `D:\ASTR_System\astr`.

---

### Task 1: Implement the explicit local draft region

**Files:**

- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx`
- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.tsx`
- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.module.css`

- [ ] **Step 1: Write the failing interaction tests**

Create `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx` with exactly:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_TASK_DRAFT_LIMIT,
  decodeLocalTaskDrafts,
  type LocalDraftReadResult,
  type LocalTaskDraft,
} from "./local-task-draft";
import type { LocalTaskDraftStorage } from "./local-task-draft-storage";
import { LocalTaskDraftRegion } from "./LocalTaskDraftRegion";

const ORIGINAL_CLIPBOARD_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function draft(index: number, text = `草稿 ${index}`): LocalTaskDraft {
  const result = decodeLocalTaskDrafts([{
    schema_version: 1,
    draft_id: `local_draft_${index}`,
    text,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
  }]);
  if (!result.ok || !result.drafts[0]) throw new Error("invalid fixture");
  return result.drafts[0];
}

function storageFixture(
  initial: readonly LocalTaskDraft[] = [],
  readResult?: LocalDraftReadResult,
) {
  let persisted = initial;
  const storage: LocalTaskDraftStorage & {
    readonly read: ReturnType<typeof vi.fn>;
    readonly write: ReturnType<typeof vi.fn>;
  } = {
    read: vi.fn(() => readResult ?? { ok: true, drafts: persisted }),
    write: vi.fn((next: readonly LocalTaskDraft[]) => {
      persisted = next;
      return true;
    }),
  };
  return { storage, persisted: () => persisted };
}

const FIXED_NOW = () => new Date("2026-07-13T00:00:05.000Z");

describe("LocalTaskDraftRegion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_CLIPBOARD_DESCRIPTOR) {
      Object.defineProperty(navigator, "clipboard", ORIGINAL_CLIPBOARD_DESCRIPTOR);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("renders the sole route heading, five truth facts, and privacy boundaries", () => {
    const { storage } = storageFixture();
    const { container } = render(<LocalTaskDraftRegion storage={storage} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("任务 · 本地草稿");
    for (const fact of [
      "目标设备：未绑定",
      "状态：本地草稿",
      "风险：尚未由 Guard 评估",
      "下一动作：继续编辑",
      "说明：未发送；不会在电脑执行",
    ]) expect(screen.getByText(fact)).toBeVisible();
    expect(screen.getByText("本机浏览器存储，未加密，请勿写入凭据")).toBeVisible();
    expect(screen.getByText(/离开此页会丢失未保存内容/)).toBeVisible();
    expect(screen.getByText(/Secure Dispatch 尚未获得设备身份、授权、审批与 ACK 合同/)).toBeVisible();
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /发送|Dispatch/ })).toBeNull();
  });

  it("does not persist while typing and writes only after explicit save", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture();
    render(
      <LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "new-1"} />,
    );
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "整理今天的记录");
    expect(storage.write).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()).toEqual([{
      schema_version: 1,
      draft_id: "local_draft_new-1",
      text: "整理今天的记录",
      created_at: "2026-07-13T00:00:05.000Z",
      updated_at: "2026-07-13T00:00:05.000Z",
    }]);
    expect(textbox).toHaveValue("");
    expect(screen.getByText("已保存到此浏览器")).toBeVisible();
  });

  it("preserves IME text and Enter as a newline without saving", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture();
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    fireEvent.compositionStart(textbox);
    await user.type(textbox, "甲{enter}乙");
    fireEvent.compositionEnd(textbox);

    expect(textbox).toHaveValue("甲\n乙");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects blank text without writing", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture();
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "   ");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(textbox).toHaveValue("   ");
    expect(screen.getByText("正文不能为空，未持久化")).toBeVisible();
  });

  it("accepts exactly 4000 characters and rejects 4001 before writing", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture();
    render(
      <LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "limit"} />,
    );
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    fireEvent.change(textbox, { target: { value: "字".repeat(4000) } });
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()[0]?.text).toHaveLength(4000);

    fireEvent.change(textbox, { target: { value: "字".repeat(4001) } });
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(textbox).toHaveValue("字".repeat(4001));
    expect(screen.getByText("正文超过 4000 字，未持久化")).toBeVisible();
  });

  it("restores and updates a saved draft without changing identity or count", async () => {
    const user = userEvent.setup();
    const existing = draft(1, "旧正文");
    const { storage, persisted } = storageFixture([existing]);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} />);

    await user.click(screen.getByRole("button", { name: "继续编辑：旧正文" }));
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });
    expect(textbox).toHaveValue("旧正文");
    await user.clear(textbox);
    await user.type(textbox, "新正文");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(persisted()).toHaveLength(1);
    expect(persisted()[0]).toEqual({
      ...existing,
      text: "新正文",
      updated_at: "2026-07-13T00:00:05.000Z",
    });
  });

  it("allows an update at 12 drafts but rejects a thirteenth new draft before write", async () => {
    const user = userEvent.setup();
    const initial = Array.from({ length: LOCAL_TASK_DRAFT_LIMIT }, (_, index) => draft(index));
    const { storage } = storageFixture(initial);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "13"} />);

    await user.click(screen.getByRole("button", { name: "继续编辑：草稿 0" }));
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });
    await user.clear(textbox);
    await user.type(textbox, "更新第 0 条");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(storage.write.mock.calls[0]?.[0]).toHaveLength(12);

    await user.type(textbox, "第十三条");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已达 12 条本地草稿上限，未持久化")).toBeVisible();
    expect(textbox).toHaveValue("第十三条");
  });

  it.each([
    { ok: false, drafts: [], reason: "unavailable" } as const,
    { ok: false, drafts: [], reason: "malformed" } as const,
  ])("keeps the editor usable when the initial read is $reason", async (readResult) => {
    const user = userEvent.setup();
    const { storage } = storageFixture([], readResult);
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "仍在当前会话");
    expect(textbox).toHaveValue("仍在当前会话");
    expect(screen.getByText(/未持久化/)).toBeVisible();
    expect(screen.getByText("此浏览器尚无已保存草稿")).toBeVisible();
  });

  it("keeps text when save fails", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture();
    storage.write.mockReturnValue(false);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "x"} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "不能丢失");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(textbox).toHaveValue("不能丢失");
    expect(screen.getByText("保存失败，未持久化")).toBeVisible();
  });

  it("keeps the item and editor when delete persistence fails", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture([draft(1, "保留我")]);
    storage.write.mockReturnValue(false);
    render(<LocalTaskDraftRegion storage={storage} />);

    await user.click(screen.getByRole("button", { name: "继续编辑：保留我" }));
    await user.click(screen.getByRole("button", { name: "删除此浏览器草稿：保留我" }));

    expect(screen.getByText("保留我")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue("保留我");
    expect(screen.getByText("删除失败，未持久化")).toBeVisible();
  });

  it("deletes only after a successful local write", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture([draft(1, "删除我")]);
    render(<LocalTaskDraftRegion storage={storage} />);

    await user.click(screen.getByRole("button", { name: "删除此浏览器草稿：删除我" }));

    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()).toEqual([]);
    expect(screen.queryByText("删除我")).toBeNull();
  });

  it("loses unsaved text across unmount/remount and never uses the clipboard", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture();
    const readText = vi.fn();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, writeText },
    });
    const first = render(<LocalTaskDraftRegion storage={storage} />);
    await user.type(screen.getByRole("textbox", { name: "本地任务草稿" }), "未保存");
    first.unmount();

    render(<LocalTaskDraftRegion storage={storage} />);
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue("");
    expect(storage.write).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("server-renders without capturing window.localStorage", () => {
    expect(() => renderToString(<LocalTaskDraftRegion />)).not.toThrow();
  });

  it("keeps source and CSS within the local static boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/mobile/tasks/LocalTaskDraftRegion.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/features/mobile/tasks/LocalTaskDraftRegion.module.css"),
      "utf8",
    );

    expect(source).not.toMatch(/fetch\s*\(|navigator\.clipboard|sessionStorage|\/v1\/|queued|running|completed|task_id/);
    expect(css).not.toMatch(/gradient|backdrop-filter|@keyframes|animation\s*:|\bgreen\b/i);
  });
});
```

- [ ] **Step 2: Run the region test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx
```

Expected: FAIL because `./LocalTaskDraftRegion` does not exist.

- [ ] **Step 3: Implement the explicit local-only region**

Create `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.tsx` with exactly:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import {
  LOCAL_TASK_DRAFT_LIMIT,
  LOCAL_TASK_DRAFT_TEXT_LIMIT,
  decodeLocalTaskDrafts,
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

type PersistencePhase = "checking" | "ready" | "unpersisted";

function describeDraft(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact;
}

export function LocalTaskDraftRegion({
  storage,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
}: LocalTaskDraftRegionProps) {
  const storageRef = useRef<LocalTaskDraftStorage | null>(null);
  const [drafts, setDrafts] = useState<readonly LocalTaskDraft[]>([]);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PersistencePhase>("checking");
  const [notice, setNotice] = useState("核验本地存储");

  useEffect(() => {
    let adapter: LocalTaskDraftStorage;
    try {
      adapter = storage ?? createLocalTaskDraftStorage(window.localStorage);
    } catch {
      storageRef.current = null;
      setPhase("unpersisted");
      setNotice("本地存储不可用，未持久化");
      return;
    }
    storageRef.current = adapter;
    const result = adapter.read();
    if (result.ok) {
      setDrafts(result.drafts);
      setPhase("ready");
      setNotice("本地存储可用");
    } else {
      setPhase("unpersisted");
      setNotice(
        result.reason === "malformed"
          ? "本地草稿不可读取，未持久化"
          : "本地存储不可用，未持久化",
      );
    }
    return () => {
      storageRef.current = null;
    };
  }, [storage]);

  const persist = (next: readonly LocalTaskDraft[], success: string, failure: string) => {
    const canonical = decodeLocalTaskDrafts(next);
    if (!canonical.ok || !storageRef.current?.write(canonical.drafts)) {
      setPhase("unpersisted");
      setNotice(failure);
      return null;
    }
    setDrafts(canonical.drafts);
    setPhase("ready");
    setNotice(success);
    return canonical.drafts;
  };

  const save = () => {
    if (text.length > LOCAL_TASK_DRAFT_TEXT_LIMIT) {
      setPhase("unpersisted");
      setNotice("正文超过 4000 字，未持久化");
      return;
    }
    if (text.trim().length === 0) {
      setPhase("unpersisted");
      setNotice("正文不能为空，未持久化");
      return;
    }
    const existingIndex = editingId
      ? drafts.findIndex(({ draft_id }) => draft_id === editingId)
      : -1;
    if (editingId !== null && existingIndex < 0) {
      setPhase("unpersisted");
      setNotice("编辑目标已不存在，未持久化");
      return;
    }
    if (editingId === null && drafts.length >= LOCAL_TASK_DRAFT_LIMIT) {
      setPhase("unpersisted");
      setNotice("已达 12 条本地草稿上限，未持久化");
      return;
    }

    let timestamp: string;
    let next: readonly LocalTaskDraft[];
    try {
      timestamp = now().toISOString();
      if (existingIndex >= 0) {
        const existing = drafts[existingIndex];
        next = drafts.map((item, index) => index === existingIndex ? {
          ...existing,
          text,
          updated_at: timestamp,
        } : item);
      } else {
        next = [...drafts, {
          schema_version: 1,
          draft_id: `local_draft_${createId()}`,
          text,
          created_at: timestamp,
          updated_at: timestamp,
        }];
      }
    } catch {
      setPhase("unpersisted");
      setNotice("无法生成本地草稿标识，未持久化");
      return;
    }

    if (persist(next, "已保存到此浏览器", "保存失败，未持久化")) {
      setText("");
      setEditingId(null);
    }
  };

  const edit = (draft: LocalTaskDraft) => {
    setText(draft.text);
    setEditingId(draft.draft_id);
    setNotice("正在编辑此浏览器草稿");
  };

  const cancelEdit = () => {
    setText("");
    setEditingId(null);
    setNotice(phase === "ready" ? "本地存储可用" : "未持久化");
  };

  const remove = (draft: LocalTaskDraft) => {
    const next = drafts.filter(({ draft_id }) => draft_id !== draft.draft_id);
    if (!persist(next, "已从此浏览器删除", "删除失败，未持久化")) return;
    if (editingId === draft.draft_id) {
      setText("");
      setEditingId(null);
    }
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
            <span>{text.length} / {LOCAL_TASK_DRAFT_TEXT_LIMIT}</span>
          </div>
          <label className={styles.label} htmlFor="mobile-local-task-draft">
            本地任务草稿
          </label>
          <textarea
            className={styles.textarea}
            id="mobile-local-task-draft"
            maxLength={LOCAL_TASK_DRAFT_TEXT_LIMIT}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="写下意图、上下文与期望结果；此处不会执行。"
            value={text}
          />
          <div className={styles.actions}>
            <button className={styles.saveButton} type="button" onClick={save}>
              保存到此浏览器
            </button>
            {editingId !== null && (
              <button className={styles.secondaryButton} type="button" onClick={cancelEdit}>
                取消编辑
              </button>
            )}
          </div>
          <p className={styles.persistence} data-persistence-phase={phase}>{notice}</p>
          <p className={styles.privacy}>本机浏览器存储，未加密，请勿写入凭据</p>
          <p className={styles.leaveWarning}>离开此页会丢失未保存内容；请先显式保存。</p>
          <p className={styles.dispatchBoundary}>
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
              {drafts.map((draft) => (
                <li className={styles.draftItem} key={draft.draft_id}>
                  <p>{draft.text}</p>
                  <time dateTime={draft.updated_at}>{draft.updated_at}</time>
                  <div className={styles.itemActions}>
                    <button
                      aria-label={`继续编辑：${describeDraft(draft.text)}`}
                      type="button"
                      onClick={() => edit(draft)}
                    >
                      继续编辑
                    </button>
                    <button
                      aria-label={`删除此浏览器草稿：${describeDraft(draft.text)}`}
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
```

- [ ] **Step 4: Implement the static asymmetric Tasks CSS**

Create `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.module.css` with exactly:

```css
.region {
  display: grid;
  gap: clamp(var(--space-5), 5vw, var(--space-8));
  min-width: 0;
}

.intro {
  display: grid;
  max-inline-size: 58rem;
  gap: var(--space-3);
  padding-inline-start: clamp(var(--space-4), 5vw, var(--space-7));
  border-inline-start: 1px solid var(--astr-action);
}

.eyebrow,
.sectionIndex,
.persistence,
.privacy,
.leaveWarning,
.dispatchBoundary,
.draftItem time {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--type--1);
  line-height: 1.6;
}

.eyebrow,
.sectionIndex {
  color: var(--astr-action);
  letter-spacing: 0.15em;
}

.intro h1,
.sectionHeading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
}

.intro h1 {
  max-inline-size: 12ch;
  font-size: clamp(var(--type-3), 8vw, var(--type-5));
  line-height: 0.98;
}

.lede {
  max-inline-size: 46rem;
  margin: 0;
  color: var(--astr-text-2);
  font-size: var(--type-1);
  line-height: 1.75;
}

.factRail {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  border-block: 1px solid var(--astr-hairline-strong);
  list-style: none;
}

.factRail li {
  min-width: 0;
  padding: var(--space-4);
  border-inline-end: 1px solid var(--astr-hairline);
  color: var(--astr-text-2);
  font-size: var(--type-0);
  line-height: 1.55;
}

.factRail li:last-child {
  border-inline-end: 0;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(18rem, 0.55fr);
  align-items: start;
  gap: clamp(var(--space-5), 5vw, var(--space-8));
  min-width: 0;
}

.editor,
.archive {
  display: grid;
  min-width: 0;
  gap: var(--space-4);
  padding-block: var(--space-5);
  border-block: 1px solid var(--astr-hairline-strong);
}

.sectionHeading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
}

.sectionHeading h2 {
  font-size: clamp(var(--type-2), 4vw, var(--type-3));
}

.sectionHeading > span {
  color: var(--astr-text-3);
  font-family: var(--font-mono);
  font-size: var(--type--1);
}

.label {
  color: var(--astr-text-2);
  font-size: var(--type-0);
}

.textarea {
  inline-size: 100%;
  min-block-size: 14rem;
  resize: vertical;
  border: 1px solid var(--astr-hairline-strong);
  border-inline-start-color: var(--astr-action);
  border-radius: var(--radius-small);
  padding: clamp(var(--space-4), 4vw, var(--space-6));
  background: var(--astr-surface);
  color: var(--astr-text);
  caret-color: var(--astr-action);
  font: inherit;
  line-height: 1.7;
}

.textarea:focus-visible {
  outline: 2px solid var(--astr-action);
  outline-offset: 3px;
}

.actions,
.itemActions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.saveButton,
.secondaryButton,
.itemActions button {
  min-inline-size: var(--touch-target);
  min-block-size: var(--touch-target);
  border: 1px solid var(--astr-hairline-strong);
  border-radius: var(--radius-small);
  padding: var(--space-2) var(--space-4);
  font: inherit;
  cursor: pointer;
}

.saveButton {
  border-color: var(--astr-action);
  background: var(--astr-action);
  color: var(--astr-on-accent);
}

.secondaryButton,
.itemActions button {
  background: transparent;
  color: var(--astr-text-2);
}

.persistence[data-persistence-phase="unpersisted"] {
  color: var(--astr-danger);
}

.privacy,
.leaveWarning,
.dispatchBoundary {
  color: var(--astr-text-3);
}

.archive {
  border-inline-start: 1px solid var(--astr-hairline);
  padding-inline-start: var(--space-5);
}

.empty {
  min-block-size: 8rem;
  margin: 0;
  color: var(--astr-text-3);
}

.draftList {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.draftItem {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding-block: var(--space-4);
  border-top: 1px solid var(--astr-hairline);
}

.draftItem p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.draftItem time {
  overflow-wrap: anywhere;
  color: var(--astr-text-3);
}

.itemActions button:last-child {
  color: var(--astr-danger);
}

@media (max-width: 62rem) {
  .factRail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .factRail li {
    border-block-end: 1px solid var(--astr-hairline);
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .archive {
    border-inline-start: 0;
    padding-inline-start: 0;
  }
}

@media (max-width: 32rem) {
  .factRail {
    grid-template-columns: minmax(0, 1fr);
  }

  .factRail li {
    border-inline-end: 0;
  }

  .sectionHeading {
    align-items: start;
    flex-direction: column;
  }
}
```

- [ ] **Step 5: Run the region test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx
```

Expected: PASS.

### Task 2: Verify and commit the Tasks region

- [ ] **Step 1: Run every Tasks test**

Run:

```powershell
npm test -- --run src/features/mobile/tasks
```

Expected: decoder, storage, and region tests PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Scan Tasks production source for forbidden capability**

Run:

```powershell
rg -n "fetch\(|navigator\.clipboard|sessionStorage|/v1/|task_id|queued|running|completed|device_id" src/features/mobile/tasks --glob "!*.test.*"
```

Expected: exit 1 with no matches.

- [ ] **Step 5: Stage the exact region files**

Run from `D:\ASTR_System\astr`:

```powershell
git add webapp/src/features/mobile/tasks/LocalTaskDraftRegion.tsx webapp/src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx webapp/src/features/mobile/tasks/LocalTaskDraftRegion.module.css
```

Expected: only the three region files are staged.

- [ ] **Step 6: Commit the Tasks region**

Run from `D:\ASTR_System\astr`:

```powershell
git commit -m "feat: build explicit Mobile local drafts"
```

Expected: commit succeeds with the three region files.
