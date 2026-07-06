"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, OctagonX, Send, Settings, SlidersHorizontal, X } from "lucide-react";
import { startRecorder, type MicRecorder } from "@/lib/wav";
import { VoiceprintPanel } from "@/components/astr/VoiceprintPanel";
import { Live2DControls } from "@/components/astr/Live2DControls";
import { Live2DStage } from "@/components/astr/Live2DStage";
import { LifeArea } from "@/components/astr/LifeArea";
import { MessageTimeline } from "@/components/astr/MessageTimeline";
import { EmotionGauge } from "@/components/astr/EmotionGauge";
import { VoiceVisualizer } from "@/components/astr/VoiceVisualizer";
import { StatusBar } from "@/components/astr/StatusBar";
import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { useEventStream, useReplyStream, useStatus } from "@/lib/useCore";
import { applyEmotionGlow } from "@/lib/emotion";
import { soulToGlow, type ChatMessage } from "@/lib/types";

const EMO_LABEL: Record<string, string> = {
  lonely: "孤独",
  excited: "兴奋",
  tsundere: "傲娇",
  calm: "平静",
};

// 情绪 → Haru 表情下标（F01–F08，切换可见即可）。
const EXPR_INDEX: Record<string, number> = { calm: 0, excited: 1, tsundere: 2, lonely: 3 };

