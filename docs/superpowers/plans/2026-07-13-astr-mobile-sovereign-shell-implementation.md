# ASTR Mobile Sovereign Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared ASTR Mobile header, static relay curve, main region, and fixed five-domain navigation with truthful authority state, day/night controls, safe-area ownership, and no Mobile animation or visual runtime.

**Architecture:** One Client Component reads pathname and authority phase, then composes metadata-only header/nav components around the route-owned content. CSS Modules own the static star-eclipse geometry and S-shaped relay mast; root CSS suppresses global ambient/grain on the first Mobile paint, and root viewport metadata enables safe-area insets.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Testing Library, React DOM SSR.

## Global Constraints

- The Shell owns exactly one `main#main-content` and zero h1; each domain page owns its sole h1.
- The bottom nav has exactly five real links, stable URLs, visible text, `aria-current="page"`, targets at least 44×44 CSS px, and gaps at least 8px.
- Header cross-space `返回 Presence` renders and prefetches only for `trusted-local`; `checking` and remote render no such link.
- Reuse the existing Theme toggle and the sole global Motion control through `VisualMotionRouteSlot`; do not create another motion state owner.
- Mobile source uses only existing `--astr-*` tokens and contains no green, gradient, glass/backdrop filter, keyframes, continuous animation, Canvas/WebGL, RAF, Pixi/Live2D/Three/framer-motion, or fake phone frame.
- Preserve the static S-shaped relay line as an aria-hidden SVG; no visual runtime owns it.
- Header owns top safe area; bottom nav owns bottom/left/right safe areas; main clearance is nav height + bottom safe area + positive room.
- At 320 CSS px the same DOM/reading order reflows without horizontal overflow; desktop uses the same information architecture with a controlled content width.
- The root viewport is `width=device-width`, `initialScale=1`, `viewportFit=cover`; do not set `maximumScale` or `userScalable`.
- Do not import any Presence, Tasks, Workbench, Knowledge, Safety, Control, Core client, controller, or data module into the Shell.
- Commands run from `D:\ASTR_System\astr\webapp`; Git commands run from `D:\ASTR_System\astr`.

---

### Task 1: Implement semantic Shell, Header, Nav, and static visual language

**Files:**

- Create: `webapp/src/features/mobile/shell/MobileShell.test.tsx`
- Create: `webapp/src/features/mobile/shell/MobileShell.tsx`
- Create: `webapp/src/features/mobile/shell/MobileHeader.tsx`
- Create: `webapp/src/features/mobile/shell/FiveDomainNav.tsx`
- Create: `webapp/src/features/mobile/shell/MobileShell.module.css`

- [ ] **Step 1: Write the failing semantic Shell test**

Create `webapp/src/features/mobile/shell/MobileShell.test.tsx` with exactly:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import { MobileShell } from "./MobileShell";

let pathname = "/mobile/tasks";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly href: string;
    readonly prefetch?: boolean;
  }) => <a href={href} data-prefetch={String(prefetch)} {...props} />,
}));
vi.mock("@/components/astr/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">切换昼夜主题</button>,
}));
vi.mock("@/components/system/VisualMotionToggle", () => ({
  VisualMotionRouteSlot: ({ className }: { readonly className?: string }) => (
    <span className={className} data-visual-motion-route-slot="">
      <button className="astr-motion-toggle" type="button">暂停视觉动效</button>
    </span>
  ),
}));

function tree(serverAuthorityTrusted: boolean, children: ReactNode = <h1>任务</h1>) {
  return (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <MobileShell>{children}</MobileShell>
    </MobileAuthorityProvider>
  );
}

