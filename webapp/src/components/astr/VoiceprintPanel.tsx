"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import {
  startRecorder,
  type MicRecorder,
  type MicRecorderFactory,
} from "@/lib/wav";
import { semanticStore } from "@/lib/semantic-store";

interface VpStatus {
  enrolled: boolean;
  model_available: boolean;
  threshold: number;
  require: boolean;
}

type StatusPhase = "loading" | "ready" | "error";
type VoiceprintPhase =
  | "idle"
  | "recording"
  | "uploading"
  | "verifying"
  | "done"
  | "error";
type EnrollmentResult =
  | { readonly ok: true; readonly clips: number; readonly enrolled: true }
  | { readonly ok: false; readonly error?: string };
type EnrollmentSubmission =
  | { readonly kind: "candidate" }
  | { readonly kind: "known-error"; readonly message: string }
  | { readonly kind: "unknown" };

const CLIPS = 5;
const SECS = 4;
const CLIP_DURATION_MS = SECS * 1_000;
const ANNOUNCEMENT_KEY_CAPACITY = 32;
const TOUCH_TARGET_STYLE = {
  minWidth: "var(--touch-target)",
  minHeight: "var(--touch-target)",
} as const;

export interface VoiceprintPanelProps {
  readonly active?: boolean;
  readonly recorderFactory?: MicRecorderFactory;
}

