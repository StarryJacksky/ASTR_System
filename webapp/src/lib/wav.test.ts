import { afterEach, describe, expect, it, vi } from "vitest";

import { startRecorder } from "./wav";

interface AudioHarnessOptions {
  readonly trackCount?: number;
  readonly failAt?: "source" | "processor" | "gain";
  readonly processorDisconnectError?: Error;
  readonly clearHandlerError?: Error;
  readonly getTracksError?: Error;
}

function installAudioHarness(options: AudioHarnessOptions = {}) {
  const tracks = Array.from({ length: options.trackCount ?? 2 }, () => ({ stop: vi.fn() }));
  const stream = {
    getTracks: vi.fn(() => {
      if (options.getTracksError) throw options.getTracksError;
      return tracks;
    }),
    getAudioTracks: vi.fn(() => tracks),
  } as unknown as MediaStream;
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  let audioProcessHandler: ((event: AudioProcessingEvent) => void) | null = null;
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(() => {
      if (options.processorDisconnectError) throw options.processorDisconnectError;
    }),
  };
  Object.defineProperty(processor, "onaudioprocess", {
    configurable: true,
    get: () => audioProcessHandler,
    set: (value: ((event: AudioProcessingEvent) => void) | null) => {
      if (value === null && options.clearHandlerError) throw options.clearHandlerError;
      audioProcessHandler = value;
    },
  });
  const gain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const close = vi.fn(async () => undefined);
  const destination = {};

  class AudioContextStub {
    readonly sampleRate = 16_000;
    readonly destination = destination;
    readonly close = close;

    createMediaStreamSource() {
      if (options.failAt === "source") throw new Error("source failed");
      return source;
    }

    createScriptProcessor() {
      if (options.failAt === "processor") throw new Error("processor failed");
      return processor;
    }

    createGain() {
      if (options.failAt === "gain") throw new Error("gain failed");
      return gain;
    }
  }

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.stubGlobal("AudioContext", AudioContextStub);

  return { tracks, stream, source, processor, gain, close, destination };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("microphone WAV recorder", () => {
  it("uses an explicit zero-gain output while collecting microphone samples", async () => {
    const audio = installAudioHarness();

    const recorder = await startRecorder();

    expect(audio.gain.gain.value).toBe(0);
    expect(audio.processor.connect).toHaveBeenCalledWith(audio.gain);
    expect(audio.gain.connect).toHaveBeenCalledWith(audio.destination);
    await recorder.cancel();
  });

  it("stops every track and closes the context once across repeated stop and cancel calls", async () => {
    const audio = installAudioHarness({ trackCount: 3 });
    const recorder = await startRecorder();

    const firstStop = recorder.stop();
    const secondStop = recorder.stop();

    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toEqual(expect.any(String));
    await expect(recorder.cancel()).resolves.toBeUndefined();
    await expect(recorder.cancel()).resolves.toBeUndefined();
    for (const track of audio.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.processor.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it("cleans every acquired resource when initialization fails partway through", async () => {
    const audio = installAudioHarness({ failAt: "processor" });

    await expect(startRecorder()).rejects.toThrow("processor failed");

    for (const track of audio.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup and reports a stop failure after releasing all resources", async () => {
    const audio = installAudioHarness({
      processorDisconnectError: new Error("processor disconnect failed"),
    });
    const recorder = await startRecorder();

    await expect(recorder.stop()).rejects.toThrow("processor disconnect failed");

    for (const track of audio.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
  });

  it("continues exhaustive cleanup when clearing the audio callback throws", async () => {
    const audio = installAudioHarness({
      clearHandlerError: new Error("clear audio callback failed"),
    });
    const recorder = await startRecorder();

    await expect(recorder.stop()).rejects.toThrow("clear audio callback failed");

    for (const track of audio.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audio.processor.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
  });

  it("falls back to audio-track enumeration and still closes context when getTracks throws", async () => {
    const audio = installAudioHarness({
      getTracksError: new Error("getTracks host failure"),
    });
    const recorder = await startRecorder();

    await expect(recorder.cancel()).rejects.toThrow("getTracks host failure");

    for (const track of audio.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audio.source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.processor.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
  });
});
