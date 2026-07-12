"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useSemanticStore } from "@/lib/semantic-store";

const VISUAL_MOTION_STORAGE_KEY = "astr.visual-motion";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface RouteSlotRegistration {
  readonly host: HTMLElement;
  readonly owner: symbol;
}

type RegisterRouteSlot = (host: HTMLElement) => () => void;

const VisualMotionRouteSlotContext = createContext<RegisterRouteSlot | null>(null);

function systemPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

export function VisualMotionControlProvider({ children }: { children: ReactNode }): ReactNode {
  const motion = useSemanticStore((state) => state.motion);
  const dispatch = useSemanticStore((state) => state.dispatch);
  const [routeSlot, setRouteSlot] = useState<RouteSlotRegistration | null>(null);
  const userSelectedMotion = useRef(false);
  const paused = motion === "paused";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (userSelectedMotion.current) return;

      let persistedMotion: string | null = null;
      try {
        persistedMotion = window.localStorage.getItem(VISUAL_MOTION_STORAGE_KEY);
      } catch {
        // Storage is best-effort; full motion remains the safe session fallback.
      }
      dispatch({
        type:
          persistedMotion === "paused"
            ? "VISUAL_PAUSE"
            : systemPrefersReducedMotion()
              ? "REDUCE_ON"
              : "VISUAL_RESUME",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [dispatch]);

  useEffect(() => {
    document.documentElement.dataset.visualMotion = motion;
  }, [motion]);

  const registerRouteSlot = useCallback<RegisterRouteSlot>((host) => {
    const registration: RouteSlotRegistration = {
      host,
      owner: Symbol("visual-motion-route-slot"),
    };
    setRouteSlot(registration);

    return () => {
      setRouteSlot((current) => (current?.owner === registration.owner ? null : current));
    };
  }, []);

  const toggleMotion = () => {
    const nextMotion = paused ? "full" : "paused";
    userSelectedMotion.current = true;
    try {
      window.localStorage.setItem(VISUAL_MOTION_STORAGE_KEY, nextMotion);
    } catch {
      // The control must still work for this session when persistence is unavailable.
    }
    dispatch({
      type: paused
        ? systemPrefersReducedMotion()
          ? "REDUCE_ON"
          : "VISUAL_RESUME"
        : "VISUAL_PAUSE",
    });
  };

  const control = (
    <button
      type="button"
      className="astr-motion-toggle"
      onClick={toggleMotion}
      style={{
        minWidth: "var(--touch-target)",
        minHeight: "var(--touch-target)",
      }}
    >
      {paused ? "恢复视觉动效" : "暂停视觉动效"}
    </button>
  );

  return (
    <VisualMotionRouteSlotContext.Provider value={registerRouteSlot}>
      {children}
      {routeSlot ? createPortal(control, routeSlot.host) : control}
    </VisualMotionRouteSlotContext.Provider>
  );
}

export function VisualMotionRouteSlot({ className }: { className?: string }): ReactNode {
  const registerRouteSlot = useContext(VisualMotionRouteSlotContext);
  const hostRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !registerRouteSlot) return;
    return registerRouteSlot(host);
  }, [registerRouteSlot]);

  return <span ref={hostRef} className={className} data-visual-motion-route-slot="" />;
}
