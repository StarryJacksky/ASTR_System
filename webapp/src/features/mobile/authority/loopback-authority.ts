export type MobileAuthorityPhase =
  | "checking"
  | "trusted-local"
  | "unavailable-remote-context";

export interface MobileServerAuthorityInput {
  readonly coreUrl?: string;
  readonly publicCoreUrl?: string;
}

const DEFAULT_CORE_URL = "http://127.0.0.1:8300";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isAllowedLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

export function isAllowedLoopbackHttpUrl(value: string): boolean {
  try {
    const target = new URL(value);
    return (
      (target.protocol === "http:" || target.protocol === "https:") &&
      target.username === "" &&
      target.password === "" &&
      isAllowedLoopbackHostname(target.hostname)
    );
  } catch {
    return false;
  }
}

export function assessMobileServerAuthority(input: MobileServerAuthorityInput): boolean {
  return (
    isAllowedLoopbackHttpUrl(input.coreUrl ?? DEFAULT_CORE_URL) &&
    isAllowedLoopbackHttpUrl(input.publicCoreUrl ?? DEFAULT_CORE_URL)
  );
}
