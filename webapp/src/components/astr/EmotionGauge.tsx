"use client";

import { motion } from "framer-motion";
import type { SoulEmotion } from "@/lib/types";

type NumDim = "loneliness" | "talkativeness" | "irritation" | "excitement";

const DIMS: { key: NumDim; label: string }[] = [
  { key: "loneliness", label: "孤独" },
  { key: "talkativeness", label: "倾诉欲" },
  { key: "irritation", label: "烦躁" },
  { key: "excitement", label: "兴奋" },
];

/** 情绪计（04 §5）：会呼吸的有机可视化（非进度条）。中心点用情绪光、缓慢呼吸；四维细条辅读。 */
export function EmotionGauge({ emotion }: { emotion: SoulEmotion | null }) {
  return (
    <div className="flex items-center gap-4">
      <motion.div
        className="h-12 w-12 shrink-0 rounded-full"
        style={{
          background: "var(--astr-emotion-glow)",
          boxShadow: "var(--glow-her)",
          transition: "background var(--dur-slow) var(--ease-inout)",
        }}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex-1 space-y-1.5">
        {DIMS.map(({ key, label }) => {
          const v = Math.max(0, Math.min(1, emotion?.[key] ?? 0));
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-12 text-xs text-ink-3">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${v * 100}%`, transition: "width var(--dur-slow) var(--ease-out)" }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
