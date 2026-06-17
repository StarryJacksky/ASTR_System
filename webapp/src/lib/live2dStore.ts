"use client";

import { create } from "zustand";

/** Live2D 看板娘的取景变换（居中锚点 + 缩放 + 偏移）。用户可在设置里实时拖动，存 localStorage。 */
export interface L2DTransform {
  scale: number; // 模型缩放（模型原生 2400×4500，常用 0.06~0.2）
  x: number; // 水平偏移，画布宽的比例（0=居中，正=右）
  y: number; // 垂直偏移，画布高的比例（0=居中，正=下）
}

// 默认值：由 Jacksky 在设置面板拖好后回填（2026-06，Haru 模型半身像取景）。
export const L2D_DEFAULT: L2DTransform = { scale: 0.235, x: 0.03, y: 1.28 };

const KEY = "astr.live2d.v1";

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
