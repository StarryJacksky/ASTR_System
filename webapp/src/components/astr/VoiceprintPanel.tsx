"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic, ShieldCheck, ShieldAlert } from "lucide-react";
import { recordWavBase64 } from "@/lib/wav";

interface VpStatus {
  enrolled: boolean;
  model_available: boolean;
  threshold: number;
  require: boolean;
}

const CLIPS = 5;
const SECS = 4;

/** 声纹录入（W10-f，从 W9 后端移入网页）：录 5 段→注册主人声纹，语音入口据此升 L2。 */
export function VoiceprintPanel() {
  const [status, setStatus] = useState<VpStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [clip, setClip] = useState(0);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/core/v1/voiceprint/status", { cache: "no-store" });
      setStatus((await r.json()) as VpStatus);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const enroll = async () => {
    setMsg("");
    try {
      const clips: string[] = [];
      setPhase("recording");
      for (let i = 0; i < CLIPS; i++) {
        setClip(i + 1);
        clips.push(await recordWavBase64(SECS));
      }
      setPhase("uploading");
      const r = await fetch("/api/core/v1/voiceprint/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips_wav_b64: clips }),
      });
      const data = (await r.json()) as { ok: boolean; clips?: number; error?: string };
      if (data.ok) {
        setPhase("done");
        setMsg(`注册成功（${data.clips} 段）。语音入口已开始只认你的声音。`);
        refresh();
      } else {
        setPhase("error");
        setMsg(data.error ?? "注册失败");
      }
    } catch (e) {
      setPhase("error");
      setMsg("录音失败：" + (e instanceof Error ? e.message : "检查麦克风权限"));
    }
  };

  const busy = phase === "recording" || phase === "uploading";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        {status?.enrolled ? (
          <ShieldCheck size={16} className="text-success" />
        ) : (
          <ShieldAlert size={16} className="text-warning" />
        )}
        <span className="text-ink-2">
          {status === null
            ? "Core 离线，无法读取声纹状态"
            : status.enrolled
              ? "已注册声纹 —— 语音入口只认你的声音"
              : status.model_available
                ? "未注册 —— 现在任何人对麦说话都按主人处理"
                : "声纹模型未就位（需先 astr voiceprint download）"}
        </span>
      </div>

      <p className="text-xs text-ink-3">
        点下面按钮，会连录 {CLIPS} 段各约 {SECS} 秒。安静环境、自然说话（说什么都行）。
        {status && <span className="ml-1">阈值 {status.threshold}</span>}
      </p>

      <button
        type="button"
        onClick={enroll}
        disabled={busy || !status?.model_available}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-ink transition-transform enabled:hover:scale-[1.02] disabled:opacity-50"
      >
        <Mic size={16} />
        {phase === "recording"
          ? `正在录第 ${clip}/${CLIPS} 段，说话…`
          : phase === "uploading"
            ? "处理中…"
            : status?.enrolled
              ? "重新录入声纹"
              : "录入声纹"}
      </button>

      {msg && (
        <p className={phase === "error" ? "text-xs text-danger" : "text-xs text-success"}>{msg}</p>
      )}
    </div>
  );
}
