"use client";

import { motion } from "framer-motion";
import { enter, staggerList } from "@/lib/motion";
import type { ChatMessage } from "@/lib/types";

/** 聊天时间线（04 §5）：多平台合一；她的气泡有 --glow-her。新消息 stagger 进场。 */
export function MessageTimeline({ messages }: { messages: ChatMessage[] }) {
  return (
    <motion.div
      variants={staggerList}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-3"
    >
      {messages.length === 0 && (
        <p className="text-sm text-ink-3">（还没有消息。和秋秋说点什么吧。）</p>
      )}
      {messages.map((m) => {
        const her = m.role === "qiuqiu";
        return (
          <motion.div
            key={m.id}
            variants={enter}
            className={`flex ${her ? "justify-start" : "justify-end"}`}
          >
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                her ? "bg-surface-2 text-ink" : "bg-accent text-ink"
              }`}
              style={her ? { boxShadow: "var(--glow-her)" } : undefined}
            >
              {m.platform && (
                <span className="mr-2 text-xs text-ink-3">{m.platform}</span>
              )}
              {m.text}
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
