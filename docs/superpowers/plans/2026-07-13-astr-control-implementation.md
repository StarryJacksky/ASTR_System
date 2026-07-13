# ASTR Control / Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the truthful ASTR Control shell, all 18 target Admin routes, and the existing Effector policy/audit/e-stop workspace without changing the backend or inventing unavailable capabilities.

**Architecture:** A frozen module registry drives `/admin`, `/admin/[module]`, the atlas, status labels, and planned boundaries. A focused Effector client and external-store controller isolate the six existing Core endpoints from React; shell, policy editor, safety control, and audit ledger remain small independent components. Only Effector is interactive in Workstream 2; every other module is a truthful planned dossier.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules/Tailwind tokens, Vitest + Testing Library, Playwright + axe, existing Next rewrite to ASTR Core.

## Global Constraints

- The product name is 星枢 / ASTR.
- Night materials use deep black, cold blue, Soul violet, and silver; day materials invert to cold porcelain and dark ink. Green is forbidden everywhere.
- Control uses a sovereign spine and archive atlas, not Presence's S-shaped orbit and not a conventional long dashboard sidebar.
- Forms, tables, code, errors, and audit records remain stable rectangles. Irregular geometry is limited to the shell, eclipse notch, spine, and section entrances.
- Admin owns 0 WebGL contexts, 0 Canvas renderers, and 0 continuous visual RAF loops.
- `/admin` exposes exactly 18 target modules. Only `/admin/effector` is `available`; the other 17 are `planned` until a real web contract exists.
- Do not modify `src/astr/**`, `tests/**`, Python dependencies, Core routes, or backend response shapes.
- Do not invent Task, device, model-router, plugin, memory, training, migration, Studio, or remote-operation endpoints.
- E-stop/reset must POST and then GET authoritative `/v1/effector/status`; never optimistically toggle safety truth.
- Policy, audit, and status load independently. A failed channel must not erase verified evidence from another channel.
- Admin headings name function first and may use a poetic label only as a subtitle.
- Main interactive targets are at least 44×44 CSS px; radiogroups support arrow keys; critical/serious axe violations are zero.
- Preserve user work and stage only named Control paths for each commit.

---

### Task 1: Canonical 18-Module Registry

**Files:**

- Create: `webapp/src/features/control/model/control-modules.ts`
- Create: `webapp/src/features/control/model/control-modules.test.ts`

**Interfaces:**

- Produces: `ControlModule`, `ControlModuleId`, `ControlDomain`, `CONTROL_MODULES`, `getControlModule()`, `getControlModulesByDomain()`.
- Consumed by: every Control route, atlas, breadcrumb, status badge, planned boundary, and acceptance test.

- [ ] **Step 1: Write the failing registry tests**

Create tests that assert the exact ID order, exact unique route set, two domain counts (`system=10`, `soul=8`), and the single available module:

```ts
import { describe, expect, it } from "vitest";

import {
  CONTROL_MODULES,
  getControlModule,
  getControlModulesByDomain,
} from "./control-modules";

const EXPECTED_IDS = [
  "dashboard",
  "platform-gateway",
  "model-router",
  "plugins-skills-mcp",
  "sessions-people",
  "schedule",
  "logs-trace",
  "settings",
  "resources-knowledge",
  "setup",
  "soul",
  "memory",
  "emotion",
  "moa-teaching",
  "training",
  "voice",
  "effector",
  "migration",
] as const;

describe("Control module registry", () => {
  it("defines the exact 18-route IA once", () => {
    expect(CONTROL_MODULES.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(new Set(CONTROL_MODULES.map(({ href }) => href)).size).toBe(18);
    expect(getControlModulesByDomain("system")).toHaveLength(10);
    expect(getControlModulesByDomain("soul")).toHaveLength(8);
  });

  it("exposes only the existing Effector web contract", () => {
    expect(CONTROL_MODULES.filter(({ status }) => status === "available").map(({ id }) => id))
      .toEqual(["effector"]);
    expect(getControlModule("effector")?.contracts).toEqual([
      "GET /v1/admin/effector/policy",
      "PUT /v1/admin/effector/policy",
      "GET /v1/admin/effector/audit",
      "GET /v1/effector/status",
      "POST /v1/effector/estop",
      "POST /v1/effector/estop/reset",
    ]);
  });

  it("returns undefined for an unknown module", () => {
    expect(getControlModule("remote-task")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/model/control-modules.test.ts`  
Expected: FAIL because `./control-modules` does not exist.

- [ ] **Step 3: Implement the frozen registry**

Define this exact public model, then populate the 18 labels and subtitles from the Control spec tables:

```ts
export type ControlDomain = "system" | "soul";
export type ControlModuleStatus = "available" | "planned";

export interface ControlModule {
  readonly id: string;
  readonly href: `/admin/${string}`;
  readonly domain: ControlDomain;
  readonly title: string;
  readonly subtitle: string;
  readonly index: string;
  readonly status: ControlModuleStatus;
  readonly summary: string;
  readonly contracts: readonly string[];
  readonly prerequisite: string;
}

const modules = [
  { id: "dashboard", href: "/admin/dashboard", domain: "system", title: "系统概览", subtitle: "总星图", index: "A01", status: "planned", summary: "汇总可验证的系统健康、成本与安全事实。", contracts: [], prerequisite: "需要独立的 Admin health projection。" },
  { id: "platform-gateway", href: "/admin/platform-gateway", domain: "system", title: "平台与网关", subtitle: "航道", index: "A02", status: "planned", summary: "管理平台适配与网关连接。", contracts: [], prerequisite: "需要授权后的 gateway projection。" },
  { id: "model-router", href: "/admin/model-router", domain: "system", title: "Provider 与模型路由", subtitle: "星门", index: "A03", status: "planned", summary: "查看 Provider、模型与路由事实。", contracts: [], prerequisite: "需要 model-router projection 与版本合同。" },
  { id: "plugins-skills-mcp", href: "/admin/plugins-skills-mcp", domain: "system", title: "插件、Skills 与 MCP", subtitle: "工具舱", index: "A04", status: "planned", summary: "查看扩展、技能与工具主机状态。", contracts: [], prerequisite: "需要 capability-scoped plugin and MCP projection。" },
  { id: "sessions-people", href: "/admin/sessions-people", domain: "system", title: "会话与人物", subtitle: "名册", index: "A05", status: "planned", summary: "查看主体、会话与人物关系。", contracts: [], prerequisite: "需要 principal-scoped session and people projection。" },
  { id: "schedule", href: "/admin/schedule", domain: "system", title: "调度计划", subtitle: "星历", index: "A06", status: "planned", summary: "查看计划任务与触发来源。", contracts: [], prerequisite: "需要 schedule projection 与取消语义。" },
  { id: "logs-trace", href: "/admin/logs-trace", domain: "system", title: "日志与 Trace", subtitle: "回声档案", index: "A07", status: "planned", summary: "按授权范围检查因果轨迹。", contracts: [], prerequisite: "需要通用 TraceProjection 与脱敏规则。" },
  { id: "settings", href: "/admin/settings", domain: "system", title: "系统设置", subtitle: "定标室", index: "A08", status: "planned", summary: "查看可安全暴露的系统设置。", contracts: [], prerequisite: "需要字段级读写权限与 revision。" },
  { id: "resources-knowledge", href: "/admin/resources-knowledge", domain: "system", title: "资源与知识", subtitle: "藏书穹顶", index: "A09", status: "planned", summary: "查看资源、索引与知识来源。", contracts: [], prerequisite: "需要资源与知识的只读 projection。" },
  { id: "setup", href: "/admin/setup", domain: "system", title: "安装与初始化", subtitle: "点火序列", index: "A10", status: "planned", summary: "检查安装、依赖与初始化阶段。", contracts: [], prerequisite: "需要幂等 setup state machine。" },
  { id: "soul", href: "/admin/soul", domain: "soul", title: "Soul 配置", subtitle: "灵魂档案", index: "S01", status: "planned", summary: "查看 Soul 身份、版本与纯度事实。", contracts: [], prerequisite: "需要只读 SoulPackage projection。" },
  { id: "memory", href: "/admin/memory", domain: "soul", title: "记忆系统", subtitle: "深空存档", index: "S02", status: "planned", summary: "查看记忆层、来源与保留策略。", contracts: [], prerequisite: "需要授权后的 Memory projection。" },
  { id: "emotion", href: "/admin/emotion", domain: "soul", title: "情绪系统", subtitle: "潮汐仪", index: "S03", status: "planned", summary: "查看情绪模型与衰减来源。", contracts: [], prerequisite: "需要 emotion history projection。" },
  { id: "moa-teaching", href: "/admin/moa-teaching", domain: "soul", title: "MoA 与教学", subtitle: "议事庭", index: "S04", status: "planned", summary: "查看讨论、教学与裁决证据。", contracts: [], prerequisite: "需要 MoA and teaching projection。" },
  { id: "training", href: "/admin/training", domain: "soul", title: "训练", subtitle: "飞轮", index: "S05", status: "planned", summary: "查看训练集、轮次与产物。", contracts: [], prerequisite: "需要可追溯 training run contract。" },
  { id: "voice", href: "/admin/voice", domain: "soul", title: "声音与声纹", subtitle: "声纹室", index: "S06", status: "planned", summary: "查看声音模型、声纹与权限边界。", contracts: [], prerequisite: "现有 Presence voiceprint 合同不足以构成 Admin 模块。" },
  { id: "effector", href: "/admin/effector", domain: "soul", title: "执行策略与审计", subtitle: "丁册", index: "S07", status: "available", summary: "管理执行策略、安全底线、急停与审计链。", contracts: ["GET /v1/admin/effector/policy", "PUT /v1/admin/effector/policy", "GET /v1/admin/effector/audit", "GET /v1/effector/status", "POST /v1/effector/estop", "POST /v1/effector/estop/reset"], prerequisite: "现有 Core 合同已提供。" },
  { id: "migration", href: "/admin/migration", domain: "soul", title: "灵魂迁移", subtitle: "远航封装", index: "S08", status: "planned", summary: "查看灵魂包迁移、校验与回滚。", contracts: [], prerequisite: "需要签名迁移包、兼容性与回滚合同。" },
] as const satisfies readonly ControlModule[];

export type ControlModuleId = (typeof modules)[number]["id"];
export const CONTROL_MODULES = Object.freeze(modules);
export function getControlModule(id: string): ControlModule | undefined {
  return CONTROL_MODULES.find((module) => module.id === id);
}
export function getControlModulesByDomain(domain: ControlDomain): readonly ControlModule[] {
  return CONTROL_MODULES.filter((module) => module.domain === domain);
}
```

