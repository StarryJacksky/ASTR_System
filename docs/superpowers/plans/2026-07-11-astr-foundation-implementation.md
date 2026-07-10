# ASTR Workstream 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the testable, accessible, truthful front-end foundation that every ASTR product space can share without changing backend behavior.

**Architecture:** Keep business truth in a pure parallel-region state model and a small Zustand vanilla store; React components consume selectors but never own Pixi objects. A single Jewel lease controller arbitrates every future high-detail motion. The root AppShell supplies theme material, skip navigation, one live region, visual pause, and browser visibility/reduced-motion synchronization while existing Presence and Effector behavior remain available.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript 5.9, Zustand 5, next-themes, Framer Motion, Tailwind CSS 4, Vitest, React Testing Library, jsdom.

## Global Constraints

- Do not change Python/Core behavior or add speculative backend endpoints in this workstream.
- Preserve `/`, `/admin`, `/api/core/*`, the two current SSE event meanings, voice, voiceprint, and local Effector controls.
- `soul.stream` is provisional; `soul.decision` is authoritative.
- `soul_name` remains an internal handle; UI types may add an optional `display_name`, but must not invent one.
- Night tokens use `#050611`, `#0e1123`, `#f5f4fb`, `#969fbd`, `#2b3253`, `#9184ff`, `#8bcfff`, `#efa85f`, and `#ff7087` in their specified semantic roles.
- Day tokens use `#f1f3fa`, `#ffffff`, `#16172b`, `#5b48b8`, `#216ca6`, `#955005`, and `#b92f4c` in their specified semantic roles.
- Green is forbidden. Success must use text, form, line, and cold blue/silver rather than a green hue.
- Any moment has at most one dynamic Jewel. No Three.js, second WebGL context, or component-owned persistent ticker is introduced.
- Motion must preserve meaning under `prefers-reduced-motion` and a persistent user pause. Hidden, offscreen, reduced, or paused states release dynamic leases immediately, which is stricter than the 250ms ceiling.
- WCAG 2.2 AA is the baseline. Primary touch targets are at least 44×44 CSS px; focus remains visible; Canvas is never the only carrier of meaning.
- All new behavior follows red-green-refactor. Existing lint failures use `npm run lint` itself as the failing regression gate before refactoring.
- The checkpoint commit `5fbae96` is the immutable pre-foundation prototype baseline.

---

### Task 1: Validation Harness and Clean Lint Baseline

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Modify: `webapp/eslint.config.mjs`
- Modify: `webapp/src/app/admin/page.tsx`
- Modify: `webapp/src/components/astr/Intro.tsx`
- Modify: `webapp/src/components/astr/ThemeToggle.tsx`
- Modify: `webapp/src/components/astr/VoiceprintPanel.tsx`
- Modify: `webapp/src/components/astr/Live2DStage.tsx`
- Modify: `webapp/src/lib/useCore.ts`
- Create: `webapp/vitest.config.mts`
- Create: `webapp/src/test/setup.ts`
- Create: `webapp/src/test/harness.test.ts`

**Interfaces:**
- Consumes: existing npm project and Next 16 local documentation.
- Produces: `npm run typecheck`, `npm run test:run`, and a zero-error/zero-warning `npm run lint`; jsdom setup for later tasks.

- [ ] **Step 1: Record the failing lint gate**

Run:

```powershell
cd D:\ASTR_System\astr\webapp
npm run lint
```

Expected: FAIL with vendored `public/live2d` diagnostics plus React hook diagnostics in Admin, Intro, ThemeToggle, VoiceprintPanel, Live2DStage, and `useCore.ts`.

- [ ] **Step 2: Install the unit-test toolchain**

Run:

```powershell
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8
```

Add these scripts and runtime declarations to `package.json`:

