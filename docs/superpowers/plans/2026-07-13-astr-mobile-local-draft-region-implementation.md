# ASTR Mobile Local Draft Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the roomy Mobile Tasks editor for explicit browser-local drafts, with truthful non-Dispatch facts, reliable edit/delete failure semantics, and no hidden persistence.

**Architecture:** A Client Component keeps unsaved text, dirty/edit selection, and conflict state only in route-mount React state. It reads on mount for display, then re-reads the canonical Storage snapshot immediately before every explicit Save/Delete, merges by stable ID, and rejects observable revision conflicts. Because Web Storage has no atomic compare-and-swap, cross-tab protection is explicitly best-effort rather than an atomicity claim. User-action results go through the existing global `semanticStore` announcer; no local live region is added.

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
- Every Save/Delete re-reads storage first. A failed read performs zero writes; an external addition is merged, and an observable external edit/delete conflict fails closed without losing editor text. A final Web Storage TOCTOU window remains and must be disclosed as best-effort.
- Switching drafts never silently replaces dirty text; an explicit discard confirmation is required.
- Remote-context local drafts remain usable without `crypto.randomUUID`; fallback IDs are local record keys, never authority or security identities.
- No clipboard, fetch, task/device/queue/terminal state, Dispatch action, sessionStorage, draft/session module singleton, navigation blocker, fake disabled control, or backend change; the existing `semanticStore` is used only to publish announcements.
- No extra `aria-live`; user-action outcomes publish once through the global AppShell StateAnnouncer.
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
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { semanticStore } from "@/lib/semantic-store";

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
const ORIGINAL_RANDOM_UUID_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  globalThis.crypto,
  "randomUUID",
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

