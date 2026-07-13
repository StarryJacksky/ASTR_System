"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  isAllowedLoopbackHostname,
  type MobileAuthorityPhase,
} from "./loopback-authority";

const MobileAuthorityContext = createContext<MobileAuthorityPhase | null>(null);

export function MobileAuthorityProvider({
  serverAuthorityTrusted,
  children,
}: {
  readonly serverAuthorityTrusted: boolean;
  readonly children: ReactNode;
}) {
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener("pageshow", listener);
    return () => window.removeEventListener("pageshow", listener);
  }, []);
  const phase = useSyncExternalStore(
    subscribe,
    () =>
      serverAuthorityTrusted && isAllowedLoopbackHostname(window.location.hostname)
        ? "trusted-local"
        : "unavailable-remote-context",
    () => (serverAuthorityTrusted ? "checking" : "unavailable-remote-context"),
  );

  return (
    <MobileAuthorityContext.Provider value={phase}>
      {children}
    </MobileAuthorityContext.Provider>
  );
}

export function useMobileAuthority(): MobileAuthorityPhase {
  const phase = useContext(MobileAuthorityContext);
  if (phase === null) throw new Error("MobileAuthorityProvider is required");
  return phase;
}
