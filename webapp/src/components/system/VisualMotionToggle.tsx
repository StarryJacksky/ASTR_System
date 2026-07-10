"use client";

import { useEffect, useRef } from "react";

import { useSemanticStore } from "@/lib/semantic-store";

const VISUAL_MOTION_STORAGE_KEY = "astr.visual-motion";

export function VisualMotionToggle() {
  const motion = useSemanticStore((state) => state.motion);
  const dispatch = useSemanticStore((state) => state.dispatch);
  const paused = motion === "paused";
  const userSelectedMotion = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (userSelectedMotion.current) return;

      let persistedMotion: string | null = null;
      try {
        persistedMotion = window.localStorage.getItem(VISUAL_MOTION_STORAGE_KEY);
      } catch {
        // Storage is best-effort; full motion remains the safe session fallback.
      }
      dispatch({ type: persistedMotion === "paused" ? "VISUAL_PAUSE" : "VISUAL_RESUME" });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [dispatch]);

  useEffect(() => {
    document.documentElement.dataset.visualMotion = motion;
  }, [motion]);

  const toggleMotion = () => {
    const nextMotion = paused ? "full" : "paused";
    userSelectedMotion.current = true;
    try {
      window.localStorage.setItem(VISUAL_MOTION_STORAGE_KEY, nextMotion);
    } catch {
      // The control must still work for this session when persistence is unavailable.
    }
    dispatch({ type: paused ? "VISUAL_RESUME" : "VISUAL_PAUSE" });
  };

  return (
    <button
      type="button"
      className="astr-motion-toggle"
      onClick={toggleMotion}
      style={{
        minWidth: "var(--touch-target)",
        minHeight: "var(--touch-target)",
      }}
    >
      {paused ? "恢复视觉动态" : "暂停视觉动态"}
    </button>
  );
}