/** 声纹录入仅注册模板；网页转写入口不执行说话者身份验证。 */
export function VoiceprintPanel({
  active = true,
  recorderFactory = startRecorder,
}: VoiceprintPanelProps = {}) {
  const [status, setStatus] = useState<VpStatus | null>(null);
  const [statusPhase, setStatusPhase] = useState<StatusPhase>("loading");
  const [phase, setPhase] = useState<VoiceprintPhase>("idle");
  const [clip, setClip] = useState(0);
  const [msg, setMsg] = useState("");
  const activeRef = useRef(active);
  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseClipWaitRef = useRef<(() => void) | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const statusReadingRef = useRef(false);
  const statusRequestRef = useRef(0);
  const announcedKeysRef = useRef(new Set<string>());

  const announceOnce = useCallback(
    (key: string, message: string, ownerGeneration?: number) => {
      if (
        disposedRef.current ||
        !activeRef.current ||
        (ownerGeneration !== undefined && generationRef.current !== ownerGeneration) ||
        announcedKeysRef.current.has(key)
      ) {
        return;
      }
      announcedKeysRef.current.add(key);
      if (announcedKeysRef.current.size > ANNOUNCEMENT_KEY_CAPACITY) {
        const oldest = announcedKeysRef.current.values().next().value;
        if (oldest !== undefined) announcedKeysRef.current.delete(oldest);
      }
      semanticStore.getState().announce(message);
    },
    [],
  );

  const refresh = useCallback(async (
    ownerGeneration?: number,
    announceFailure = true,
  ): Promise<VpStatus | null> => {
    const requestId = ++statusRequestRef.current;
    const ownsRead = () =>
      !disposedRef.current &&
      activeRef.current &&
      (ownerGeneration === undefined || generationRef.current === ownerGeneration);
    statusReadingRef.current = true;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    await Promise.resolve();
    if (ownsRead()) {
      setStatus(null);
      setStatusPhase("loading");
    }
    try {
      const r = await fetch("/api/core/v1/voiceprint/status", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!r.ok) throw new Error("voiceprint status request failed");
      const nextStatus = parseStatus(await r.json());
      if (!controller.signal.aborted && ownsRead()) {
        setStatus(nextStatus);
        setStatusPhase("ready");
        return nextStatus;
      }
    } catch {
      if (!controller.signal.aborted && ownsRead()) {
        setStatus(null);
        setStatusPhase("error");
        if (announceFailure) {
          announceOnce(`status:${requestId}:failure`, "无法读取声纹状态", ownerGeneration);
        }
      }
    } finally {
      if (statusAbortRef.current === controller) {
        statusAbortRef.current = null;
        statusReadingRef.current = false;
      }
    }
    return null;
  }, [announceOnce]);

  useEffect(() => {
    const loadInitial = async () => {
      if (active) await refresh();
    };
    void loadInitial();
    return () => statusAbortRef.current?.abort();
  }, [active, refresh]);

  const clearClipTimer = useCallback(() => {
    if (clipTimerRef.current !== null) clearTimeout(clipTimerRef.current);
    clipTimerRef.current = null;
    const release = releaseClipWaitRef.current;
    releaseClipWaitRef.current = null;
    release?.();
  }, []);

  const cancelOwnedWork = useCallback(
    (resetUi: boolean) => {
      generationRef.current += 1;
      busyRef.current = false;
      clearClipTimer();
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) void ignoreCleanupFailure(recorder.cancel());
      if (resetUi && !disposedRef.current) {
        setPhase("idle");
        setClip(0);
        setMsg("");
      }
    },
    [clearClipTimer],
  );

  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) cancelOwnedWork(true);
  }, [active, cancelOwnedWork]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      activeRef.current = false;
      statusAbortRef.current?.abort();
      statusAbortRef.current = null;
      cancelOwnedWork(false);
    };
  }, [cancelOwnedWork]);

  const isOwned = useCallback(
    (generation: number) =>
      !disposedRef.current && activeRef.current && generationRef.current === generation,
    [],
  );

  const waitForClip = useCallback(
    () =>
      new Promise<void>((resolve) => {
        releaseClipWaitRef.current = resolve;
        clipTimerRef.current = setTimeout(() => {
          clipTimerRef.current = null;
          releaseClipWaitRef.current = null;
          resolve();
        }, CLIP_DURATION_MS);
      }),
    [],
  );

  const enroll = async () => {
    if (
      busyRef.current ||
      statusReadingRef.current ||
      !activeRef.current ||
      statusPhase !== "ready" ||
      !status?.model_available
    ) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    busyRef.current = true;
    let ownedUpload: AbortController | null = null;
    setMsg("");
    try {
      const clips: string[] = [];
      setPhase("recording");
      for (let i = 0; i < CLIPS; i++) {
        if (!isOwned(generation)) return;
        setClip(i + 1);
        const recorder = await recorderFactory(16_000);
        if (!isOwned(generation)) {
          await ignoreCleanupFailure(recorder.cancel());
          return;
        }
        recorderRef.current = recorder;
        await waitForClip();
        if (!isOwned(generation)) return;
        const wav = await recorder.stop();
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (!isOwned(generation)) return;
        clips.push(wav);
      }
      setPhase("uploading");
      const uploadController = new AbortController();
      ownedUpload = uploadController;
      uploadAbortRef.current = uploadController;
      const submission = await submitEnrollment(clips, uploadController.signal);
      if (!isOwned(generation) || uploadController.signal.aborted) return;
      if (submission.kind === "known-error") {
        setPhase("error");
        setMsg(submission.message);
        announceOnce(`enrollment:${generation}:outcome`, submission.message, generation);
        return;
      }

      setPhase("verifying");
      const readback = await refresh(generation, false);
      if (!isOwned(generation)) return;
      if (readback === null) {
        const message = "声纹注册结果未知；无法读取权威声纹状态";
        setPhase("error");
        setMsg(message);
        announceOnce(`enrollment:${generation}:outcome`, message, generation);
      } else if (readback.enrolled) {
        setPhase("done");
        setMsg("声纹模板已注册；当前网页转写入口未执行身份验证");
        announceOnce(
          `enrollment:${generation}:outcome`,
          "声纹模板注册已确认；当前网页转写入口未执行身份验证",
          generation,
        );
      } else {
        const message =
          submission.kind === "candidate"
            ? "注册响应与权威声纹状态不一致，尚未确认注册"
            : "声纹注册未确认；权威状态显示尚未注册";
        setPhase("error");
        setMsg(message);
        announceOnce(`enrollment:${generation}:outcome`, message, generation);
      }
    } catch (e) {
      if (!isOwned(generation)) return;
      const message = "录音失败：" + (e instanceof Error ? e.message : "检查麦克风权限");
      setPhase("error");
      setMsg(message);
      announceOnce(`enrollment:${generation}:outcome`, message, generation);
    } finally {
      if (ownedUpload && uploadAbortRef.current === ownedUpload) {
        uploadAbortRef.current = null;
      }
      if (isOwned(generation)) busyRef.current = false;
    }
  };

  const busy = phase === "recording" || phase === "uploading" || phase === "verifying";
  const statusControlDisabled = statusPhase === "loading" || busy;
  const statusControlLabel =
    statusPhase === "loading"
      ? "正在读取声纹状态"
      : statusPhase === "error"
        ? "重试读取声纹状态"
        : "刷新声纹状态";
  const enrollmentDisabled =
    busy || !active || statusPhase !== "ready" || !status?.model_available;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-px w-4 shrink-0 bg-accent" />
        <span className="text-ink-2">
          {statusPhase === "loading"
            ? "正在读取声纹状态"
            : statusPhase === "error" || status === null
            ? "无法读取声纹状态"
            : !status.model_available
              ? "声纹模型不可用；当前网页转写入口未执行身份验证"
            : status.enrolled
              ? "已注册声纹模板；当前网页转写入口未执行身份验证"
              : "未注册声纹模板；当前网页转写入口未执行身份验证"}
        </span>
      </div>

      <button
        type="button"
        style={TOUCH_TARGET_STYLE}
        aria-disabled={statusControlDisabled}
        onClick={() => {
          if (
            !statusControlDisabled &&
            !statusReadingRef.current &&
            !busyRef.current
          ) {
            void refresh();
          }
        }}
        className="rounded-md border border-hairline px-3 text-ink-2 transition-colors hover:bg-surface-2 aria-disabled:opacity-50"
      >
        {statusControlLabel}
      </button>

      <p className="text-xs text-ink-3">
        点下面按钮，会连录 {CLIPS} 段各约 {SECS} 秒。安静环境、自然说话（说什么都行）。
        {status && <span className="ml-1">阈值 {status.threshold}</span>}
      </p>

      <button
        type="button"
        onClick={enroll}
        aria-disabled={enrollmentDisabled}
        style={TOUCH_TARGET_STYLE}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-on-accent transition-transform hover:scale-[1.02] aria-disabled:opacity-50"
      >
        <Mic size={16} />
        {phase === "recording"
          ? `正在录第 ${clip}/${CLIPS} 段，说话…`
          : phase === "uploading"
            ? "正在提交声纹…"
            : phase === "verifying"
              ? "正在核验声纹注册结果…"
            : status?.enrolled
              ? "重新录入声纹"
              : "录入声纹"}
      </button>

      {msg && (
        <p className={phase === "error" ? "text-sm text-danger" : "text-sm text-ink-2"}>{msg}</p>
      )}
    </div>
  );
}