function revise(
  original: LocalTaskDraft,
  text: string,
  updatedAt = "2026-07-13T00:00:03.000Z",
): LocalTaskDraft {
  const result = decodeLocalTaskDrafts([{ ...original, text, updated_at: updatedAt }]);
  if (!result.ok || !result.drafts[0]) throw new Error("invalid revision fixture");
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
    read: vi.fn(
      (): LocalDraftReadResult => readResult ?? { ok: true, drafts: persisted },
    ),
    write: vi.fn((next: readonly LocalTaskDraft[]) => {
      persisted = next;
      return true;
    }),
  };
  return {
    storage,
    persisted: () => persisted,
    replacePersisted: (next: readonly LocalTaskDraft[]) => {
      persisted = next;
    },
  };
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
    if (ORIGINAL_RANDOM_UUID_DESCRIPTOR) {
      Object.defineProperty(globalThis.crypto, "randomUUID", ORIGINAL_RANDOM_UUID_DESCRIPTOR);
    } else {
      Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    }
    semanticStore.setState({ announcement: null });
  });

  it("renders the sole route heading, five truth facts, and privacy boundaries", async () => {
    const { storage } = storageFixture();
    const { container } = render(<LocalTaskDraftRegion storage={storage} />);
    await screen.findByText("本地存储可用");

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
    expect(
      screen.getByText("跨标签页冲突检测为尽力而为；请勿同时编辑同一草稿。"),
    ).toBeVisible();
    expect(screen.getByText(/离开此页会丢失未保存内容/)).toBeVisible();
    expect(screen.getByText(/Secure Dispatch 尚未获得设备身份、授权、审批与 ACK 合同/)).toBeVisible();
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /发送|Dispatch/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveAttribute(
      "aria-describedby",
      "mobile-local-draft-count mobile-local-draft-state mobile-local-draft-privacy mobile-local-draft-concurrency mobile-local-draft-leave mobile-local-draft-dispatch",
    );
    for (const id of [
      "mobile-local-draft-count",
      "mobile-local-draft-state",
      "mobile-local-draft-privacy",
      "mobile-local-draft-concurrency",
      "mobile-local-draft-leave",
      "mobile-local-draft-dispatch",
    ]) expect(container.querySelector(`#${id}`)).toBeVisible();
  });

  it("does not persist while typing and writes only after explicit save", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
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
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("已保存到此浏览器", "polite");

    await user.type(textbox, "下一段未保存内容");
    expect(screen.getByText("当前内容未保存")).toBeVisible();
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
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

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });
    expect(textbox).toHaveValue("旧正文");
    await user.clear(textbox);
    await user.type(textbox, "新正文");
    expect(screen.getByText("当前内容未保存")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(persisted()).toHaveLength(1);
    expect(persisted()[0]).toEqual({
      ...existing,
      text: "新正文",
      updated_at: "2026-07-13T00:00:05.000Z",
    });
  });

  it("keeps long identical draft operation names bounded and unique by ordinal", async () => {
    const longText = "😀组合".repeat(600);
    const { storage } = storageFixture([draft(1, longText), draft(2, longText)]);
    render(<LocalTaskDraftRegion storage={storage} />);
    await screen.findByText("本地存储可用");

    expect(screen.getByRole("button", { name: "继续编辑第 1 条草稿" })).toHaveTextContent("继续编辑");
    expect(screen.getByRole("button", { name: "继续编辑第 2 条草稿" })).toHaveTextContent("继续编辑");
    expect(screen.getByRole("button", { name: "删除第 1 条本地草稿" })).toHaveTextContent("删除");
    expect(screen.getByRole("button", { name: "删除第 2 条本地草稿" })).toHaveTextContent("删除");
  });

  it("allows an update at 12 drafts but rejects a thirteenth new draft before write", async () => {
    const user = userEvent.setup();
    const initial = Array.from({ length: LOCAL_TASK_DRAFT_LIMIT }, (_, index) => draft(index));
    const { storage } = storageFixture(initial);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "13"} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
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

  it("re-reads before save and preserves a draft added by another tab", async () => {
    const user = userEvent.setup();
    const first = draft(1, "原有草稿");
    const external = draft(2, "另一标签页新增");
    const { storage, persisted, replacePersisted } = storageFixture([first]);
    render(
      <LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "local-new"} />,
    );

    replacePersisted([first, external]);
    await user.type(screen.getByRole("textbox", { name: "本地任务草稿" }), "当前标签页新增");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.read).toHaveBeenCalledTimes(2);
    expect(persisted().map(({ text }) => text)).toEqual([
      "原有草稿",
      "另一标签页新增",
      "当前标签页新增",
    ]);
  });

  it("fails closed when another tab revised the draft being edited", async () => {
    const user = userEvent.setup();
    const original = draft(1, "原正文");
    const external = revise(original, "另一标签页正文", original.updated_at);
    const { storage, persisted, replacePersisted } = storageFixture([original]);
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });
    await user.clear(textbox);
    await user.type(textbox, "当前标签页正文");
    replacePersisted([external]);
    announce.mockClear();
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(persisted()).toEqual([external]);
    expect(textbox).toHaveValue("当前标签页正文");
    expect(screen.getByText("草稿已在另一上下文更新，未持久化")).toBeVisible();
    expect(screen.getByText("另一标签页正文")).toBeVisible();
    expect(
      screen.getByText("原保存版本已在另一上下文更新；当前文字未保存"),
    ).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "草稿已在另一上下文更新，未持久化",
      "assertive",
    );
  });

  it("does not label an externally replaced clean editor version as saved", async () => {
    const user = userEvent.setup();
    const original = draft(1, "未修改正文");
    const external = revise(original, "外部替换正文", original.updated_at);
    const { storage, replacePersisted } = storageFixture([original]);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    replacePersisted([external]);
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue("未修改正文");
    expect(
      screen.getByText("原保存版本已在另一上下文更新；当前文字未保存"),
    ).toBeVisible();
    expect(screen.queryByText("当前内容与已保存版本一致")).toBeNull();
  });

  it("turns a clean editor into an unsaved draft when its saved version vanished", async () => {
    const user = userEvent.setup();
    const original = draft(1, "被外部删除的正文");
    const { storage, replacePersisted } = storageFixture([original]);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    replacePersisted([]);
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue(
      "被外部删除的正文",
    );
    expect(
      screen.getByText("原保存版本已在另一上下文删除；当前文字未保存"),
    ).toBeVisible();
    expect(screen.queryByText("当前内容与已保存版本一致")).toBeNull();
  });

  it("requires an explicit discard before replacing a new unsaved draft", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture([draft(1, "已保存正文")]);
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "未保存的新正文");
    const trigger = await screen.findByRole("button", { name: "继续编辑第 1 条草稿" });
    await user.click(trigger);
    expect(textbox).toHaveValue("未保存的新正文");
    const discard = screen.getByRole("button", {
      name: "放弃未保存内容并编辑第 1 条草稿",
    });
    expect(discard).toBeVisible();
    expect(trigger).toHaveFocus();
    await user.tab();
    expect(discard).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "保留当前未保存内容" }));
    expect(textbox).toHaveValue("未保存的新正文");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("keeps dirty A on repeat selection and requires discard before switching to B", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture([draft(1, "正文 A"), draft(2, "正文 B")]);
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    await user.type(textbox, " · 未保存");
    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    expect(textbox).toHaveValue("正文 A · 未保存");
    expect(screen.queryByRole("button", { name: /放弃未保存内容/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "继续编辑第 2 条草稿" }));
    expect(textbox).toHaveValue("正文 A · 未保存");
    announce.mockClear();
    await user.click(
      screen.getByRole("button", { name: "放弃未保存内容并编辑第 2 条草稿" }),
    );
    expect(textbox).toHaveValue("正文 B");
    expect(storage.write).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "已放弃未保存内容；已载入第 2 条本地草稿",
      "polite",
    );
  });

  it("falls back to a non-authority local key when randomUUID is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const { storage, persisted } = storageFixture();
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} />);

    await user.type(screen.getByRole("textbox", { name: "本地任务草稿" }), "远程上下文本地草稿");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()[0]?.draft_id).toMatch(/^local_draft_[A-Za-z0-9_-]+$/);
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
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
    expect(textbox).toHaveValue("仍在当前会话");
    expect(screen.getByText(/未持久化/)).toBeVisible();
    expect(screen.getByText("此浏览器尚无已保存草稿")).toBeVisible();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("keeps text when save fails", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    storage.write.mockReturnValue(false);
    render(<LocalTaskDraftRegion storage={storage} now={FIXED_NOW} createId={() => "x"} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.type(textbox, "不能丢失");
    await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));

    expect(textbox).toHaveValue("不能丢失");
    expect(screen.getByText("保存失败，未持久化")).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("保存失败，未持久化", "assertive");
  });

  it("keeps the item and editor when delete persistence fails", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture([draft(1, "保留我")]);
    storage.write.mockReturnValue(false);
    render(<LocalTaskDraftRegion storage={storage} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    await user.click(await screen.findByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(
      within(screen.getByRole("region", { name: "此浏览器中的草稿" })).getByText("保留我"),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue("保留我");
    expect(screen.getByText("删除失败，未持久化")).toBeVisible();
  });

  it("deletes only after a successful local write", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture([draft(1, "删除我")]);
    render(<LocalTaskDraftRegion storage={storage} />);

    await user.click(await screen.findByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(storage.read).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()).toEqual([]);
    expect(screen.queryByText("删除我")).toBeNull();
  });

  it("refuses delete when another tab changed text without changing the timestamp", async () => {
    const user = userEvent.setup();
    const original = draft(1, "删除前正文");
    const external = revise(original, "同毫秒外部正文", original.updated_at);
    const { storage, persisted, replacePersisted } = storageFixture([original]);
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    render(<LocalTaskDraftRegion storage={storage} />);

    replacePersisted([external]);
    await user.click(await screen.findByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(persisted()).toEqual([external]);
    expect(screen.getByText("草稿已在另一上下文更新，未删除")).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "草稿已在另一上下文更新，未删除",
      "assertive",
    );
  });

  it("deletes the saved record but preserves its dirty editor text as a new unsaved draft", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture([draft(1, "已保存正文")]);
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    render(<LocalTaskDraftRegion storage={storage} />);

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });
    await user.type(textbox, " · 当前未保存");
    announce.mockClear();
    await user.click(screen.getByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(persisted()).toEqual([]);
    expect(textbox).toHaveValue("已保存正文 · 当前未保存");
    expect(screen.queryByRole("button", { name: "放弃本次编辑" })).toBeNull();
    expect(screen.getByText("已删除已保存草稿；当前未保存文字仍保留")).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "已删除已保存草稿；当前未保存文字仍保留",
      "polite",
    );
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

  it("stabilizes after the StrictMode effect replay without writing", async () => {
    const { storage } = storageFixture([draft(1)]);
    render(
      <StrictMode>
        <LocalTaskDraftRegion storage={storage} />
      </StrictMode>,
    );

    await waitFor(() => expect(storage.read).toHaveBeenCalledTimes(2));
    expect(storage.write).not.toHaveBeenCalled();
    expect(screen.getByText("本地存储可用")).toBeVisible();
    expect(screen.getByText("草稿 1")).toBeVisible();
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
    expect(source).not.toMatch(/defaultValue/);
    expect(source.indexOf("window.localStorage")).toBeGreaterThan(
      source.indexOf("useEffect(() =>"),
    );
    expect(source.slice(0, source.indexOf("useEffect(() =>"))).not.toMatch(/localStorage/);
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
                            }}
                          >
                            保留当前未保存内容
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      aria-label={`删除第 ${index + 1} 条本地草稿`}
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
.draftState,
.privacy,
.concurrency,
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
.dangerButton,
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
.dangerButton,
.itemActions button {
  background: transparent;
  color: var(--astr-text-2);
}

.discardPrompt {
  display: grid;
  flex-basis: 100%;
  gap: var(--space-3);
  inline-size: 100%;
  padding-block: var(--space-4);
  border-block: 1px solid var(--astr-danger);
}

.discardPrompt p {
  margin: 0;
  color: var(--astr-text-2);
}

.dangerButton {
  border-color: var(--astr-danger);
  color: var(--astr-danger);
}

.persistence[data-storage-phase="unavailable"] {
  color: var(--astr-danger);
}

.draftState {
  color: var(--astr-text-2);
}

.privacy,
.concurrency,
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
