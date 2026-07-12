import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PresenceControllerDiagnostic } from "@/features/presence/controller/create-presence-controller";
import type { DraftSnapshot } from "@/features/presence/model/presence-types";
import { initialSemanticState, type SemanticState } from "@/lib/semantic-state";
import type { MicRecorder } from "@/lib/wav";

import { Composer, type ComposerActions, type ComposerSnapshot } from "./Composer";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const baseDraft = (
  text = "和星枢说点什么",
  revision = 1,
  selectionStart = text.length,
  selectionEnd = selectionStart,
): DraftSnapshot => ({ revision, text, selectionStart, selectionEnd });

interface HarnessProps {
  readonly initialDraft?: DraftSnapshot;
  readonly core?: SemanticState["core"];
  readonly safety?: SemanticState["safety"];
  readonly conversationState?: SemanticState["conversation"];
  readonly receipt?: ComposerSnapshot["conversation"]["receipt"];
  readonly error?: string | null;
  readonly diagnostics?: readonly PresenceControllerDiagnostic[];
  readonly send?: ComposerActions["send"];
  readonly retryFailed?: ComposerActions["retryFailed"];
  readonly transcribe?: ComposerActions["transcribe"];
  readonly recorderFactory?: () => Promise<MicRecorder>;
  readonly copyText?: (text: string) => Promise<void>;
  readonly maxRecordingMs?: number;
  readonly onDraft?: (draft: DraftSnapshot) => void;
}

function Harness({
  initialDraft = baseDraft(),
  core = "reachable",
  safety = "normal",
  conversationState = "idle",
  receipt = null,
  error = null,
  diagnostics = [],
  send = async () => true,
  retryFailed = async () => true,
  transcribe = async () => ({ text: "" }),
  recorderFactory,
  copyText,
  maxRecordingMs,
  onDraft,
}: HarnessProps) {
  const [draft, setDraft] = useState(initialDraft);
  const semantic: SemanticState = {
    ...initialSemanticState,
    core,
    safety,
    conversation: conversationState,
  };
  const snapshot: ComposerSnapshot = {
    draft,
    semantic,
    conversation: { receipt, error },
    diagnostics,
  };
  const actions: ComposerActions = {
    updateDraft: (next) => {
      onDraft?.(next);
      setDraft(next);
    },
    send,
    retryFailed,
    transcribe,
  };

  return (
    <Composer
      snapshot={snapshot}
      actions={actions}
      recorderFactory={recorderFactory}
      copyText={copyText}
      maxRecordingMs={maxRecordingMs}
    />
  );
}

