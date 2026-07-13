# ASTR Mobile Domain Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the single immutable metadata source for the five exact ASTR Mobile domains without importing UI or business behavior.

**Architecture:** A pure TypeScript registry defines IDs, stable hrefs, labels, order, indexes, and truthful availability states. A total pathname lookup returns Presence metadata for `/mobile` and unknown paths; routing itself remains the App Router's responsibility.

**Tech Stack:** TypeScript, Vitest, Node file inspection.

## Global Constraints

- Create only `webapp/src/features/mobile/model/mobile-domains.ts` and its test.
- The exact ordered IDs are `presence`, `tasks`, `workbench`, `knowledge`, `safety`.
- The exact hrefs are `/mobile/<id>`; no sixth domain or dynamic route exists.
- Statuses are exactly `local-available`, `local-only`, `unavailable`, `unavailable`, `local-read-only` in domain order.
- The registry contains metadata only: no component, controller, data client, fetch, or dynamic import.
- This task performs no routing, I/O, environment read, storage access, or backend change.
- Commands run from `D:\ASTR_System\astr\webapp`; Git commands run from `D:\ASTR_System\astr`.

---

### Task 1: Implement and verify the five-domain registry

**Files:**

- Create: `webapp/src/features/mobile/model/mobile-domains.test.ts`
- Create: `webapp/src/features/mobile/model/mobile-domains.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `webapp/src/features/mobile/model/mobile-domains.test.ts` with exactly:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MOBILE_DOMAINS, getMobileDomainByPath } from "./mobile-domains";

const EXPECTED_IDS = ["presence", "tasks", "workbench", "knowledge", "safety"];
const EXPECTED_HREFS = [
  "/mobile/presence",
  "/mobile/tasks",
  "/mobile/workbench",
  "/mobile/knowledge",
  "/mobile/safety",
];

describe("Mobile domain registry", () => {
  it("defines the exact five-domain information architecture once", () => {
    expect(MOBILE_DOMAINS.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(MOBILE_DOMAINS.map(({ href }) => href)).toEqual(EXPECTED_HREFS);
    expect(MOBILE_DOMAINS.map(({ index }) => index)).toEqual(["01", "02", "03", "04", "05"]);
    expect(MOBILE_DOMAINS.map(({ status }) => status)).toEqual([
      "local-available",
      "local-only",
      "unavailable",
      "unavailable",
      "local-read-only",
    ]);
    expect(new Set(MOBILE_DOMAINS.map(({ id }) => id)).size).toBe(5);
    expect(new Set(MOBILE_DOMAINS.map(({ href }) => href)).size).toBe(5);
  });

  it("publishes a deeply immutable registry", () => {
    expect(Object.isFrozen(MOBILE_DOMAINS)).toBe(true);
    for (const domain of MOBILE_DOMAINS) expect(Object.isFrozen(domain)).toBe(true);
  });

  it("looks up exact routes and uses Presence metadata as the total fallback", () => {
    expect(getMobileDomainByPath("/mobile/tasks").id).toBe("tasks");
    expect(getMobileDomainByPath("/mobile/safety").id).toBe("safety");
    expect(getMobileDomainByPath("/mobile").id).toBe("presence");
    expect(getMobileDomainByPath("/mobile/unknown").id).toBe("presence");
    expect(getMobileDomainByPath("").id).toBe("presence");
  });

  it("remains metadata-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/mobile/model/mobile-domains.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /components\/|controller\/|data\/|fetch\s*\(|import\s*\(|CoreClient|SafetyClient/,
    );
  });
});
```

- [ ] **Step 2: Run the registry test and confirm RED**

Run:

```powershell
npm test -- --run src/features/mobile/model/mobile-domains.test.ts
```

Expected: FAIL because `./mobile-domains` does not exist.

- [ ] **Step 3: Implement the immutable registry**

Create `webapp/src/features/mobile/model/mobile-domains.ts` with exactly:

```ts
export type MobileDomainId = "presence" | "tasks" | "workbench" | "knowledge" | "safety";
export type MobileDomainHref = `/mobile/${MobileDomainId}`;
export type MobileDomainStatus =
  | "local-available"
  | "local-only"
  | "unavailable"
  | "local-read-only";

export interface MobileDomainDefinition {
  readonly id: MobileDomainId;
  readonly href: MobileDomainHref;
  readonly label: string;
  readonly index: string;
  readonly status: MobileDomainStatus;
}

const domainDefinitions = [
  {
    id: "presence",
    href: "/mobile/presence",
    label: "露怀秋",
    index: "01",
    status: "local-available",
  },
  {
    id: "tasks",
    href: "/mobile/tasks",
    label: "任务",
    index: "02",
    status: "local-only",
  },
  {
    id: "workbench",
    href: "/mobile/workbench",
    label: "AI 工作台",
    index: "03",
    status: "unavailable",
  },
  {
    id: "knowledge",
    href: "/mobile/knowledge",
    label: "知识",
    index: "04",
    status: "unavailable",
  },
  {
    id: "safety",
    href: "/mobile/safety",
    label: "设备与安全",
    index: "05",
    status: "local-read-only",
  },
] as const satisfies readonly MobileDomainDefinition[];

export const MOBILE_DOMAINS: readonly MobileDomainDefinition[] = Object.freeze(
  domainDefinitions.map((definition) => Object.freeze(definition)),
);

export function getMobileDomainByPath(pathname: string): MobileDomainDefinition {
  return MOBILE_DOMAINS.find(({ href }) => href === pathname) ?? MOBILE_DOMAINS[0];
}
```

- [ ] **Step 4: Run the registry test and confirm GREEN**

Run:

```powershell
npm test -- --run src/features/mobile/model/mobile-domains.test.ts
```

Expected: PASS with four tests.

- [ ] **Step 5: Run lint on the two registry files**

Run:

```powershell
npx eslint src/features/mobile/model/mobile-domains.ts src/features/mobile/model/mobile-domains.test.ts --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 6: Run TypeScript verification**

Run:

```powershell
npm run typecheck
```

Expected: exit 0 with no circular type inference.

- [ ] **Step 7: Stage the exact registry files**

Run from `D:\ASTR_System\astr`:

```powershell
git add webapp/src/features/mobile/model/mobile-domains.ts webapp/src/features/mobile/model/mobile-domains.test.ts
```

Expected: only the two registry files are staged.

- [ ] **Step 8: Commit the registry**

Run from `D:\ASTR_System\astr`:

```powershell
git commit -m "feat: define Mobile five-domain registry"
```

Expected: commit succeeds with the two registry files.
