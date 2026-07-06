"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { enter, staggerList } from "@/lib/motion";
import type { ChatMessage } from "@/lib/types";

function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts >= Number.MAX_SAFE_INTEGER) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 聊天时间线（04 §5）：她的气泡带情绪缘光与发丝渐变边，用户气泡走强调色渐变；
 *  新消息 stagger 进场、自动滚到最新；时间戳悬停浮现（不打扰阅读）。 */
export function MessageTimeline({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastKey = messages.length
    ? `${messages[messages.length - 1].id}:${messages[messages.length - 1].text.length}`
    : "";

  // 新消息/流式增量 → 平滑滚到底（用户在看历史时也跟随——驾驶舱以"现在"为先）
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastKey]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 py-16">
        <motion.div
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{
            background: "var(--astr-emotion-glow)",
            boxShadow: "0 0 18px 2px color-mix(in srgb, var(--astr-emotion-glow) 60%, transparent)",
            transition: "background 2400ms var(--ease-inout), box-shadow 2400ms var(--ease-inout)",
          }}
          animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <p
          className="text-2xl text-ink"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}
        >
          她在。
        </p>
        <p className="astr-label">说点什么吧</p>
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
      {messages.map((m) => {
        const her = m.role === "qiuqiu";
        const time = fmtTime(m.ts);
        return (
          <motion.div
            key={m.id}
            variants={enter}
            className={`group flex flex-col ${her ? "items-start" : "items-end"}`}
          >
            <div
              className={`max-w-[78%] px-4 py-2.5 text-sm leading-relaxed ${
                her
                  ? "astr-edge rounded-2xl rounded-bl-md bg-surface-2 text-ink"
                  : "rounded-2xl rounded-br-md text-on-accent"
              }`}
              style={
                her
                  ? {
                      boxShadow: "0 0 24px -14px var(--astr-emotion-glow)",
                      transition: "box-shadow 2400ms var(--ease-inout)",
                    }
                  : { background: "var(--astr-accent)" }
              }
            >
              {m.platform && (
                <span className={`mr-2 text-xs ${her ? "text-ink-3" : "text-on-accent/70"}`}>
                  {m.platform}
                </span>
              )}
              {m.text}
            </div>
            {time && (
              <span className="tabular mt-1 px-1 font-mono text-[10px] text-ink-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                {time}
              </span>
            )}
          </motion.div>
        );
      })}
      <div ref={endRef} />
    </motion.div>
  );
}
