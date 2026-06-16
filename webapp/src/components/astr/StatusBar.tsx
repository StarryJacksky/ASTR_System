"use client";

import { Activity } from "lucide-react";

/** 顶栏状态（04 §5）：躯壳版本 / 当日成本 / 心跳。数字用 mono。connected 决定心跳点颜色。 */
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
    <div className="flex items-center gap-4 text-xs text-ink-2">
      <span className="flex items-center gap-1.5">
        <Activity size={14} className={connected ? "text-success" : "text-ink-3"} />
        <span className="font-mono">{connected ? "在线" : "Core 离线"}</span>
      </span>
      <span className="text-ink-3">·</span>
      <span>
        躯壳 <span className="font-mono text-ink">{model}</span>
      </span>
      <span className="text-ink-3">·</span>
      <span>
        今日花费{" "}
        <span className="font-mono text-ink">
          ${costToday != null ? costToday.toFixed(3) : "—"}
        </span>
        {budget != null && <span className="text-ink-3"> / ${budget.toFixed(0)}</span>}
      </span>
      <span className="text-ink-3">·</span>
      <span className="font-mono text-ink-3">{soulName}</span>
    </div>
  );
}
