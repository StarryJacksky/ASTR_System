# ASTR Mobile 五域壳层实施路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **路线图边界：** 本文件冻结全局顺序、边界与最终验收，不直接授权编写产品代码。每个 Task 开始前必须创建一份同目录、符合 `writing-plans` 的可复制微型 Implementation Plan；实现者只执行该微型计划。这样让每个子系统独立可审、可测、可提交，同时保留本文件的全局完成审计。

**Goal:** 建立星枢 Mobile 的五个稳定路由、唯一底部导航、双证据本机 authority 门禁、本地任务草稿、可信 Presence 投影、Workbench/Knowledge 能力门与 GET-only Safety 投影；不修改后端，不伪造 Secure Dispatch、远程设备、Studio 或 Knowledge 数据。

**Architecture:** Server Component 只把 Core target 是否为 loopback 的 boolean 交给 Mobile；客户端再核验浏览器 hostname。只有两份证据同时通过，Presence 与 Safety 的 trusted 子组件才挂载。五域保持独立 route chunk；域注册表只含元数据。Tasks 只在当前 route mount 编辑，显式点击后才写 localStorage。Safety 使用独立 GET-only client 与三通道 external-store controller，不复用含 mutation 的 Control client。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、CSS Modules、Vitest/Testing Library、Playwright/axe、现有 Core rewrite 与 mock Core。

**实施基线：** 本计划提交后的 HEAD 是 `MOBILE_W4_BASELINE`。开始 Task 1 前把精确 SHA 写入 `.superpowers/sdd/progress.md`；最终所有“后端未变”与 scope 检查都使用 `MOBILE_W4_BASELINE..HEAD`，不能只检查 working tree。

**命令约定：** 所有 `npm`、`npx`、`rg` 命令都以 `D:\ASTR_System\astr\webapp` 为 tool workdir；所有 `git` 命令都以 `D:\ASTR_System\astr` 为 workdir。Windows PowerShell 5.1 下每条命令单独执行，禁止使用 `&&`。

## 全局约束

- 产品名为星枢 / ASTR；主色只用黑蓝、靛蓝、冷紫、银白与冷瓷，禁绿。
- Mobile 采用“星蚀顶标 × 中继桅杆 × 底部五域龙骨”，不是桌面页面缩窄版，也不是卡片/Bento/HUD 堆叠。
- Mobile 源码 0 gradient、0 glass/backdrop-filter、0 continuous CSS animation、0 route-owned RAF、0 Canvas/WebGL、0 Pixi/Live2D/Three/framer-motion。
- 只允许 `/mobile/presence|tasks|workbench|knowledge|safety` 五个域；`/mobile` 只重定向 Presence。
- `checking` / remote context 不挂载 Presence owner 或 Safety client，不渲染/预取“返回 Presence”或 Control 链接。
- `ASTR_CORE_URL` 与 `NEXT_PUBLIC_ASTR_CORE` 任一非 loopback 时 fail closed；私有 `ASTR_CORE_URL` 不进入客户端，authority context/RSC 只传 boolean 且不重新序列化任一目标。`NEXT_PUBLIC_ASTR_CORE` 是既有 W1 明确公开的 transport config，可能由 Next 编入 Presence client bundle，但不能由 Mobile authority 再暴露为 UI/context 数据。
- Workbench/Knowledge 只显示 capability unavailable；Tasks 不产生任何网络请求；Safety 只允许三个 GET。
- 不修改 `src/astr/**`、`tests/**`、Python 依赖、Core 路由或后端响应。
- 每页恰好一个 `main#main-content` 与一个 h1；44×44 目标、8px 间距、320px/400% reflow、WCAG 2.2 AA。
- 各提交只 stage 本任务文件；保留用户和其他工作流的改动。

---

### Task 0：冻结并验证实施基线

- [ ] 提交本计划后，在 repo root 原子解析、校验并写入精确 SHA：

```powershell
$baseline = (git rev-parse HEAD).Trim()
if ($baseline -notmatch '^[0-9a-f]{40}$') { throw 'Invalid HEAD SHA' }
git cat-file -e "$baseline^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Invalid Mobile W4 baseline' }
Add-Content -Path .superpowers/sdd/progress.md -Value "Mobile W4 baseline: $baseline"
```

- [ ] 立即从 durable ledger 重新读取并验证（不依赖上一个 shell 的变量）：

```powershell
$match = Select-String -Path .superpowers/sdd/progress.md -Pattern '^Mobile W4 baseline: ([0-9a-f]{40})$' | Select-Object -Last 1
if ($null -eq $match) { throw 'Missing Mobile W4 baseline' }
$baseline = $match.Matches[0].Groups[1].Value
git cat-file -e "$baseline^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Invalid Mobile W4 baseline' }
```

Expected: `$baseline` is the plan commit and `git cat-file` exits 0. All later range checks re-run this exact resolution block.

---

### Task 1：双证据 Mobile Authority Gate

**文件：**

- Create: `webapp/src/features/mobile/authority/loopback-authority.ts`
- Create: `webapp/src/features/mobile/authority/loopback-authority.test.ts`
- Create: `webapp/src/features/mobile/authority/MobileAuthorityProvider.tsx`
- Create: `webapp/src/features/mobile/authority/MobileAuthorityProvider.test.tsx`

**Interfaces：**

```ts
export type MobileAuthorityPhase =
  | "checking"
  | "trusted-local"
  | "unavailable-remote-context";

export interface MobileServerAuthorityInput {
  readonly coreUrl?: string;
  readonly publicCoreUrl?: string;
}

export function isAllowedLoopbackHostname(hostname: string): boolean;
export function isAllowedLoopbackHttpUrl(value: string): boolean;
export function assessMobileServerAuthority(input: MobileServerAuthorityInput): boolean;
export function useMobileAuthority(): MobileAuthorityPhase;
```

- Produces: a non-sensitive server boolean and client phase.
- Consumed by: `app/mobile/layout.tsx`, `MobileShell`, Presence gate, Safety gate.
- Must not consume: fetch, router, Core client, query, cookie, storage or headers.

- [ ] **Step 1 — hostname 与 URL RED（2–5 分钟）**

Create table-driven tests with exact values:

```ts
it.each(["localhost", "127.0.0.1", "[::1]", "::1"])("accepts %s", (value) => {
  expect(isAllowedLoopbackHostname(value)).toBe(true);
});

it.each(["192.168.1.8", "astr.local", "localhost.evil.test", "127.0.0.1.evil", ""])(
  "rejects %s",
  (value) => expect(isAllowedLoopbackHostname(value)).toBe(false),
);
```

Also assert only credential-free HTTP(S) loopback URLs pass and either remote target makes `assessMobileServerAuthority()` false.

- [ ] **Step 2 — run RED**

Run: `npm test -- --run src/features/mobile/authority/loopback-authority.test.ts`
Expected: FAIL because `loopback-authority.ts` does not exist.

- [ ] **Step 3 — implement pure authority functions**

Create `loopback-authority.ts` with this complete implementation:

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

This does not resolve DNS and does not accept all `127/8`; the allowlist is exact.

- [ ] **Step 4 — Provider SSR/hydration RED**

Use isolated tests and containers. `renderToString` proves the pre-effect server state without RTL flushing effects:

```tsx
expect(renderToString(
  <MobileAuthorityProvider serverAuthorityTrusted><Probe /></MobileAuthorityProvider>,
)).toContain("checking");
expect(renderToString(
  <MobileAuthorityProvider serverAuthorityTrusted={false}><Probe /></MobileAuthorityProvider>,
)).toContain("unavailable-remote-context");
```

Then put the trusted SSR string in a fresh container, call `hydrateRoot`, and `waitFor` trusted-local. Use another fresh container/server-false case for remote. Always unmount roots. Add a pure browser-host negative test rather than mutating query/cookie/storage.

- [ ] **Step 5 — run Provider RED, then implement**

Run: `npm test -- --run src/features/mobile/authority/MobileAuthorityProvider.test.tsx`
Expected: FAIL because Provider is missing.

Create `MobileAuthorityProvider.tsx` exactly as follows:

```tsx
"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

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
      serverAuthorityTrusted &&
      isAllowedLoopbackHostname(window.location.hostname)
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

Task 4/7 checking-owner tests use `renderToString`, where effects cannot flush, then separately hydrate the trusted case.

- [ ] **Step 6 — focused GREEN and static verification**

Run: `npm test -- --run src/features/mobile/authority`
Expected: all authority tests PASS.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7 — stage exact files and commit**

```text
git add webapp/src/features/mobile/authority/loopback-authority.ts webapp/src/features/mobile/authority/loopback-authority.test.ts webapp/src/features/mobile/authority/MobileAuthorityProvider.tsx webapp/src/features/mobile/authority/MobileAuthorityProvider.test.tsx
git commit -m "feat: add Mobile local authority gate"
```

---

### Task 2：五域注册表、Shell 与唯一导航

**文件：**

- Create: `webapp/src/features/mobile/model/mobile-domains.ts`
- Create: `webapp/src/features/mobile/model/mobile-domains.test.ts`
- Create: `webapp/src/features/mobile/shell/MobileShell.tsx`
- Create: `webapp/src/features/mobile/shell/MobileShell.test.tsx`
- Create: `webapp/src/features/mobile/shell/MobileHeader.tsx`
- Create: `webapp/src/features/mobile/shell/FiveDomainNav.tsx`
- Create: `webapp/src/features/mobile/shell/MobileShell.module.css`
- Modify: `webapp/src/app/globals.css`
- Modify: `webapp/src/app/layout.tsx`
- Create: `webapp/src/app/layout.test.ts`
- Modify: `webapp/src/components/system/AppShell.test.tsx`

**Interfaces：**

```ts
export type MobileDomainId = "presence" | "tasks" | "workbench" | "knowledge" | "safety";
export type MobileDomainHref = `/mobile/${MobileDomainId}`;
export interface MobileDomainDefinition {
  readonly id: MobileDomainId;
  readonly href: MobileDomainHref;
  readonly label: string;
  readonly index: string;
  readonly status: "local-available" | "local-only" | "unavailable" | "local-read-only";
}
export const MOBILE_DOMAINS: readonly MobileDomainDefinition[];
export function getMobileDomainByPath(pathname: string): MobileDomainDefinition;
```

- `MobileShell` consumes metadata and Task 1 phase, owns header/main/nav, and owns zero domain I/O.
- `FiveDomainNav` consumes only registry + current pathname.
- Domain pages own the sole h1; Shell owns the sole `main#main-content`.

- [ ] **Step 1 — registry RED**

