# ASTR Mobile Authority Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dual-evidence, fail-closed authority gate that prevents Mobile Presence and Safety clients from mounting outside a strict loopback browser/Core context.

**Architecture:** A pure TypeScript module validates the private and public Core targets without performing DNS resolution and returns only a boolean. A Client Component combines that server boolean with the hydrated browser hostname through `useSyncExternalStore`; trusted SSR stays in `checking`, while rejected server evidence is unavailable from the first render.

**Tech Stack:** TypeScript, React 19, Next.js Client Components, Vitest, Testing Library, React DOM SSR/hydration.

## Global Constraints

- Work only under `webapp/src/features/mobile/authority/`; do not modify backend, rewrites, Presence, Control, or environment values.
- Accept only credential-free `http:` or `https:` URLs whose hostname is exactly `localhost`, `127.0.0.1`, `[::1]`, or `::1`.
- Do not accept LAN, mDNS, custom/public domains, query/storage/cookie/header overrides, or the rest of `127/8`.
- `ASTR_CORE_URL` and `NEXT_PUBLIC_ASTR_CORE` must both pass; their default is `http://127.0.0.1:8300`.
- The client receives only `serverAuthorityTrusted: boolean`; no target URL is placed in context or rendered output.
- The provider performs no fetch, routing, Core client, query, cookie, header, or storage access.
- Commands run from `D:\ASTR_System\astr\webapp`; Git commands run from `D:\ASTR_System\astr`.

---

### Task 1: Implement the pure loopback authority evaluator

**Files:**

- Create: `webapp/src/features/mobile/authority/loopback-authority.test.ts`
- Create: `webapp/src/features/mobile/authority/loopback-authority.ts`

- [ ] **Step 1: Write the failing pure evaluator tests**

Create `webapp/src/features/mobile/authority/loopback-authority.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";

import {
  assessMobileServerAuthority,
  isAllowedLoopbackHostname,
  isAllowedLoopbackHttpUrl,
} from "./loopback-authority";

describe("Mobile loopback authority", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "[::1]", "::1"])(
    "accepts the exact loopback hostname %s",
    (hostname) => expect(isAllowedLoopbackHostname(hostname)).toBe(true),
  );

  it.each([
    "",
    "127.0.0.2",
    "127.1.2.3",
    "192.168.1.8",
    "astr.local",
    "localhost.evil.test",
    "127.0.0.1.evil",
  ])("rejects the non-allowlisted hostname %s", (hostname) => {
    expect(isAllowedLoopbackHostname(hostname)).toBe(false);
  });

  it.each([
    "http://localhost",
    "https://localhost:8443/core",
    "http://127.0.0.1:8300",
    "https://[::1]:8300/v1/stream",
  ])("accepts the credential-free loopback HTTP URL %s", (url) => {
    expect(isAllowedLoopbackHttpUrl(url)).toBe(true);
  });

  it.each([
    "ftp://localhost/resource",
    "file://localhost/tmp/core",
    "http://user@localhost",
    "https://user:secret@127.0.0.1",
    "http://localhost.evil.test",
    "http://127.0.0.2:8300",
    "https://remote.example",
    "not a url",
    "",
  ])("rejects the non-authoritative URL %s", (url) => {
    expect(isAllowedLoopbackHttpUrl(url)).toBe(false);
  });

  it("requires both private and public Core targets to be loopback", () => {
    expect(assessMobileServerAuthority({})).toBe(true);
    expect(
      assessMobileServerAuthority({
        coreUrl: "http://localhost:8300",
        publicCoreUrl: "https://[::1]:8300",
      }),
    ).toBe(true);
    expect(
      assessMobileServerAuthority({
        coreUrl: "https://remote.example",
        publicCoreUrl: "http://127.0.0.1:8300",
      }),
    ).toBe(false);
    expect(
      assessMobileServerAuthority({
        coreUrl: "http://127.0.0.1:8300",
        publicCoreUrl: "https://remote.example",
      }),
    ).toBe(false);
    expect(
      assessMobileServerAuthority({
        coreUrl: "invalid",
        publicCoreUrl: "http://127.0.0.1:8300",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the evaluator test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/authority/loopback-authority.test.ts
```

Expected: FAIL because `./loopback-authority` does not exist.

- [ ] **Step 3: Implement the pure evaluator**

Create `webapp/src/features/mobile/authority/loopback-authority.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run the evaluator test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/authority/loopback-authority.test.ts
```

