"use client";

import { useEffect, type RefObject } from "react";

import {
  presenceVisibilityCoordinator,
  type PresenceVisibilityCoordinator,
} from "./visibility-coordinator";

export const PRESENCE_VISIBILITY_THRESHOLD = 0.15;

export interface PresenceVisibilityBridgeProps {
  readonly coordinator?: PresenceVisibilityCoordinator;
  readonly targetRef: RefObject<Element | null>;
}

export function PresenceVisibilityBridge({
  coordinator = presenceVisibilityCoordinator,
  targetRef,
}: PresenceVisibilityBridgeProps) {
  useEffect(() => {
    let active = true;
    const target = targetRef.current;

    coordinator.setViewportOnscreen(false);

    if (!target || typeof IntersectionObserver === "undefined") {
      return () => {
        active = false;
        coordinator.setViewportOnscreen(false);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return;
        const entry = entries.find((candidate) => candidate.target === target);
        if (!entry) return;
        coordinator.setViewportOnscreen(
          entry.isIntersecting && entry.intersectionRatio >= PRESENCE_VISIBILITY_THRESHOLD,
        );
      },
      { threshold: PRESENCE_VISIBILITY_THRESHOLD },
    );

    observer.observe(target);

    return () => {
      active = false;
      observer.disconnect();
      coordinator.setViewportOnscreen(false);
    };
  }, [coordinator, targetRef]);

  return null;
}