```json
{
  "engines": { "node": "^20.19.0 || ^22.13.0 || >=24.0.0" },
  "packageManager": "npm@10.8.2",
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "start": "next start -p 3100",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "next typegen && tsc --noEmit --incremental false --pretty false",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

- [ ] **Step 3: Create the deterministic Vitest setup**

Create `vitest.config.mts`:

```ts
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts", "src/components/system/**/*.tsx"],
    },
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
```

Create `src/test/harness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("foundation test harness", () => {
  it("provides a browser-like document and media query API", () => {
    expect(document.documentElement).toBeInstanceOf(HTMLElement);
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });
});
```

- [ ] **Step 4: Remove third-party lint noise and refactor hook violations without changing behavior**

Add `"public/live2d/**"` and `"public/pixi-live2d-display.js"` to `globalIgnores`.

Apply these exact refactor rules:

```ts
// Intro.tsx: defer the initial state synchronization and cancel it on unmount.
useEffect(() => {
  const frame = requestAnimationFrame(() => {
    const seen = sessionStorage.getItem("astr-intro-seen");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!seen && !reduced) setShow(true);
  });
  return () => cancelAnimationFrame(frame);
}, []);
```

```ts
// ThemeToggle.tsx: remove mounted state/effect; resolvedTheme is the source.
const { resolvedTheme, setTheme } = useTheme();
const dark = resolvedTheme !== "light";
```

Use an invariant label `切换昼夜主题`; render both icons inside spans selected by `data-theme` CSS rather than branching on a mounted flag.

For Admin and Voiceprint initial loads, ensure the first state update occurs after an awaited fetch or microtask and guard completion with an `AbortController`; do not call a synchronous state-setting helper directly from the effect body. Preserve the manual `refresh()` functions for button/event handlers. Change the Voiceprint success copy to `声纹模板已注册；网页转写入口仍需单独验证身份。`.

In `useCore.ts`, replace the render-time ref write with a stable key:

```ts
const typesKey = [...types].sort().join("\u001f");

useEffect(() => {
  const subscribedTypes = typesKey ? typesKey.split("\u001f") : [];
  // register and remove listeners using subscribedTypes
}, [max, typesKey]);
```

Remove only the three now-unused `eslint-disable` comments in `useCore.ts` and `Live2DStage.tsx`.

- [ ] **Step 5: Verify the harness and lint baseline**

Run:

```powershell
npm run test:run
npm run lint
npm run typecheck
npm run build
```

Expected: harness `1 passed`; ESLint exit 0 with no warnings; TypeScript exit 0; Next build lists `/` and `/admin`.

- [ ] **Step 6: Commit**

```powershell
git add webapp/package.json webapp/package-lock.json webapp/eslint.config.mjs webapp/vitest.config.mts webapp/src/test webapp/src/app/admin/page.tsx webapp/src/components/astr/Intro.tsx webapp/src/components/astr/ThemeToggle.tsx webapp/src/components/astr/VoiceprintPanel.tsx webapp/src/components/astr/Live2DStage.tsx webapp/src/lib/useCore.ts
git commit -m "test: establish frontend validation harness"
```

---

### Task 2: Constitutional Color, Type, Shape, and Motion Tokens

**Files:**
- Create: `webapp/src/styles/tokens.test.ts`
- Modify: `webapp/src/styles/tokens.css`
- Modify: `webapp/src/app/globals.css`
- Modify: `webapp/src/lib/emotion.ts`

**Interfaces:**
- Consumes: exact palette and budgets in the Master Spec.
- Produces: backward-compatible `--astr-*` tokens plus semantic roles used by every workstream.

- [ ] **Step 1: Write the failing token contract test**

Create `tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

