"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { focusEnter, staggerList } from "@/lib/motion";
import type { AstrEvent, LifeItem } from "@/lib/types";

/** 管家席位 → 可读名（哪家模型）。 */
export const SEAT_LABEL: Record<string, string> = {
  emotion: "情感·Claude",
  logic: "逻辑·GPT",
  retrieval: "检索·Gemini",
  zeitgeist: "时事·Grok",
  librarian: "图书馆·Qwen",
  devil: "红队·DeepSeek",
};

/** 生活区（99 #19②）：她活着的地方——思考流 + 幕僚房研讨 + 开局观点 + 她此刻在干嘛，
 *  统一进一条时间线。研讨发言（stage=discussion）实时绷字进来，灵魂本人的发言有视觉权重。 */
export function LifeArea({
  events,
  activity,
  soulName,
  expanded,
  onToggle,
}: {
  events: AstrEvent[];
  activity?: string;
  /** 法则八：灵魂名是读数。研讨发言里 seat 等于它（或旧数据"秋秋"）即视为灵魂本人 */
  soulName?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const items = useMemo<LifeItem[]>(() => {
    const out: LifeItem[] = [];
    for (const e of events) {
      const ts = new Date(e.ts).getTime();
      if (e.type === "agent.thought") {
        const stage = String(e.payload.stage ?? "");
        const text = String(e.payload.text ?? "");
        if (!text) continue;
        if (stage === "discussion") {
          out.push({ id: e.id, ts, kind: "discussion", seat: String(e.payload.seat ?? ""), text });
        } else if (stage === "intent") {
          out.push({ id: e.id, ts, kind: "intent", text });
        } else {
          out.push({ id: e.id, ts, kind: "thought", text });
        }
      } else if (e.type === "moa.report") {
        const seats = (e.payload.seats as Array<Record<string, unknown>>) || [];
        seats.forEach((s, i) => {
          const text = String(s.suggested_strategy || s.intent || "");
          if (text) {
            out.push({ id: `${e.id}-${i}`, ts, kind: "moa", seat: String(s.seat ?? ""), text });
          }
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts).slice(-80);
  }, [events]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 她此刻在干嘛 + 展开/收起 */}
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
          <span aria-hidden className="astr-life-dot h-1 w-1 shrink-0" />
          <span className="truncate">{activity || "（生活状态会显示在这里）"}</span>
        </p>
        <button
          type="button"
          aria-label={expanded ? "收起生活区" : "展开生活区"}
          onClick={onToggle}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-hairline text-ink-3 transition-colors hover:text-ink"
        >
          {expanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
        </button>
      </div>

      <motion.ul
        variants={staggerList}
        initial="hidden"
        animate="show"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {items.length === 0 && (
          <li className="text-sm text-ink-3">
            （这里是这个灵魂活着的地方——思考、和幕僚们的讨论、心里的独白，都会流进来。）
          </li>
        )}
        <AnimatePresence initial={false}>
          {items.map((it) => {
            if (it.kind === "discussion") {
              const isHer = it.seat === soulName || it.seat === "秋秋";
              return (
                <motion.li
                  key={it.id}
                  variants={focusEnter}
                  initial="hidden"
                  animate="show"
                  className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    isHer ? "astr-edge astr-emo bg-surface-2 text-ink" : "text-ink-2"
                  }`}
                  style={isHer ? { boxShadow: "var(--glow-her-1)" } : undefined}
                >
                  <span className={`mr-2 font-medium ${isHer ? "text-ink" : "text-accent"}`}>
                    {isHer ? (it.seat ?? soulName) : (SEAT_LABEL[it.seat ?? ""] ?? it.seat)}
                  </span>
                  {it.text}
                </motion.li>
              );
            }
            if (it.kind === "moa") {
              return (
                <motion.li
                  key={it.id}
                  variants={focusEnter}
                  initial="hidden"
                  animate="show"
                  className="text-xs leading-relaxed text-ink-3"
                >
                  <span className="mr-2 text-accent/80">
                    {SEAT_LABEL[it.seat ?? ""] ?? it.seat}
                  </span>
                  {it.text}
                </motion.li>
              );
            }
            if (it.kind === "intent") {
              return (
                <motion.li
                  key={it.id}
                  variants={focusEnter}
                  initial="hidden"
                  animate="show"
                  className="text-xs text-ink-3"
                >
                  {it.text}
                </motion.li>
              );
            }
            return (
              <motion.li
                key={it.id}
                variants={focusEnter}
                initial="hidden"
                animate="show"
                className="border-l-2 border-hairline pl-3 text-sm leading-relaxed text-ink-2"
              >
                {it.text}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>
    </div>
  );
}