export default function Cockpit() {
  const { status, connected } = useStatus();
  const { events } = useEventStream(["agent.thought", "soul.decision", "moa.report"]);
  const { text: streamText, active: streamActive } = useReplyStream();
  const [userMsgs, setUserMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [lifeExpanded, setLifeExpanded] = useState(false);
  const [speak, setSpeak] = useState<{ sig: number; ms: number }>({ sig: 0, ms: 0 });
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [estopped, setEstopped] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const lastFlapRef = useRef(0);

  // 急停（P2-W8）：红钮 <500ms 停手；再点一次复位。热键 Ctrl+Alt+Space 同效（Core 侧）。
  const toggleEstop = async () => {
    const path = estopped ? "/api/core/v1/effector/estop/reset" : "/api/core/v1/effector/estop";
    try {
      await fetch(path, { method: "POST" });
      setEstopped((v) => !v);
    } catch {
      /* Core 离线 */
    }
  };

  // 情绪 → 环境光（04 §3.2）：她的真实情绪向量驱动整页背光，缓慢变化。
  const glow = soulToGlow(status?.emotion);
  useEffect(() => {
    applyEmotionGlow(glow);
  }, [glow]);

  const dominant = useMemo(() => {
    const entries = Object.entries(glow) as [keyof typeof glow, number][];
    return entries.sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [glow]);
  const emotionLabel = dominant ? EMO_LABEL[dominant] : undefined;
  const expressionIndex = dominant ? EXPR_INDEX[dominant] : 0;

  // 她的回复来自 SSE 的 soul.decision；用户消息本地乐观追加，按时间合并。
  // 正在流式生成的那句以临时气泡追加在末尾（99 #19①），soul.decision 终稿到达即替换。
  const messages = useMemo<ChatMessage[]>(() => {
    const her: ChatMessage[] = events
      .filter((e) => e.type === "soul.decision" && e.payload.reply_text)
      .map((e) => ({
        id: e.id,
        role: "qiuqiu" as const,
        text: String(e.payload.reply_text ?? ""),
        ts: new Date(e.ts).getTime(),
      }));
    const merged = [...userMsgs, ...her].sort((a, b) => a.ts - b.ts);
    if (streamText) {
      merged.push({
        id: "streaming",
        role: "qiuqiu",
        text: streamText + (streamActive ? " ▍" : ""),
        ts: Number.MAX_SAFE_INTEGER,
      });
    }
    return merged;
  }, [events, userMsgs, streamText, streamActive]);

  // 嘴型随流动（99 #19①）：流帧到达即触发短促嘴动（节流 350ms，避免每帧重启动画）。
  useEffect(() => {
    if (!streamActive || !streamText) return;
    const now = Date.now();
    if (now - lastFlapRef.current > 350) {
      lastFlapRef.current = now;
      setSpeak({ sig: now, ms: 550 });
    }
  }, [streamText, streamActive]);

  // 整段到达（未走流式/QQ 等场景）：她最新一条回复变化时 → 按字数估一段嘴动。
  const lastHerId = useMemo(() => {
    const her = messages.filter((m) => m.role === "qiuqiu" && m.id !== "streaming");
    return her[her.length - 1]?.id;
  }, [messages]);
  useEffect(() => {
    if (!lastHerId) return;
    // 刚流完的句子嘴已经动过了，不再补一段长嘴动
    if (Date.now() - lastFlapRef.current < 1500) return;
    const her = messages.filter((m) => m.role === "qiuqiu" && m.id !== "streaming");
    const text = her[her.length - 1]?.text ?? "";
    setSpeak({ sig: Date.now(), ms: Math.min(6000, Math.max(900, text.length * 130)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastHerId]);

  const send = async (textArg?: string) => {
    const text = (textArg ?? draft).trim();
    if (!text) return;
    setUserMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", text, ts: Date.now() }]);
    setDraft("");
    try {
      await fetch("/api/core/v1/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, platform: "web", user_id: "jacksky" }),
      });
    } catch {
      /* Core 离线：消息已在本地显示，发送静默失败 */
    }
  };

  // 麦克风按钮：按一下开始录、再按停止 → 本地 SenseVoice 转写 → 直接发出。
  const toggleMic = async () => {
    if (recording) {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!rec) return;
      setTranscribing(true);
      try {
        const wav = await rec.stop();
        const r = await fetch("/api/core/v1/voice/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wav_b64: wav }),
        });
        const data = (await r.json()) as { text?: string };
        if (data.text?.trim()) await send(data.text.trim());
      } catch {
        /* 转写失败/Core 离线：忽略 */
      } finally {
        setTranscribing(false);
      }
    } else {
      try {
        recorderRef.current = await startRecorder(16000);
        setRecording(true);
      } catch {
        /* 麦克风权限被拒：忽略 */
      }
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* 顶部仪器条：无盒——只有内容和一条刻线。铭牌用衬线，读数用等宽 */}
      <header className="flex items-center justify-between border-b border-hairline px-8 py-4">
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden
            className="h-2 w-2 self-center rounded-full"
            style={{
              background: "var(--astr-emotion-glow)",
              boxShadow: "0 0 14px var(--astr-emotion-glow)",
              transition:
                "background 2400ms var(--ease-inout), box-shadow 2400ms var(--ease-inout)",
              animation: "astr-breath var(--dur-breath) ease-in-out infinite",
            }}
          />
          <span className="astr-wordmark text-xl text-ink">露怀秋</span>
          <span className="astr-label">ASTR OBSERVATORY</span>
        </div>
        <StatusBar
          soulName={status?.soul_name ?? "justin"}
          model={status?.local_llm_model ?? "—"}
          costToday={status?.cost_today_usd ?? null}
          budget={status?.daily_budget_usd ?? null}
          connected={connected}
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={estopped ? "复位急停" : "急停"}
            title={estopped ? "急停已触发——点击复位" : "急停（她立刻停手）"}
            onClick={toggleEstop}
            className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${
              estopped
                ? "animate-pulse border border-danger bg-danger/20 text-danger"
                : "text-danger/60 hover:bg-surface-2 hover:text-danger"
            }`}
          >
            <OctagonX size={16} />
          </button>
          <button
            type="button"
            aria-label="设置"
            onClick={() => setShowSettings((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Settings size={16} />
          </button>
          <Link
            href="/admin"
            aria-label="后台控制台"
            title="后台控制台（执行层旋钮/审计）"
            className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <SlidersHorizontal size={16} />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* 设置浮层：声纹录入（W10-f）*/}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="astr-glass absolute left-3 top-16 z-[var(--z-overlay)] max-h-[82vh] w-80 overflow-auto rounded-2xl border border-hairline p-4 shadow-[var(--shadow-3)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">设置 · 声纹</h3>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setShowSettings(false)}
                className="text-ink-3 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <VoiceprintPanel />
            <div className="my-4 border-t border-hairline" />
            <h3 className="mb-3 text-sm font-medium text-ink">看板娘取景</h3>
            <Live2DControls />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 观测场景：左=对话之河（无盒，上下渐隐），右=她的观测柱（全高，一条刻线分隔） */}
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
        {/* 对话之河 */}
        <section className="relative mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col px-8 lg:min-h-0">
          <div className="astr-label shrink-0 pb-4 pt-6">01 / DIALOGUE — 对话</div>
          <div
            className="min-h-0 flex-1 overflow-y-auto pr-2"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent, black 28px, black calc(100% - 28px), transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 28px, black calc(100% - 28px), transparent)",
            }}
          >
            <MessageTimeline messages={messages} />
          </div>

          {/* 输入：一条刻线上的仪器行，不是大盒子。聚焦=琥珀刻线通电 */}
          <footer className="astr-composer flex shrink-0 items-center gap-3 border-t border-hairline py-4">
            <span aria-hidden className="font-mono text-sm text-ink-3">
              ❯
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={
                recording
                  ? "录音中…再点一下麦克风停止"
                  : transcribing
                    ? "转写中…"
                    : connected
                      ? "和秋秋说点什么…"
                      : "Core 离线 —— 消息只在本地显示"
              }
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <VoiceVisualizer />
            <button
              type="button"
              aria-label={recording ? "停止录音" : "语音输入"}
              onClick={toggleMic}
              disabled={transcribing}
              className={`grid h-8 w-8 place-items-center rounded-md transition-colors disabled:opacity-50 ${
                recording
                  ? "animate-pulse border border-danger text-danger"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Mic size={15} />
            </button>
            <motion.button
              type="button"
              aria-label="发送"
              onClick={() => send()}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="grid h-8 w-8 place-items-center rounded-md text-on-accent"
              style={{ background: "var(--astr-accent)" }}
            >
              <Send size={15} />
            </motion.button>
          </footer>
        </section>

        {/* 她的观测柱：房间里唯一发光的存在。竖排铭牌立在分隔线上 */}
        <aside className="relative flex min-h-0 flex-col border-t border-hairline lg:border-l lg:border-t-0">
          <span
            aria-hidden
            className="astr-label absolute left-3 top-6 hidden lg:block"
            style={{ writingMode: "vertical-rl", letterSpacing: "0.4em" }}
          >
            观测记录
          </span>
          <div className="flex min-h-0 flex-1 flex-col pl-8 pr-8 lg:pl-12">
            <div className="relative shrink-0 pt-2">
              <Live2DStage
                emotionLabel={emotionLabel}
                expressionIndex={expressionIndex}
                speakSignal={speak.sig}
                speakMs={speak.ms}
              />
              <div className="mt-4">
                <EmotionGauge emotion={status?.emotion ?? null} />
              </div>
            </div>
            <div className="mt-5 shrink-0 border-t border-hairline pt-4">
              <div className="astr-label pb-3">02 / LIFE — 她的生活</div>
            </div>
            <div className={`min-h-0 ${lifeExpanded ? "flex-[3]" : "flex-1"} pb-4`}>
              <LifeArea
                events={events}
                activity={status?.activity}
                expanded={lifeExpanded}
                onToggle={() => setLifeExpanded((v) => !v)}
              />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