describe("MobileShell", () => {
  beforeEach(() => {
    pathname = "/mobile/tasks";
  });

  it("renders one semantic main and the exact current five-domain nav", () => {
    const { container } = render(tree(true));
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "Mobile 五域" });

    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).getByRole("link", { name: /任务/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: /任务/ })).toHaveAttribute(
      "href",
      "/mobile/tasks",
    );
    expect(container.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });

  it("shows local authority and cross-space controls only after trust", () => {
    render(tree(true));

    expect(screen.getByText("本机可信入口")).toBeVisible();
    expect(screen.getByRole("button", { name: "切换昼夜主题" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "暂停视觉动效" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "返回 Presence" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "返回 Presence" })).toHaveAttribute(
      "data-prefetch",
      "false",
    );
  });

  it("renders the remote phase without a Presence bypass", () => {
    render(tree(false));

    expect(screen.getByText("远程来源未授权")).toBeVisible();
    expect(screen.queryByRole("link", { name: "返回 Presence" })).toBeNull();
  });

  it("server-renders trusted evidence as checking without a Presence bypass", () => {
    const html = renderToString(tree(true));

    expect(html).toContain("核验本机来源");
    expect(html).not.toContain("返回 Presence");
  });

  it("retains the static aria-hidden relay curve", () => {
    const { container } = render(tree(true));
    const curve = container.querySelector("svg[data-mobile-relay-curve]");

    expect(curve).toHaveAttribute("aria-hidden", "true");
    expect(curve?.querySelectorAll("path")).toHaveLength(1);
  });

  it("keeps Shell production files free of domain business imports", () => {
    const source = ["MobileShell.tsx", "MobileHeader.tsx", "FiveDomainNav.tsx"]
      .map((file) =>
        readFileSync(resolve(process.cwd(), `src/features/mobile/shell/${file}`), "utf8"),
      )
      .join("\n");

    expect(source).not.toMatch(
      /features\/(presence|control)|mobile\/(tasks|presence|workbench|knowledge|safety)|CoreClient|SafetyClient|fetch\s*\(|import\s*\(/,
    );
  });
});
```

- [ ] **Step 2: Run the semantic Shell test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/shell/MobileShell.test.tsx
```

Expected: FAIL because `./MobileShell` does not exist.

- [ ] **Step 3: Implement the five-domain navigation**

Create `webapp/src/features/mobile/shell/FiveDomainNav.tsx` with exactly:

```tsx
import Link from "next/link";

import { MOBILE_DOMAINS } from "../model/mobile-domains";
import styles from "./MobileShell.module.css";

export function FiveDomainNav({ pathname }: { readonly pathname: string }) {
  return (
    <nav className={styles.domainNav} aria-label="Mobile 五域">
      {MOBILE_DOMAINS.map((domain) => {
        const current = pathname === domain.href;
        return (
          <Link
            className={styles.domainLink}
            data-current={current ? "true" : "false"}
            href={domain.href}
            key={domain.id}
            prefetch={false}
            {...(current ? { "aria-current": "page" as const } : {})}
          >
            <span className={styles.domainIndex} aria-hidden="true">{domain.index}</span>
            <span className={styles.domainLabel}>{domain.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Implement the authority-aware Header**

Create `webapp/src/features/mobile/shell/MobileHeader.tsx` with exactly:

```tsx
import Link from "next/link";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";

import type { MobileAuthorityPhase } from "../authority/loopback-authority";
import type { MobileDomainDefinition } from "../model/mobile-domains";
import styles from "./MobileShell.module.css";

const AUTHORITY_COPY: Record<MobileAuthorityPhase, string> = {
  checking: "核验本机来源",
  "trusted-local": "本机可信入口",
  "unavailable-remote-context": "远程来源未授权",
};

