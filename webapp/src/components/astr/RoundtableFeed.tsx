"use client";

import { motion } from "framer-motion";
import { enter, staggerList } from "@/lib/motion";
import type { RoundtableTurn } from "@/lib/types";

/** 智囊团圆桌（04 §5）：各席位发言；主持人(秋秋)有视觉权重。P3 接真数据，骨架先占位。 */
export function RoundtableFeed({ turns }: { turns: RoundtableTurn[] }) {
  return (
    <motion.ul variants={staggerList} initial="hidden" animate="show" className="space-y-2">
      {turns.length === 0 && (
        <li className="text-sm text-ink-3">（圆桌未开。P3 学术引擎接入后，这里是各 Agent 的发言流。）</li>
      )}
      {turns.map((t, i) => (
        <motion.li
          key={i}
          variants={enter}
          className={`rounded-xl px-3 py-2 text-sm ${
            t.isHost ? "bg-surface-2 text-ink" : "text-ink-2"
          }`}
          style={t.isHost ? { boxShadow: "var(--glow-her)" } : undefined}
        >
          <span className="mr-2 font-medium text-accent">{t.seat}</span>
          {t.content}
        </motion.li>
      ))}
    </motion.ul>
  );
}
