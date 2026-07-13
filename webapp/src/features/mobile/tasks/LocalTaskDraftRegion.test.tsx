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
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(
      screen.getByRole("button", {
        name: "放弃未保存内容并编辑第 1 条草稿",
      }),
    );
    expect(textbox).toHaveValue("已保存正文");
    expect(textbox).toHaveFocus();
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
    expect(textbox).toHaveFocus();
    expect(storage.write).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "已放弃未保存内容；已载入第 2 条本地草稿",
      "polite",
    );
  });

  it("returns focus to the editor after cancelling a saved-draft edit", async () => {
    const user = userEvent.setup();
    const { storage } = storageFixture([draft(1, "取消编辑正文")]);
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.click(await screen.findByRole("button", { name: "继续编辑第 1 条草稿" }));
    await user.click(screen.getByRole("button", { name: "放弃本次编辑" }));

    expect(textbox).toHaveValue("");
    expect(textbox).toHaveFocus();
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
      within(
        screen.getByRole("region", { name: "此浏览器中的草稿" }),
      ).getByText("保留我"),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "本地任务草稿" })).toHaveValue("保留我");
    expect(screen.getByText("删除失败，未持久化")).toBeVisible();
  });

  it("deletes only after a successful local write", async () => {
    const user = userEvent.setup();
    const { storage, persisted } = storageFixture([draft(1, "删除我")]);
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    await user.click(await screen.findByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(storage.read).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(persisted()).toEqual([]);
    expect(screen.queryByText("删除我")).toBeNull();
    expect(textbox).toHaveFocus();
  });

  it("returns focus to the editor when delete finds the draft already removed", async () => {
    const user = userEvent.setup();
    const original = draft(1, "外部已删正文");
    const { storage, replacePersisted } = storageFixture([original]);
    render(<LocalTaskDraftRegion storage={storage} />);
    const textbox = screen.getByRole("textbox", { name: "本地任务草稿" });

    replacePersisted([]);
    await user.click(await screen.findByRole("button", { name: "删除第 1 条本地草稿" }));

    expect(storage.write).not.toHaveBeenCalled();
    expect(screen.getByText("草稿已在另一上下文删除")).toBeVisible();
    expect(textbox).toHaveFocus();
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
    expect(await screen.findByText("本地存储可用")).toBeVisible();
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
    expect(source).toContain("className={styles.deleteButton}");
    expect(source.indexOf("window.localStorage")).toBeGreaterThan(
      source.indexOf("useEffect(() =>"),
    );
    expect(source.slice(0, source.indexOf("useEffect(() =>"))).not.toMatch(/localStorage/);
    expect(css).not.toMatch(/\.itemActions button:last-child/);
    expect(css).toMatch(
      /\.dangerButton,\s*\.itemActions \.dangerButton\s*\{[^}]*border-color:\s*var\(--astr-danger\);[^}]*color:\s*var\(--astr-danger\);/,
    );
    expect(css).toMatch(
      /\.itemActions \.deleteButton\s*\{[^}]*color:\s*var\(--astr-danger\);/,
    );
    expect(css).not.toMatch(/gradient|backdrop-filter|@keyframes|animation\s*:|\bgreen\b/i);
  });
});