Assert exact ordered IDs and hrefs, unique values, and exact statuses. Read the registry source in one test and assert it contains no `components/`, `data/`, `controller/`, `fetch`, or dynamic import.

Run: `npm test -- --run src/features/mobile/model/mobile-domains.test.ts`
Expected: FAIL because registry is missing.

- [ ] **Step 2 — implement registry and rerun**

Create `mobile-domains.ts`:

```ts
export type MobileDomainId = "presence" | "tasks" | "workbench" | "knowledge" | "safety";
export type MobileDomainHref = `/mobile/${MobileDomainId}`;
export type MobileDomainStatus = "local-available" | "local-only" | "unavailable" | "local-read-only";
export interface MobileDomainDefinition {
  readonly id: MobileDomainId;
  readonly href: MobileDomainHref;
  readonly label: string;
  readonly index: string;
  readonly status: MobileDomainStatus;
}

const domains = [
  { id: "presence", href: "/mobile/presence", label: "露怀秋", index: "01", status: "local-available" },
  { id: "tasks", href: "/mobile/tasks", label: "任务", index: "02", status: "local-only" },
  { id: "workbench", href: "/mobile/workbench", label: "AI 工作台", index: "03", status: "unavailable" },
  { id: "knowledge", href: "/mobile/knowledge", label: "知识", index: "04", status: "unavailable" },
  { id: "safety", href: "/mobile/safety", label: "设备与安全", index: "05", status: "local-read-only" },
] as const satisfies readonly MobileDomainDefinition[];

export const MOBILE_DOMAINS: readonly MobileDomainDefinition[] = Object.freeze(domains);
export function getMobileDomainByPath(pathname: string): MobileDomainDefinition {
  return MOBILE_DOMAINS.find(({ href }) => href === pathname) ?? MOBILE_DOMAINS[0];
}
```

This treats `/mobile` as Presence metadata without performing a redirect.

Run: `npm test -- --run src/features/mobile/model/mobile-domains.test.ts`
Expected: PASS.

- [ ] **Step 3 — Shell/Nav RED**

Mock `next/navigation` pathname and Task 1 context. Tests assert:

```tsx
expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
expect(screen.getByRole("navigation", { name: "Mobile 五域" }).querySelectorAll("a"))
  .toHaveLength(5);
expect(screen.getByRole("link", { name: /任务/ })).toHaveAttribute("aria-current", "page");
```

For phase checking/remote, query for `返回 Presence` must be null. For trusted, it exists with `href="/"`; mock `next/link` and assert `prefetch={false}` was passed. Also assert one Theme toggle and one Motion route slot.

Run: `npm test -- --run src/features/mobile/shell/MobileShell.test.tsx`
Expected: FAIL because Shell files are missing.

- [ ] **Step 4 — implement semantic shell**

