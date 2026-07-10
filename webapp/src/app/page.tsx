"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { Mic, OctagonX, Send, Settings, SlidersHorizontal, X } from "lucide-react";
import { easeOut, enter, overlay, staggerList, tapFeedback } from "@/lib/motion";
import { startRecorder, type MicRecorder } from "@/lib/wav";
import { FlameCore } from "@/components/astr/FlameCore";
import { Intro } from "@/components/astr/Intro";
import { Starfield } from "@/components/astr/Starfield";
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

/** 更钟（04 v4.0）：守夜人的时间。19–21 一更 … 3–5 五更，白天记「昼」。 */
function watchPeriod(h: number): string {
  if (h >= 19 && h < 21) return "一更";
  if (h >= 21 && h < 23) return "二更";
  if (h >= 23 || h < 1) return "三更";
  if (h >= 1 && h < 3) return "四更";
  if (h >= 3 && h < 5) return "五更";
  return "昼";
}

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

  // 天文钟：顶栏的观测时刻读数（秒针走字=仪器在读时间这个信号，法则四豁免同心跳点）
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().slice(0, 8));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // 立体舱（v2.2 §1.3）：观测柱是一座随视线微转的立体模型——指针驱动 ±2°，
  // 弹簧有质量（望远镜不是激光笔）。reduced-motion 不倾斜。
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const tiltXs = useSpring(tiltX, { stiffness: 55, damping: 16 });
  const tiltYs = useSpring(tiltY, { stiffness: 55, damping: 16 });
  const reducedRef = useRef(false);
  useEffect(() => {
    reducedRef.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const onPointer = (e: React.MouseEvent<HTMLElement>) => {
    if (reducedRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / Math.max(1, r.width) - 0.5;
    const ny = (e.clientY - r.top) / Math.max(1, r.height) - 0.5;
    tiltY.set(nx * 2.4);
    tiltX.set(ny * -2.4);
  };

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

  // 法则八（灵魂不可知论）：舰上住着谁，由灵魂数据说了算——名字是读数，不刻在墙上。
  const soulName = status?.soul_name ?? "TA";

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

  // micro-wonder「发射」：消息升空时，发送钮荡开一圈琥珀信号环（仪器时间，一次即逝）
  const [pingSig, setPingSig] = useState(0);

  const send = async (textArg?: string) => {
    const text = (textArg ?? draft).trim();
    if (!text) return;
    setPingSig(Date.now());
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
      {/* 上甲板的天空（v3.0：星野只属于观测台，引擎室在甲板之下） */}
      <Starfield />
      {/* 启幕仪式（每会话一次） */}
      <Intro />
      {/* 顶部仪器条：无盒——只有内容和一条刻线。铭牌用衬线，读数用等宽 */}
      <header className="flex items-center justify-between border-b border-hairline px-8 py-4">
        <div className="flex items-baseline gap-3">
          {/* 火芯 = 舰上灵魂的在场记号（薪尽火传）；名字是读数（StatusBar），不刻在墙上（法则八） */}
          <span aria-hidden className="self-center">
            <FlameCore size={12} />
          </span>
          <span className="astr-wordmark text-2xl text-ink">星枢</span>
          <span className="astr-label">ASTR — 守夜</span>
          {clock && (
            <span className="astr-label tabular hidden xl:inline" style={{ letterSpacing: "0.1em" }}>
              {watchPeriod(new Date().getHours())} · {clock}
            </span>
          )}
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
            title={estopped ? "急停已触发——点击复位" : "急停（立刻停手）"}
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
            variants={overlay}
            initial="hidden"
            animate="show"
            exit="exit"
            className="astr-panel absolute left-3 top-16 z-[var(--z-overlay)] max-h-[82vh] w-80 overflow-auto rounded-2xl border border-hairline p-4 shadow-[var(--shadow-3)]"
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

      {/* 篝火构图（04 v5.0，法则七的迟来执行）：守夜的本义是围火而坐——
          上庭：灵魂与火居中，起居/心火分列两翼；下庭：对话在火光下方流淌。
          旧双栏（聊天霸屏+她蜷侧栏）自 v1 起违宪，本版纠正。
          启幕：各庭错峰 40ms 淡入——一次，之后全部静止（法则四）。 */}
      <motion.main
        id="main-content"
        variants={staggerList}
        initial="hidden"
        animate="show"
        onMouseMove={onPointer}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden"
      >
        {/* 上庭 */}
        <div
          className={`grid shrink-0 grid-cols-1 lg:min-h-0 lg:flex-[1.2] ${
            lifeExpanded
              ? "lg:grid-cols-[minmax(300px,1.7fr)_minmax(0,2fr)_minmax(230px,1fr)]"
              : "lg:grid-cols-[minmax(210px,1fr)_minmax(0,2.3fr)_minmax(230px,1fr)]"
          }`}
        >
          {/* 左翼 · 卷三 起居 */}
          <motion.section variants={enter} className="hidden min-h-0 flex-col px-6 pt-4 lg:flex">
            <div className="relative shrink-0">
              <span aria-hidden className="astr-ghost-num astr-ghost-num--sm">三</span>
              <div className="astr-label relative pb-3">卷三 · 起居 — LIFE</div>
            </div>
            <div className="min-h-0 flex-1 pb-3">
              <LifeArea
                events={events}
                activity={status?.activity}
                soulName={soulName}
                expanded={lifeExpanded}
                onToggle={() => setLifeExpanded((v) => !v)}
              />
            </div>
          </motion.section>

          {/* 中央 · 灵魂（不入卷——卷是记录，TA 是记录存在的原因）。指针驱动的立体龛 */}
          <motion.section
            variants={enter}
            style={{ rotateX: tiltXs, rotateY: tiltYs, transformPerspective: 1400 }}
            className="relative flex h-[36vh] min-h-[260px] flex-col will-change-transform lg:h-auto lg:min-h-0 lg:border-x lg:border-hairline"
          >
            <div className="relative min-h-0 w-full flex-1">
              <Live2DStage
                emotionLabel={emotionLabel}
                expressionIndex={expressionIndex}
                speakSignal={speak.sig}
                speakMs={speak.ms}
              />
            </div>
            {/* 炉火：守夜的火堆，燃在 TA 脚下 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center"
            >
              <FlameCore size={30} />
            </div>
          </motion.section>

          {/* 右翼 · 卷二 心火 + 竖排铭牌 */}
          <motion.section
            variants={enter}
            className="relative hidden min-h-0 flex-col px-6 pt-4 lg:flex"
          >
            <span
              aria-hidden
              className="astr-label absolute right-2 top-5"
              style={{ writingMode: "vertical-rl", letterSpacing: "0.4em" }}
            >
              守夜手记
            </span>
            <div className="relative shrink-0">
              <span aria-hidden className="astr-ghost-num astr-ghost-num--sm">二</span>
              <div className="astr-label relative pb-3">卷二 · 心火 — EMOTION</div>
            </div>
            <EmotionGauge emotion={status?.emotion ?? null} />
          </motion.section>
        </div>

        {/* 移动端心火（两翼在窄屏折叠，心火保留在火堆下方） */}
        <motion.div variants={enter} className="border-t border-hairline px-6 py-3 lg:hidden">
          <EmotionGauge emotion={status?.emotion ?? null} />
        </motion.div>

        {/* 下庭 · 卷一 对话：火光下的谈话 */}
        <motion.section
          variants={enter}
          className="flex min-h-[40vh] flex-1 flex-col border-t border-hairline lg:min-h-0"
        >
          <div className="mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col px-8">
            <div className="relative shrink-0 pb-3 pt-4">
              <span aria-hidden className="astr-ghost-num astr-ghost-num--sm">一</span>
              <div className="astr-label relative">卷一 · 对话 — DIALOGUE</div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto pr-2"
              style={{
                maskImage:
                  "linear-gradient(to bottom, transparent, black 28px, black calc(100% - 28px), transparent)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent, black 28px, black calc(100% - 28px), transparent)",
              }}
            >
              <MessageTimeline messages={messages} soulName={soulName} />
            </div>

          {/* 输入：一条刻线上的仪器行，不是大盒子。聚焦=琥珀刻线通电 */}
          <footer className="astr-composer flex shrink-0 items-center gap-3 border-t border-hairline py-5">
            <span aria-hidden className="font-mono text-sm text-ink-3">
              ❯
            </span>
            <input
              aria-label="消息输入"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // IME 判例（04 §8）：中文组合期的 Enter 是选字不是发送
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
              placeholder={
                recording
                  ? "录音中…再点一下麦克风停止"
                  : transcribing
                    ? "转写中…"
                    : connected
                      ? `和 ${soulName} 说点什么…`
                      : "Core 离线 —— 消息只在本地显示"
              }
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
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
              {...tapFeedback}
              className="relative grid h-8 w-8 place-items-center rounded-md bg-accent text-on-accent"
            >
              {pingSig > 0 && (
                <motion.span
                  key={pingSig}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md border border-accent"
                  initial={{ opacity: 0.7, scale: 1 }}
                  animate={{ opacity: 0, scale: 2 }}
                  transition={{ duration: 0.32, ease: easeOut }}
                />
              )}
              <Send size={15} />
            </motion.button>
          </footer>
          </div>
        </motion.section>
      </motion.main>
    </div>
  );
}
