import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MicRecorder, MicRecorderFactory } from "@/lib/wav";

import { VoiceInput } from "./VoiceInput";

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

function renderVoice(
  overrides: Partial<{
    coreReachable: boolean;
    recorderFactory: MicRecorderFactory;
    transcribe: (wavB64: string, signal?: AbortSignal) => Promise<{ readonly text: string }>;
    onTranscript: (text: string) => void;
    maxDurationMs: number;
  }> = {},
) {
  const recorder = fakeRecorder();
  const props = {
    coreReachable: true,
    recorderFactory: vi.fn(async () => recorder) as MicRecorderFactory,
    transcribe: vi.fn(async () => ({ text: "transcript" })),
    onTranscript: vi.fn(),
    maxDurationMs: 30_000,
    ...overrides,
  };
  return { recorder, props, ...render(<VoiceInput {...props} />) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Presence VoiceInput", () => {
  it("distinguishes microphone permission denial from other recorder failures", async () => {
    const user = userEvent.setup();
    const denied = vi.fn<MicRecorderFactory>(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    const first = renderVoice({ recorderFactory: denied });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(await screen.findByText("麦克风权限被拒绝")).toBeInTheDocument();
    first.unmount();

    const broken = vi.fn<MicRecorderFactory>(async () => {
      throw new Error("device failed");
    });
    renderVoice({ recorderFactory: broken });
    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(await screen.findByText("录音失败，请检查麦克风设备")).toBeInTheDocument();
  });

  it("distinguishes transcription failure and empty transcription", async () => {
    const user = userEvent.setup();
    const first = renderVoice({
      transcribe: vi.fn(async () => {
        throw new Error("Core rejected transcription");
      }),
    });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    expect(await screen.findByText("语音转写失败，请重试")).toBeInTheDocument();
    first.unmount();

    renderVoice({ transcribe: vi.fn(async () => ({ text: "   " })) });
    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    expect(await screen.findByText("没有识别到可用文字")).toBeInTheDocument();
  });

  it("reports recorder stop rejection as a recording failure before transcription", async () => {
    const user = userEvent.setup();
    const recorder = fakeRecorder(async () => {
      throw new Error("encoder stopped unexpectedly");
    });
    const transcribe = vi.fn(async () => ({ text: "must not run" }));
    renderVoice({ recorderFactory: async () => recorder, transcribe });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));

    expect(await screen.findByText("录音失败，请检查麦克风设备")).toBeInTheDocument();
    expect(transcribe).not.toHaveBeenCalled();
    expect(screen.queryByText("语音转写失败，请重试")).not.toBeInTheDocument();
  });

  it("shows the initial Core-unreachable boundary without acquiring a microphone", () => {
    const recorderFactory = vi.fn<MicRecorderFactory>(async () => fakeRecorder());
    renderVoice({ coreReachable: false, recorderFactory });

    expect(screen.getByText("Core 不可达，语音转写暂不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始语音输入" })).toBeDisabled();
    expect(recorderFactory).not.toHaveBeenCalled();
  });

  it("lets a later Core-offline fact replace an older idle success message", async () => {
    const user = userEvent.setup();
    const view = renderVoice({
      transcribe: vi.fn(async () => ({ text: "completed transcript" })),
    });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    expect(await screen.findByText("转写已回填，请确认后发送")).toBeInTheDocument();

    view.rerender(<VoiceInput {...view.props} coreReachable={false} />);

    expect(screen.getByText("Core 不可达，语音转写暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("转写已回填，请确认后发送")).not.toBeInTheDocument();
  });

  it("returns a non-empty transcript verbatim without claiming identity or sending anything", async () => {
    const user = userEvent.setup();
    const onTranscript = vi.fn();
    const { container } = renderVoice({
      transcribe: vi.fn(async () => ({ text: "  保留空格  " })),
      onTranscript,
    });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("  保留空格  "));
    expect(container).not.toHaveTextContent(/身份已验证|只认主人|声纹已验证/);
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
  });

  it("shows textual starting and recording states with described controls", async () => {
    const user = userEvent.setup();
    const pending = deferred<MicRecorder>();
    const { recorder, container } = renderVoice({ recorderFactory: () => pending.promise });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(screen.getByText("正在请求麦克风权限")).toBeInTheDocument();

    pending.resolve(recorder);
    expect(await screen.findByText("录音中 0 秒")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "停止并转写" });
    const cancel = screen.getByRole("button", { name: "取消录音" });
    expect(stop).toHaveAttribute("aria-describedby");
    expect(cancel).toHaveAttribute("aria-describedby");
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
  });

  it("stops and transcribes exactly once at the maximum recording duration", async () => {
    vi.useFakeTimers();
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async () => ({ text: "maximum" }));
    const onTranscript = vi.fn();
    renderVoice({
      recorderFactory: async () => recorder,
      transcribe,
      onTranscript,
      maxDurationMs: 5_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("button", { name: "停止并转写" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("maximum");
  });

  it("cancels a recorder that resolves after explicit cancel or route unmount", async () => {
    const factoryResult = deferred<MicRecorder>();
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async () => ({ text: "late" }));
    const first = renderVoice({ recorderFactory: () => factoryResult.promise, transcribe });

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    fireEvent.click(screen.getByRole("button", { name: "取消语音输入" }));
    factoryResult.resolve(recorder);
    await waitFor(() => expect(recorder.cancel).toHaveBeenCalledTimes(1));
    expect(transcribe).not.toHaveBeenCalled();
    first.unmount();

    const unmountResult = deferred<MicRecorder>();
    const lateRecorder = fakeRecorder();
    const second = renderVoice({ recorderFactory: () => unmountResult.promise, transcribe });
    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    second.unmount();
    unmountResult.resolve(lateRecorder);
    await waitFor(() => expect(lateRecorder.cancel).toHaveBeenCalledTimes(1));
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("aborts and ignores a transcription that resolves after cancel", async () => {
    const user = userEvent.setup();
    const result = deferred<{ readonly text: string }>();
    let capturedSignal: AbortSignal | undefined;
    const onTranscript = vi.fn();
    renderVoice({
      transcribe: vi.fn((_, signal) => {
        capturedSignal = signal;
        return result.promise;
      }),
      onTranscript,
    });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    await user.click(screen.getByRole("button", { name: "取消语音处理" }));
    expect(capturedSignal?.aborted).toBe(true);

    result.resolve({ text: "late transcript" });
    await result.promise;
    await act(async () => Promise.resolve());
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("ignores a late WAV when cancel or unmount occurs while stop is pending", async () => {
    const user = userEvent.setup();
    const firstStop = deferred<string>();
    const firstRecorder = fakeRecorder(() => firstStop.promise);
    const transcribe = vi.fn(async () => ({ text: "must not run" }));
    const first = renderVoice({ recorderFactory: async () => firstRecorder, transcribe });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    await user.click(screen.getByRole("button", { name: "取消语音处理" }));
    firstStop.resolve("late-wav");
    await firstStop.promise;
    await act(async () => Promise.resolve());
    expect(firstRecorder.stop).toHaveBeenCalledTimes(1);
    expect(firstRecorder.cancel).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
    first.unmount();

    const secondStop = deferred<string>();
    const secondRecorder = fakeRecorder(() => secondStop.promise);
    const second = renderVoice({ recorderFactory: async () => secondRecorder, transcribe });
    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止并转写" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "停止并转写" }));
    second.unmount();
    secondStop.resolve("late-unmount-wav");
    await secondStop.promise;
    await act(async () => Promise.resolve());
    expect(secondRecorder.stop).toHaveBeenCalledTimes(1);
    expect(secondRecorder.cancel).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("aborts and ignores pending transcription on route unmount", async () => {
    const user = userEvent.setup();
    const result = deferred<{ readonly text: string }>();
    let signal: AbortSignal | undefined;
    const onTranscript = vi.fn();
    const view = renderVoice({
      transcribe: vi.fn((_, nextSignal) => {
        signal = nextSignal;
        return result.promise;
      }),
      onTranscript,
    });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    await user.click(await screen.findByRole("button", { name: "停止并转写" }));
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);

    result.resolve({ text: "late after route" });
    await result.promise;
    await act(async () => Promise.resolve());
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("still stops and cancels safely when Core becomes unreachable mid-recording", async () => {
    const user = userEvent.setup();
    const transcribe = vi.fn(async () => ({ text: "must not run" }));
    const { recorder, props, rerender } = renderVoice({ transcribe });

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(await screen.findByRole("button", { name: "停止并转写" })).toBeEnabled();
    rerender(<VoiceInput {...props} coreReachable={false} />);

    const stop = screen.getByRole("button", { name: "停止并转写" });
    expect(stop).toBeEnabled();
    await user.click(stop);

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
    expect(await screen.findByText("Core 不可达，语音转写暂不可用")).toBeInTheDocument();
  });

  it("cancels an active recorder on route unmount", async () => {
    const user = userEvent.setup();
    const { recorder, unmount } = renderVoice();

    await user.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(await screen.findByRole("button", { name: "停止并转写" })).toBeInTheDocument();
    unmount();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
  });
});
