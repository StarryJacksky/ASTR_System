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

// 有机形变的两组 border-radius 关键帧（blob 呼吸，8s 循环——比进度条更像"活物"）
const BLOB_A = "58% 42% 52% 48% / 48% 56% 44% 52%";
const BLOB_B = "45% 55% 46% 54% / 56% 44% 58% 42%";

/** 情绪计（04 §5）：会呼吸的有机体——分层情绪光 + 缓慢形变；四维细条渐变辅读。 */
export function EmotionGauge({ emotion }: { emotion: SoulEmotion | null }) {
  return (
    <div className="flex items-center gap-4">
      <motion.div
        aria-hidden
        className="h-14 w-14 shrink-0"
        style={{
          background:
            "radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--astr-emotion-glow) 70%, var(--astr-text)), var(--astr-emotion-glow) 55%, color-mix(in srgb, var(--astr-emotion-glow) 55%, transparent) 100%)",
          boxShadow: "0 0 32px -8px var(--astr-emotion-glow)",
          transition:
            "background 2400ms var(--ease-inout), box-shadow 2400ms var(--ease-inout)",
        }}
        animate={{
          borderRadius: [BLOB_A, BLOB_B, BLOB_A],
          scale: [1, 1.05, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex-1 space-y-2">
        {DIMS.map(({ key, label }) => {
          const v = Math.max(0, Math.min(1, emotion?.[key] ?? 0));
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-12 text-xs text-ink-3">{label}</span>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${v * 100}%`,
                    background: "var(--astr-accent)",
                    transition: "width 1200ms var(--ease-out)",
                  }}
                />
              </div>
              <span className="tabular w-7 text-right font-mono text-[10px] text-ink-3">
                {(v * 100).toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
