"use client";

import { create } from "zustand";

/** Live2D 看板娘的取景变换（居中锚点 + 缩放 + 偏移）。用户可在设置里实时拖动，存 localStorage。 */
export interface L2DTransform {
  scale: number; // 模型缩放（模型原生 2400×4500，常用 0.06~0.2）
  x: number; // 水平偏移，画布宽的比例（0=居中，正=右）
  y: number; // 垂直偏移，画布高的比例（0=居中，正=下）
}

// 默认值：延续 Jacksky 2026-06 的半身像取景意图，按 v2.2 新舞台几何（52vh/最宽 560px）
// 折算回帧内。取景权仍在设置面板——拖动即覆盖此默认。
export const L2D_DEFAULT: L2DTransform = { scale: 0.26, x: 0.03, y: 0.95 };

// v2（2026-07-07）：舞台几何变更，v1 存储的偏移会把她压出帧外，换键作废旧值。
const KEY = "astr.live2d.v2";

function loadInitial(): L2DTransform {
  if (typeof window === "undefined") return L2D_DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...L2D_DEFAULT, ...JSON.parse(raw) };
  } catch {
    /* 损坏的存储忽略 */
  }
  return L2D_DEFAULT;
}

function persist(t: L2DTransform): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* 隐私模式等写入失败忽略 */
  }
}

interface L2DStore extends L2DTransform {
  set: (patch: Partial<L2DTransform>) => void;
  reset: () => void;
}

export const useLive2D = create<L2DStore>((set, get) => ({
  ...loadInitial(),
  set: (patch) => {
    set(patch);
    const { scale, x, y } = get();
    persist({ scale, x, y });
  },
  reset: () => {
    set(L2D_DEFAULT);
    persist(L2D_DEFAULT);
  },
}));