export function MobileHeader({
  domain,
  authority,
}: {
  readonly domain: MobileDomainDefinition;
  readonly authority: MobileAuthorityPhase;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brandRail}>
        <div className={styles.eclipse} aria-hidden="true" />
        <div className={styles.brandCopy}>
          <p className={styles.brand}>星枢 · ASTR</p>
          <p className={styles.domainName}>{domain.label}</p>
        </div>
      </div>
      <p className={styles.localFact}>{AUTHORITY_COPY[authority]}</p>
      <div className={styles.headerActions}>
        <ThemeToggle />
        <VisualMotionRouteSlot className={styles.motionSlot} />
        {authority === "trusted-local" && (
          <Link className={styles.presenceLink} href="/" prefetch={false}>
            返回 Presence
          </Link>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Implement the semantic Shell and static relay SVG**

Create `webapp/src/features/mobile/shell/MobileShell.tsx` with exactly:

```tsx
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import { getMobileDomainByPath } from "../model/mobile-domains";
import { FiveDomainNav } from "./FiveDomainNav";
import { MobileHeader } from "./MobileHeader";
import styles from "./MobileShell.module.css";

export function MobileShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const authority = useMobileAuthority();
  const domain = getMobileDomainByPath(pathname);

  return (
    <div className={styles.shell} data-route-surface="mobile">
      <MobileHeader authority={authority} domain={domain} />
      <svg
        className={styles.relayCurve}
        data-mobile-relay-curve=""
        aria-hidden="true"
        viewBox="0 0 96 1000"
        preserveAspectRatio="none"
      >
        <path d="M18 0 C82 130 10 255 58 382 C94 478 20 604 52 718 C79 818 37 903 72 1000" />
      </svg>
      <main className={styles.main} id="main-content">{children}</main>
      <FiveDomainNav pathname={pathname} />
    </div>
  );
}
```

- [ ] **Step 6: Implement the complete static Shell CSS**

Create `webapp/src/features/mobile/shell/MobileShell.module.css` with exactly:

```css
.shell {
  --mobile-nav-block-size: 5.25rem;
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  overflow-x: clip;
  background: var(--astr-bg);
  color: var(--astr-text);
}

.header {
  position: relative;
  z-index: var(--z-panel);
  display: grid;
  grid-template-areas: "brand fact actions";
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) max(var(--space-4), 4vw)
    var(--space-4);
  border-bottom: 1px solid var(--astr-hairline-strong);
  background: var(--astr-bg);
}

.brandRail {
  grid-area: brand;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.eclipse {
  position: relative;
  flex: none;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  overflow: hidden;
  border: 1px solid var(--astr-action);
  border-radius: 50%;
  background: var(--astr-surface-2);
  clip-path: polygon(0 0, 72% 0, 88% 24%, 100% 35%, 100% 100%, 0 100%);
}

.eclipse::before,
.eclipse::after {
  position: absolute;
  content: "";
}

.eclipse::before {
  inset: 0.45rem;
  border: 1px solid var(--astr-hairline-strong);
  border-radius: 50%;
}

.eclipse::after {
  inset: 50% -0.25rem auto;
  border-top: 1px solid var(--astr-text-3);
}

.brandCopy {
  min-width: 0;
}

.brand,
.domainName,
.localFact {
  margin: 0;
}

.brand {
  color: var(--astr-text-3);
  font-family: var(--font-mono);
  font-size: var(--type--1);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.domainName {
  overflow-wrap: anywhere;
  color: var(--astr-text);
  font-family: var(--font-display);
  font-size: clamp(var(--type-1), 3vw, var(--type-2));
  line-height: 1.25;
}

.localFact {
  grid-area: fact;
  max-width: 12rem;
  padding-inline-start: var(--space-3);
  border-inline-start: 1px solid var(--astr-hairline-strong);
  color: var(--astr-text-2);
  font-family: var(--font-mono);
  font-size: var(--type--1);
  line-height: 1.5;
}

.headerActions {
  grid-area: actions;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.headerActions :global(button),
.presenceLink,
.domainLink {
  min-inline-size: var(--touch-target);
  min-block-size: var(--touch-target);
}

.motionSlot {
  display: inline-flex;
}

.motionSlot :global(.astr-motion-toggle) {
  position: static;
  inset: auto;
  z-index: auto;
  min-inline-size: var(--touch-target);
  min-block-size: var(--touch-target);
}

.presenceLink {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--astr-hairline-strong);
  padding-inline: var(--space-3);
  color: var(--astr-text-2);
  font-family: var(--font-mono);
  font-size: var(--type--1);
  text-decoration: none;
}

.presenceLink:hover {
  border-color: var(--astr-action);
  color: var(--astr-text);
}

.relayCurve {
  position: fixed;
  z-index: var(--z-base);
  inset-block: 0 var(--mobile-nav-block-size);
  inset-inline-start: max(0.35rem, env(safe-area-inset-left));
  inline-size: clamp(2.75rem, 8vw, 6rem);
  block-size: calc(100dvh - var(--mobile-nav-block-size));
  overflow: visible;
  pointer-events: none;
}

.relayCurve path {
  fill: none;
  stroke: color-mix(in srgb, var(--astr-action) 42%, var(--astr-hairline-strong));
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.main {
  position: relative;
  z-index: var(--z-base);
  inline-size: min(100%, 76rem);
  min-width: 0;
  margin-inline: auto;
  padding: clamp(var(--space-4), 4vw, var(--space-7));
  padding-bottom: calc(
    var(--mobile-nav-block-size) + env(safe-area-inset-bottom) + var(--space-5)
  );
  scroll-padding-bottom: calc(
    var(--mobile-nav-block-size) + env(safe-area-inset-bottom) + var(--space-5)
  );
}

.domainNav {
  position: fixed;
  z-index: var(--z-overlay);
  inset-inline: 0;
  inset-block-end: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  min-block-size: var(--mobile-nav-block-size);
  padding: var(--space-2) max(var(--space-2), env(safe-area-inset-right))
    calc(var(--space-2) + env(safe-area-inset-bottom))
    max(var(--space-2), env(safe-area-inset-left));
  border-top: 1px solid var(--astr-hairline-strong);
  background: var(--astr-surface);
}

.domainLink {
  position: relative;
  display: grid;
  min-width: 0;
  place-content: center;
  gap: 0.1rem;
  padding: 0.35rem 0.1rem;
  border-top: 1px solid transparent;
  color: var(--astr-text-2);
  text-align: center;
  text-decoration: none;
}

.domainLink::before {
  position: absolute;
  inset: -1px 28% auto;
  border-top: 1px solid transparent;
  content: "";
}

.domainLink[data-current="true"] {
  border-top-color: var(--astr-action);
  color: var(--astr-action);
}

.domainLink[data-current="true"]::before {
  border-top-color: currentColor;
}

.domainIndex {
  font-family: var(--font-mono);
  font-size: var(--type--1);
  letter-spacing: 0.08em;
}

.domainLabel {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--type-0);
  line-height: 1.2;
}

@media (max-width: 48rem) {
  .header {
    grid-template-areas:
      "brand fact"
      "actions actions";
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .headerActions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (max-width: 36rem) {
  .header {
    grid-template-areas:
      "brand"
      "fact"
      "actions";
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }

  .localFact {
    max-width: none;
  }

  .domainLabel {
    font-size: 0.72rem;
  }
}
```

- [ ] **Step 7: Run the semantic Shell test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/shell/MobileShell.test.tsx
```

Expected: PASS with six tests.

- [ ] **Step 8: Add static CSS constitutional tests**

Append this test inside the existing `describe` block in `MobileShell.test.tsx`:

```tsx
  it("owns safe areas and rejects forbidden Mobile visual techniques", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/mobile/shell/MobileShell.module.css"),
      "utf8",
    );

    expect(css).toMatch(/min-height:\s*100dvh/);
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).toMatch(/safe-area-inset-bottom/);
    expect(css).toMatch(/scroll-padding-bottom/);
    expect(css).toMatch(/min-inline-size:\s*var\(--touch-target\)/);
    expect(css).toMatch(/gap:\s*8px/);
    expect(css).toMatch(/inline-size:\s*min\(100%,\s*76rem\)/);
    expect(css).toMatch(/\.motionSlot\s+:global\(\.astr-motion-toggle\)[\s\S]*position:\s*static/);
    expect(css).not.toMatch(
      /gradient|backdrop-filter|@keyframes|animation\s*:|requestAnimationFrame|canvas|webgl|pixi|live2d|three|framer-motion|\bgreen\b/i,
    );
  });
