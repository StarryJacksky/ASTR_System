"use client";

import { AnimatePresence, motion } from "framer-motion";
import { enter, staggerList } from "@/lib/motion";
import type { AstrEvent } from "@/lib/types";

/** 思考流（04 §5）：agent.thought 片段逐条淡入上移（"脑电波"）。 */
export function ThoughtStream({ events }: { events: AstrEvent[] }) {
  const thoughts = events.filter((e) => e.type === "agent.thought");
  return (
    <motion.ul variants={staggerList} initial="hidden" animate="show" className="space-y-2">
      {thoughts.length === 0 && (
        <li className="text-sm text-ink-3">（她还没开始想……连上 Core 后这里会浮现思考片段）</li>
      )}
      <AnimatePresence initial={false}>
        {thoughts.map((e) => (
          <motion.li
            key={e.id}
            variants={enter}
            initial="hidden"
            animate="show"
            className="border-l-2 border-hairline pl-3 text-sm leading-relaxed text-ink-2"
          >
            {String(e.payload.text ?? "")}
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}
