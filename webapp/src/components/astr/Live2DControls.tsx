"use client";

import { useState } from "react";
import { RotateCcw, Copy, Check } from "lucide-react";
import {
  LIVE2D_TRANSFORM_LIMITS,
  useLive2D,
} from "@/lib/live2dStore";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono text-ink-3">{value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--astr-accent)]"
      />
    </label>
  );
}

/** 看板娘取景调整（实时）。拖动即生效并存 localStorage；「复制数值」把当前参数给开发者设为默认。 */
export function Live2DControls() {
  const { scale, x, y, set, reset } = useLive2D();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ scale, x, y }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用忽略 */
    }
  };

  return (
    <div className="space-y-3">
      <Slider
        label="大小"
        value={scale}
        min={LIVE2D_TRANSFORM_LIMITS.scale.min}
        max={LIVE2D_TRANSFORM_LIMITS.scale.max}
        step={0.005}
        onChange={(value) => set({ scale: value })}
      />
      <Slider
        label="左右"
        value={x}
        min={LIVE2D_TRANSFORM_LIMITS.x.min}
        max={LIVE2D_TRANSFORM_LIMITS.x.max}
        step={0.01}
        onChange={(value) => set({ x: value })}
      />
      <Slider
        label="上下"
        value={y}
        min={LIVE2D_TRANSFORM_LIMITS.y.min}
        max={LIVE2D_TRANSFORM_LIMITS.y.max}
        step={0.02}
        onChange={(value) => set({ y: value })}
      />
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-ink"
        >
          <RotateCcw size={13} /> 复位
        </button>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-surface-2"
        >
          {copied ? <Check size={13} className="text-[var(--astr-accent)]" /> : <Copy size={13} />}
          {copied ? "已复制" : "复制数值"}
        </button>
      </div>
    </div>
  );
}