```

- [ ] **Step 9: Run the Shell test with CSS assertions**

Run:

```powershell
npm test -- --run src/features/mobile/shell/MobileShell.test.tsx
```

Expected: PASS with seven tests.

### Task 2: Suppress global ambient on first paint and export safe-area viewport

**Files:**

- Modify: `webapp/src/app/globals.css`
- Modify: `webapp/src/components/system/AppShell.test.tsx`
- Modify: `webapp/src/app/layout.tsx`
- Create: `webapp/src/app/layout.test.ts`

- [ ] **Step 1: Write the failing first-paint suppression test**

Add these imports at the top of `webapp/src/components/system/AppShell.test.tsx`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
```

Append this test inside `describe("AppShell", ...)`:

```tsx
  it("suppresses global ambient and grain from the Mobile SSR witness", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = css.match(
      /body:has\(\[data-route-surface="mobile"\]\) \.astr-ambient,[\s\S]*?body:has\(\[data-route-surface="mobile"\]\) \.astr-grain\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*none/);
    expect(rule).toMatch(/animation:\s*none/);
    expect(rule).toMatch(/background:\s*none/);
  });
```

- [ ] **Step 2: Run the AppShell test and confirm RED**

Run:

```powershell
npm test -- --run src/components/system/AppShell.test.tsx -t "Mobile SSR witness"
```