- [ ] **Step 4: Run focused and full registry tests**

Run: `cd webapp && npm test -- --run src/features/control/model/control-modules.test.ts`  
Expected: 3 tests PASS.  
Run: `cd webapp && npm run typecheck`  
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add webapp/src/features/control/model/control-modules.ts webapp/src/features/control/model/control-modules.test.ts
git commit -m "feat: define Control module registry"
```

---

### Task 2: Sovereign Spine, Archive Atlas, and All Routes

**Files:**

- Replace: `webapp/src/app/admin/page.tsx`
- Create: `webapp/src/app/admin/layout.tsx`
- Create: `webapp/src/app/admin/[module]/page.tsx`
- Create: `webapp/src/features/control/components/ControlShell.tsx`
- Create: `webapp/src/features/control/components/ControlShell.module.css`
- Create: `webapp/src/features/control/components/ControlAtlas.tsx`
- Create: `webapp/src/features/control/components/ControlAtlas.test.tsx`
- Create: `webapp/src/features/control/components/ModuleDossier.tsx`
- Create: `webapp/src/features/control/components/ModuleDossier.test.tsx`

**Interfaces:**

- Consumes: Task 1's registry.
- Produces: `ControlShell`, `ControlAtlas`, `ModuleDossier`, `/admin`, and `/admin/[module]`.
- Defers: importing `EffectorWorkspace` through a temporary static boundary component that is replaced in Task 6.

- [ ] **Step 1: Write failing shell and dossier tests**

Test that the atlas renders 18 links, exposes two named regions, gives Effector the available label, gives the other 17 planned labels, and renders no action button for a planned module:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getControlModule } from "../model/control-modules";
import { ControlAtlas } from "./ControlAtlas";
import { ModuleDossier } from "./ModuleDossier";

describe("Control atlas", () => {
  it("renders the complete two-domain archive", () => {
    render(<ControlAtlas />);
    expect(within(screen.getByRole("region", { name: "系统域" })).getAllByRole("link"))
      .toHaveLength(10);
    expect(within(screen.getByRole("region", { name: "Soul 域" })).getAllByRole("link"))
      .toHaveLength(8);
    expect(screen.getByRole("link", { name: /执行策略与审计/ })).toHaveTextContent("可用");
  });
});

describe("planned module dossier", () => {
  it("states the missing contract without inventing an operation", () => {
    render(<ModuleDossier module={getControlModule("model-router")!} />);
    expect(screen.getByRole("heading", { name: "Provider 与模型路由" })).toBeVisible();
    expect(screen.getByText("当前 Core 未提供此模块的网页合同")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/components/ControlAtlas.test.tsx src/features/control/components/ModuleDossier.test.tsx`  
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Build the archive components**

`ControlAtlas` maps both domains from the registry into semantic `<section aria-label>` groups and `<Link>` rows. Each row includes `index`, `title`, `subtitle`, and visible `可用`/`规划中` copy. `ModuleDossier` uses this stable structure:

```tsx
import type { ControlModule } from "../model/control-modules";

export function ModuleDossier({ module }: { readonly module: ControlModule }) {
  return (
    <article aria-labelledby="module-title">
      <p>{module.index} · {module.domain === "system" ? "系统域" : "Soul 域"}</p>
      <h1 id="module-title">{module.title}</h1>
      <p>{module.subtitle}</p>
      <p>{module.summary}</p>
      <section aria-labelledby="contract-boundary-title">
        <h2 id="contract-boundary-title">合同边界</h2>
        <strong>当前 Core 未提供此模块的网页合同</strong>
        <p>{module.prerequisite}</p>
        <p>状态：规划中 · 无可执行操作</p>
      </section>
    </article>
  );
}
```

Use `<span data-status="available|planned">` plus copy and line style, never color alone. No fake numbers, charts, logs, controls, or skeleton data.

- [ ] **Step 4: Build the shell and routes**

`layout.tsx` wraps children with `<ControlShell>`. `page.tsx` renders the full atlas. Dynamic routes use the registry and `notFound()`:

```tsx
import { notFound } from "next/navigation";

import { ModuleDossier } from "@/features/control/components/ModuleDossier";
import { getControlModule } from "@/features/control/model/control-modules";

export default async function ControlModulePage({
  params,
}: {
  readonly params: Promise<{ readonly module: string }>;
}) {
  const { module: moduleId } = await params;
  const module = getControlModule(moduleId);
  if (!module) notFound();
  return <ModuleDossier module={module} />;
}
```