describe("ASTR constitutional tokens", () => {
  it.each([
    ["--astr-bg", "#050611"],
    ["--astr-surface", "#0e1123"],
    ["--astr-text", "#f5f4fb"],
    ["--astr-text-2", "#969fbd"],
    ["--astr-hairline-strong", "#2b3253"],
    ["--astr-soul", "#9184ff"],
    ["--astr-action", "#8bcfff"],
    ["--astr-warning", "#efa85f"],
    ["--astr-danger", "#ff7087"],
  ])("defines %s as %s", (name, value) => {
    expect(css.toLowerCase()).toMatch(new RegExp(`${name}:\\s*${value}`));
  });

  it("contains the complete day material inversion", () => {
    for (const value of ["#f1f3fa", "#ffffff", "#16172b", "#5b48b8", "#216ca6", "#955005", "#b92f4c"]) {
      expect(css.toLowerCase()).toContain(value);
    }
  });

  it("contains no legacy green success or calm color", () => {
    expect(css.toLowerCase()).not.toContain("#4ec98f");
    expect(css.toLowerCase()).not.toContain("#3df5c4");
  });

  it("defines non-color craft and performance tokens", () => {
    for (const token of ["--radius-jewel", "--corner-eclipse", "--motion-instant", "--motion-signature", "--dpr-desktop", "--dpr-mobile", "--touch-target"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify the constitutional mismatch**

Run `npm run test:run -- src/styles/tokens.test.ts`.

Expected: FAIL on the old black/amber/green palette and missing craft tokens.

- [ ] **Step 3: Replace the root token roles while preserving compatibility aliases**

The `:root` semantic block must contain:

```css
:root {
  color-scheme: dark;
  --astr-bg: #050611;
  --astr-surface: #0e1123;
  --astr-surface-2: #15192f;
  --astr-text: #f5f4fb;
  --astr-text-2: #969fbd;
  --astr-text-3: #b3bad2;
  --astr-hairline: rgba(151, 165, 214, 0.18);
  --astr-hairline-strong: #2b3253;
  --astr-soul: #9184ff;
  --astr-action: #8bcfff;
  --astr-accent: var(--astr-action);
  --astr-accent-2: #6a78ba;
  --astr-on-accent: #07101d;
  --astr-success: #c8dcff;
  --astr-warning: #efa85f;
  --astr-danger: #ff7087;
  --emo-lonely: #6f8cff;
  --emo-excited: #ff8c78;
  --emo-tsundere: #c884ff;
  --emo-calm: #92b7ff;
  --astr-emotion-glow: var(--emo-calm);
  --touch-target: 44px;
  --radius-small: 6px;
  --radius-medium: 12px;
  --radius-large: 22px;
  --radius-jewel: 999px;
  --corner-eclipse: 28px 5px 28px 5px;
  --motion-instant: 120ms;
  --motion-fast: 200ms;
  --motion-spatial: 320ms;
  --motion-signature: 1200ms;
  --dpr-desktop: 1.5;
  --dpr-mobile: 1.25;
}

[data-theme="light"] {
  color-scheme: light;
  --astr-bg: #f1f3fa;
  --astr-surface: #ffffff;
  --astr-surface-2: #e7eaf4;
  --astr-text: #16172b;
  --astr-text-2: #4e5572;
  --astr-text-3: #656c88;
  --astr-hairline: rgba(31, 42, 82, 0.18);
  --astr-hairline-strong: #aeb7d2;
  --astr-soul: #5b48b8;
  --astr-action: #216ca6;
  --astr-accent: var(--astr-action);
  --astr-accent-2: #526a9d;
  --astr-on-accent: #ffffff;
  --astr-success: #315f91;
  --astr-warning: #955005;
  --astr-danger: #b92f4c;
}
```

Keep the existing typography, spacing, z-index, easing, and shadow roles, but rename comments and references away from the amber observatory concept. Update `emotion.ts` fallback hex values to the four new emotion tokens. In `globals.css`, map `soul` and `action` roles and ensure the default focus ring uses `--astr-action`.

- [ ] **Step 4: Verify the token system**

Run:

```powershell
npm run test:run -- src/styles/tokens.test.ts
npm run lint
npm run typecheck
```

Expected: token tests pass; no lint/type errors.

- [ ] **Step 5: Commit**

```powershell
git add webapp/src/styles/tokens.css webapp/src/styles/tokens.test.ts webapp/src/app/globals.css webapp/src/lib/emotion.ts
git commit -m "feat: establish ASTR constitutional design tokens"
```

---

### Task 3: Parallel Semantic State and Truthful Guards

**Files:**
- Create: `webapp/src/lib/semantic-state.ts`
- Create: `webapp/src/lib/semantic-state.test.ts`
- Create: `webapp/src/lib/semantic-store.ts`
- Create: `webapp/src/lib/semantic-store.test.ts`
- Modify: `webapp/src/lib/types.ts`

**Interfaces:**
- Consumes: browser/Core events normalized by later adapters.
- Produces: `SemanticState`, `SemanticEvent`, `reduceSemanticState`, guard functions, `createSemanticStore`, `semanticStore`, and `useSemanticStore`.

- [ ] **Step 1: Write failing reducer and guard tests**

Tests must assert these behaviors with real functions:

```ts
it("keeps conversation sending independent from device e-stop", () => {
  const stopped = { ...initialSemanticState, core: "reachable", safety: "stoppedLatched" };
  expect(canSend(stopped, { inputValid: true, isComposing: false })).toBe(true);
});

it("requires the full visual conjunction before animation", () => {
  const ready = {
    ...initialSemanticState,
    visualRuntime: "ready",
    visibility: "visible",
    motion: "full",
  };
  expect(canAnimate(ready, true)).toBe(true);
  expect(canAnimate({ ...ready, motion: "paused" }, true)).toBe(false);
  expect(canAnimate({ ...ready, visibility: "hidden" }, true)).toBe(false);
});

it("fails closed for task side effects outside normal safety", () => {
  const state = { ...initialSemanticState, core: "reachable", safety: "stopUnknown" };
  expect(canCreateOrAdvanceTask(state, { authenticated: true, online: true, heartbeatFresh: true })).toBe(false);
});

it("does not let visual context loss overwrite Core reachability", () => {
  const state = reduceSemanticState(
    { ...initialSemanticState, core: "reachable" },
    { type: "WEBGL_LOST" },
  );
  expect(state.core).toBe("reachable");
  expect(state.visualRuntime).toBe("contextLost");
});
```

The store test must prove `dispatch` uses the reducer and `announce` atomically replaces one message rather than appending a live-region list.

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run `npm run test:run -- src/lib/semantic-state.test.ts src/lib/semantic-store.test.ts`.

Expected: FAIL because the two modules do not exist.

- [ ] **Step 3: Implement the pure state model**

Define these exact region unions:

```ts
export type CoreState = "cold" | "loading" | "reachable" | "offline" | "error";
export type StreamState = "connecting" | "open" | "retrying" | "closed";
export type ConversationState = "empty" | "idle" | "sending" | "streaming" | "final" | "error";
export type VisualRuntimeState = "loading" | "ready" | "contextLost";
export type VisibilityState = "visible" | "hidden" | "offscreen";
export type MotionState = "full" | "reduced" | "paused";
export type SafetyState = "normal" | "stopRequested" | "stopUnknown" | "stoppedLatched" | "resetting";
export type TaskState = "none" | "draft" | "queued" | "planning" | "approvalRequired" | "running" | "terminal";

export interface SemanticState {
  core: CoreState;
  replySse: StreamState;
  lifeSse: StreamState;
  conversation: ConversationState;
  visualRuntime: VisualRuntimeState;
  visibility: VisibilityState;
  motion: MotionState;
  safety: SafetyState;
  task: TaskState;
}
```

Implement `initialSemanticState`, a discriminated `SemanticEvent` union for every event listed in Master Spec section 14, and an exhaustive reducer using `assertNever`. Implement:

```ts
export function canSend(
  state: SemanticState,
  input: { inputValid: boolean; isComposing: boolean },
): boolean;

export function canAnimate(state: SemanticState, ownsLease: boolean): boolean;

export function canCreateOrAdvanceTask(
  state: SemanticState,
  device: { authenticated: boolean; online: boolean; heartbeatFresh: boolean },
): boolean;

export function deriveProminentStatus(state: SemanticState):
  | "safety"
  | "approval"
  | "outcome"
  | "core"
  | "stream"
  | "conversation"
  | "ready";
```

Priority follows the Master Spec exactly: safety, approval/denied, outcome/error, Core, SSE, conversation, ready.

- [ ] **Step 4: Implement the Zustand vanilla store and frontend projection types**

`semantic-store.ts` must export a factory so tests do not share singleton state:

```ts
export interface Announcement {
  id: number;
  message: string;
  politeness: "polite" | "assertive";
}

export interface SemanticStoreState extends SemanticState {
  announcement: Announcement | null;
  dispatch: (event: SemanticEvent) => void;
  announce: (message: string, politeness?: Announcement["politeness"]) => void;
  clearAnnouncement: () => void;
}

export const createSemanticStore = () => createStore<SemanticStoreState>()((set) => ({
  ...initialSemanticState,
  announcement: null,
  dispatch: (event) => set((state) => ({ ...reduceSemanticState(state, event) })),
  announce: (message, politeness = "polite") =>
    set((state) => ({ announcement: { id: (state.announcement?.id ?? 0) + 1, message, politeness } })),
  clearAnnouncement: () => set({ announcement: null }),
}));
```

Export the singleton and a typed React selector hook built with `useStore`.

Extend `types.ts` with optional `display_name?: string` and explicit `CoreStatusProjection`, `ConversationProjection`, and `IngestReceipt { event_id; trace_id }`. Do not add Task/Artifact fields to current Core responses.

- [ ] **Step 5: Verify reducer/store behavior**

Run:

```powershell
npm run test:run -- src/lib/semantic-state.test.ts src/lib/semantic-store.test.ts
npm run lint
npm run typecheck
```

Expected: all state/store tests pass and all static gates stay clean.

- [ ] **Step 6: Commit**

```powershell
git add webapp/src/lib/semantic-state.ts webapp/src/lib/semantic-state.test.ts webapp/src/lib/semantic-store.ts webapp/src/lib/semantic-store.test.ts webapp/src/lib/types.ts
git commit -m "feat: add truthful parallel semantic state"
```

---

### Task 4: Executable Global Jewel Lease

**Files:**
- Create: `webapp/src/lib/jewel-lease.ts`
- Create: `webapp/src/lib/jewel-lease.test.ts`

**Interfaces:**
- Consumes: `SemanticState` and capability evidence from later projections.
- Produces: `JewelLeaseController`, `JEWEL_PRIORITY`, `JewelLease`, and `JewelEnvironment`.

- [ ] **Step 1: Write failing lease-arbitration tests**

Cover all of the following:

```ts
it("allows only one owner and higher priority preempts", () => {
  const leases = new JewelLeaseController();
  expect(leases.acquire({ owner: "live2d", mode: "idle", traceId: null })?.owner).toBe("live2d");
  expect(leases.acquire({ owner: "orbitTraveler", mode: "navigate", traceId: "trc_1" })?.owner).toBe("orbitTraveler");
  expect(leases.current()?.owner).toBe("orbitTraveler");
});

it("transfers stream ownership from Lens to speech without overlap", () => {
  const leases = new JewelLeaseController();
  leases.acquire({ owner: "soulLens", mode: "streamStage", traceId: "trc_1" });
  leases.release("soulLens", "streamStage");
  leases.acquire({ owner: "live2d", mode: "speech", traceId: "trc_1" });
  expect(leases.current()).toMatchObject({ owner: "live2d", mode: "speech" });
});

it.each(["hidden", "offscreen"] as const)("releases immediately when visibility is %s", (visibility) => {
  const leases = new JewelLeaseController();
  leases.acquire({ owner: "live2d", mode: "idle", traceId: null });
  leases.setEnvironment({ visibility, motion: "full", runtime: "ready" });
  expect(leases.current()).toBeNull();
});

it("keeps future success rituals disabled without evidence", () => {
  const leases = new JewelLeaseController();
  expect(leases.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_1" })).toBeNull();
  expect(leases.acquire({ owner: "authorizationSeal", mode: "confirmed", traceId: "trc_1" })).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify the missing module failure**

Run `npm run test:run -- src/lib/jewel-lease.test.ts`.

Expected: FAIL because `jewel-lease.ts` does not exist.

- [ ] **Step 3: Implement the controller and priority table**

Use this exact priority map:

```ts
export const JEWEL_PRIORITY = {
  safetyBoundary: 1000,
  errorBoundary: 900,
  authorizationSeal: 800,
  soulLens: 700,
  artifactReturn: 650,
  evidenceReveal: 600,
  live2dSpeech: 500,
  orbitTraveler: 400,
  composerTab: 300,
  coldCalibration: 200,
  live2dIdle: 100,
} as const;
```

`acquire` resolves the priority from the owner/mode pair, rejects dynamic acquisition unless environment is `visible/full/ready`, rejects lower priority, and lets the newest equal-priority intent replace the old lease. Every lease includes `owner`, `mode`, `traceId`, `priority`, `acquiredAt`, and `semanticEnd`.

Capability defaults are both false:

```ts
export interface JewelCapabilities {
  canSealApproval: boolean;
  canReturnArtifact: boolean;
}
```

`authorizationSeal/confirmed` requires `canSealApproval`; `artifactReturn/complete` requires `canReturnArtifact`. `setEnvironment` releases the current lease immediately when visibility, motion, or runtime cannot animate. `release` is idempotent and requires the exact owner/mode pair.

- [ ] **Step 4: Verify lease semantics**

Run:

```powershell
npm run test:run -- src/lib/jewel-lease.test.ts
npm run lint
npm run typecheck
```

Expected: all arbitration, transfer, environment, and capability tests pass.

- [ ] **Step 5: Commit**

```powershell
git add webapp/src/lib/jewel-lease.ts webapp/src/lib/jewel-lease.test.ts
git commit -m "feat: add global Jewel lease arbitration"
```

---

### Task 5: Accessible AppShell, One Announcer, and Persistent Visual Pause

**Files:**
- Create: `webapp/src/components/system/AppShell.tsx`
- Create: `webapp/src/components/system/AppShell.test.tsx`
- Create: `webapp/src/components/system/StateAnnouncer.tsx`
- Create: `webapp/src/components/system/VisualMotionToggle.tsx`
- Modify: `webapp/src/app/layout.tsx`
- Modify: `webapp/src/app/page.tsx`
- Modify: `webapp/src/app/admin/page.tsx`
- Modify: `webapp/src/app/globals.css`

**Interfaces:**
- Consumes: semantic store announcement/motion region and existing children.
- Produces: a shared shell with `#main-content` skip navigation, exactly one live region, and a 44px persistent motion control.

- [ ] **Step 1: Write the failing AppShell tests**

The tests must render the shell and assert:

```tsx
render(
  <AppShell>
    <main id="main-content">内容</main>
  </AppShell>,
);

expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute("href", "#main-content");
expect(screen.getAllByRole("status")).toHaveLength(1);
expect(screen.getByRole("button", { name: "暂停视觉动态" })).toHaveStyle({ minWidth: "var(--touch-target)" });
```

Dispatching `announce("Core 已接收 · trc_1")` must update the single status node once. Clicking the visual control must change Motion from full to paused, set `data-visual-motion="paused"` on `<html>`, and persist `astr.visual-motion=paused`.

- [ ] **Step 2: Run tests and verify missing components**

Run `npm run test:run -- src/components/system/AppShell.test.tsx`.

Expected: FAIL because the system components do not exist.

- [ ] **Step 3: Implement the shell and announcer**

`AppShell` renders in this order:

```tsx
<>
  <a className="astr-skip-link" href="#main-content">跳到主要内容</a>
  <StateAnnouncer />
  <div aria-hidden className="astr-ambient" />
  <div aria-hidden className="astr-grain" />
  {children}
  <VisualMotionToggle />
</>
```

`StateAnnouncer` contains one atomic node outside all busy regions:

```tsx
<div
  className="sr-only"
  role={announcement?.politeness === "assertive" ? "alert" : "status"}
  aria-live={announcement?.politeness === "assertive" ? "assertive" : "polite"}
  aria-atomic="true"
>
  {announcement?.message ?? ""}
</div>
```

`VisualMotionToggle` initializes from localStorage in a scheduled effect, dispatches `VISUAL_PAUSE` or `VISUAL_RESUME`, keeps `<html data-visual-motion>` synchronized, and uses the invariant labels `暂停视觉动态` / `恢复视觉动态`. It must not hide content or disable application behavior.

- [ ] **Step 4: Integrate the shell and CSS behavior**

Wrap `children` with `<AppShell>` inside `ThemeProvider` and remove the duplicated ambient/grain nodes from `layout.tsx`. Add `id="main-content"` to the current Presence and Admin primary `<main>`/root content region.

Add:

```css
.astr-skip-link {
  position: fixed;
  inset: 12px auto auto 12px;
  z-index: var(--z-modal);
  transform: translateY(-180%);
}
.astr-skip-link:focus { transform: translateY(0); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

[data-visual-motion="paused"] *,
[data-visual-motion="paused"] *::before,
[data-visual-motion="paused"] *::after {
  animation-play-state: paused !important;
  scroll-behavior: auto !important;
}
```

The toggle itself uses `min-width` and `min-height: var(--touch-target)` and remains keyboard operable.

- [ ] **Step 5: Verify shell behavior and all routes**

Run:

```powershell
npm run test:run -- src/components/system/AppShell.test.tsx
npm run lint
npm run typecheck
npm run build
```

Expected: AppShell tests pass and `/` plus `/admin` build successfully.

- [ ] **Step 6: Commit**

```powershell
git add webapp/src/components/system webapp/src/app/layout.tsx webapp/src/app/page.tsx webapp/src/app/admin/page.tsx webapp/src/app/globals.css
git commit -m "feat: add accessible ASTR application shell"
```

---

### Task 6: Browser Runtime Bridge and Foundation Acceptance

**Files:**
- Create: `webapp/src/components/system/SemanticRuntimeBridge.tsx`
- Create: `webapp/src/components/system/SemanticRuntimeBridge.test.tsx`
- Modify: `webapp/src/components/system/AppShell.tsx`
- Create: `webapp/src/lib/runtime-metrics.ts`
- Create: `webapp/src/lib/runtime-metrics.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `document.visibilityState`, reduced-motion media query, semantic store, and browser Performance API.
- Produces: truthful Visibility/Motion transitions and opt-in runtime metric hooks without owning a renderer or animation loop.

- [ ] **Step 1: Write failing browser synchronization tests**

Tests must prove:

- hidden dispatches `DOCUMENT_HIDDEN` and visible dispatches `DOCUMENT_VISIBLE`;
- reduced-motion changes dispatch `REDUCE_ON`/`REDUCE_OFF` unless the explicit persistent pause is active;
- listeners are removed on unmount;
- no `requestAnimationFrame` loop is created;
- `recordRuntimeMetric("app-raf", 0)` retains only the latest bounded sample set and `readRuntimeMetrics()` returns a frozen copy.

- [ ] **Step 2: Run tests and verify missing modules**

Run:

```powershell
npm run test:run -- src/components/system/SemanticRuntimeBridge.test.tsx src/lib/runtime-metrics.test.ts
```

Expected: FAIL because bridge and metric modules do not exist.

- [ ] **Step 3: Implement the runtime bridge**

`SemanticRuntimeBridge` is a renderless client component. It registers exactly one `visibilitychange` listener and one `(prefers-reduced-motion: reduce)` change listener, dispatches current values after listener registration, and removes both listeners on cleanup. It never calls RAF, creates Canvas, or imports Pixi.

Render it once inside `AppShell` before route children.

- [ ] **Step 4: Implement bounded instrumentation hooks**

`runtime-metrics.ts` exports:

```ts
export type RuntimeMetricName = "app-raf" | "webgl-context" | "draw-calls" | "gpu-memory-mib" | "decoded-texture-mib";
export interface RuntimeMetric { name: RuntimeMetricName; value: number; at: number; }
export function recordRuntimeMetric(name: RuntimeMetricName, value: number, at?: number): void;
export function readRuntimeMetrics(): readonly RuntimeMetric[];
export function clearRuntimeMetrics(): void;
```

Keep at most 100 samples in module memory, reject non-finite or negative values, and make `readRuntimeMetrics` return `Object.freeze([...samples])`. Do not send telemetry or write persistent storage.

- [ ] **Step 5: Create the durable local progress boundary**

Append `.superpowers/` to the root `.gitignore`. Create `.superpowers/sdd/progress.md` locally after the ignore rule is active; it remains untracked and records each reviewed task commit range.

- [ ] **Step 6: Run the complete Foundation acceptance suite**

Run:

```powershell
cd D:\ASTR_System\astr\webapp
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run build
```

Expected: all tests pass; coverage report is generated; lint/typecheck/build all exit 0; route table still contains `/` and `/admin`; no new route or backend contract is introduced.

- [ ] **Step 7: Commit**

```powershell
git add .gitignore webapp/src/components/system/SemanticRuntimeBridge.tsx webapp/src/components/system/SemanticRuntimeBridge.test.tsx webapp/src/components/system/AppShell.tsx webapp/src/lib/runtime-metrics.ts webapp/src/lib/runtime-metrics.test.ts
git commit -m "feat: synchronize browser runtime state"
```

## Self-Review Record

- Spec coverage: Foundation tokens, AppShell, skip links, StateAnnouncer, semantic regions, runtime/lease interfaces, pause/reduced/hidden behavior, instrumentation hooks, tests, and unchanged Core boundaries each map to a task.
- Scope boundary: Presence networking, S-shaped composition, Live2D/Pixi lifecycle, Studio, Control IA, Mobile five-domain shell, and Secure Dispatch remain in their own workstream plans.
- Type consistency: `SemanticState`, `SemanticEvent`, `SemanticStoreState`, Jewel owner/mode, and runtime metric names are defined once and consumed by later tasks.
- Placeholder scan: the plan contains no unresolved implementation markers; every test and command has an expected result.
- Pre-flight conflict scan: no task contradicts the Global Constraints. Existing lint refactors preserve current behavior, while the one misleading voiceprint sentence is deliberately corrected to match the real backend path.
