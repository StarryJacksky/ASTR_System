"use client";

import { motion } from "framer-motion";

/** 顶栏状态（04 §5）：心跳呼吸点 / 躯壳 / 当日成本。数字 mono + 等宽。 */
export function StatusBar({
  soulName,
  model,
  costToday,
  budget,
  connected,
}: {
  soulName: string;
  model: string;
  costToday: number | null;
  budget: number | null;
  connected: boolean;
}) {
  return (
    <div className="hidden items-center gap-4 text-xs text-ink-2 md:flex">
      <span className="flex items-center gap-2">
        <span className="relative grid h-3 w-3 place-items-center">
          {connected && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full bg-success"
              animate={{ scale: [1, 2.1], opacity: [0.45, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-success" : "bg-ink-3"}`}
          />
        </span>
        <span className="font-mono">{connected ? "在线" : "Core 离线"}</span>
      </span>
      <span className="text-ink-3">·</span>
      <span>
        躯壳 <span className="font-mono text-ink">{model}</span>
      </span>
      <span className="text-ink-3">·</span>
      <span>
        今日{" "}
        <span className="tabular font-mono text-ink">
          ${costToday != null ? costToday.toFixed(3) : "—"}
        </span>
        {budget != null && (
          <span className="tabular text-ink-3"> / ${budget.toFixed(0)}</span>
        )}
      </span>
      <span className="text-ink-3">·</span>
      <span className="font-mono text-ink-3">{soulName}</span>
    </div>
  );
}
