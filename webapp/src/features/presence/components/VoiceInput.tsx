"use client";

import { Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { TranscriptionResult } from "@/lib/types";
import {
  startRecorder,
  type MicRecorder,
  type MicRecorderFactory,
} from "@/lib/wav";

import styles from "./Composer.module.css";

const DEFAULT_MAX_DURATION_MS = 30_000;

type VoicePhase = "idle" | "starting" | "recording" | "stopping" | "transcribing";

export interface VoiceInputProps {
  readonly coreReachable: boolean;
  readonly transcribe: (
    wavB64: string,
    signal?: AbortSignal,
  ) => Promise<TranscriptionResult>;
  readonly onTranscript: (text: string) => void;
  readonly recorderFactory?: MicRecorderFactory;
  readonly maxDurationMs?: number;
}

export function VoiceInput({
  coreReachable,
  transcribe,
  onTranscript,
  recorderFactory = startRecorder,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
}: VoiceInputProps) {
  const statusId = useId();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const phaseRef = useRef<VoicePhase>("idle");
  const generationRef = useRef(0);
  const disposedRef = useRef(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maximumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const coreReachableRef = useRef(coreReachable);

  useLayoutEffect(() => {
    coreReachableRef.current = coreReachable;
  }, [coreReachable]);

  const setOwnedPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearRecordingTimers = useCallback(() => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    if (maximumTimerRef.current !== null) clearTimeout(maximumTimerRef.current);
    intervalRef.current = null;
    maximumTimerRef.current = null;
  }, []);

  const isActive = useCallback(
    (generation: number) =>
      !disposedRef.current && generationRef.current === generation,
    [],
  );

  const finishRecording = useCallback(async () => {
    if (phaseRef.current !== "recording") return;
    const generation = generationRef.current;
    const recorder = recorderRef.current;
    if (!recorder) return;
    clearRecordingTimers();
    setOwnedPhase("stopping");

    let wav: string;
    try {
      wav = await recorder.stop();
    } catch {
      if (!isActive(generation)) return;
      recorderRef.current = null;
      setOwnedPhase("idle");
      setMessage("录音失败，请检查麦克风设备");
      return;
    }
    if (!isActive(generation)) return;
    recorderRef.current = null;

    if (!coreReachableRef.current) {
      setOwnedPhase("idle");
      setMessage("Core 不可达，语音转写暂不可用");
      return;
    }

    const abortController = new AbortController();
    transcriptionAbortRef.current = abortController;
    setOwnedPhase("transcribing");
    try {
      const result = await transcribe(wav, abortController.signal);
      if (!isActive(generation) || abortController.signal.aborted) return;
      if (result.text.trim().length === 0) {
        setMessage("没有识别到可用文字");
      } else {
        onTranscript(result.text);
        setMessage("转写已回填，请确认后发送");
      }
    } catch {
      if (!isActive(generation) || abortController.signal.aborted) return;
      setMessage("语音转写失败，请重试");
    } finally {
      if (transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
      if (isActive(generation)) setOwnedPhase("idle");
    }
  }, [clearRecordingTimers, isActive, onTranscript, setOwnedPhase, transcribe]);

  const beginRecording = useCallback(async () => {
    if (phaseRef.current !== "idle" || !coreReachableRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setMessage(null);
    setElapsedSeconds(0);
    setOwnedPhase("starting");

    let recorder: MicRecorder;
    try {
      recorder = await recorderFactory(16_000);
    } catch (error) {
      if (!isActive(generation)) return;
      setOwnedPhase("idle");
      setMessage(
        isPermissionDenial(error)
          ? "麦克风权限被拒绝"
          : "录音失败，请检查麦克风设备",
      );
      return;
    }

    if (!isActive(generation)) {
      await ignoreCleanupFailure(recorder.cancel());
      return;
    }

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setOwnedPhase("recording");
    intervalRef.current = setInterval(() => {
      if (!isActive(generation)) return;
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1_000));
    }, 1_000);
    const duration = positiveDuration(maxDurationMs, DEFAULT_MAX_DURATION_MS);
    maximumTimerRef.current = setTimeout(() => {
      if (isActive(generation)) void finishRecording();
    }, duration);
  }, [finishRecording, isActive, maxDurationMs, recorderFactory, setOwnedPhase]);

  const cancel = useCallback(async () => {
    if (phaseRef.current === "idle") return;
    generationRef.current += 1;
    clearRecordingTimers();
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setOwnedPhase("idle");
    setMessage("语音输入已取消");
    if (recorder) await ignoreCleanupFailure(recorder.cancel());
  }, [clearRecordingTimers, setOwnedPhase]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      clearRecordingTimers();
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) void ignoreCleanupFailure(recorder.cancel());
    };
  }, [clearRecordingTimers]);

  const statusText = voiceStatus(phase, elapsedSeconds, coreReachable, message);
  const active = phase !== "idle";
  const starting = phase === "starting";
  const recording = phase === "recording";
  const processing = phase === "stopping" || phase === "transcribing";

  return (
    <div className={styles.voice}>
      {recording ? (
        <button
          type="button"
          className={styles.control}
          aria-label="停止并转写"
          aria-describedby={statusId}
          onClick={() => void finishRecording()}
        >
          <Square aria-hidden size={17} />
        </button>
      ) : (
        <button
          type="button"
          className={styles.control}
          aria-label="开始语音输入"
          aria-describedby={statusId}
          disabled={active || !coreReachable}
          onClick={() => void beginRecording()}
        >
          <Mic aria-hidden size={18} />
        </button>
      )}

      {active && (
        <button
          type="button"
          className={styles.secondaryControl}
          aria-label={
            starting
              ? "取消语音输入"
              : recording
                ? "取消录音"
                : "取消语音处理"
          }
          aria-describedby={statusId}
          onClick={() => void cancel()}
        >
          <X aria-hidden size={17} />
        </button>
      )}

      <p id={statusId} className={processing ? styles.voiceBusy : styles.voiceStatus}>
        {statusText}
      </p>
    </div>
  );
}

function voiceStatus(
  phase: VoicePhase,
  elapsedSeconds: number,
  coreReachable: boolean,
  message: string | null,
): string {
  if (phase === "starting") return "正在请求麦克风权限";
  if (phase === "recording") return `录音中 ${elapsedSeconds} 秒`;
  if (phase === "stopping") return "正在结束录音";
  if (phase === "transcribing") return "正在转写，结果不会自动发送";
  if (!coreReachable) return "Core 不可达，语音转写暂不可用";
  if (message) return message;
  return "语音输入默认关闭；转写结果需确认后发送";
}

function isPermissionDenial(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

function positiveDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function ignoreCleanupFailure(cleanup: Promise<void>): Promise<void> {
  try {
    await cleanup;
  } catch {
    // Cleanup is best-effort at the component boundary; the recorder exhausts every release step.
  }
}