Create `FiveDomainNav.tsx`:

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
            <span aria-hidden="true">{domain.index}</span>
            <span>{domain.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

Create `MobileHeader.tsx`:

```tsx
import Link from "next/link";
import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
import type { MobileAuthorityPhase } from "../authority/loopback-authority";
import type { MobileDomainDefinition } from "../model/mobile-domains";
import styles from "./MobileShell.module.css";

export function MobileHeader({ domain, authority }: {
  readonly domain: MobileDomainDefinition;
  readonly authority: MobileAuthorityPhase;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brandRail}>
        <div aria-hidden="true" className={styles.eclipse} />
        <div><p className={styles.brand}>星枢 ASTR</p><p className={styles.domainName}>{domain.label}</p></div>
      </div>
      <div className={styles.localFact}>
        {authority === "trusted-local" ? "本机可信入口" : authority === "checking" ? "核验本机来源" : "远程来源未授权"}
      </div>
      <div className={styles.headerActions}>
        <ThemeToggle />
        <VisualMotionRouteSlot className={styles.motionSlot} />
        {authority === "trusted-local" && <Link href="/" prefetch={false}>返回 Presence</Link>}
      </div>
    </header>
  );
}
```

Create `MobileShell.tsx`:

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
      <div aria-hidden="true" className={styles.relayMast} />
      <main className={styles.main} id="main-content">{children}</main>
      <FiveDomainNav pathname={pathname} />
    </div>
  );
}
```

These files import no domain component or business client.

- [ ] **Step 5 — CSS/Viewport RED**

Extend `AppShell.test.tsx` or add static source assertions for:

```css
body:has([data-route-surface="mobile"]) .astr-ambient,
body:has([data-route-surface="mobile"]) .astr-grain {
  display: none;
  animation: none;
  background: none;
}
```

Define `--mobile-nav-block-size`. Assert Mobile CSS contains `min-height:100dvh`; Header top padding owns `env(safe-area-inset-top)`; bottom nav padding owns `env(safe-area-inset-bottom)`; main has both `padding-bottom` and `scroll-padding-bottom` equal to nav height + bottom inset + positive clearance; targets are ≥44px with ≥8px gap. Assert desktop uses the same DOM/IA with a controlled max-width and contains no fake phone frame/media-query replacement. Also reject `gradient`, `backdrop-filter`, `@keyframes`, `animation-name`, any `animation` declaration whose value is not `none`, green literals and Canvas/RAF tokens. The required global `animation:none` suppression is explicitly valid. In `layout.test.ts`, read the source and assert the exported viewport contains `width:"device-width"`, `initialScale:1`, `viewportFit:"cover"` and contains no scale lock; this avoids executing Next font loaders in Vitest.

Run: `npm test -- --run src/features/mobile/shell src/components/system/AppShell.test.tsx src/app/layout.test.ts`
Expected: FAIL until CSS and viewport are implemented.

- [ ] **Step 6 — implement visual shell and first-paint suppression**

Create the structural CSS with these complete ownership rules, then add domain-specific typography without changing them:

```css
.shell { --mobile-nav-block-size: 5.25rem; min-height: 100dvh; color: var(--astr-text); background: var(--astr-bg); }
.header { padding: calc(1rem + env(safe-area-inset-top)) max(1rem, 4vw) 1rem; display: grid; grid-template-columns: 1fr auto; gap: 1rem; border-bottom: 1px solid var(--astr-hairline); }
.brandRail { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.eclipse { inline-size: 2.75rem; block-size: 2.75rem; border: 1px solid var(--astr-accent); border-radius: 50%; clip-path: polygon(0 0, 72% 0, 88% 24%, 100% 35%, 100% 100%, 0 100%); }
.brand,.domainName,.localFact { margin: 0; }
.domainName { overflow-wrap: anywhere; }
.headerActions { display: flex; align-items: center; justify-content: flex-end; gap: .5rem; }
.headerActions a,.domainLink { min-inline-size: 44px; min-block-size: 44px; }
.motionSlot { display: inline-flex; }
.motionSlot :global(.astr-motion-toggle) { position: static; inset: auto; z-index: auto; min-inline-size: 44px; min-block-size: 44px; }
.relayMast { position: fixed; inset-block: 0 var(--mobile-nav-block-size); inset-inline-start: max(.55rem, env(safe-area-inset-left)); border-inline-start: 1px solid var(--astr-hairline); pointer-events: none; }
.main { width: min(100%, 76rem); margin-inline: auto; padding: clamp(1rem, 4vw, 3rem); padding-bottom: calc(var(--mobile-nav-block-size) + env(safe-area-inset-bottom) + 1.5rem); scroll-padding-bottom: calc(var(--mobile-nav-block-size) + env(safe-area-inset-bottom) + 1.5rem); }
.domainNav { position: fixed; z-index: 20; inset-inline: 0; inset-block-end: 0; min-block-size: var(--mobile-nav-block-size); padding: .5rem max(.5rem, env(safe-area-inset-right)) calc(.5rem + env(safe-area-inset-bottom)) max(.5rem, env(safe-area-inset-left)); display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 8px; background: var(--astr-surface); border-top: 1px solid var(--astr-hairline); }
.domainLink { display: grid; place-content: center; gap: .1rem; color: var(--astr-text-2); text-align: center; text-decoration: none; border-top: 1px solid transparent; }
.domainLink[data-current="true"] { color: var(--astr-accent); border-top-color: currentColor; }
@media (max-width: 42rem) { .header { grid-template-columns: 1fr; } .headerActions { justify-content: flex-start; flex-wrap: wrap; } .domainLink { font-size: .72rem; } }
```

Use the repository's actual token names when implementing; do not introduce aliases that do not exist. Add this exact global override:

```css
body:has([data-route-surface="mobile"]) .astr-ambient,
body:has([data-route-surface="mobile"]) .astr-grain {
  display: none;
  animation: none;
  background: none;
}
```

In root layout import `Viewport` with `Metadata` and export:

```ts
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
```

- [ ] **Step 7 — focused GREEN, lint and typecheck**

Run: `npm test -- --run src/features/mobile/model src/features/mobile/shell src/components/system/AppShell.test.tsx src/app/layout.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8 — stage exact files and commit**

```text
git add webapp/src/features/mobile/model/mobile-domains.ts webapp/src/features/mobile/model/mobile-domains.test.ts webapp/src/features/mobile/shell/MobileShell.tsx webapp/src/features/mobile/shell/MobileShell.test.tsx webapp/src/features/mobile/shell/MobileHeader.tsx webapp/src/features/mobile/shell/FiveDomainNav.tsx webapp/src/features/mobile/shell/MobileShell.module.css webapp/src/app/globals.css webapp/src/app/layout.tsx webapp/src/app/layout.test.ts webapp/src/components/system/AppShell.test.tsx
git commit -m "feat: establish Mobile sovereign relay shell"
```

---

### Task 3：显式、严格、浏览器本地的任务草稿

**文件：**

- Create: `webapp/src/features/mobile/tasks/local-task-draft.ts`
- Create: `webapp/src/features/mobile/tasks/local-task-draft.test.ts`
- Create: `webapp/src/features/mobile/tasks/local-task-draft-storage.ts`
- Create: `webapp/src/features/mobile/tasks/local-task-draft-storage.test.ts`
- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.tsx`
- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx`
- Create: `webapp/src/features/mobile/tasks/LocalTaskDraftRegion.module.css`

**Interfaces：**

```ts
export const LOCAL_TASK_DRAFT_STORAGE_KEY = "astr.mobile.task-drafts.v1";
export const LOCAL_TASK_DRAFT_LIMIT = 12;
export const LOCAL_TASK_DRAFT_TEXT_LIMIT = 4_000;
export interface LocalTaskDraft {
  readonly schema_version: 1;
  readonly draft_id: `local_draft_${string}`;
  readonly text: string;
  readonly created_at: string;
  readonly updated_at: string;
}
export type LocalDraftReadResult =
  | { readonly ok: true; readonly drafts: readonly LocalTaskDraft[] }
  | { readonly ok: false; readonly drafts: readonly []; readonly reason: "unavailable" | "malformed" };
export interface LocalTaskDraftStorage {
  readonly read: () => LocalDraftReadResult;
  readonly write: (drafts: readonly LocalTaskDraft[]) => boolean;
}
export interface LocalTaskDraftRegionProps {
  readonly storage?: LocalTaskDraftStorage;
  readonly now?: () => Date;
  readonly createId?: () => string;
}
export function decodeLocalTaskDrafts(value: unknown): LocalDraftReadResult;
export function createLocalTaskDraftStorage(storage: Storage): LocalTaskDraftStorage;
```

- [ ] **Step 1 — strict model RED**

Write table tests for valid frozen records and each rejection class. Include this hostile case and a duplicate-ID case. Model-level decoding must also reject a 13-record array and text that is empty, whitespace-only or 4001 characters; the storage adapter must refuse invalid records without calling `setItem`, so hand-edited localStorage cannot bypass UI limits:

```ts
expect(decodeLocalTaskDrafts(JSON.parse('[{"__proto__":{},"schema_version":1}]'))).toEqual({
  ok: false, drafts: [], reason: "malformed",
});
expect(decodeLocalTaskDrafts([VALID_DRAFT, { ...VALID_DRAFT }]).ok).toBe(false);
```

Require canonical ISO strings by checking `new Date(value).toISOString() === value`; require `created_at <= updated_at`; reject extra keys and any key named `__proto__`, `prototype`, or `constructor`.

- [ ] **Step 2 — run model RED, implement, rerun GREEN**

Run: `npm test -- --run src/features/mobile/tasks/local-task-draft.test.ts`
Expected: FAIL because model is missing.

Implement exact validation, copy into null-prototype records, freeze each record and the result array, then rerun the same command; expected PASS.

- [ ] **Step 3 — storage adapter RED**

Use a fake `Storage` and assert `read()` distinguishes missing/valid/malformed/unavailable, while `write()` calls `setItem` once with the exact versioned array and returns false on exceptions. The adapter never calls network APIs.

Run: `npm test -- --run src/features/mobile/tasks/local-task-draft-storage.test.ts`
Expected: FAIL because adapter is missing.

- [ ] **Step 4 — implement storage adapter and rerun GREEN**

The adapter accepts an injected `Storage`, does not capture `window.localStorage` during module evaluation, and serializes only validated records. Run the focused storage test; expected PASS.

- [ ] **Step 5 — component interaction RED**

Testing Library cases must assert:

```tsx
await user.type(screen.getByRole("textbox", { name: "本地任务草稿" }), "整理今天的记录");
expect(storage.setItem).not.toHaveBeenCalled();
await user.click(screen.getByRole("button", { name: "保存到此浏览器" }));
expect(storage.setItem).toHaveBeenCalledTimes(1);
expect(screen.getByText(/未发送.*不会执行/)).toBeVisible();
```

Also cover explicit restore/edit/delete, 12/4000 limits, blank text, IME/Enter-as-newline, unmount/remount loss of unsaved text, and a write throw that leaves textarea text intact with `未持久化`. Inject both `read: unavailable` and `read: malformed`; in each case type before the read-result publication, assert the editor value remains intact, no list is invented, and the visible persistence state becomes `未持久化`. Editing a saved draft and saving again must preserve `draft_id`/`created_at`, update only text/`updated_at`, and keep array length unchanged. At 12 records, updating an existing draft is allowed; a 13th new record is rejected before any storage write. A delete write failure keeps the list item and editor value visible. Require the visible privacy copy `本机浏览器存储，未加密，请勿写入凭据` and assert `navigator.clipboard.readText/writeText` are never called.

Run: `npm test -- --run src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx`
Expected: FAIL because component is missing.

- [ ] **Step 6 — implement local-only region**

Use component-local state only. Generate `local_draft_${crypto.randomUUID()}` and timestamps only after explicit save; inject ID/time/storage factories in tests. Persist first, then publish saved state. Deletion uses read-modify-write and only updates UI after a successful write. The region owns the route's sole h1 and renders these five exact lines: `目标设备：未绑定`, `状态：本地草稿`, `风险：尚未由 Guard 评估`, `下一动作：继续编辑`, `说明：未发送；不会在电脑执行`. Render the exact unencrypted-storage warning and Dispatch unavailable explanation, with no disabled fake action and no clipboard access.

- [ ] **Step 7 — focused GREEN and source boundary**

Run: `npm test -- --run src/features/mobile/tasks`
Expected: all Task tests PASS.
Run: `rg -n "fetch\(|navigator\.clipboard|/v1/tasks|/v1/devices|queued|running|completed" src/features/mobile/tasks --glob '!*.test.*'`
Expected: `rg` exit 1 (no production matches); tests are intentionally excluded.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8 — stage exact files and commit**

```text
git add webapp/src/features/mobile/tasks/local-task-draft.ts webapp/src/features/mobile/tasks/local-task-draft.test.ts webapp/src/features/mobile/tasks/local-task-draft-storage.ts webapp/src/features/mobile/tasks/local-task-draft-storage.test.ts webapp/src/features/mobile/tasks/LocalTaskDraftRegion.tsx webapp/src/features/mobile/tasks/LocalTaskDraftRegion.test.tsx webapp/src/features/mobile/tasks/LocalTaskDraftRegion.module.css
git commit -m "feat: add explicit browser-local Mobile drafts"
```

---

### Task 4：可信 Presence Mobile 投影

**文件：**

- Create: `webapp/src/features/mobile/presence/MobilePresenceDomain.tsx`
- Create: `webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx`
- Create: `webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx`
- Create: `webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx`
- Create: `webapp/src/features/mobile/presence/MobilePresenceDomain.module.css`
- Modify: `webapp/src/features/presence/components/Composer.module.css`
- Modify: `webapp/src/features/presence/components/Composer.test.tsx`
- Modify: `webapp/src/features/presence/PresenceExperience.module.css`
- Modify: `webapp/src/features/presence/PresenceExperience.test.tsx`

**Interfaces：**

```tsx
export interface MobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner; // test seam, forwarded only after trust
}
export function MobilePresenceDomain(props: MobilePresenceDomainProps): ReactNode;
export function TrustedMobilePresenceDomain(props: {
  readonly owner?: PresenceControllerOwner;
}): ReactNode;
```

- Consumes: Task 1 phase and existing W1 `usePresenceController(owner)`.
- Reuses: `MessageTimeline`, `projectConversationTimeline`, `Composer`, `StaticSoulLens`.
- Must not import: `PresenceExperience`, `SoulPresence`, `PresenceVisualHost`, Jewel/Pixi/Live2D modules.

- Shared-skin rule: Mobile may reuse the existing `Composer` behavior and markup, but its route-owned CSS chunk must contain no gradient. Move the two current Composer gradient values behind inherited custom properties: `Composer.module.css` owns only solid fallbacks, while `PresenceExperience.module.css` supplies the existing Presence-only values. Mobile does not import `PresenceExperience.module.css`, so its Composer resolves to the solid fallback without changing W1 geometry or behavior.

- [ ] **Step 1 — authority mount RED**

Build a fake `PresenceControllerOwner` whose `subscribe` is a spy. Prove checking with `renderToString` under `serverAuthorityTrusted=true`, so no hydration effect can advance the phase; assert the HTML contains the checking gate and `owner.subscribe` is zero. Prove remote with an isolated `serverAuthorityTrusted=false` render. Hydrate a fresh trusted container separately and only then wait for the subscription:

```tsx
renderMobilePresence({ serverAuthorityTrusted: false, owner });
expect(owner.subscribe).not.toHaveBeenCalled();
expect(screen.getByText(/未连接 Core/)).toBeVisible();
expect(screen.queryByRole("textbox", { name: "消息输入" })).toBeNull();
```

For checking, assert the same non-mount behavior. For trusted, wait for hydration and expect one active subscription. Remote must have no voice/retry/message facts or links to `/` and `/admin`.

Run: `npm test -- --run src/features/mobile/presence/MobilePresenceDomain.test.tsx`
Expected: FAIL because domain is missing.

- [ ] **Step 2 — implement outer gate only**

Render the route h1 and static gate in the outer component. Render `<TrustedMobilePresenceDomain owner={owner} />` only in the trusted branch. Do not call a controller hook in the outer component.

- [ ] **Step 3 — trusted projection RED**

Use an immutable fake W1 snapshot with display name, activity, distinct Core/Reply/Life states, one settled message and a draft. Assert the trusted component renders all facts, the message timeline, and existing Composer. Assert the Mobile domain/timeline contributes zero `[aria-live]` nodes; the sole live region remains the global AppShell `StateAnnouncer`. Repeat without display name and assert the internal handle never appears as a person label.

Assert the DOM/source has no emergency controls, Task/Dispatch copy, device rows, Canvas, Live2D or runtime owner imports.

Run: `npm test -- --run src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx`
Expected: FAIL because trusted component is missing.

- [ ] **Step 3a — shared Composer skin RED（2–5 分钟）**

Extend `Composer.test.tsx` to read `Composer.module.css` and assert it contains `var(--astr-composer-surface,` and `var(--astr-composer-accent-line,`, but contains no `gradient`. Extend `PresenceExperience.test.tsx` to assert `PresenceExperience.module.css` owns both custom-property declarations. Run the two focused tests; expected RED until the declarations move.

- [ ] **Step 3b — isolate the Presence-only gradient values（2–5 分钟）**

Replace the two declarations in `Composer.module.css` with:

```css
background: var(
  --astr-composer-surface,
  color-mix(in srgb, var(--astr-surface) 92%, var(--astr-bg))
);
/* composer::before */
background: var(--astr-composer-accent-line, var(--astr-action));
```

Add the old layered background and accent-line values as `--astr-composer-surface` and `--astr-composer-accent-line` on the existing `.dialogueSurface` rule in `PresenceExperience.module.css`. Rerun the two focused tests; expected GREEN. Do not add a Mobile override: the solid fallback is the Mobile result.

- [ ] **Step 4 — implement trusted projection**

Call `usePresenceController(owner)`, project messages with `projectConversationTimeline`, pass the existing snapshot/action subsets to Composer, and render terse local status facts. Use `status.displayName?.trim()` only; activity missing gets explicit “Core 未提供” copy. Add one aria-hidden static S path and `StaticSoulLens`; do not install a visual runtime. Because `StaticSoulLens` emits unstyled global child classes, `MobilePresenceDomain.module.css` must explicitly style `.lensOuter/.lensContinuity/.lensShell/.lensNotch/.lensAxis` with `fill:none` and static strokes, `.lensFacet` with an opaque `--astr-surface-2` fill, and `.lensCore` with `--astr-soul`; it must not import `SoulPresence.module.css`, add filter/glow, or leave SVG default fill active.

- [ ] **Step 5 — focused GREEN and dependency scan**

Run: `npm test -- --run src/features/mobile/presence`
Expected: all Mobile Presence tests PASS.
Run: `rg -n "PresenceExperience|SoulPresence|PresenceVisualHost|pixi|live2d|JewelRuntime|canvas|getContext|requestAnimationFrame" src/features/mobile/presence --glob '!*.test.*'`
Expected: `rg` exit 1 (no production matches); tests are intentionally excluded.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6 — stage exact files and commit**

```text
git add webapp/src/features/mobile/presence/MobilePresenceDomain.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.module.css webapp/src/features/presence/components/Composer.module.css webapp/src/features/presence/components/Composer.test.tsx webapp/src/features/presence/PresenceExperience.module.css webapp/src/features/presence/PresenceExperience.test.tsx
git commit -m "feat: project trusted Presence into Mobile"
```

---

### Task 5：Workbench 与 Knowledge 静态能力门

**文件：**

- Create: `webapp/src/features/mobile/shared/CapabilityGate.tsx`
- Create: `webapp/src/features/mobile/shared/CapabilityGate.module.css`
- Create: `webapp/src/features/mobile/workbench/MobileWorkbenchGate.tsx`
- Create: `webapp/src/features/mobile/workbench/MobileWorkbenchGate.test.tsx`
- Create: `webapp/src/features/mobile/knowledge/MobileKnowledgeGate.tsx`
- Create: `webapp/src/features/mobile/knowledge/MobileKnowledgeGate.test.tsx`

**Interfaces：**

```tsx
export interface CapabilityGateProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly status: string;
  readonly reason: string;
  readonly evidence: string;
  readonly capabilities?: readonly string[];
}
```

The shared component renders one h1 and explanatory text/list; it exposes no button, form or client boundary.

- [ ] **Step 1 — Workbench RED**

Render `MobileWorkbenchGate` and assert the six exact labels `Workspace / Run / Tool / Trace / Source / Artifact`, status `Studio 投影未启用`, missing authority/scopes/read endpoints, and “没有可验证的 Run、模型路由、成本或产物数据”. Assert `queryAllByRole("button")`, textbox, link and form are empty; `$0`, fake counts and success copy are absent.

Run: `npm test -- --run src/features/mobile/workbench/MobileWorkbenchGate.test.tsx`
Expected: FAIL because component is missing.

- [ ] **Step 2 — Knowledge RED**

Assert `MobileKnowledgeGate` says safe read projection is unavailable and has no search/write/delete/import action, memory count, index count, update time, SoulPackage path or chat-history claim.

Run: `npm test -- --run src/features/mobile/knowledge/MobileKnowledgeGate.test.tsx`
Expected: FAIL because component is missing.

- [ ] **Step 3 — implement static gates**

Build Server-safe components with the shared CSS seam. The Workbench capability list is descriptive only; neither gate renders disabled controls. Do not add `"use client"` or any data import.

- [ ] **Step 4 — focused GREEN and import scan**

Run: `npm test -- --run src/features/mobile/workbench src/features/mobile/knowledge`
Expected: both suites PASS.
Run: `rg -n "features/(presence|control)|CoreClient|StudioClient|Memory|fetch\(|use client" src/features/mobile/workbench src/features/mobile/knowledge src/features/mobile/shared --glob '!*.test.*'`
Expected: `rg` exit 1 (no production matches); tests are intentionally excluded.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5 — stage exact files and commit**

```text
git add webapp/src/features/mobile/shared/CapabilityGate.tsx webapp/src/features/mobile/shared/CapabilityGate.module.css webapp/src/features/mobile/workbench/MobileWorkbenchGate.tsx webapp/src/features/mobile/workbench/MobileWorkbenchGate.test.tsx webapp/src/features/mobile/knowledge/MobileKnowledgeGate.tsx webapp/src/features/mobile/knowledge/MobileKnowledgeGate.test.tsx
git commit -m "feat: add truthful Mobile capability gates"
```

---

### Task 6：专用 GET-only Safety Client

**文件：**

- Create: `webapp/src/features/mobile/safety/mobile-safety-types.ts`
- Create: `webapp/src/features/mobile/safety/mobile-safety-client.ts`
- Create: `webapp/src/features/mobile/safety/mobile-safety-client.test.ts`

**Interfaces：**

```ts
export interface MobileLocalStatusProjection {
  readonly stopped: boolean;
  readonly pending_count: number;
  readonly audit_tail_count: number;
}
export interface MobileLocalPolicyProjection {
  readonly approval_mode: "ask" | "audited" | "auto";
  readonly headless_scope: "cwd" | "folders" | "full";
  readonly max_steps_per_task: number;
}
export interface MobileLocalAuditProjection {
  readonly audit_date: string | null;
  readonly audit_total: number | null;
  readonly chain_valid: boolean | null;
}
export interface MobileSafetyClient {
  readonly status: (signal?: AbortSignal) => Promise<MobileLocalStatusProjection>;
  readonly policy: (signal?: AbortSignal) => Promise<MobileLocalPolicyProjection>;
  readonly audit: (signal?: AbortSignal) => Promise<MobileLocalAuditProjection>;
}
```

- [ ] **Step 1 — exact transport RED**

Use an injected fetch spy and valid full backend fixtures. Assert exact calls:

```ts
expect(fetcher).toHaveBeenNthCalledWith(1, "/api/core/v1/effector/status", {
  method: "GET", cache: "no-store", signal,
});
expect(fetcher).toHaveBeenNthCalledWith(2, "/api/core/v1/admin/effector/policy", {
  method: "GET", cache: "no-store", signal,
});
expect(fetcher).toHaveBeenNthCalledWith(3, "/api/core/v1/admin/effector/audit", {
  method: "GET", cache: "no-store", signal,
});
```

Assert the public client has exactly three own methods and serialized fetch init contains no body or mutation verb.

- [ ] **Step 2 — minimal projection RED**

Fixtures must contain raw pending values, audit entries, speaker, cwd/folders/apps/sites/sandbox/overlay. Assert returned objects equal only the three minimal interfaces and are frozen. `total` omitted maps to null; it is never inferred from entries.

- [ ] **Step 3 — hostile/error RED**

For each operation cover network, HTTP, invalid JSON, top-level non-record, hostile getter/proxy, symbol keys, wrong enums, invalid counts and non-finite numbers. Assert the thrown error exposes only `{kind, operation, status?}` plus stable local message and never remote response text.

Run: `npm test -- --run src/features/mobile/safety/mobile-safety-client.test.ts`
Expected: FAIL because client/types are missing.

- [ ] **Step 4 — implement strict GET-only client**

Use a local `requestProjection()` helper and three operation-specific parsers. Catch unusual property access. Count only validated own keys/array length, then immediately discard raw input. Do not import or wrap `features/control/data/effector-client`.

- [ ] **Step 5 — focused GREEN and mutation scan**

Run: `npm test -- --run src/features/mobile/safety/mobile-safety-client.test.ts`
Expected: all client tests PASS.
Run: `rg -n "POST|PUT|patchPolicy|estop|reset|features/control" src/features/mobile/safety/mobile-safety-client.ts src/features/mobile/safety/mobile-safety-types.ts`
Expected: no matches.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6 — stage exact files and commit**

```text
git add webapp/src/features/mobile/safety/mobile-safety-types.ts webapp/src/features/mobile/safety/mobile-safety-client.ts webapp/src/features/mobile/safety/mobile-safety-client.test.ts
git commit -m "feat: add GET-only Mobile safety client"
```

---

### Task 7：Safety 三通道 Controller 与可信 UI

**文件：**

- Create: `webapp/src/features/mobile/safety/create-mobile-safety-controller.ts`
- Create: `webapp/src/features/mobile/safety/create-mobile-safety-controller.test.ts`
- Create: `webapp/src/features/mobile/safety/use-mobile-safety-controller.ts`
- Create: `webapp/src/features/mobile/safety/use-mobile-safety-controller.test.tsx`
- Create: `webapp/src/features/mobile/safety/MobileLocalSafetyDomain.tsx`
- Create: `webapp/src/features/mobile/safety/MobileLocalSafetyDomain.test.tsx`
- Create: `webapp/src/features/mobile/safety/TrustedMobileLocalSafetyDomain.tsx`
- Create: `webapp/src/features/mobile/safety/TrustedMobileLocalSafetyDomain.test.tsx`
- Create: `webapp/src/features/mobile/safety/MobileLocalSafetyDomain.module.css`

**Interfaces：**

```ts
export type MobileChannelSnapshot<T> =
  | { readonly phase: "idle" | "loading"; readonly value: null; readonly error: null; readonly verified_at: null }
  | { readonly phase: "ready"; readonly value: T; readonly error: null; readonly verified_at: string }
  | { readonly phase: "refreshing"; readonly value: T; readonly error: null; readonly verified_at: string }
  | { readonly phase: "stale"; readonly value: T; readonly error: string; readonly verified_at: string }
  | { readonly phase: "error"; readonly value: null; readonly error: string; readonly verified_at: null };
export interface MobileSafetySnapshot {
  readonly status: MobileChannelSnapshot<MobileLocalStatusProjection>;
  readonly policy: MobileChannelSnapshot<MobileLocalPolicyProjection>;
  readonly audit: MobileChannelSnapshot<MobileLocalAuditProjection>;
}
export interface MobileSafetyActions {
  readonly refreshStatus: () => void;
  readonly refreshPolicy: () => void;
  readonly refreshAudit: () => void;
}
export interface MobileSafetyController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => MobileSafetySnapshot;
  readonly getServerSnapshot: () => MobileSafetySnapshot;
  readonly start: () => void;
  readonly dispose: () => void;
  readonly actions: MobileSafetyActions;
}
```

- [ ] **Step 1 — write the first independent-channel test**

Create a deferred helper and one exact test:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("publishes status without changing loading policy or audit", async () => {
  const status = deferred<MobileLocalStatusProjection>();
  const policy = deferred<MobileLocalPolicyProjection>();
  const audit = deferred<MobileLocalAuditProjection>();
  const controller = createMobileSafetyController({
    client: {
      status: vi.fn(() => status.promise),
      policy: vi.fn(() => policy.promise),
      audit: vi.fn(() => audit.promise),
    },
    now: () => new Date("2026-07-13T00:00:00.000Z"),
  });
  controller.start();
  expect(controller.getSnapshot().status.phase).toBe("loading");
  status.resolve({ stopped: false, pending_count: 1, audit_tail_count: 2 });
  await Promise.resolve();
  expect(controller.getSnapshot()).toMatchObject({
    status: { phase: "ready", verified_at: "2026-07-13T00:00:00.000Z" },
    policy: { phase: "loading" }, audit: { phase: "loading" },
  });
});
```

- [ ] **Step 2 — run the first controller test RED**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "publishes status"`
Expected: FAIL because the controller module is missing.

- [ ] **Step 3 — write the minimal three-channel controller factory**

Create the file with this concrete ownership skeleton; fill the three loader branches exactly, not with placeholders:

```ts
type ChannelKey = "status" | "policy" | "audit";
type ChannelValue = {
  status: MobileLocalStatusProjection;
  policy: MobileLocalPolicyProjection;
  audit: MobileLocalAuditProjection;
};
const IDLE = Object.freeze({ phase: "idle", value: null, error: null, verified_at: null } as const);
export const MOBILE_SAFETY_SERVER_SNAPSHOT: MobileSafetySnapshot = Object.freeze({
  status: IDLE, policy: IDLE, audit: IDLE,
});

export function createMobileSafetyController({ client, now = () => new Date() }: {
  readonly client: MobileSafetyClient; readonly now?: () => Date;
}): MobileSafetyController {
  let snapshot = MOBILE_SAFETY_SERVER_SNAPSHOT;
  let disposed = false;
  let started = false;
  const listeners = new Set<() => void>();
  const requests: Record<ChannelKey, { epoch: number; abort: AbortController | null }> = {
    status: { epoch: 0, abort: null }, policy: { epoch: 0, abort: null }, audit: { epoch: 0, abort: null },
  };
  const publish = <K extends ChannelKey>(key: K, channel: MobileChannelSnapshot<ChannelValue[K]>) => {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, [key]: Object.freeze(channel) }) as MobileSafetySnapshot;
    listeners.forEach((listener) => listener());
  };
  const load = <K extends ChannelKey>(key: K, request: (signal: AbortSignal) => Promise<ChannelValue[K]>, error: string) => {
    if (disposed) return;
    const previous = snapshot[key] as MobileChannelSnapshot<ChannelValue[K]>;
    requests[key].abort?.abort();
    const abort = new AbortController();
    const epoch = ++requests[key].epoch;
    requests[key].abort = abort;
    publish(key, previous.value === null
      ? { phase: "loading", value: null, error: null, verified_at: null }
      : { phase: "refreshing", value: previous.value, error: null, verified_at: previous.verified_at });
    void request(abort.signal).then((value) => {
      if (disposed || abort.signal.aborted || requests[key].epoch !== epoch) return;
      publish(key, { phase: "ready", value: Object.freeze(value), error: null, verified_at: now().toISOString() });
    }).catch(() => {
      if (disposed || abort.signal.aborted || requests[key].epoch !== epoch) return;
      const current = snapshot[key] as MobileChannelSnapshot<ChannelValue[K]>;
      publish(key, current.value === null
        ? { phase: "error", value: null, error, verified_at: null }
        : { phase: "stale", value: current.value, error, verified_at: current.verified_at });
    });
  };
  const actions: MobileSafetyActions = Object.freeze({
    refreshStatus: () => load("status", (signal) => client.status(signal), "本机状态读取失败"),
    refreshPolicy: () => load("policy", (signal) => client.policy(signal), "本机策略读取失败"),
    refreshAudit: () => load("audit", (signal) => client.audit(signal), "本机审计读取失败"),
  });
  return Object.freeze({
    subscribe: (listener) => { if (disposed) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => MOBILE_SAFETY_SERVER_SNAPSHOT,
    start: () => { if (started || disposed) return; started = true; actions.refreshStatus(); actions.refreshPolicy(); actions.refreshAudit(); },
    dispose: () => { if (disposed) return; disposed = true; Object.values(requests).forEach(({ abort }) => abort?.abort()); listeners.clear(); },
    actions,
  });
}
```

- [ ] **Step 4 — run the first controller test GREEN**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "publishes status"`
Expected: PASS.

- [ ] **Step 5 — add policy/audit initial-failure tests**

Add one parameterized test over `status|policy|audit`: reject only that deferred, resolve the other two, and assert only the rejected channel is `{phase:"error",value:null,verified_at:null}`. Assert its stable local error excludes the thrown secret string.

- [ ] **Step 6 — run initial-failure tests**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "initial failure"`
Expected: PASS with the generic factory from Step 3.

- [ ] **Step 7 — write one retained-stale RED test**

Load status ready, call `refreshStatus()`, assert refreshing retains its exact object/time, reject the second request, then assert stale retains both. Parameterize the same assertion over all three channels.

- [ ] **Step 8 — run retained-stale test GREEN**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "retains verified value"`
Expected: PASS; if it fails, correct only the generic `load()` previous/current selection and rerun.

- [ ] **Step 9 — write supersession RED test**

Start refresh A then B on one ready channel, resolve B, resolve A last, and assert B remains published. Also assert A's signal is aborted.

- [ ] **Step 10 — run supersession GREEN**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "supersedes"`
Expected: PASS from epoch + AbortController ownership.

- [ ] **Step 11 — write disposal RED test**

Subscribe a spy, start three deferred loads, call dispose, settle all promises, and assert all signals aborted, listener never called after dispose, snapshot unchanged. Record all three client call counts, invoke `refreshStatus/refreshPolicy/refreshAudit` after disposal, and assert every count remains unchanged so a disposed controller cannot issue new GETs.

- [ ] **Step 12 — run disposal GREEN**

Run: `npm test -- --run src/features/mobile/safety/create-mobile-safety-controller.test.ts -t "dispose"`
Expected: PASS.

- [ ] **Step 13 — write owner StrictMode RED test**

Use injected `setTimer/clearTimer` exactly like W1. Assert first subscription creates/starts once, final release schedules disposal, reacquire cancels it, and a true final timer callback disposes once.

- [ ] **Step 14 — run owner test RED**

Run: `npm test -- --run src/features/mobile/safety/use-mobile-safety-controller.test.tsx -t "StrictMode"`
Expected: FAIL because owner/hook file is missing.

- [ ] **Step 15 — implement owner and hook**

Implement `MobileSafetyControllerOwner` with `subscribe/getSnapshot/getServerSnapshot/actions`; lazy-create on first subscribe, count subscribers, schedule zero-delay final disposal and cancel it on reacquire. Implement the hook exactly:

```ts
export function useMobileSafetyController(owner = mobileSafetyControllerOwner) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getServerSnapshot);
  return { snapshot, actions: owner.actions } as const;
}
```

- [ ] **Step 16 — run owner/hook GREEN**

Run: `npm test -- --run src/features/mobile/safety/use-mobile-safety-controller.test.tsx`
Expected: PASS, including StrictMode and true final disposal.

- [ ] **Step 17 — write authority-gate SSR RED test**

Use `renderToString` with server-trusted checking and a spy owner; assert checking copy, zero subscriptions, no channel values/retry/Control link. Render server-false separately and assert remote copy and the exact forbidden-claim negatives.

- [ ] **Step 18 — run gate test RED**

Run: `npm test -- --run src/features/mobile/safety/MobileLocalSafetyDomain.test.tsx -t "does not mount"`
Expected: FAIL because domain components are missing.

- [ ] **Step 19 — implement outer and trusted component boundary**

```tsx
export function MobileLocalSafetyDomain({ owner }: { readonly owner?: MobileSafetyControllerOwner }) {
  const authority = useMobileAuthority();
  return (
    <section className={styles.domain} data-mobile-domain="safety">
      <h1>设备与安全</h1>
      {authority === "trusted-local"
        ? <TrustedMobileLocalSafetyDomain owner={owner} />
        : <p>{authority === "checking" ? "正在核验本机来源" : "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态"}</p>}
    </section>
  );
}
```

Only `TrustedMobileLocalSafetyDomain` calls the hook. Its heading copy is `当前 Web 主机 · 本机可信入口`; its Control link has `prefetch={false}`. It renders no live region.

- [ ] **Step 20 — run gate test GREEN**

Run: `npm test -- --run src/features/mobile/safety/MobileLocalSafetyDomain.test.tsx -t "does not mount"`
Expected: PASS.

- [ ] **Step 21 — write channel-view RED tests**

For each channel, render idle/loading/ready/refreshing/error/stale; assert error/stale retry calls only the matching action. Add stopped true/false plus the no-value/error case, which must display exact `停止状态：未知` and must not contain copy meaning “安全”“未闩锁” or “可执行”. Add chain true/false/null and audit total number/null. Assert three independent sections, exact trusted title, no `我的电脑在线`, no global success badge and zero `[aria-live]`.

- [ ] **Step 22 — implement three channel sections and CSS**

Create a local `ChannelSection<T>` that receives one discriminated snapshot, retry label/action and a value renderer. It shows retained value plus `可能陈旧` for stale, never converts null to zero/false, and uses a native ≥44px retry button. CSS uses stable rectangles, pure colors and no animation/glass/gradient.

- [ ] **Step 23 — run all Safety component tests GREEN**

Run: `npm test -- --run src/features/mobile/safety/MobileLocalSafetyDomain.test.tsx src/features/mobile/safety/TrustedMobileLocalSafetyDomain.test.tsx`
Expected: PASS.

- [ ] **Step 24 — run full Safety and read-only static checks**

Run: `npm test -- --run src/features/mobile/safety`
Expected: all Safety tests PASS.
Run: `rg -n "POST|PUT|patchPolicy|estop|reset|Dispatch" src/features/mobile/safety --glob '!*.test.*'`
Expected: exit 1, no production matches.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 25 — stage exact files and commit**

```text
git add webapp/src/features/mobile/safety/create-mobile-safety-controller.ts webapp/src/features/mobile/safety/create-mobile-safety-controller.test.ts webapp/src/features/mobile/safety/use-mobile-safety-controller.ts webapp/src/features/mobile/safety/use-mobile-safety-controller.test.tsx webapp/src/features/mobile/safety/MobileLocalSafetyDomain.tsx webapp/src/features/mobile/safety/MobileLocalSafetyDomain.test.tsx webapp/src/features/mobile/safety/TrustedMobileLocalSafetyDomain.tsx webapp/src/features/mobile/safety/TrustedMobileLocalSafetyDomain.test.tsx webapp/src/features/mobile/safety/MobileLocalSafetyDomain.module.css
git commit -m "feat: add read-only Mobile safety projection"
```

---

### Task 8：五路由、分块与跨空间集成

**文件：**

- Create: `webapp/src/app/mobile/layout.tsx`
- Create: `webapp/src/app/mobile/layout.test.tsx`
- Create: `webapp/src/app/mobile/page.tsx`
- Create: `webapp/src/app/mobile/page.test.tsx`
- Create: `webapp/src/app/mobile/presence/page.tsx`
- Create: `webapp/src/app/mobile/tasks/page.tsx`
- Create: `webapp/src/app/mobile/workbench/page.tsx`
- Create: `webapp/src/app/mobile/knowledge/page.tsx`
- Create: `webapp/src/app/mobile/safety/page.tsx`
- Create: focused page tests beside each route
- Modify: `webapp/src/features/presence/components/PresenceHeader.tsx`
- Modify: `webapp/src/features/presence/components/PresenceHeader.test.tsx`
- Modify as needed: `webapp/src/features/presence/components/PresenceHeader.module.css`
- Modify: `webapp/src/features/control/components/ControlShell.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.test.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.module.css`

**Interfaces 与 import ownership：**

```tsx
// app/mobile/layout.tsx — Server Component
export default function MobileLayout({ children }: { readonly children: ReactNode }) {
  const serverAuthorityTrusted = assessMobileServerAuthority({
    coreUrl: process.env.ASTR_CORE_URL,
    publicCoreUrl: process.env.NEXT_PUBLIC_ASTR_CORE,
  });
  return (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <MobileShell>{children}</MobileShell>
    </MobileAuthorityProvider>
  );
}
```

- Each explicit page imports exactly one domain component.
- `layout.tsx` imports authority + shell only; no Presence/Tasks/Safety client.
- `/mobile/page.tsx` imports only `redirect`.

- [ ] **Step 1 — redirect and layout RED**

Mock `next/navigation.redirect` and assert `MobileIndexPage()` calls it once with `/mobile/presence`. For layout, stub both envs to loopback and remote combinations, render with a probe child, and assert only the boolean phase is visible; `renderToString`/serialized props must not contain either target URL.

Run: `npm test -- --run src/app/mobile/page.test.tsx src/app/mobile/layout.test.tsx`
Expected: FAIL because routes are missing.

- [ ] **Step 2 — implement server layout and redirect**

Create only the two root files. Do not export the env input or target to client code. Repeat the focused tests; expected PASS.

- [ ] **Step 3 — five explicit page RED**

Each page test renders its default export and asserts exactly one route heading and its unique domain marker. Add a static source test that maps exact page paths to the only permitted domain import and fails on a barrel/dynamic `[domain]` route.

```ts
expect(readPage("presence")).toContain("@/features/mobile/presence/MobilePresenceDomain");
expect(readPage("presence")).not.toMatch(/tasks|workbench|knowledge|safety/);
```

Run: `npm test -- --run src/app/mobile`
Expected: FAIL until all five pages exist.

- [ ] **Step 4 — implement five pages**

Create the five explicit `page.tsx` files. Do not create `src/features/mobile/index.ts`, a component registry, or a `[domain]` route. The domain components own h1; Shell supplies main.

- [ ] **Step 5 — cross-space link RED**

Extend existing PresenceHeader and ControlShell tests to expect one Mobile link with 44px target and stable `/mobile/presence` href. Existing Control/Presence links and heading semantics must remain unchanged. Add a PresenceHeader CSS assertion proving all five controls wrap/reflow without nowrap overflow at 320px. Add a Control CSS source/layout assertion proving its two cross-space links occupy distinct desktop and ≤760px grid/flex positions; do not reuse the single bottom `.presenceLink` slot twice.

Run: `npm test -- --run src/features/presence/components/PresenceHeader.test.tsx src/features/control/components/ControlShell.test.tsx`
Expected: FAIL because links are absent.

- [ ] **Step 6 — add restrained links and rerun**

Add one Mobile text link to the existing cross-space control rail in each desktop shell. Do not add Studio or Mobile subnavigation. Rerun focused tests; expected PASS.

- [ ] **Step 7 — full focused suite, static import check and build**

Run: `npm test -- --run src/app/mobile src/features/mobile src/features/presence/components/PresenceHeader.test.tsx src/features/control/components/ControlShell.test.tsx`
Expected: PASS.
Run: `npm run lint`
Expected: exit 0.
Run: `npm run typecheck`
Expected: exit 0.
Run: `npm run build`
Expected: exit 0; build route output contains `/mobile`, `/mobile/presence`, `/mobile/tasks`, `/mobile/workbench`, `/mobile/knowledge`, `/mobile/safety`.

- [ ] **Step 8 — stage exact route/integration scopes and commit**

```text
git add webapp/src/app/mobile/layout.tsx webapp/src/app/mobile/layout.test.tsx webapp/src/app/mobile/page.tsx webapp/src/app/mobile/page.test.tsx webapp/src/app/mobile/presence/page.tsx webapp/src/app/mobile/presence/page.test.tsx webapp/src/app/mobile/tasks/page.tsx webapp/src/app/mobile/tasks/page.test.tsx webapp/src/app/mobile/workbench/page.tsx webapp/src/app/mobile/workbench/page.test.tsx webapp/src/app/mobile/knowledge/page.tsx webapp/src/app/mobile/knowledge/page.test.tsx webapp/src/app/mobile/safety/page.tsx webapp/src/app/mobile/safety/page.test.tsx webapp/src/features/presence/components/PresenceHeader.tsx webapp/src/features/presence/components/PresenceHeader.test.tsx webapp/src/features/presence/components/PresenceHeader.module.css webapp/src/features/control/components/ControlShell.tsx webapp/src/features/control/components/ControlShell.test.tsx webapp/src/features/control/components/ControlShell.module.css
git commit -m "feat: publish five Mobile domain routes"
```

---

### Task 9：Source/Build Boundary 与操作文档

**文件：**

- Create: `webapp/scripts/check-mobile-boundaries.mjs`
- Create: `webapp/scripts/check-mobile-boundaries.test.mjs`
- Modify: `webapp/package.json`
- Modify: `webapp/vitest.config.mts`
- Modify as coverage evidence requires: `webapp/src/features/mobile/**/*.test.{ts,tsx}`
- Modify: `webapp/README.md`
- Create: `webapp/docs/mobile-verification.md`

**Interfaces：**

```json
{
  "schemaVersion": 1,
  "check": "mobile-boundaries",
  "passed": true,
  "sourceFilesScanned": 0,
  "domains": ["presence", "tasks", "workbench", "knowledge", "safety"],
  "buildEvidence": {
    "status": "checked",
    "routes": [{ "route": "/mobile/presence", "serverEntry": "...", "clientChunks": [] }]
  },
  "violations": []
}
```

- [ ] **Step 1 — source fixture RED**

Create temporary fixture roots with minimal valid Mobile source. One mutation at a time must fail with a stable rule: green literal/token, `gradient`, `backdrop-filter`, `@keyframes`, `animation-name` or non-`none` animation value, RAF, Canvas/WebGL, Pixi/Live2D/Three/framer import, W5 types/endpoints, Shell/Nav business import, static-domain Core import, Safety mutation verb/client. Add passing fixtures for static SVG, the three exact GET paths, and required `animation:none` first-paint suppression. Add a passing fixture whose `*.test.ts`, `*.spec.tsx`, fixture folder and `*.d.ts` deliberately contain forbidden tokens; they must be excluded from production scanning.

Run: `npm test -- --run scripts/check-mobile-boundaries.test.mjs`
Expected: FAIL because checker is missing.

- [ ] **Step 2 — registry/global/build fixture RED**

Add fixtures for wrong/missing/duplicate domain registry, missing `body:has([data-route-surface="mobile"])` ambient/grain override, missing server route, missing route manifest, zero route evidence, missing/stale stamp, a route-owned chunk with heavy token, and a Workbench/Knowledge manifest that imports Presence/Safety business bytes. A Server Component may have zero dedicated client chunks only when its server entry and manifest evidence are real. Legitimate shared Next runtime, React, MobileShell, authority provider, navigation, shared metadata and shared CSS must pass; “cross-route” means another domain's business module, not any shared byte.

- [ ] **Step 3 — implement fail-closed checker**

Reuse the shared no-green scanner and the existing build-ID/source-hash calculation rather than weakening it. Scan only production files under `src/app/mobile/**`, `src/features/mobile/**`, the exact globals witness, and actual Mobile route entries/chunks; explicitly exclude `*.test.*`, `*.spec.*`, `*.d.ts`, `__tests__`, test/fixture/fixtures directories and snapshots before applying token/import rules. Parse source imports and client-reference/build manifests to map route-owned modules. Allowlist framework + shell/authority/nav/shared metadata modules; for each route, forbid only other domains' business modules. Safety mutation checks apply to Safety-owned production source/modules and their route-owned chunk bytes, not a naked search across shared/minified runtime chunks. Sort violations for deterministic JSON.

- [ ] **Step 4 — coverage configuration RED**

The boundary test must read `vitest.config.mts` and fail until all exact facts hold: existing lib/system includes remain; coverage includes `src/features/mobile/**/*.{ts,tsx}`; excludes contain test/spec, fixtures and `*.d.ts`; reporters contain `json-summary`; `thresholds["src/features/mobile/**/*.{ts,tsx}"]` is lines/statements/functions 90 and branches 85; each critical pure-module glob below has all four metrics 100. This closes the current configuration where only `src/lib/**` and `src/components/system/**` are measured and prevents an irrelevant top-level threshold from passing on old corpus.

- [ ] **Step 5 — package/config/docs implementation**

Add:

```json
"check:mobile-boundaries": "node scripts/check-mobile-boundaries.mjs"
```

Extend coverage without removing the existing includes, using this threshold ownership:

```ts
thresholds: {
  "src/features/mobile/**/*.{ts,tsx}": { lines: 90, statements: 90, functions: 90, branches: 85 },
  "src/features/mobile/authority/loopback-authority.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
  "src/features/mobile/tasks/{local-task-draft,local-task-draft-storage}.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
  "src/features/mobile/safety/mobile-safety-client.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
  "src/features/mobile/safety/create-mobile-safety-controller.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
}
```

Add `json-summary` and excludes for `**/*.test.*`, `**/*.spec.*`, fixtures and declarations. Document exact authority evidence, three GETs, localStorage key, five routes, no-mock/bundle rules, W4 partial, missing Studio/Knowledge/Dispatch and Pixel 6a/TalkBack pending.

- [ ] **Step 6 — focused GREEN**

Run: `npm test -- --run scripts/check-mobile-boundaries.test.mjs`
Expected: all fixture/config tests PASS.
Run: `npm run test:coverage`
Expected: exit 0; text/json summary contains Mobile authority, model, tasks, presence and safety production files and meets thresholds. If coverage is RED, inspect the exact uncovered branches/lines and add evidence-driven cases only to the owning Mobile `*.test.ts(x)` files listed in this task; do not change production merely to raise coverage and do not lower thresholds. Record each added test file path in the task report, rerun its focused suite, then rerun coverage until GREEN.

- [ ] **Step 7 — create authoritative stamped build, then check**

Do not run bare `next build` and immediately claim freshness. Use the existing runner that writes `.next/astr-e2e-build.json`:

Run: `npm run test:e2e -- --list`
Expected: production build succeeds, runner writes a matching stamp, Playwright lists tests, exit 0.
Run: `npm run check:mobile-boundaries`
Expected: `passed:true`, exact five routes, `buildEvidence.status:"checked"`, real route evidence, 0 violations.

- [ ] **Step 8 — stage exact files and commit**

Stage the six fixed boundary/config/doc files explicitly. If Step 6 added coverage tests, inspect each diff and append each actual test file as an explicit `git add -- <file>` argument; directory/glob staging is forbidden.

```text
git add webapp/scripts/check-mobile-boundaries.mjs webapp/scripts/check-mobile-boundaries.test.mjs webapp/package.json webapp/vitest.config.mts webapp/README.md webapp/docs/mobile-verification.md
git commit -m "test: enforce Mobile production boundaries"
```

---

### Task 10：Browser、a11y、视觉与性能验收

**文件：**

- Modify: `webapp/e2e/support/mock-core.mjs`
- Modify: `webapp/e2e/support/mock-core.test.ts`
- Modify: `webapp/playwright.config.ts`
- Modify as evidence requires: `webapp/src/features/mobile/authority/**`
- Modify as evidence requires: `webapp/src/features/mobile/shell/**`
- Modify as evidence requires: `webapp/src/features/mobile/tasks/**`
- Modify as evidence requires: `webapp/src/features/mobile/presence/**`
- Modify as evidence requires: `webapp/src/features/mobile/safety/**`
- Modify as evidence requires: `webapp/src/features/mobile/shared/**`, `workbench/**`, `knowledge/**`
- Modify as evidence requires: `webapp/src/app/globals.css`, `webapp/src/app/mobile/**`
- Modify as evidence requires: `webapp/src/app/layout.tsx`, `webapp/src/app/layout.test.ts`
- Modify as evidence requires: `webapp/src/features/presence/components/PresenceHeader.tsx`, `PresenceHeader.test.tsx`, `PresenceHeader.module.css`
- Modify as evidence requires: `webapp/src/features/control/components/ControlShell.tsx`, `ControlShell.test.tsx`, `ControlShell.module.css`
- Create: `webapp/e2e/mobile.spec.ts`
- Create: `webapp/e2e/mobile-authority.spec.ts`
- Create: `webapp/e2e/mobile-a11y.spec.ts`
- Create: `webapp/e2e/mobile-visual.spec.ts`
- Create: `webapp/e2e/mobile-performance.spec.ts`
- Create: screenshot baselines under the matching snapshot directory
- Modify: `webapp/docs/mobile-verification.md`

**Browser constants and matrices：**

```ts
export const REMOTE_APP_ORIGIN = "http://astr-remote.test:3100";
// Chromium launchOptions.args includes:
// --host-resolver-rules=MAP astr-remote.test 127.0.0.1
```

Exact axe matrix:

- Presence: trusted-ready, trusted-Core-error, remote gate.
- Tasks: default editor, storage-error.
- Workbench: unavailable.
- Knowledge: unavailable.
- Safety: all-ready, remote gate, status-error, policy-error, audit-error, one retained-stale case per channel.

Exact visual matrix: five domains × dark/light × 390×844/430×932 = 20 named files `mobile-{domain}-{width}x{height}-{theme}-win32.png`. Deterministic visual states are Presence seeded conversation, Tasks representative editor, Workbench unavailable, Knowledge unavailable, Safety all-ready.

- [ ] **Step 0 — preserve pre-existing working state**

Require no pre-existing staged files; otherwise stop for coordination. Save the full pre-task dirty snapshot for later preservation, then initialize a durable owned-file ledger with only the exact Task10 files that will be created/modified:

```powershell
$preStaged = @(git diff --cached --name-only)
if ($preStaged.Count -ne 0) { throw 'Task10 requires an empty index' }
git status --porcelain=v1 | Set-Content .superpowers/sdd/task-10-preexisting-status.txt
if (-not (Test-Path .superpowers/sdd/task-10-report.md)) {
  Set-Content .superpowers/sdd/task-10-report.md -Value '# Mobile Task 10 evidence report'
}
@(
  'webapp/e2e/support/mock-core.mjs',
  'webapp/e2e/support/mock-core.test.ts',
  'webapp/playwright.config.ts',
  'webapp/e2e/mobile.spec.ts',
  'webapp/e2e/mobile-authority.spec.ts',
  'webapp/e2e/mobile-a11y.spec.ts',
  'webapp/e2e/mobile-visual.spec.ts',
  'webapp/e2e/mobile-performance.spec.ts',
  'webapp/docs/mobile-verification.md'
) | Set-Content .superpowers/sdd/task-10-owned.txt
```

Whenever Step 8 repairs a production file or Step 6 creates a snapshot, append that exact relative file path to `task-10-owned.txt` immediately. If an owned path was already dirty in the pre-task snapshot, stop and coordinate instead of overwriting it. Unrelated pre-existing dirty files remain untouched and are never added to `$owned`.

- [ ] **Step 1 — mock controls RED**

Extend mock tests first: three existing GET routes can independently delay/fail/recover; response bodies remain the full current Core shapes. Add test-only reset and operation counters for Core status, ingest, voice, SSE opens and the three Safety GETs. Do not add product routes or fields.

Run: `npm test -- --run e2e/support/mock-core.test.ts`
Expected: new cases FAIL before mock implementation, then PASS after the faithful test-only controls are added.

- [ ] **Step 1b — Playwright discovery configuration**

Before running any Mobile spec, extend mock-mode `testMatch` to:

```ts
/(?:presence(?:-[\w-]+)?|control(?:-a11y)?|mobile(?:-[\w-]+)?)\.spec\.ts/
```

Keep real-Core mode restricted to its existing smoke file. Configure `REMOTE_APP_ORIGIN` and the Chromium host-resolver rule here. Do not create empty placeholder specs and do not run discovery yet; the exact discovery gate runs only after Steps 2–7 have created real tests.

- [ ] **Step 2 — authority/browser RED**

Configure Chromium host resolver and export `REMOTE_APP_ORIGIN`. Navigate to both trusted base URL and the absolute remote URL; first assert `location.hostname === "astr-remote.test"`. Install page request listeners before navigation and reset mock counters. Remote Presence/Safety must show gates and expose no link whose href is `/`, `/admin`, or starts with `/admin/`; they must make zero `/api/core`, direct Core/SSE/ingest/transcribe/Effector attempts, and leave all mock operation counters at zero. Trusted routes must make only their documented requests.

Re-run Task 1/8 unit negatives for `ASTR_CORE_URL=https://remote.example` and a remote public Core target; both must SSR fail closed and serialized output must not contain the URL.

Run: `npm run test:e2e -- e2e/mobile-authority.spec.ts`
Expected initially: FAIL; after fixes PASS.

- [ ] **Step 3 — functional browser RED**

`mobile.spec.ts` covers exact five links/current state, `/mobile` redirect, local Tasks no-network/save/edit/upsert/delete/limits/storage failure, the exact unencrypted-storage warning and zero clipboard calls, Workbench/Knowledge no actions, trusted Presence conversation/Composer, and all Safety channel ready/error/stale/retry cases. For unsaved Tasks text, use four independent fresh contexts and prove route switch, history back, history forward, and refresh each remount an empty editor without hidden restore; saved localStorage drafts remain separately recoverable. Trusted Safety must show `当前 Web 主机 · 本机可信入口`; trusted/remote both must omit `我的电脑在线` and remote-device claims. It also asserts the real viewport meta includes `viewport-fit=cover` and omits maximum-scale/user-scalable locks.

Run: `npm run test:e2e -- e2e/mobile.spec.ts`
Expected initially: FAIL; after fixes PASS.

- [ ] **Step 4 — responsive/a11y RED**

Run axe on the exact matrix above; critical/serious must be zero. On every route/state assert the whole document has exactly one `[aria-live]`, it is the AppShell `.sr-only` StateAnnouncer, and Mobile timeline/Safety/error regions add none. At 320/390/430/768 verify `scrollWidth <= clientWidth`. At 1280 and 1440 verify the same header/main/nav DOM/reading order, controlled content max-width and no fake device frame. For 200%/400% equivalents, assert all nav labels and focused controls remain reachable. Simulate a soft keyboard only as a desktop viewport-contraction proxy: shrink viewport after focusing the Task textarea/Presence composer, scroll it into view, and assert focused bottom is above fixed nav top. Label real keyboard/Pixel/TalkBack pending.

Run: `npm run test:e2e -- e2e/mobile-a11y.spec.ts`
Expected initially: FAIL; after fixes PASS.

- [ ] **Step 5 — SSR ambient and RAF RED**

For every route, create a JavaScript-disabled context and assert SSR computed styles for ambient/grain are `display:none`, no animation, no background. Repeat after normal hydration. Before page scripts, wrap `requestAnimationFrame` to count application calls; hard-assert stable and reduced-motion contexts remain zero. For hidden evidence, follow the existing `presence-runtime.spec.ts` method: open a second page and call `bringToFront()`, require the first page to reach real `document.visibilityState === "hidden"`, then hard-assert the count remains zero. If Chromium cannot provide that real hidden state, the gate fails and W4 is not accepted; never synthesize it with a fake event. Assert `document.getAnimations()` has no running infinite Mobile/global ambient animation.

Run: `npm run test:e2e -- e2e/mobile-performance.spec.ts -g "ambient|RAF"`
Expected initially: FAIL; after fixes PASS.

- [ ] **Step 6 — deterministic visual RED/GREEN**

Freeze clock/`verified_at`, seed mock state, await `document.fonts.ready`, disable caret and any animation through screenshot style, then take viewport screenshots (not fullPage). Never wait for generic `networkidle` on trusted Presence because its single EventSource transport remains open. Use route-specific readiness witnesses: Presence seeded conversation + the open transport reflected as distinct Reply/Life semantic facts, Tasks representative editor value, Safety all three channels ready, and static gate text for Workbench/Knowledge. Generate exactly 20 baselines with `--update-snapshots`. Use local `view_image` inspection on every file and, immediately after each inspection, append one exact line to `.superpowers/sdd/task-10-report.md`: `SNAPSHOT_INSPECTED: <relative-path> | no green/gradient/glass; nav clear; primary region roomy; no clipping; truth copy verified`. Compare header/main/nav/primary-region bounding rects between themes at each viewport with ≤1 CSS px tolerance. Finally rerun without update and require PASS.

Run: `npm run test:e2e -- e2e/mobile-visual.spec.ts --update-snapshots`
Expected: 20 baselines created.
Run after inspection: `npm run test:e2e -- e2e/mobile-visual.spec.ts`
Expected: PASS without updates.

- [ ] **Step 7 — measurable lab performance evidence**

Install PerformanceObservers before navigation for LCP, layout-shift, longtask and event entries. Use a fixed 5-second window after LCP; compute TBT as `sum(max(0, longtask.duration - 50))`. Perform one real textarea input + nav/button interaction and record Event Timing duration plus a click-to-next-paint laboratory latency proxy. Persist raw timestamps/durations in the Playwright attachment. Gate LCP≤2.5s, CLS≤0.1, TBT≤200ms, observed Event Timing≤200ms and lab interaction proxy≤200ms. If this Chromium run exposes no Event Timing entry, the automated performance gate fails; field INP remains explicitly pending and W4 remains partial, so the report must not claim real-user INP completion.

Run: `npm run test:e2e -- e2e/mobile-performance.spec.ts`
Expected: automated lab gates PASS and raw evidence is attached; no field-INP completion claim.

- [ ] **Step 8 — evidence-driven production repair loop**

Before repairs, prove discovery now that all five real spec files exist:

Run: `npm run test:e2e -- --list`
Expected: output lists `mobile.spec.ts`, `mobile-authority.spec.ts`, `mobile-a11y.spec.ts`, `mobile-visual.spec.ts`, and `mobile-performance.spec.ts`, with at least one discovered test in every file and a total test count greater than zero. Missing/zero discovery is a failure.

For each failing group, patch only its owning production path listed in this task: authority failures → authority; viewport meta → root layout + layout test; shell/overflow/ambient → shell/globals/app-mobile; task behavior → tasks; Presence projection → mobile/presence; Safety channel behavior → safety; gate copy → shared/workbench/knowledge; existing-space regression → PresenceHeader/ControlShell component, CSS owner and tests. Never weaken axe, request counts, viewport assertions, thresholds or screenshots. After each patch rerun its single focused spec, then all five Mobile specs.

- [ ] **Step 9 — coverage and full configured regression**

Run: `npm run test:coverage`
Expected: Mobile files present; aggregate ≥90/85 and critical pure modules 100%, exit 0.
Run: `npm run test:e2e`
Expected: all configured Presence, Control and Mobile browser/a11y/visual tests PASS; existing baselines do not regress.

- [ ] **Step 10 — update evidence doc, stage exact scopes and commit**

Record commands/counts, 20 inspected baselines, remote counters, measured lab metrics and honest pending real-device/field-INP items in `mobile-verification.md`.

Before staging, read the durable owned ledger, validate every entry against this task's explicit Files allowlist, and inspect only those diffs. Do not compare against or stage unrelated dirty files:

```powershell
$owned = @(Get-Content .superpowers/sdd/task-10-owned.txt | Where-Object { $_.Trim().Length -gt 0 } | Sort-Object -Unique)
if ($owned.Count -eq 0) { throw 'Task10 owned set is empty' }
$allowedExact = @(
  'webapp/e2e/support/mock-core.mjs',
  'webapp/e2e/support/mock-core.test.ts',
  'webapp/playwright.config.ts',
  'webapp/e2e/mobile.spec.ts',
  'webapp/e2e/mobile-authority.spec.ts',
  'webapp/e2e/mobile-a11y.spec.ts',
  'webapp/e2e/mobile-visual.spec.ts',
  'webapp/e2e/mobile-performance.spec.ts',
  'webapp/docs/mobile-verification.md',
  'webapp/src/app/globals.css',
  'webapp/src/app/layout.tsx',
  'webapp/src/app/layout.test.ts',
  'webapp/src/features/presence/components/PresenceHeader.tsx',
  'webapp/src/features/presence/components/PresenceHeader.test.tsx',
  'webapp/src/features/presence/components/PresenceHeader.module.css',
  'webapp/src/features/control/components/ControlShell.tsx',
  'webapp/src/features/control/components/ControlShell.test.tsx',
  'webapp/src/features/control/components/ControlShell.module.css'
)
$allowedPrefix = @(
  'webapp/src/features/mobile/',
  'webapp/src/app/mobile/',
  'webapp/e2e/mobile-visual.spec.ts-snapshots/'
)
$invalid = @($owned | Where-Object {
  $path = $_.Replace('\', '/')
  $path.StartsWith('/') -or $path -match '(^|/)\.\.(/|$)' -or
  (-not ($allowedExact -contains $path) -and -not ($allowedPrefix | Where-Object { $path.StartsWith($_) }))
})
if ($invalid.Count -ne 0) { $invalid; throw 'Task10 owned path is outside allowlist' }
$report = '.superpowers/sdd/task-10-report.md'
if (-not (Test-Path $report)) { throw 'Missing Task10 evidence report' }
$inspectedSnapshots = @(Get-Content $report | Where-Object { $_ -like 'SNAPSHOT_INSPECTED: *' } | ForEach-Object { ($_ -replace '^SNAPSHOT_INSPECTED: ', '').Split(' | ')[0] } | Sort-Object -Unique)
$ownedSnapshots = @($owned | Where-Object { $_ -like 'webapp/e2e/mobile-visual.spec.ts-snapshots/*.png' } | Sort-Object -Unique)
if ($inspectedSnapshots.Count -ne 20 -or @(Compare-Object $inspectedSnapshots $ownedSnapshots).Count -ne 0) {
  throw 'Snapshot evidence must contain exactly the 20 owned baselines'
}
$owned | ForEach-Object {
  $path = $_
  git ls-files --error-unmatch -- $path 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    git diff --no-ext-diff -- $path
  } elseif ($path -match '\.png$') {
    $inspected = Select-String -Path $report -SimpleMatch $path -Quiet
    if (-not $inspected) { throw "Uninspected screenshot: $path" }
    Write-Output "UNTRACKED IMAGE inspected with view_image: $path"
  } else {
    Write-Output "UNTRACKED TEXT: $path"
    Get-Content -LiteralPath $path -Raw
  }
}
$owned | ForEach-Object { if (Test-Path -LiteralPath $_) { git add -- $_ } else { throw "Missing owned path: $_" } }
$cached = @(git diff --cached --name-only | Sort-Object -Unique)
$difference = @(Compare-Object -ReferenceObject $owned -DifferenceObject $cached)
if ($difference.Count -ne 0) { $difference; throw 'Staged files do not equal Task10 owned set' }

function Get-Task10StatusPath([string]$line) {
  if ($line.Length -lt 4) { return '' }
  $payload = $line.Substring(3)
  if ($payload -match ' -> ') { $payload = ($payload -split ' -> ')[-1] }
  return $payload.Trim('"').Replace('\', '/')
}
$preStatus = @(Get-Content .superpowers/sdd/task-10-preexisting-status.txt)
$currentStatus = @(git status --porcelain=v1 --untracked-files=all)
$preUnrelated = @($preStatus | Where-Object { $owned -notcontains (Get-Task10StatusPath $_) } | Sort-Object)
$currentUnrelated = @($currentStatus | Where-Object { $owned -notcontains (Get-Task10StatusPath $_) } | Sort-Object)
$unrelatedDrift = @(Compare-Object -ReferenceObject $preUnrelated -DifferenceObject $currentUnrelated)
if ($unrelatedDrift.Count -ne 0) { $unrelatedDrift; throw 'Unrelated working state changed during Task10' }
$stagedUnrelated = @($cached | Where-Object { $owned -notcontains $_ })
if ($stagedUnrelated.Count -ne 0) { $stagedUnrelated; throw 'Unrelated files are staged' }
```

The comparison above must remain GREEN. Directory arguments such as `webapp/src/features/mobile` or `webapp/src/app/mobile` are forbidden. Then commit:

```text
git commit -m "test: complete Mobile shell acceptance evidence"
```

---

## W4 壳层 tranche 最终验收

按顺序执行：

```text
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e
npm run check:presence-boundaries
npm run check:control-boundaries
npm run check:mobile-boundaries
```

仓库根目录再执行：

```text
git diff --check
git diff --cached --check
git status --short
```

Then execute the Task 0 resolution block in repo-root PowerShell and run:

```powershell
git diff --check "$baseline..HEAD"
$committedBackend = @(git diff --name-only "$baseline..HEAD" -- src tests integrations pyproject.toml requirements.txt uv.lock)
$loggedBackend = @(git log --format= --name-only "$baseline..HEAD" -- src tests integrations pyproject.toml requirements.txt uv.lock | Where-Object { $_.Trim().Length -gt 0 })
$workingBackend = @(git diff --name-only -- src tests integrations pyproject.toml requirements.txt uv.lock)
$stagedBackend = @(git diff --cached --name-only -- src tests integrations pyproject.toml requirements.txt uv.lock)
if ($committedBackend.Count -ne 0 -or $loggedBackend.Count -ne 0 -or $workingBackend.Count -ne 0 -or $stagedBackend.Count -ne 0) {
  $committedBackend
  $loggedBackend
  $workingBackend
  $stagedBackend
  throw 'Mobile W4 modified backend scope'
}
```

Expected: both diff-check commands exit 0 and all four backend collections are empty. This checks committed history, unstaged changes and staged changes against the validated 40-hex baseline, including `uv.lock`.

验收必须证明：

- 五域 exact、唯一底部导航、safe-area、无整页 overflow；
- remote/checking 0 业务连接且无本机跨空间旁路；
- Safety 只含三个 GET，Tasks 只含显式本地草稿；
- 生产 Mobile chunks 无跨域业务依赖、无重视觉 runtime、无持续动画/RAF；
- backend diff 为空，Presence/Control 既有验收不回归；
- Studio、Knowledge、Secure Dispatch、远程设备/审批/ACK 仍明确未完成；W4 状态保持 `partial`。

最后分派两名独立只读 reviewer：一名审查 authority/data/bundle 边界，一名审查视觉/a11y/响应式。所有 Critical/Important 清零后只关闭 W4 壳层 tranche，不关闭完整 Mobile Workstream。
