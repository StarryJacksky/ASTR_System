import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { semanticStore } from "@/lib/semantic-store";
import type { MicRecorder, MicRecorderFactory } from "@/lib/wav";

import { VoiceprintPanel } from "./VoiceprintPanel";

describe("VoiceprintPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    semanticStore.getState().clearAnnouncement();
  });

  it("reports the initial request as loading rather than offline", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<VoiceprintPanel />);

    expect(screen.getAllByText("正在读取声纹状态").length).toBeGreaterThan(0);
    expect(screen.queryByText(/离线|无法读取/)).not.toBeInTheDocument();
  });

  it.each([
    ["non-OK", { ok: false, json: async () => validStatus() }],
    ["malformed JSON", { ok: true, json: async () => "not-an-object" }],
    [
      "invalid JSON",
      {
        ok: true,
        json: async () => {
          throw new SyntaxError("invalid JSON");
        },
      },
    ],
    [
      "missing required fields",
      {
        ok: true,
        json: async () => ({ enrolled: false, model_available: true }),
      },
    ],
    [
      "prototype-only fields",
      { ok: true, json: async () => Object.create(validStatus()) },
    ],
  ])("reports %s status responses as read failures", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    render(<VoiceprintPanel />);

    expect(await screen.findByText("无法读取声纹状态")).toBeInTheDocument();
    expect(screen.queryByText(/已注册声纹模板|未注册声纹模板/)).not.toBeInTheDocument();
  });

  it("offers a truthful retry after a status read failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => validStatus() })
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceprintPanel />);

    const retry = await screen.findByRole("button", { name: "重试读取声纹状态" });
    expect(retry).toHaveStyle({
      minWidth: "var(--touch-target)",
      minHeight: "var(--touch-target)",
    });
    await user.click(retry);
    expect(
      await screen.findByText("未注册声纹模板；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("announces an owned status read failure once through the global announcer", async () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => validStatus() }),
    );

    const view = render(
      <StrictMode>
        <VoiceprintPanel />
      </StrictMode>,
    );
    await screen.findByText("无法读取声纹状态");
    view.rerender(
      <StrictMode>
        <VoiceprintPanel />
      </StrictMode>,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("无法读取声纹状态");
  });

  it("does not announce a status failure that settles after close", async () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const view = render(<VoiceprintPanel active />);
    await flushMicrotasks();

    view.rerender(<VoiceprintPanel active={false} />);
    response.resolve({ ok: false, json: async () => validStatus() });
    await flushMicrotasks();

    expect(announce).not.toHaveBeenCalled();
  });

  it("clears stale status truth while refreshing and keeps the refresh control focused", async () => {
    const user = userEvent.setup();
    const pendingRefresh = deferred<{
      ok: boolean;
      json: () => Promise<ReturnType<typeof baseStatus>>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validStatus({ enrolled: true }),
      })
      .mockImplementationOnce(() => pendingRefresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel />);

    await screen.findByText("已注册声纹模板；当前网页转写入口未执行身份验证");
    const refresh = screen.getByRole("button", { name: "刷新声纹状态" });
    await user.click(refresh);

    expect(screen.getByRole("button", { name: "正在读取声纹状态" })).toBe(refresh);
    expect(refresh).toHaveFocus();
    expect(screen.queryByText(/已注册声纹模板|未注册声纹模板/)).not.toBeInTheDocument();
    const enroll = screen.getByRole("button", { name: "录入声纹" });
    expect(enroll).not.toBeDisabled();
    expect(enroll).toHaveAttribute("aria-disabled", "true");

    pendingRefresh.resolve({ ok: true, json: async () => validStatus() });
    expect(await screen.findByRole("button", { name: "刷新声纹状态" })).toBe(refresh);
    expect(refresh).toHaveFocus();
  });

  it("blocks a stale enrollment activation in the same turn that refresh starts", async () => {
    const pendingRefresh = deferred<{
      ok: boolean;
      json: () => Promise<ReturnType<typeof baseStatus>>;
    }>();
    const recorderFactory = vi.fn<MicRecorderFactory>(async () => fakeRecorder());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() })
      .mockImplementationOnce(() => pendingRefresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderFactory} />);
    await screen.findByText("未注册声纹模板；当前网页转写入口未执行身份验证");
    const refresh = screen.getByRole("button", { name: "刷新声纹状态" });
    const enroll = screen.getByRole("button", { name: "录入声纹" });

    act(() => {
      refresh.click();
      enroll.click();
    });

    expect(recorderFactory).not.toHaveBeenCalled();
    pendingRefresh.resolve({ ok: true, json: async () => validStatus() });
    await flushMicrotasks();
  });

  it("keeps the retry control mounted and focused through loading and recovery", async () => {
    const user = userEvent.setup();
    const pendingRetry = deferred<{
      ok: boolean;
      json: () => Promise<ReturnType<typeof baseStatus>>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => validStatus() })
      .mockImplementationOnce(() => pendingRetry.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel />);

    const retry = await screen.findByRole("button", { name: "重试读取声纹状态" });
    await user.click(retry);

    expect(screen.getByRole("button", { name: "正在读取声纹状态" })).toBe(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-disabled", "true");

    pendingRetry.resolve({ ok: true, json: async () => validStatus() });
    expect(await screen.findByRole("button", { name: "刷新声纹状态" })).toBe(retry);
    expect(retry).toHaveFocus();
  });

  it("does not claim that the web transcription path verifies the enrolled speaker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          enrolled: true,
          model_available: true,
          threshold: 0.7,
          require: true,
        }),
      }),
    );

    render(<VoiceprintPanel />);

    expect(
      await screen.findByText("已注册声纹模板；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/只认你的声音|只认主人/)).not.toBeInTheDocument();
  });

  it("states the same web identity boundary when no template is enrolled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => validStatus() }),
    );

    const { container } = render(<VoiceprintPanel />);

    expect(
      await screen.findByText("未注册声纹模板；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/主人|所有者|身份已验证|认证级别|L2/);
  });

  it("reports an unavailable model without implying authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => validStatus({ model_available: false }),
      }),
    );

    const { container } = render(<VoiceprintPanel />);

    expect(
      await screen.findByText("声纹模型不可用；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/身份已验证|只认|主人|认证级别|L2/);
  });

  it("keeps its source documentation honest about the unverified web voice path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/astr/VoiceprintPanel.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/语音入口据此升 L2|网页语音入口.*L2/);
    expect(source).toContain("网页转写入口不执行说话者身份验证");
  });

  it("uses ASTR text and line language without shields, owner claims, or green success styling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => validStatus({ enrolled: true }) }),
    );
    const { container } = render(<VoiceprintPanel />);
    await screen.findByText("已注册声纹模板；当前网页转写入口未执行身份验证");
    const source = readFileSync(
      resolve(process.cwd(), "src/components/astr/VoiceprintPanel.tsx"),
      "utf8",
    );

    expect(container.querySelector(".lucide-shield-check, .lucide-shield-alert")).toBeNull();
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
    expect(source).not.toMatch(/ShieldCheck|ShieldAlert|text-success|主人|认证级别|L2/);
  });

  it("keeps every voiceprint action at the constitutional touch target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => validStatus() }),
    );
    render(<VoiceprintPanel />);

    const enroll = await screen.findByRole("button", { name: "录入声纹" });
    expect(enroll).toHaveStyle({
      minWidth: "var(--touch-target)",
      minHeight: "var(--touch-target)",
    });
  });

  it("keeps the enrollment control focused and guarded while recording", async () => {
    const user = userEvent.setup();
    const recorder = fakeRecorder();
    const recorderFactory = vi.fn<MicRecorderFactory>(async () => recorder);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => validStatus() }),
    );
    const view = render(<VoiceprintPanel recorderFactory={recorderFactory} />);
    const enroll = await screen.findByRole("button", { name: "录入声纹" });

    await user.click(enroll);
    expect(await screen.findByText("正在录第 1/5 段，说话…")).toBeInTheDocument();
    expect(enroll).toHaveFocus();
    expect(enroll).not.toBeDisabled();
    expect(enroll).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(enroll);
    expect(recorderFactory).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("blocks a stale status refresh activation in the same turn recording starts", async () => {
    const recorder = fakeRecorder();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <VoiceprintPanel recorderFactory={async () => recorder} />,
    );
    await screen.findByText("未注册声纹模板；当前网页转写入口未执行身份验证");
    const enroll = screen.getByRole("button", { name: "录入声纹" });
    const refresh = screen.getByRole("button", { name: "刷新声纹状态" });

    act(() => {
      enroll.click();
      refresh.click();
    });
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("keeps recorder acquisition failures distinct from mutation uncertainty", async () => {
    const user = userEvent.setup();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <VoiceprintPanel
        recorderFactory={async () => {
          throw new Error("microphone unavailable");
        }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "录入声纹" }));

    expect(await screen.findByText("录音失败：microphone unavailable")).toHaveClass("text-sm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("录音失败：microphone unavailable");
  });

  it("keeps recorder stop failures distinct from upload outcomes", async () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const recorder = fakeRecorder(async () => {
      throw new Error("encoder failed");
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={async () => recorder} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await flushMicrotasks();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));

    expect(screen.getByText("录音失败：encoder failed")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("录音失败：encoder failed");
  });

  it("cancels the owned recorder and clears its clip timer when the panel unmounts", async () => {
    vi.useFakeTimers();
    const recorder = fakeRecorder();
    const recorderFactory = vi.fn<MicRecorderFactory>(async () => recorder);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<VoiceprintPanel recorderFactory={recorderFactory} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await flushMicrotasks();
    expect(screen.getByText("正在录第 1/5 段，说话…")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    await flushMicrotasks();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an inactive parent surface as a close boundary and cancels recording", async () => {
    vi.useFakeTimers();
    const recorder = fakeRecorder();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <VoiceprintPanel active recorderFactory={async () => recorder} />,
    );
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await flushMicrotasks();
    view.rerender(
      <VoiceprintPanel active={false} recorderFactory={async () => recorder} />,
    );
    await flushMicrotasks();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a recorder that arrives after the parent has closed and never enrolls it", async () => {
    const pendingRecorder = deferred<MicRecorder>();
    const recorder = fakeRecorder();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <VoiceprintPanel active recorderFactory={() => pendingRecorder.promise} />,
    );
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    view.rerender(
      <VoiceprintPanel active={false} recorderFactory={() => pendingRecorder.promise} />,
    );
    pendingRecorder.resolve(recorder);

    await waitFor(() => expect(recorder.cancel).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
  });

  it("ignores a late recorder stop after close and never posts its WAV", async () => {
    vi.useFakeTimers();
    const lateStop = deferred<string>();
    const recorder = fakeRecorder(() => lateStop.promise);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validStatus(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <VoiceprintPanel active recorderFactory={async () => recorder} />,
    );
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await flushMicrotasks();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(recorder.stop).toHaveBeenCalledTimes(1);

    view.rerender(
      <VoiceprintPanel active={false} recorderFactory={async () => recorder} />,
    );
    lateStop.resolve("late-wav");
    await flushMicrotasks();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
  });

  it("aborts and ignores a late enrollment response after the parent closes", async () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const enrollment = deferred<{ ok: boolean; json: () => Promise<{ ok: boolean }> }>();
    let uploadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/status")) {
        return Promise.resolve({ ok: true, json: async () => validStatus() });
      }
      uploadSignal = init?.signal as AbortSignal | undefined;
      return enrollment.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const recorders = Array.from({ length: 5 }, () => fakeRecorder());
    const recorderFactory = vi.fn<MicRecorderFactory>(async () => {
      const next = recorders.shift();
      if (!next) throw new Error("unexpected extra clip");
      return next;
    });
    const view = render(
      <VoiceprintPanel active recorderFactory={recorderFactory} />,
    );
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();
    expect(screen.getByText("正在提交声纹…")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    view.rerender(
      <VoiceprintPanel active={false} recorderFactory={recorderFactory} />,
    );
    expect(uploadSignal?.aborted).toBe(true);
    enrollment.resolve({ ok: true, json: async () => ({ ok: true }) });
    await flushMicrotasks();

    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(announce).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-OK response", false, { ok: true, clips: 5, enrolled: true }],
    ["missing success fields", true, { ok: true }],
    ["a non-boolean result", true, { ok: "yes", clips: 5, enrolled: true }],
    ["an inconsistent enrollment fact", true, { ok: true, clips: 5, enrolled: false }],
    [
      "prototype-only enrollment fields",
      true,
      Object.create({ ok: true, clips: 5, enrolled: true }),
    ],
  ])("does not show enrollment success for %s", async (_label, ok, payload) => {
    vi.useFakeTimers();
    const fetchMock = enrollmentFetch(ok, payload);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("声纹注册未确认；权威状态显示尚未注册"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits for an enrolled status readback before confirming a candidate success", async () => {
    vi.useFakeTimers();
    const readback = deferred<{
      ok: boolean;
      json: () => Promise<ReturnType<typeof baseStatus>>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, clips: 5, enrolled: true }),
      })
      .mockImplementationOnce(() => readback.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(screen.getByText("正在核验声纹注册结果…")).toBeInTheDocument();

    readback.resolve({
      ok: true,
      json: async () => validStatus({ enrolled: true }),
    });
    await flushMicrotasks();
    expect(
      screen.getByText("声纹模板已注册；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a candidate success contradicted by the authoritative readback", async () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const fetchMock = enrollmentFetch(
      true,
      { ok: true, clips: 5, enrolled: true },
      validStatus({ enrolled: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("注册响应与权威声纹状态不一致，尚未确认注册"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "注册响应与权威声纹状态不一致，尚未确认注册",
    );
  });

  it("confirms a rejected upload only when the authoritative readback is enrolled", async () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() })
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => validStatus({ enrolled: true }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("声纹模板已注册；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/录音失败/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "声纹模板注册已确认；当前网页转写入口未执行身份验证",
    );
  });

  it("reports an upload rejection as unconfirmed when readback remains unenrolled", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() })
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("声纹注册未确认；权威状态显示尚未注册"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/录音失败/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps mutation disabled when upload and authoritative readback are both unknown", async () => {
    vi.useFakeTimers();
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => validStatus() })
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce({ ok: false, json: async () => validStatus() });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("声纹注册结果未知；无法读取权威声纹状态"),
    ).toBeInTheDocument();
    expect(screen.getByText("无法读取声纹状态")).toBeInTheDocument();
    const enroll = screen.getByRole("button", { name: "录入声纹" });
    expect(enroll).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(enroll);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "声纹注册结果未知；无法读取权威声纹状态",
    );
  });

  it("treats invalid enrollment JSON as a registration read failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/status")
          ? { ok: true, json: async () => validStatus() }
          : {
              ok: true,
              json: async () => {
                throw new SyntaxError("invalid JSON");
              },
            },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(
      screen.getByText("声纹注册未确认；权威状态显示尚未注册"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves a truthful backend enrollment error", async () => {
    vi.useFakeTimers();
    const fetchMock = enrollmentFetch(true, {
      ok: false,
      error: "没有可用录音",
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(screen.getByText("没有可用录音")).toBeInTheDocument();
    expect(screen.queryByText(/声纹模板已注册/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a nonblank fallback for an empty known backend error", async () => {
    vi.useFakeTimers();
    const fetchMock = enrollmentFetch(true, { ok: false, error: "   " });
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceprintPanel recorderFactory={recorderSequence()} />);
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "录入声纹" }));
    await finishFiveClips();

    expect(screen.getByText("声纹注册失败，请重试")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function validStatus(overrides: Partial<ReturnType<typeof baseStatus>> = {}) {
  return { ...baseStatus(), ...overrides };
}

function baseStatus() {
  return {
    enrolled: false,
    model_available: true,
    threshold: 0.7,
    require: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeRecorder(stop: MicRecorder["stop"] = async () => "wav-data"): MicRecorder {
  return {
    stop: vi.fn(stop),
    cancel: vi.fn(async () => undefined),
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function finishFiveClips() {
  for (let clip = 1; clip <= 5; clip += 1) {
    await flushMicrotasks();
    expect(screen.getByText(`正在录第 ${clip}/5 段，说话…`)).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
  }
  await flushMicrotasks();
}

function recorderSequence(): MicRecorderFactory {
  const recorders = Array.from({ length: 5 }, () => fakeRecorder());
  return vi.fn(async () => {
    const next = recorders.shift();
    if (!next) throw new Error("unexpected extra clip");
    return next;
  });
}

function enrollmentFetch(
  ok: boolean,
  payload: unknown,
  readback = validStatus(),
) {
  let statusReads = 0;
  return vi.fn((url: string) => {
    if (url.endsWith("/status")) {
      const status = statusReads === 0 ? validStatus() : readback;
      statusReads += 1;
      return Promise.resolve({ ok: true, json: async () => status });
    }
    return Promise.resolve({ ok, json: async () => payload });
  });
}
