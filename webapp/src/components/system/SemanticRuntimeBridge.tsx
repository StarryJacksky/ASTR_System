"use client";

import { useEffect } from "react";

import { semanticStore } from "@/lib/semantic-store";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function SemanticRuntimeBridge() {
  useEffect(() => {
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);

    const synchronizeVisibility = () => {
      semanticStore.getState().dispatch({
        type: document.visibilityState === "hidden" ? "DOCUMENT_HIDDEN" : "DOCUMENT_VISIBLE",
      });
    };

    const synchronizeMotion = () => {
      if (semanticStore.getState().motion === "paused") return;

      semanticStore.getState().dispatch({
        type: reducedMotion.matches ? "REDUCE_ON" : "REDUCE_OFF",
      });
    };

    const reconcileMotion = () => {
      const motion = semanticStore.getState().motion;
      if (motion === "paused") return;

      const truthIsApplied = reducedMotion.matches ? motion === "reduced" : motion === "full";
      if (!truthIsApplied) synchronizeMotion();
    };

    document.addEventListener("visibilitychange", synchronizeVisibility);
    reducedMotion.addEventListener("change", synchronizeMotion);
    const unsubscribe = semanticStore.subscribe((state, previousState) => {
      if (state.motion !== previousState.motion && state.motion !== "paused") {
        reconcileMotion();
      }
    });

    synchronizeVisibility();
    synchronizeMotion();

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", synchronizeVisibility);
      reducedMotion.removeEventListener("change", synchronizeMotion);
    };
  }, []);

  return null;
}