describe("Presence Composer", () => {
  it("renders a native textarea with the shared focus treatment and no extra live region", () => {
    const { container } = render(<Harness />);
    const textarea = screen.getByRole("textbox", { name: "消息输入" });

    expect(textarea.tagName).toBe("TEXTAREA");
    textarea.focus();
    expect(textarea).toHaveFocus();
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();

    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/Composer.module.css"),
      "utf8",
    );
    const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
    expect(css).toMatch(/\.textarea:focus-visible\s*\{[\s\S]*?outline:/);
    expect(css).toMatch(/min-(?:inline-size|width):\s*var\(--touch-target\)/);
    expect(css).toMatch(/min-(?:block-size|height):\s*var\(--touch-target\)/);
    expect(tokens).toMatch(/--touch-target:\s*44px/);
    const necessaryStateRule = css.match(
      /\.voiceStatus,[\s\S]*?\.errorText\s*\{([^}]*)\}/,
    )?.[1];
    expect(necessaryStateRule).toContain("color: var(--astr-text-2)");
    expect(necessaryStateRule).toContain("font-size: var(--type-0)");
    expect(necessaryStateRule).toContain("line-height: var(--leading-body)");
    expect(necessaryStateRule).not.toContain("var(--astr-text-3)");
    expect(necessaryStateRule).not.toContain("var(--text-xs)");
  });

  it("blocks native composition and legacy 229, then sends exactly once after compositionend", async () => {
    const send = vi.fn(async () => true);
    render(<Harness send={send} />);
    const textarea = screen.getByRole("textbox", { name: "消息输入" });

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it("keeps Shift+Enter as a newline and never submits it", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => true);
    render(<Harness initialDraft={baseDraft("", 0, 0, 0)} send={send} />);
    const textarea = screen.getByRole("textbox", { name: "消息输入" });

    await user.click(textarea);
    await user.type(textarea, "first line");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(textarea).toHaveValue("first line\n");
    expect(send).not.toHaveBeenCalled();
  });

  it("guards blank and offline input while keeping e-stop independent from conversation", () => {
    const send = vi.fn(async () => true);
    const blank = render(
      <Harness initialDraft={baseDraft("   ", 1, 3, 3)} send={send} />,
    );
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    blank.unmount();

    const offline = render(
      <Harness initialDraft={baseDraft("hello")} core="offline" send={send} />,
    );
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    offline.unmount();

    render(
      <Harness initialDraft={baseDraft("hello")} safety="stoppedLatched" send={send} />,
    );
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
  });

  it("does not submit from textarea after Core becomes offline while the draft is unchanged", () => {
    const send = vi.fn(async () => true);
    const view = render(<Harness initialDraft={baseDraft("stable draft")} send={send} />);

    view.rerender(
      <Harness initialDraft={baseDraft("stable draft")} core="offline" send={send} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "消息输入" }), {
      key: "Enter",
      code: "Enter",
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("uses a synchronous submission lock so rapid Enter never becomes a false ACK failure", async () => {
    const ingest = deferred<boolean>();
    const send = vi.fn(() => ingest.promise);
    render(<Harness send={send} />);
    const textarea = screen.getByRole("textbox", { name: "消息输入" });

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "重试发送" })).not.toBeInTheDocument();
    ingest.resolve(true);
    await ingest.promise;
  });

  it("preserves exact failed selection and exposes controller retry plus diagnostic copy", async () => {
    const user = userEvent.setup();
    const retryFailed = vi.fn(async () => true);
    const copyText = vi.fn(async () => undefined);
    const failedDraft = baseDraft("exact failed draft", 7, 2, 11);
    render(
      <Harness
        initialDraft={failedDraft}
        conversationState="error"
        error="ingest unavailable"
        diagnostics={[
          { code: "INGEST_FAILED", message: "ingest unavailable", at: 123 },
        ]}
        retryFailed={retryFailed}
        copyText={copyText}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "消息输入" }) as HTMLTextAreaElement;

    textarea.focus();
    expect(textarea).toHaveValue(failedDraft.text);
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(11);

    await user.click(screen.getByRole("button", { name: "重试发送" }));
    await user.click(screen.getByRole("button", { name: "复制诊断" }));

    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("INGEST_FAILED"));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("ingest unavailable"));
    expect(screen.getByText(/发送失败：ingest unavailable/)).toHaveTextContent("诊断已复制");
  });

  it("orders error, final, offline, pending, and retained receipt feedback truthfully", () => {
    const receipt = { event_id: "event-1", trace_id: "trace-1" };
    const final = render(
      <Harness conversationState="final" receipt={receipt} />,
    );
    expect(screen.getByText("回答完成；权威终稿已到达")).toBeInTheDocument();
    expect(screen.queryByText(/回答尚未完成/)).not.toBeInTheDocument();
    final.unmount();

    const offline = render(
      <Harness core="offline" conversationState="idle" receipt={receipt} />,
    );
    expect(screen.getByText("Core 不可达；草稿仅保存在当前页面")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.queryByText(/回答尚未完成/)).not.toBeInTheDocument();
    offline.unmount();

    render(
      <Harness
        conversationState="final"
        receipt={receipt}
        error="late error remains authoritative"
        diagnostics={[
          { code: "REQUEST_TIMED_OUT", message: "late error remains authoritative", at: 42 },
        ]}
      />,
    );
    expect(screen.getByText("发送失败：late error remains authoritative")).toBeInTheDocument();
  });

  it("guards retry by Core, composition, and pending state while e-stop remains independent", () => {
    const retryFailed = vi.fn(async () => true);
    const failed = {
      error: "ingest unavailable",
      diagnostics: [
        { code: "INGEST_FAILED", message: "ingest unavailable", at: 123 } as const,
      ],
      retryFailed,
    };

    const offline = render(<Harness {...failed} core="offline" />);
    expect(screen.getByRole("button", { name: "重试发送" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试发送" }));
    expect(retryFailed).not.toHaveBeenCalled();
    offline.unmount();

    const stopped = render(<Harness {...failed} safety="stoppedLatched" />);
    expect(screen.getByRole("button", { name: "重试发送" })).toBeEnabled();
    stopped.unmount();

    const composing = render(<Harness {...failed} />);
    fireEvent.compositionStart(screen.getByRole("textbox", { name: "消息输入" }));
    expect(screen.getByRole("button", { name: "重试发送" })).toBeDisabled();
    composing.unmount();

    render(<Harness {...failed} conversationState="sending" />);
    expect(screen.getByRole("button", { name: "重试发送" })).toBeDisabled();
    expect(retryFailed).not.toHaveBeenCalled();
  });

  it("preserves a newly typed draft when the matching send resolves successfully", async () => {
    const user = userEvent.setup();
    const ingest = deferred<boolean>();
    const send = vi.fn(() => ingest.promise);
    render(<Harness initialDraft={baseDraft("first", 3)} send={send} />);
    const textarea = screen.getByRole("textbox", { name: "消息输入" });

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await user.clear(textarea);
    await user.type(textarea, "newer draft");
    ingest.resolve(true);
    await ingest.promise;

    expect(textarea).toHaveValue("newer draft");
  });

  it("replaces the current selection with the literal transcript, restores focus, and never sends", async () => {
    const user = userEvent.setup();
    const recorder: MicRecorder = {
      stop: vi.fn(async () => "wav-data"),
      cancel: vi.fn(async () => undefined),
    };
    const send = vi.fn(async () => true);
    const revisions: DraftSnapshot[] = [];
    render(
      <Harness
        initialDraft={baseDraft("left RIGHT tail", 5, 5, 10)}
        send={send}
        recorderFactory={async () => recorder}
        transcribe={async () => ({ text: "  语音  " })}
        onDraft={(draft) => revisions.push(draft)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));

    const textarea = await screen.findByRole("textbox", { name: "消息输入" });
    await waitFor(() => expect(textarea).toHaveValue("left   语音   tail"));
    expect(textarea).toHaveFocus();
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(11);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(11);
    expect(revisions.at(-1)).toMatchObject({ revision: 6, selectionStart: 11, selectionEnd: 11 });
    expect(send).not.toHaveBeenCalled();
  });
});