async function submitEnrollment(
  clips: readonly string[],
  signal: AbortSignal,
): Promise<EnrollmentSubmission> {
  try {
    const response = await fetch("/api/core/v1/voiceprint/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clips_wav_b64: clips }),
      signal,
    });
    if (!response.ok) return { kind: "unknown" };

    let result: EnrollmentResult | null;
    try {
      result = parseEnrollmentResult(await response.json());
    } catch {
      return { kind: "unknown" };
    }
    if (result === null) return { kind: "unknown" };
    if (result.ok) return { kind: "candidate" };
    const backendMessage = result.error?.trim();
    return {
      kind: "known-error",
      message: backendMessage || "声纹注册失败，请重试",
    };
  } catch {
    return { kind: "unknown" };
  }
}

function parseStatus(value: unknown): VpStatus {
  if (
    typeof value !== "object" ||
    value === null ||
    !hasOwn(value, "enrolled") ||
    !hasOwn(value, "model_available") ||
    !hasOwn(value, "threshold") ||
    !hasOwn(value, "require") ||
    typeof Reflect.get(value, "enrolled") !== "boolean" ||
    typeof Reflect.get(value, "model_available") !== "boolean" ||
    typeof Reflect.get(value, "threshold") !== "number" ||
    !Number.isFinite(Reflect.get(value, "threshold")) ||
    typeof Reflect.get(value, "require") !== "boolean"
  ) {
    throw new Error("invalid voiceprint status");
  }

  return {
    enrolled: Reflect.get(value, "enrolled"),
    model_available: Reflect.get(value, "model_available"),
    threshold: Reflect.get(value, "threshold"),
    require: Reflect.get(value, "require"),
  };
}

function parseEnrollmentResult(value: unknown): EnrollmentResult | null {
  if (typeof value !== "object" || value === null || !hasOwn(value, "ok")) return null;
  const ok = Reflect.get(value, "ok");
  if (typeof ok !== "boolean") return null;
  if (!ok) {
    if (!hasOwn(value, "error")) return { ok: false };
    const error = Reflect.get(value, "error");
    if (typeof error !== "string") return null;
    return { ok: false, error };
  }

  if (!hasOwn(value, "clips") || !hasOwn(value, "enrolled")) return null;
  const clips = Reflect.get(value, "clips");
  const enrolled = Reflect.get(value, "enrolled");
  if (!Number.isInteger(clips) || clips < 1 || enrolled !== true) return null;
  return { ok: true, clips, enrolled: true };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function ignoreCleanupFailure(cleanup: Promise<void>): Promise<void> {
  try {
    await cleanup;
  } catch {
    // The recorder owns exhaustive cleanup; a host release error must not revive this UI lease.
  }
}
