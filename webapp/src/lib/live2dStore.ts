"use client";

import { create } from "zustand";

/** Camera transform for the Live2D shell, expressed in model scale and viewport ratios. */
export interface L2DTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const L2D_DEFAULT: L2DTransform = Object.freeze({
  scale: 0.26,
  x: 0.03,
  y: 0.95,
});

export const LIVE2D_TRANSFORM_LIMITS = Object.freeze({
  scale: Object.freeze({ min: 0.03, max: 0.4 }),
  x: Object.freeze({ min: -0.5, max: 0.5 }),
  y: Object.freeze({ min: -1.5, max: 1.5 }),
});

export const LIVE2D_STORAGE_KEY = "astr.live2d.v2";

interface StorageReader {
  readonly getItem: (key: string) => string | null;
}

interface StorageWriter {
  readonly setItem: (key: string, value: string) => void;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLive2DTransform(value: unknown): L2DTransform {
  const candidate = isRecord(value) ? value : {};
  return Object.freeze({
    scale: clamp(
      finiteOrDefault(candidate.scale, L2D_DEFAULT.scale),
      LIVE2D_TRANSFORM_LIMITS.scale.min,
      LIVE2D_TRANSFORM_LIMITS.scale.max,
    ),
    x: clamp(
      finiteOrDefault(candidate.x, L2D_DEFAULT.x),
      LIVE2D_TRANSFORM_LIMITS.x.min,
      LIVE2D_TRANSFORM_LIMITS.x.max,
    ),
    y: clamp(
      finiteOrDefault(candidate.y, L2D_DEFAULT.y),
      LIVE2D_TRANSFORM_LIMITS.y.min,
      LIVE2D_TRANSFORM_LIMITS.y.max,
    ),
  });
}

export function loadLive2DTransform(
  storage: StorageReader | null = browserStorage(),
): L2DTransform {
  if (storage === null) return L2D_DEFAULT;
  try {
    const raw = storage.getItem(LIVE2D_STORAGE_KEY);
    return raw === null ? L2D_DEFAULT : normalizeLive2DTransform(JSON.parse(raw));
  } catch {
    return L2D_DEFAULT;
  }
}

export function persistLive2DTransform(
  value: unknown,
  storage: StorageWriter | null = browserStorage(),
): L2DTransform {
  const transform = normalizeLive2DTransform(value);
  if (storage !== null) {
    try {
      storage.setItem(LIVE2D_STORAGE_KEY, JSON.stringify(transform));
    } catch {
      // Privacy modes and quota errors do not make the visual shell unavailable.
    }
  }
  return transform;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface L2DStore extends L2DTransform {
  readonly set: (patch: Partial<L2DTransform>) => void;
  readonly reset: () => void;
}

export const useLive2D = create<L2DStore>((set, get) => ({
  ...loadLive2DTransform(),
  set: (patch) => {
    const current = get();
    const transform = persistLive2DTransform({
      scale: patch.scale ?? current.scale,
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
    });
    set(transform);
  },
  reset: () => {
    const transform = persistLive2DTransform(L2D_DEFAULT);
    set(transform);
  },
}));

export const live2DTransformSource = Object.freeze({
  getSnapshot: (): L2DTransform => {
    const { scale, x, y } = useLive2D.getState();
    return Object.freeze({ scale, x, y });
  },
  subscribe: (listener: () => void): (() => void) => useLive2D.subscribe(listener),
});