Until Task 6, the Effector dossier may show `合同已提供 · 工作面正在迁移` but must not expose fake controls. `ControlShell` includes:

- a 64–76px desktop sovereign spine with 星枢 / Control, a link back to Presence, and a native `<details id="module-index">` atlas trigger;
- a document header with current module derived from `usePathname()` and a visible `SURFACE W2` label;
- `<main id="main-content">` for children;
- static CSS star coordinates and one eclipse notch;
- day/night material parity through existing tokens;
- narrow layout below 760px with a horizontal top spine and full-width details panel.

Do not import `framer-motion`, Pixi, Live2D, Lens, Canvas, or any RAF helper.

- [ ] **Step 5: Run tests, lint, typecheck, and route build**

Run: `cd webapp && npm test -- --run src/features/control`  
Expected: all Control tests PASS.  
Run: `cd webapp && npm run lint && npm run typecheck && npm run build`  
Expected: exit 0 and routes `/admin` plus `/admin/[module]` build.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/app/admin webapp/src/features/control/components
git commit -m "feat: build Control archive shell"
```

---

### Task 3: Strict Existing-Core Effector Client

**Files:**

- Create: `webapp/src/features/control/data/effector-types.ts`
- Create: `webapp/src/features/control/data/effector-client.ts`
- Create: `webapp/src/features/control/data/effector-client.test.ts`

**Interfaces:**

- Produces: `EffectorPolicy`, `EffectorAudit`, `EffectorStatus`, `PolicyPatch`, `EffectorClient`, `createEffectorClient()`.
- All methods accept an optional `AbortSignal`.
- No new endpoint names are permitted.

- [ ] **Step 1: Write failing contract tests**

Cover exact method/path/body behavior, non-2xx rejection, malformed policy/audit/status rejection, and `error` response rejection. The expected request sequence is:

```ts
expect(fetcher).toHaveBeenNthCalledWith(1, "/api/core/v1/admin/effector/policy", {
  cache: "no-store",
  signal,
});
expect(fetcher).toHaveBeenNthCalledWith(2, "/api/core/v1/admin/effector/policy", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ approval_mode: "audited" }),
  signal,
});
expect(fetcher).toHaveBeenNthCalledWith(
  3,
  "/api/core/v1/admin/effector/audit?date=2026-07-13&limit=100",
  { cache: "no-store", signal },
);
expect(fetcher).toHaveBeenNthCalledWith(4, "/api/core/v1/effector/status", {
  cache: "no-store",
  signal,
});
expect(fetcher).toHaveBeenNthCalledWith(5, "/api/core/v1/effector/estop", {
  method: "POST",
  signal,
});
expect(fetcher).toHaveBeenNthCalledWith(6, "/api/core/v1/effector/estop/reset", {
  method: "POST",
  signal,
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/data/effector-client.test.ts`  
Expected: FAIL because the client does not exist.

- [ ] **Step 3: Define exact TypeScript contracts**

Use readonly types. `PolicyPatch` is a partial pick of only the nine writable keys. Audit entries accept the existing required display keys and preserve extra JSON fields without projecting them into UI. Safety truth is derived only from `EffectorStatus.stopped`.

```ts
export interface EffectorPolicy {
  readonly approval_mode: "ask" | "audited" | "auto";
  readonly headless_scope: "cwd" | "folders" | "full";
  readonly headless_cwd: string;
  readonly headless_folders: readonly string[];
  readonly app_whitelist: readonly string[];
  readonly login_sites_whitelist: readonly string[];
  readonly dangerous_categories: readonly string[];
  readonly dangerous_keywords: readonly string[];
  readonly max_steps_per_task: number;
  readonly sandbox_dir: string;
  readonly core_dangerous_categories: readonly string[];
  readonly core_dangerous_keywords: readonly string[];
  readonly locked: readonly string[];
  readonly overlay_path: string;
}

export type PolicyPatch = Partial<Pick<EffectorPolicy,
  | "approval_mode"
  | "headless_scope"
  | "headless_cwd"
  | "headless_folders"
  | "app_whitelist"
  | "login_sites_whitelist"
  | "dangerous_categories"
  | "dangerous_keywords"
  | "max_steps_per_task"
>>;

export interface EffectorAuditEntry {
  readonly ts: string;
  readonly trace_id: string;
  readonly track: string;
  readonly description: string;
  readonly decision: string;
  readonly dangerous: boolean;
}

export interface EffectorAudit {
  readonly dates: readonly string[];
  readonly date: string | null;
  readonly entries: readonly EffectorAuditEntry[];
  readonly total?: number;
  readonly chain_valid: boolean | null;
}

export interface EffectorStatus {
  readonly stopped: boolean;
  readonly pending: Readonly<Record<string, unknown>>;
  readonly audit_tail: readonly Readonly<Record<string, unknown>>[];
}
```

- [ ] **Step 4: Implement validated fetch methods**

`requestJson()` must throw `EffectorClientError` with `operation`, HTTP status, and safe message on non-2xx. Manual decoders require all keys used by UI, clone arrays/records, reject `NaN`, and freeze returned values. Do not silently default missing server fields.

```ts
export interface EffectorClient {
  readonly policy: (signal?: AbortSignal) => Promise<EffectorPolicy>;
  readonly patchPolicy: (patch: PolicyPatch, signal?: AbortSignal) => Promise<EffectorPolicy>;
  readonly audit: (date?: string, limit?: number, signal?: AbortSignal) => Promise<EffectorAudit>;
  readonly status: (signal?: AbortSignal) => Promise<EffectorStatus>;
  readonly estop: (signal?: AbortSignal) => Promise<{ readonly stopped: boolean }>;
  readonly reset: (signal?: AbortSignal) => Promise<{ readonly stopped: boolean }>;
}
```

Reject an empty `PolicyPatch` before network I/O. Encode date with `URLSearchParams`; clamp audit limit to `1..500`.

- [ ] **Step 5: Run client tests and static checks**

Run: `cd webapp && npm test -- --run src/features/control/data/effector-client.test.ts`  
Expected: all tests PASS.  
Run: `cd webapp && npm run lint && npm run typecheck`  
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/features/control/data
git commit -m "feat: add truthful Effector client"
```

---

### Task 4: Effector Controller and Authoritative Safety Readback

**Files:**

- Create: `webapp/src/features/control/controller/create-effector-controller.ts`
- Create: `webapp/src/features/control/controller/create-effector-controller.test.ts`
- Create: `webapp/src/features/control/controller/use-effector-controller.ts`
- Create: `webapp/src/features/control/controller/use-effector-controller.test.tsx`

**Interfaces:**

- Consumes: Task 3 `EffectorClient`.
- Produces: immutable `EffectorSnapshot`, `EffectorActions`, `createEffectorController()`, `useEffectorController()`.

- [ ] **Step 1: Write failing controller tests**

Cover these independent cases:

1. `start()` publishes policy, audit, and status separately; one rejected request only marks its own channel failed.
2. A second refresh aborts and supersedes the first without stale publication.
3. `patchPolicy()` prevents a second concurrent patch and preserves the last verified policy on failure.
4. `estop()` POST acknowledgement followed by status `stopped: true` yields `latched`.
5. `estop()` followed by status `stopped: false`, or failed readback, yields `unknown` and returns `false`.
6. `reset()` yields `clear` only after status `stopped: false`.
7. E-stop is callable while a policy patch promise remains pending.
8. `dispose()` aborts active operations and prevents later publication.

Use deferred promises rather than timers.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/controller`  
Expected: FAIL because controller modules do not exist.

- [ ] **Step 3: Implement immutable controller state**

Use this public shape:

```ts
export type ChannelState = "idle" | "loading" | "ready" | "error";
export type SafetyEvidence = "checking" | "clear" | "latched" | "unknown";

export interface EffectorSnapshot {
  readonly policy: EffectorPolicy | null;
  readonly audit: EffectorAudit | null;
  readonly status: EffectorStatus | null;
  readonly channels: Readonly<Record<"policy" | "audit" | "status", ChannelState>>;
  readonly errors: Readonly<Partial<Record<"policy" | "audit" | "status" | "mutation", string>>>;
  readonly selectedAuditDate: string | null;
  readonly savingPolicy: boolean;
  readonly safetyMutation: "estop" | "reset" | null;
  readonly safetyEvidence: SafetyEvidence;
}

export interface EffectorActions {
  readonly refreshAll: () => void;
  readonly refreshPolicy: () => void;
  readonly refreshAudit: (date?: string) => void;
  readonly refreshStatus: () => void;
  readonly patchPolicy: (patch: PolicyPatch) => Promise<boolean>;
  readonly estop: () => Promise<boolean>;
  readonly reset: () => Promise<boolean>;
}
```

The controller exposes `subscribe`, `getSnapshot`, `getServerSnapshot`, `start`, `dispose`, and `actions`. It performs no I/O until `start()` or an action is called. Cache snapshots and replace only on semantic mutation. Clone/freeze server data at the client boundary.

Safety algorithms are exact:

```ts
async function runSafetyMutation(kind: "estop" | "reset"): Promise<boolean> {
  publish({ safetyMutation: kind, errors: withoutMutationError() });
  try {
    if (kind === "estop") await client.estop(signal());
    else await client.reset(signal());
    const readback = await client.status(signal());
    const confirmed = kind === "estop" ? readback.stopped : !readback.stopped;
    publish({
      status: readback,
      safetyMutation: null,
      safetyEvidence: confirmed ? (readback.stopped ? "latched" : "clear") : "unknown",
      channels: withStatusReady(),
      errors: confirmed ? withoutMutationError() : withMutationError("权威回读与操作目标不一致"),
    });
    return confirmed;
  } catch (error) {
    publish({
      safetyMutation: null,
      safetyEvidence: "unknown",
      errors: withMutationError(safeErrorMessage(error)),
    });
    return false;
  }
}
```

Helpers in the final implementation may differ internally, but the observable state transitions must match exactly.

- [ ] **Step 4: Implement the React hook**

Create one controller with a lazy `useState`, call `start()`/`dispose()` in an effect, and read with all three `useSyncExternalStore` arguments. Return `{ snapshot, actions }`. Do not mirror controller data with effect-driven `setState`.

- [ ] **Step 5: Run controller, full unit, lint, and typecheck**

Run: `cd webapp && npm test -- --run src/features/control/controller`  
Expected: all focused tests PASS.  
Run: `cd webapp && npm run test:run && npm run lint && npm run typecheck`  
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add webapp/src/features/control/controller
git commit -m "feat: model Effector control truth"
```

---

### Task 5: Accessible Policy and Safety Editors

**Files:**

- Create: `webapp/src/features/control/components/SegmentedRadio.tsx`
- Create: `webapp/src/features/control/components/SegmentedRadio.test.tsx`
- Create: `webapp/src/features/control/components/PolicyChipEditor.tsx`
- Create: `webapp/src/features/control/components/PolicyChipEditor.test.tsx`
- Create: `webapp/src/features/control/components/EffectorPolicyEditor.tsx`
- Create: `webapp/src/features/control/components/EffectorPolicyEditor.test.tsx`
- Create: `webapp/src/features/control/components/SafetyControl.tsx`
- Create: `webapp/src/features/control/components/SafetyControl.test.tsx`
- Create: `webapp/src/features/control/components/EffectorWorkspace.module.css`

**Interfaces:**

- Consumes: `EffectorPolicy`, `PolicyPatch`, `SafetyEvidence`, `EffectorActions`.
- Produces: accessible editors with no direct fetch calls.

- [ ] **Step 1: Write failing interaction tests**

Tests must prove:

- `SegmentedRadio` exposes one radiogroup and true radios; Right/Down select next, Left/Up select previous, Home/End select edges, focus follows selection, disabled prevents changes.
- `PolicyChipEditor` ignores Enter during IME composition, trims and deduplicates, preserves locked chips, labels removal buttons, and never renders a removal button for a locked core item.
- `EffectorPolicyEditor` emits only the changed writable key, disables ordinary policy controls while `savingPolicy`, and renders `sandbox_dir`, `overlay_path`, and `locked` as read-only evidence.
- `SafetyControl` stays enabled during policy saving, renders checking/clear/latched/unknown in text, calls `estop` from clear/unknown and `reset` from latched, and never flips its own status before new props arrive.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/components/SegmentedRadio.test.tsx src/features/control/components/PolicyChipEditor.test.tsx src/features/control/components/EffectorPolicyEditor.test.tsx src/features/control/components/SafetyControl.test.tsx`  
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement radiogroup keyboard semantics**

Use native radio inputs or buttons with `role="radio"`, `aria-checked`, roving `tabIndex`, and this key map:

```ts
const deltaByKey: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};
```

Home selects index 0; End selects the last index; wrapping is allowed. Call `onChange` once, then focus the newly selected radio. Labels are visible Chinese copy, not English microtext alone.

- [ ] **Step 4: Implement chip and policy editors**

`PolicyChipEditor` accepts `items`, `locked`, `labelMap`, `label`, `placeholder`, `disabled`, `onChange`. On add it calls `onChange([...items, value])`; on remove it filters only unlocked values. The editor uses a named text input and a 44px add button.

`EffectorPolicyEditor` groups:

- `approval_mode`: 请求 / 自审核 / 全自动;
- `headless_scope`: 当前目录 / 白名单目录 / 全电脑;
- conditional folder editor;
- app and login-site editors;
- max steps numeric input constrained to `1..100`;
- dangerous categories and keywords, with core values locked;
- read-only source strip for cwd, sandbox, overlay, and locked fields.

Every patch is one key and contains the complete array for list fields.

- [ ] **Step 5: Implement independent safety control**

The component accepts `evidence`, `mutation`, `onEstop`, and `onReset`; it does not receive `savingPolicy`. The button label is exact:

- checking: `安全状态检查中`
- clear: `触发急停`
- latched: `急停已闩锁 · 请求复位`
- unknown: `安全状态未知 · 重新触发急停`

The button remains present for every state. Use danger styling and text/shape, no pulse loop.

- [ ] **Step 6: Run focused and static verification**

Run: `cd webapp && npm test -- --run src/features/control/components`  
Expected: all focused tests PASS.  
Run: `cd webapp && npm run lint && npm run typecheck`  
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/features/control/components/SegmentedRadio.tsx webapp/src/features/control/components/SegmentedRadio.test.tsx webapp/src/features/control/components/PolicyChipEditor.tsx webapp/src/features/control/components/PolicyChipEditor.test.tsx webapp/src/features/control/components/EffectorPolicyEditor.tsx webapp/src/features/control/components/EffectorPolicyEditor.test.tsx webapp/src/features/control/components/SafetyControl.tsx webapp/src/features/control/components/SafetyControl.test.tsx webapp/src/features/control/components/EffectorWorkspace.module.css
git commit -m "feat: build Control policy editors"
```

---

### Task 6: Audit Ledger and Complete Effector Workspace

**Files:**

- Create: `webapp/src/features/control/components/AuditLedger.tsx`
- Create: `webapp/src/features/control/components/AuditLedger.test.tsx`
- Create: `webapp/src/features/control/components/EffectorWorkspace.tsx`
- Create: `webapp/src/features/control/components/EffectorWorkspace.test.tsx`
- Modify: `webapp/src/app/admin/[module]/page.tsx`
- Modify: `webapp/src/features/control/components/ControlShell.module.css`
- Modify: `webapp/src/features/control/components/EffectorWorkspace.module.css`

**Interfaces:**

- Consumes: Task 4 hook/actions and Task 5 editors.
- Produces: the only interactive Workstream 2 module.

- [ ] **Step 1: Write failing ledger and integration tests**

Cover:

- audit `chain_valid: true`, `false`, and `null` with exact visible copy and no green classes/tokens;
- date selector calls `refreshAudit(date)` and refresh retains selected date;
- empty selected date copy does not claim the system has never run;
- every entry exposes decision, track, dangerous, full trace ID, localized timestamp, and description without hover-only evidence;
- partial policy failure still renders status/safety and audit;
- partial audit failure still renders policy;
- last verified policy/audit stays visible with a `可能陈旧` label after refresh failure;
- `/admin/effector` receives the real workspace while every other module remains a planned dossier.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd webapp && npm test -- --run src/features/control/components/AuditLedger.test.tsx src/features/control/components/EffectorWorkspace.test.tsx`  
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the audit ledger**

Use a rectangular `<section id="audit-ledger" aria-labelledby="audit-title">`, native date `<select>`, 44px refresh button, visible integrity label, and `<ol>`. Integrity copy is exact:

- true: `链完整 · 校验通过`
- false: `链断裂 · 证据可能被修改`
- null: `未提供链完整性证据`

Map decision colors only to existing action/warning/danger/silver roles. Never use `--astr-success` because the Control spec requires cold-blue/silver success semantics.

- [ ] **Step 4: Integrate the Effector workspace**

`EffectorWorkspace` calls `useEffectorController(createEffectorClient())`, renders local skip links to `#control-form` and `#audit-ledger`, and composes:

1. module header and contract source list;
2. `SafetyControl` independent from policy load/save;
3. policy channel loading/error/stale state plus `EffectorPolicyEditor`;
4. audit channel loading/error/stale state plus `AuditLedger`;
5. status evidence with pending count and audit-tail count only when supplied by Core.

Do not create a dashboard KPI grid. Use asymmetric desktop columns around a central dossier seam, then one-column flow below 980px. Keep the form and ledger roomy; do not compress them into a narrow rail.

- [ ] **Step 5: Switch the dynamic route to the real workspace**

```tsx
if (module.id === "effector") {
  return <EffectorWorkspace module={module} />;
}
return <ModuleDossier module={module} />;
```

The route does not branch on any other unavailable internal capability.

- [ ] **Step 6: Run focused, full, lint, typecheck, and build**

Run: `cd webapp && npm test -- --run src/features/control`  
Expected: all Control tests PASS.  
Run: `cd webapp && npm run test:run && npm run lint && npm run typecheck && npm run build`  
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add webapp/src/app/admin/[module]/page.tsx webapp/src/features/control/components/AuditLedger.tsx webapp/src/features/control/components/AuditLedger.test.tsx webapp/src/features/control/components/EffectorWorkspace.tsx webapp/src/features/control/components/EffectorWorkspace.test.tsx webapp/src/features/control/components/ControlShell.module.css webapp/src/features/control/components/EffectorWorkspace.module.css
git commit -m "feat: migrate Effector Control workspace"
```

---

### Task 7: Control Boundary, Browser Acceptance, and Final Verification

**Files:**

- Modify: `webapp/e2e/support/mock-core.mjs`
- Modify: `webapp/e2e/support/mock-core.test.ts`
- Create: `webapp/e2e/control.spec.ts`
- Create: `webapp/e2e/control-a11y.spec.ts`
- Create: `webapp/scripts/check-control-boundaries.mjs`
- Create: `webapp/scripts/check-control-boundaries.test.mjs`
- Modify: `webapp/package.json`
- Modify: `webapp/README.md`
- Create: `webapp/docs/control-verification.md`

**Interfaces:**

- Extends the existing mock only with exact current Core Admin shapes.
- Produces: `check:control-boundaries`, Control Playwright coverage, screenshots, and operator documentation.

- [ ] **Step 1: Write failing mock contract and boundary tests**

Mock tests require exact endpoints and bodies:

- GET/PUT policy with cumulative patch behavior and `422` for invalid modes;
- GET audit with date/limit query support;
- GET status plus POST stop/reset and authoritative readback controls;
- no Task/device/model/plugin/memory/training/migration route.

Boundary fixture tests must fail on:

- `requestAnimationFrame(`, `.getContext(`, `<canvas`, `new Application(`, `Ticker.shared`, Live2D/Pixi/Lens imports anywhere under `src/app/admin` or `src/features/control`;
- green literals through the shared constitutional scanner;
- a registry where available modules are not exactly `effector`;
- an Admin production chunk containing `pixi`, `live2d`, `soul-lens`, or a 2048 texture path;
- missing/stale build evidence or zero resolved Admin chunks.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd webapp && npm test -- --run e2e/support/mock-core.test.ts`  
Expected: new Admin mock cases FAIL.  
Run: `cd webapp && npm test -- --run scripts/check-control-boundaries.test.mjs`  
Expected: FAIL because the boundary command does not exist.

- [ ] **Step 3: Extend the mock with contract-faithful Admin state**

Use the same field names as `read_policy`, `read_audit`, and `effector_status`. PUT accepts only current `PolicyUpdate` fields and returns the full effective policy. Test controls may delay/fail real endpoints but must not add product fields or remote capabilities.

- [ ] **Step 4: Implement the fail-closed Control boundary command**

Follow the existing Presence boundary's build-ID/source-hash discipline. The report shape is:

```json
{
  "schemaVersion": 1,
  "check": "control-boundaries",
  "passed": true,
  "sourceFilesScanned": 0,
  "availableModules": ["effector"],
  "buildEvidence": { "status": "checked", "chunks": [] },
  "violations": []
}
```

`status: checked` with zero chunks is forbidden. The command scans only Control/Admin production sources plus their built client chunks; it does not weaken Presence rules. Add `"check:control-boundaries": "node scripts/check-control-boundaries.mjs"` to package scripts.

- [ ] **Step 5: Write Control browser acceptance first**

`control.spec.ts` covers:

- `/admin` has exactly 18 route links and no console/page/hydration errors;
- all 18 hrefs return a valid page; only Effector has interactive policy controls;
- module atlas opens/closes and retains keyboard focus;
- dark/light material switch preserves module geometry and status;
- desktop 1440×1000 and mobile 390×844 snapshots in both themes;
- no horizontal overflow at 1440, 980, 390, and 320;
- policy patch sends one exact body and reflects returned effective policy;
- policy failure retains verified data and shows stale/error evidence;
- stop/reset POST then status GET; contrary/failing readback becomes unknown;
- audit date, empty state, full trace ID, and chain true/false/null.

`control-a11y.spec.ts` covers axe critical/serious zero on index, planned, Effector ready/offline/latched/unknown, keyboard route through local skip links and radiogroups, and 200%/400% zoom-equivalent viewports.

- [ ] **Step 6: Implement only evidence-backed UI fixes**

Run the new browser specs against production build. Fix source defects; do not relax axe, screenshots, API ordering, overflow, or boundary assertions.

- [ ] **Step 7: Document truth and verification**

`control-verification.md` lists the six allowed endpoints, the 17 planned modules, build/boundary order, screenshot viewports, real-Core limitation, 0 WebGL/Canvas/continuous RAF rule, and exact commands. README links both Presence and Control verification docs.

- [ ] **Step 8: Run complete Workstream 2 acceptance**

Run sequentially:

```bash
cd webapp
npm run test:run
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- e2e/control.spec.ts e2e/control-a11y.spec.ts
npm run check:control-boundaries
```

Then from repo root:

```bash
git diff --check
git diff --name-only -- src tests pyproject.toml
git status --short
```

Expected:

- all automated commands exit 0;
- backend diff is empty;
- exactly 18 module routes, one available module, no invented operations;
- 0 critical/serious axe findings and no overflow;
- policy/audit/status partial errors retain verified evidence;
- e-stop/reset truth comes from readback;
- Control boundary reports real nonzero Admin chunks and no heavy visual bytes or rendering ownership.

- [ ] **Step 9: Stage only Control paths and commit**

```bash
git add webapp/e2e/control.spec.ts webapp/e2e/control-a11y.spec.ts webapp/e2e/support/mock-core.mjs webapp/e2e/support/mock-core.test.ts webapp/scripts/check-control-boundaries.mjs webapp/scripts/check-control-boundaries.test.mjs webapp/package.json webapp/package-lock.json webapp/README.md webapp/docs/control-verification.md
git commit -m "test: enforce Control experience boundaries"
```

---

## Workstream 2 Final Review

After Task 7:

1. Generate a review package from the Workstream 2 plan commit through the final acceptance commit.
2. Dispatch a fresh read-only reviewer against this plan, the Control sub-spec, and the Master Spec Control sections.
3. Fix all Critical and Important findings in one focused task; rerun complete Workstream 2 acceptance and re-review.
4. Record Minor findings in `.superpowers/sdd/progress.md`.
5. Mark Workstream 2 complete only after review approval and an empty backend diff.
6. Proceed directly to Workstream 3A Studio projection specification; do not invent Studio projections in the frontend.