Expected: FAIL because the Mobile suppression rule is absent.

- [ ] **Step 3: Add the exact global first-paint override**

Append this rule immediately after the existing `.astr-grain` light-theme rule in `webapp/src/app/globals.css`:

```css
body:has([data-route-surface="mobile"]) .astr-ambient,
body:has([data-route-surface="mobile"]) .astr-grain {
  display: none;
  animation: none;
  background: none;
}
```

- [ ] **Step 4: Run the AppShell suppression test and confirm GREEN**

Run:

```powershell
npm test -- --run src/components/system/AppShell.test.tsx -t "Mobile SSR witness"
```

Expected: PASS.

- [ ] **Step 5: Write the failing viewport source test**

Create `webapp/src/app/layout.test.ts` with exactly:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("root viewport", () => {
  it("enables safe-area geometry without disabling zoom", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(source).toMatch(/import type \{ Metadata, Viewport \} from "next"/);
    expect(source).toMatch(/export const viewport:\s*Viewport/);
    expect(source).toMatch(/width:\s*"device-width"/);
    expect(source).toMatch(/initialScale:\s*1/);
    expect(source).toMatch(/viewportFit:\s*"cover"/);
    expect(source).not.toMatch(/maximumScale|userScalable/);
  });
});
```

- [ ] **Step 6: Run the viewport test and confirm RED**

Run:

```powershell
npm test -- --run src/app/layout.test.ts
```

Expected: FAIL because `Viewport` and `viewport` are absent.

- [ ] **Step 7: Export the exact Next viewport**

In `webapp/src/app/layout.tsx`, replace the first import with:

```ts
import type { Metadata, Viewport } from "next";
```

Insert immediately after `metadata`:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

- [ ] **Step 8: Run the viewport test and confirm GREEN**

Run:

```powershell
npm test -- --run src/app/layout.test.ts
```

Expected: PASS.

### Task 3: Verify and commit the sovereign Shell

- [ ] **Step 1: Run the complete focused suite**

Run:

```powershell
npm test -- --run src/features/mobile/model src/features/mobile/shell src/features/mobile/authority src/components/system/AppShell.test.tsx src/app/layout.test.ts
```

Expected: all selected suites PASS.

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

- [ ] **Step 4: Scan the Shell production files for forbidden dependencies**

Run:

```powershell
rg -n "features/(presence|control)|mobile/(tasks|presence|workbench|knowledge|safety)|CoreClient|SafetyClient|fetch\(|requestAnimationFrame|canvas|pixi|live2d|three|framer-motion" src/features/mobile/shell --glob "!*.test.*"
```

Expected: exit 1 with no matches.

- [ ] **Step 5: Stage the exact Shell files**

Run from `D:\ASTR_System\astr`:

```powershell
git add webapp/src/features/mobile/shell/MobileShell.tsx webapp/src/features/mobile/shell/MobileShell.test.tsx webapp/src/features/mobile/shell/MobileHeader.tsx webapp/src/features/mobile/shell/FiveDomainNav.tsx webapp/src/features/mobile/shell/MobileShell.module.css webapp/src/app/globals.css webapp/src/components/system/AppShell.test.tsx webapp/src/app/layout.tsx webapp/src/app/layout.test.ts
```

Expected: only the nine listed files are staged.

- [ ] **Step 6: Commit the sovereign Shell**

Run from `D:\ASTR_System\astr`:

```powershell
git commit -m "feat: establish Mobile sovereign relay shell"
```

Expected: commit succeeds with the nine Shell/viewport files.
