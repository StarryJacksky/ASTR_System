"use client";

import { motion } from "framer-motion";

/** 声波可视化（04 §5）：随 TTS 播放的音量包络律动。无包络时 idle 轻微呼吸。 */
export function VoiceVisualizer({ envelope }: { envelope?: number[] }) {
  const bars = envelope && envelope.length > 0 ? envelope : Array.from({ length: 16 }, () => 0.12);
  return (
    <div className="flex h-8 items-center gap-1">
      {bars.map((v, i) => (
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