Expected: PASS with 1 file and all table cases green.

### Task 2: Implement the SSR-safe authority provider

**Files:**

- Create: `webapp/src/features/mobile/authority/MobileAuthorityProvider.test.tsx`
- Create: `webapp/src/features/mobile/authority/MobileAuthorityProvider.tsx`

- [ ] **Step 1: Write the failing provider SSR/hydration tests**

Create `webapp/src/features/mobile/authority/MobileAuthorityProvider.test.tsx` with exactly:

```tsx
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileAuthorityProvider, useMobileAuthority } from "./MobileAuthorityProvider";
import { isAllowedLoopbackHostname } from "./loopback-authority";

function Probe() {
  return <output data-authority-phase>{useMobileAuthority()}</output>;
}

const mounted: Array<{ readonly host: HTMLDivElement; readonly root: Root }> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) continue;
    await act(async () => item.root.unmount());
    item.host.remove();
  }
});

async function hydrate(serverAuthorityTrusted: boolean) {
  const tree = (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <Probe />
    </MobileAuthorityProvider>
  );
  const host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(host, tree);
    await Promise.resolve();
  });
  mounted.push({ host, root });
  return host;
}

describe("MobileAuthorityProvider", () => {
  it("server-renders trusted evidence as checking without exposing a target", () => {
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted>
        <Probe />
      </MobileAuthorityProvider>,
    );
    expect(html).toContain("checking");
    expect(html).not.toContain("127.0.0.1:8300");
    expect(html).not.toContain("NEXT_PUBLIC_ASTR_CORE");
  });

  it("server-renders rejected evidence as unavailable", () => {
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted={false}>
        <Probe />
      </MobileAuthorityProvider>,
    );
    expect(html).toContain("unavailable-remote-context");
    expect(html).not.toContain("checking");
  });

  it("hydrates to trusted-local only for trusted server and browser evidence", async () => {
    expect(isAllowedLoopbackHostname(window.location.hostname)).toBe(true);
    const host = await hydrate(true);
    expect(host.textContent).toBe("trusted-local");
  });

  it("keeps rejected server evidence unavailable after hydration", async () => {
    const host = await hydrate(false);
    expect(host.textContent).toBe("unavailable-remote-context");
  });

  it("re-evaluates the immutable browser origin on pageshow without data access", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const host = await hydrate(true);
    expect(add).toHaveBeenCalledWith("pageshow", expect.any(Function));
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(host.textContent).toBe("trusted-local");
  });

  it("fails clearly when consumed outside its provider", () => {
    expect(() => renderToString(<Probe />)).toThrow("MobileAuthorityProvider is required");
  });
});
```

- [ ] **Step 2: Run the provider test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/authority/MobileAuthorityProvider.test.tsx
```

Expected: FAIL because `./MobileAuthorityProvider` does not exist.

- [ ] **Step 3: Implement the authority provider**

Create `webapp/src/features/mobile/authority/MobileAuthorityProvider.tsx` with exactly:

```tsx
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
```

- [ ] **Step 4: Run the provider test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/authority/MobileAuthorityProvider.test.tsx
```

Expected: PASS with no hydration warning.

### Task 3: Verify and commit the authority gate

- [ ] **Step 1: Run the complete authority suite**

Run:

```powershell
npm test -- --run src/features/mobile/authority
```

Expected: both test files PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Scan the production authority files for forbidden dependencies**

Run:

```powershell
rg -n "fetch\(|useRouter|useSearchParams|document\.cookie|localStorage|sessionStorage|CoreClient|headers\(" src/features/mobile/authority --glob "!*.test.*"
```

Expected: exit 1 with no matches.

- [ ] **Step 5: Stage the exact authority files**

Run from `D:\ASTR_System\astr`:

```powershell
git add webapp/src/features/mobile/authority/loopback-authority.ts webapp/src/features/mobile/authority/loopback-authority.test.ts webapp/src/features/mobile/authority/MobileAuthorityProvider.tsx webapp/src/features/mobile/authority/MobileAuthorityProvider.test.tsx
```

Expected: only the four authority files are staged.

- [ ] **Step 6: Commit the authority gate**

Run from `D:\ASTR_System\astr`:

```powershell
git commit -m "feat: add Mobile local authority gate"
```

Expected: commit succeeds and the four authority files are recorded.
