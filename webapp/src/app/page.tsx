"use client";

import { useEffect, useMemo, useState } from "react";
import { Mic, Send } from "lucide-react";
import { Panel } from "@/components/astr/Panel";
import { Live2DStage } from "@/components/astr/Live2DStage";
import { ThoughtStream } from "@/components/astr/ThoughtStream";
import { MessageTimeline } from "@/components/astr/MessageTimeline";
import { RoundtableFeed } from "@/components/astr/RoundtableFeed";
import { EmotionGauge } from "@/components/astr/EmotionGauge";
import { VoiceVisualizer } from "@/components/astr/VoiceVisualizer";
import { StatusBar } from "@/components/astr/StatusBar";
import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { useEventStream, useStatus } from "@/lib/useCore";
import { applyEmotionGlow } from "@/lib/emotion";
import { soulToGlow, type ChatMessage } from "@/lib/types";

const EMO_LABEL: Record<string, string> = {
  lonely: "孤独",
  excited: "兴奋",
  tsundere: "傲娇",
  calm: "平静",
};

export default function Cockpit() {
  const { status, connected } = useStatus();
  const { events } = useEventStream(["agent.thought", "soul.decision"]);
  const [userMsgs, setUserMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");

  // 情绪 → 环境光（04 §3.2）：她的真实情绪向量驱动整页背光，缓慢变化。
  const glow = soulToGlow(status?.emotion);
  useEffect(() => {
    applyEmotionGlow(glow);
  }, [glow]);

  const emotionLabel = useMemo(() => {
    const entries = Object.entries(glow) as [keyof typeof glow, number][];
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return top ? EMO_LABEL[top[0]] : undefined;
  }, [glow]);

  // 她的回复来自 SSE 的 soul.decision；用户消息本地乐观追加，按时间合并。
  const messages = useMemo<ChatMessage[]>(() => {
    const her: ChatMessage[] = events
      .filter((e) => e.type === "soul.decision" && e.payload.reply_text)
      .map((e) => ({
        id: e.id,
        role: "qiuqiu" as const,
        text: String(e.payload.reply_text ?? ""),
        ts: new Date(e.ts).getTime(),
      }));
    return [...userMsgs, ...her].sort((a, b) => a.ts - b.ts);
  }, [events, userMsgs]);

  const send = async () => {
    const text = draft.trim();
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

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      {/* 顶栏 */}
      <header className="flex items-center justify-between rounded-2xl border border-hairline bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--astr-emotion-glow)", boxShadow: "var(--glow-her)" }}
          />
          <span className="text-sm font-semibold text-ink">秋秋 · ASTR 驾驶舱</span>
        </div>
        <StatusBar
          soulName={status?.soul_name ?? "justin"}
          model={status?.local_llm_model ?? "—"}
          costToday={status?.cost_today_usd ?? null}
          budget={status?.daily_budget_usd ?? null}
          connected={connected}
        />
        <ThemeToggle />
      </header>

      {/* 主区：左聊天，右栏 Live2D / 当前任务·思考 / 圆桌 */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_380px]">
        <Panel title="对话" className="min-h-0">
          <MessageTimeline messages={messages} />
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel glow className="shrink-0">
            <Live2DStage emotionLabel={emotionLabel} />
            <div className="mt-3">
              <EmotionGauge emotion={status?.emotion ?? null} />
            </div>
          </Panel>
          <Panel title="当前任务 · 思考流" className="min-h-0 flex-1">
            <ThoughtStream events={events} />
          </Panel>
          <Panel title="智囊团圆桌" className="hidden min-h-0 flex-1 lg:flex">
            <RoundtableFeed turns={[]} />
          </Panel>
        </div>
      </main>

      {/* 底栏：输入 + 麦克风 + 声波 */}
      <footer className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-3 py-2.5">
        <VoiceVisualizer />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={connected ? "和秋秋说点什么…" : "Core 离线 —— 消息只在本地显示"}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label="语音"
          className="grid h-9 w-9 place-items-center rounded-xl border border-hairline text-ink-2 transition-colors hover:bg-surface-2"
        >
          <Mic size={16} />
        </button>
        <button
          type="button"
          aria-label="发送"
          onClick={send}
          className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-ink transition-transform hover:scale-[1.03]"
        >
          <Send size={16} />
        </button>
      </footer>
    </div>
  );
}
