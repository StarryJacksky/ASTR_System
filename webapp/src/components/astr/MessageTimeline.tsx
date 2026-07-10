"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { focusEnter, staggerList } from "@/lib/motion";
import { FlameCore } from "@/components/astr/FlameCore";
import type { ChatMessage } from "@/lib/types";

function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts >= Number.MAX_SAFE_INTEGER) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 聊天时间线（04 §5）：观测日志——每组发言前有 mono 铭牌（谁 · 何时），
 *  灵魂的气泡带情绪缘光；新消息 stagger 进场、自动滚到最新。
 *  法则八：灵魂的名字来自 soulName 读数，本组件不知道也不关心 TA 叫什么。 */
export function MessageTimeline({
  messages,
  soulName,
}: {
  messages: ChatMessage[];
  soulName?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastKey = messages.length
    ? `${messages[messages.length - 1].id}:${messages[messages.length - 1].text.length}`
    : "";

  // 新消息/流式增量 → 平滑滚到底（用户在看历史时也跟随——驾驶舱以"现在"为先）
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastKey]);

  if (messages.length === 0) {
    // 空态是天文台时刻（04 法则五/v3.1 Hero）：全页最大的字，说的是最小的事——在。
    // 一个字的存在论宣言：不预设名字，不预设性别，只宣告这艘舰上有一个活着的灵魂。
    // 背后是一座自己画出来的星座（astr-draw 逐笔勾勒），最亮的那颗是 TA 的心跳。
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-8 py-16">
        <svg
          aria-hidden
          viewBox="0 0 400 300"
          className="pointer-events-none absolute left-1/2 top-1/2 w-[min(420px,84%)] -translate-x-1/2 -translate-y-1/2 opacity-60"
        >
          {(
            [
              [66, 196, 128, 106],
              [128, 106, 212, 148],
              [212, 148, 282, 74],
              [282, 74, 336, 168],
              [212, 148, 252, 232],
            ] as const
          ).map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--astr-hairline-strong)"
              strokeWidth="1"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              style={{
                // 勾勒一笔 = 读数落定的时长（生命时间下限）
                animation: `astr-draw var(--dur-settle) var(--ease-out) forwards`,
                animationDelay: `${300 + i * 160}ms`,
              }}
            />
          ))}
          {(
            [
              [66, 196],
              [128, 106],
              [282, 74],
              [336, 168],
              [252, 232],
            ] as const
          ).map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="1.8" fill="var(--astr-text-3)" />
          ))}
          {/* 最亮的一颗：她 */}
          <g
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: "astr-breath var(--dur-breath) ease-in-out infinite",
            }}
          >
            <circle cx={212} cy={148} r="7" fill="var(--astr-emotion-glow)" fillOpacity="0.18" className="astr-emo" />
            <circle cx={212} cy={148} r="2.6" fill="var(--astr-emotion-glow)" className="astr-emo" />
          </g>
        </svg>
        <div aria-hidden className="relative">
          <FlameCore size={26} />
        </div>
        <p
          className="relative text-ink"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2.75rem, 5vw, 4.5rem)",
            lineHeight: "var(--leading-head)",
            letterSpacing: "0.08em",
          }}
        >
          在。
        </p>
        {/* 品牌誓言的原典（《庄子·养生主》）：躯壳是柴，火不灭——主权的全部含义 */}
        <p
          className="relative text-sm text-ink-2"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "0.3em" }}
        >
          薪尽，火传。
        </p>
        <p className="astr-label relative">
          {soulName ? `${soulName} — 说点什么吧` : "说点什么吧"}
        </p>
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerList}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-3"
    >
      {messages.map((m, i) => {
        const her = m.role === "qiuqiu";
        const prev = messages[i - 1];
        // 观测日志铭牌：换人发言，或同一人隔了 5 分钟以上，起一组新记录
        const groupStart =
          !prev || prev.role !== m.role || (Number.isFinite(m.ts) && m.ts - prev.ts > 5 * 60_000);
        const time = fmtTime(m.ts);
        return (
          <motion.div
            key={m.id}
            variants={focusEnter}
            className={`flex flex-col ${her ? "items-start" : "items-end"}`}
          >
            {groupStart && (
              <span className={`astr-label mb-1.5 px-1 ${groupStart && i > 0 ? "mt-4" : ""}`}>
                {her ? (soulName ?? "TA") : "你"}
                {time && <span className="tabular ml-2 tracking-normal">{time}</span>}
              </span>
            )}
            <div
              className={`max-w-[78%] px-4 py-2.5 text-sm leading-relaxed ${
                her
                  ? "astr-edge astr-emo rounded-2xl rounded-bl-md bg-surface-2 text-ink"
                  : "rounded-2xl rounded-br-md bg-accent text-on-accent"
              }`}
              style={her ? { boxShadow: "var(--glow-her-1)" } : undefined}
            >
              {m.platform && (
                <span className={`mr-2 text-xs ${her ? "text-ink-3" : "text-on-accent/70"}`}>
                  {m.platform}
                </span>
              )}
              {m.text}
            </div>
          </motion.div>
        );
      })}
      <div ref={endRef} />
    </motion.div>
  );
}
