"use client";

import { motion } from "framer-motion";

/** 声波可视化（04 §5）：随 TTS 播放的音量包络律动。
 *  无信号时不渲染（04 法则四：仪器不动）——只有她开口，这台仪器才通电。 */
export function VoiceVisualizer({ envelope }: { envelope?: number[] }) {
  if (!envelope || envelope.length === 0) return null;
  return (
    <div className="flex h-8 items-center gap-1">
      {envelope.map((v, i) => (
        <motion.span
          key={i}
          className="w-1 rounded-full bg-accent-2"
          animate={{ height: `${Math.max(8, Math.min(100, v * 100))}%`, opacity: 0.5 + v * 0.5 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{ height: "12%" }}
        />
      ))}
    </div>
  );
}
