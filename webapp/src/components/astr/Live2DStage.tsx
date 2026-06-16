"use client";

import { motion } from "framer-motion";

/** Live2D 舞台（04 §5）。P1-W10 基线：呼吸的"她"占位 + 情绪背光；真模型(pixi-live2d-display)在 W10-d 接。
 *  props 预留 modelPath/gazeTarget/mouthOpen，骨架先只用 emotion 背光。 */
export function Live2DStage({ emotionLabel }: { emotionLabel?: string }) {
  return (
    <div className="relative flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-2xl">
      {/* 情绪背光：缓慢呼吸的 radial-gradient（颜色来自 --astr-emotion-glow，由 emotion.ts 写入）*/}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, var(--astr-emotion-glow), transparent 68%)",
          opacity: 0.2,
          transition: "background var(--dur-slow) var(--ease-inout)",
        }}
      />
      <motion.div
        className="relative flex h-40 w-40 items-center justify-center rounded-full border border-hairline bg-surface-2 text-center text-ink-3"
        animate={{ scale: [1, 1.02, 1], opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ boxShadow: "var(--glow-her)" }}
      >
        <span className="px-3 text-xs leading-relaxed">
          Live2D · 秋秋
          {emotionLabel ? (
            <>
              <br />
              {emotionLabel}
            </>
          ) : null}
        </span>
      </motion.div>
    </div>
  );
}
