import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const boundaryScript = resolve(process.cwd(), "scripts/check-mobile-boundaries.mjs");
const DOMAINS = ["presence", "tasks", "workbench", "knowledge", "safety"];
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { force: true, recursive: true });
  }
});

describe("Mobile production boundary command", () => {
  it("accepts the exact five-domain source and real per-route build evidence", () => {
    const root = createFixture();
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toMatchObject({
      schemaVersion: 1,
      check: "mobile-boundaries",
      passed: true,
      domains: DOMAINS,
      buildEvidence: {
        status: "checked",
        routes: [
          routeEvidence("presence", [".next/static/chunks/mobile-presence.js"]),
          routeEvidence("tasks", [".next/static/chunks/mobile-tasks.js"]),
          routeEvidence("workbench", []),
          routeEvidence("knowledge", []),
          routeEvidence("safety", [".next/static/chunks/mobile-safety.js"]),
        ],
      },
      violations: [],
    });
    expect(report.sourceFilesScanned).toBeGreaterThan(0);
  });

  it.each([
    [
      "green literal/token",
      "src/features/mobile/tasks/rogue.css",
      ".rogue { color: rgb(0, 255, 0); }",
      "no-green-hardcode",
    ],
    [
      "gradient",
      "src/features/mobile/tasks/rogue.css",
      ".rogue { background: linear-gradient(#111, #222); }",
      "mobile-forbidden-gradient",
    ],
    [
      "glass",
      "src/features/mobile/tasks/rogue.css",
      ".rogue { backdrop-filter: blur(12px); }",
      "mobile-forbidden-glass",
    ],
    [
      "keyframes",
      "src/features/mobile/tasks/rogue.css",
      "@keyframes orbit { to { opacity: .5; } }",
      "mobile-forbidden-animation",
    ],
    [
      "animation-name",
      "src/features/mobile/tasks/rogue.css",
      ".rogue { animation-name: orbit; }",
      "mobile-forbidden-animation",
    ],
    [
      "non-none animation",
      "src/features/mobile/tasks/rogue.css",
      ".rogue { animation: orbit 9s linear infinite; }",
      "mobile-forbidden-animation",
    ],
    [
      "RAF",
      "src/features/mobile/tasks/rogue.ts",
      "requestAnimationFrame(() => undefined);",
      "mobile-render-request-animation-frame",
    ],
    [
      "Canvas",
      "src/features/mobile/tasks/rogue.ts",
      "export const surface = document.createElement('canvas');",
      "mobile-render-canvas-webgl",
    ],
    [
      "WebGL",
      "src/features/mobile/tasks/rogue.ts",
      "surface.getContext('webgl2');",
      "mobile-render-canvas-webgl",
    ],
    [
      "W5 type",
      "src/features/mobile/tasks/rogue.ts",
      "export interface RemoteDevice { id: string }",
      "mobile-w5-capability",
    ],
    [
      "W5 endpoint",
      "src/features/mobile/tasks/rogue.ts",
      "export const endpoint = '/v1/devices/bind';",
      "mobile-w5-capability",
    ],
    [
      "Shell business import",
      "src/features/mobile/shell/rogue.ts",
      "export { MobilePresenceDomain } from '../presence/MobilePresenceDomain';",
      "mobile-shell-business-import",
    ],
    [
      "static-domain Core import",
      "src/features/mobile/workbench/rogue.ts",
      "import { CoreClient } from '@/lib/core/client'; export { CoreClient };",
      "mobile-static-core-import",
    ],
    [
      "Safety mutation verb",
      "src/features/mobile/safety/rogue.ts",
      "fetch('/api/core/v1/effector/estop', { method: 'POST' });",
      "mobile-safety-mutation",
    ],
    [
      "Safety mutation client",
      "src/features/mobile/safety/rogue.ts",
      "import { ControlClient } from '@/features/control/api/control-client'; export { ControlClient };",
      "mobile-safety-mutation",
    ],
    [
      "Safety computed request verb",
      "src/features/mobile/safety/rogue.ts",
      "const method = getMethod(); fetch('/api/core/v1/effector/status', { method });",
      "mobile-safety-mutation",
    ],
    [
      "Safety non-exact GET path",
      "src/features/mobile/safety/rogue.ts",
      "fetch('/api/core/v1/effector/status/', { method: 'GET' });",
      "mobile-safety-mutation",
    ],
  ])("rejects %s in production source", (_label, file, source, rule) => {
    const root = createFixture({ [file]: source });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(expect.objectContaining({ rule, file }));
  });

  it.each([
    "pixi.js",
    "pixi-live2d-display-lipsyncpatch/cubism4",
    "three",
    "framer-motion",
  ])("rejects the heavy source import %s", (specifier) => {
    const file = "src/features/mobile/presence/rogue.ts";
    const root = createFixture({
      [file]: `import ${JSON.stringify(specifier)}; export const marker = true;`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-heavy-import",
      file,
    }));
  });

  it("allows static SVG, the three exact Safety GET paths, and first-paint animation:none", () => {
    const root = createFixture({
      "src/features/mobile/presence/static-mark.tsx": `
        export function StaticMark() {
          return <svg aria-hidden="true" viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>;
        }
      `,
      "src/features/mobile/safety/extra-get-client.ts": `
        export const load = () => Promise.all([
          fetch("/api/core/v1/effector/status", { method: "GET" }),
          fetch("/api/core/v1/admin/effector/policy", { method: "GET" }),
          fetch("/api/core/v1/admin/effector/audit", { method: "GET" }),
        ]);
      `,
    });
    const result = runBoundary(root);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("excludes tests, declarations, fixture trees, and snapshots before every source rule", () => {
    const base = createFixture();
    const baseReport = parseReport(runBoundary(base).stdout);
    const poison = `
      import "pixi.js";
      interface RemoteDevice { id: string }
      requestAnimationFrame(() => document.createElement("canvas").getContext("webgl"));
      export const value = "linear-gradient(green, lime) /v1/devices";
    `;
    const root = createFixture({
      "src/app/mobile/presence/page.test.tsx": poison,
      "src/features/mobile/tasks/rogue.spec.tsx": poison,
      "src/features/mobile/tasks/types.d.ts": poison,
      "src/features/mobile/tasks/__tests__/rogue.ts": poison,
      "src/features/mobile/tasks/test/rogue.ts": poison,
      "src/features/mobile/tasks/fixture/rogue.ts": poison,
      "src/features/mobile/tasks/fixtures/rogue.ts": poison,
      "src/features/mobile/tasks/__snapshots__/rogue.snap": poison,
      "src/features/mobile/tasks/snapshots/rogue.ts": poison,
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(report.sourceFilesScanned).toBe(baseReport.sourceFilesScanned);
  });

  it.each([
    ["wrong", registrySource(["presence", "tasks", "workbench", "knowledge", "dispatch"])],
    ["duplicate", registrySource(["presence", "tasks", "workbench", "knowledge", "knowledge"])],
    ["missing", null],
  ])("rejects a %s domain registry", (_label, source) => {
    const file = "src/features/mobile/model/mobile-domains.ts";
    const root = createFixture({ [file]: source });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-domain-registry",
      file,
    }));
  });

  it("rejects a registry whose route href does not exactly match its domain", () => {
    const source = registrySource(DOMAINS).replace("/mobile/tasks", "/mobile/task");
    const root = createFixture({ "src/features/mobile/model/mobile-domains.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-domain-registry",
    }));
  });

  it("requires the exact Mobile ambient and grain first-paint witness", () => {
    const root = createFixture({
      "src/app/globals.css": `
        body:has([data-route-surface="mobile"]) .astr-ambient {
          display: none;
          animation: none;
          background: none;
        }
      `,
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-global-ambient-witness",
      file: "src/app/globals.css",
    }));
  });

  it("rejects a Mobile globals witness that later overrides animation:none", () => {
    const root = createFixture({
      "src/app/globals.css": globalsWitness().replace(
        "animation: none;",
        "animation: none; animation: orbit 9s infinite;",
      ),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-global-ambient-witness",
    }));
  });

  it("fails closed when the stamped build is missing", () => {
    const root = createFixture({}, { buildEvidence: false });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "missing", routes: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-build-evidence-missing",
    }));
  });

  it("fails closed when source changes after the stamped build", () => {
    const root = createFixture();
    writeFileSync(
      join(root, "src/features/mobile/tasks/LocalTaskDraftRegion.tsx"),
      "export function LocalTaskDraftRegion() { return <h1>changed</h1>; }",
    );
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "stale", routes: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-build-evidence-stale",
    }));
  });

  it("requires every explicit Mobile server route", () => {
    const file = ".next/server/app/mobile/workbench/page.js";
    const root = createFixture({ [file]: null });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence.status).toBe("checked");
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-server-entry-missing",
      file,
    }));
  });

  it("requires the authoritative app-paths mapping for every explicit Mobile route", () => {
    const file = ".next/server/app-paths-manifest.json";
    const mappings = Object.fromEntries(
      DOMAINS.filter((domain) => domain !== "workbench").map((domain) => [
        `/mobile/${domain}/page`,
        `app/mobile/${domain}/page.js`,
      ]),
    );
    const root = createFixture({ [file]: JSON.stringify(mappings) });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-server-entry-missing",
      file,
      match: "/mobile/workbench/page",
    }));
  });

  it("requires every explicit Mobile client-reference manifest", () => {
    const file = ".next/server/app/mobile/knowledge/page_client-reference-manifest.js";
    const root = createFixture({ [file]: null });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-manifest-missing",
      file,
    }));
  });

  it("rejects a manifest with zero evidence for its expected route", () => {
    const file = ".next/server/app/mobile/tasks/page_client-reference-manifest.js";
    const root = createFixture({
      [file]: rscManifest("wrong", { routeKey: "/mobile/wrong/page" }),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-evidence-missing",
      file,
    }));
  });

  it("rejects malformed client-module ownership evidence", () => {
    const file = ".next/server/app/mobile/tasks/page_client-reference-manifest.js";
    const manifest = rscManifest("tasks").replace(
      '"[project]/src/features/mobile/shell/MobileShell.tsx":{"chunks":["/_next/static/chunks/shared-runtime.js"]}',
      '"[project]/src/features/mobile/shell/MobileShell.tsx":{"chunks":"not-an-array"}',
    );
    const root = createFixture({ [file]: manifest });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-evidence-missing",
      file,
    }));
  });

  it("allows a real Server Component route to own zero dedicated client chunks", () => {
    const root = createFixture();
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(report.buildEvidence.routes).toContainEqual(routeEvidence("workbench", []));
    expect(report.buildEvidence.routes).toContainEqual(routeEvidence("knowledge", []));
  });

  it.each([
    ["Pixi", "pixi.js"],
    ["Live2D", "pixi-live2d-display"],
    ["Three", "three.module.js"],
    ["framer", "framer-motion"],
    ["texture", "haru_greeter_t03.2048/texture_00.png"],
  ])("rejects %s bytes in a route-owned client chunk", (_label, token) => {
    const file = ".next/static/chunks/mobile-presence.js";
    const root = createFixture({ [file]: `export const payload = ${JSON.stringify(token)};` });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-heavy-bytes",
      file,
    }));
  });

  it("rejects Safety mutation bytes only in Safety-owned chunks", () => {
    const safetyFile = ".next/static/chunks/mobile-safety.js";
    const root = createFixture({
      [safetyFile]: "fetch('/api/core/v1/effector/estop',{method:'POST'})",
      ".next/static/chunks/shared-runtime.js": "fetch('/api/core/v1/effector/estop',{method:'POST'})",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-safety-mutation",
      file: safetyFile,
    }));
    expect(report.violations).not.toContainEqual(expect.objectContaining({
      rule: "mobile-safety-mutation",
      file: ".next/static/chunks/shared-runtime.js",
    }));
  });

  it("rejects Workbench and Knowledge manifests that own another domain's business module", () => {
    const root = createFixture({
      ".next/server/app/mobile/workbench/page_client-reference-manifest.js": rscManifest(
        "workbench",
        { foreignDomain: "presence" },
      ),
      ".next/server/app/mobile/knowledge/page_client-reference-manifest.js": rscManifest(
        "knowledge",
        { foreignDomain: "safety" },
      ),
    });
    const report = parseReport(runBoundary(root).stdout);
    const crossRoute = report.violations.filter(({ rule }) => rule === "mobile-route-cross-domain");

    expect(crossRoute).toHaveLength(2);
    expect(crossRoute.map(({ match }) => match)).toEqual([
      expect.stringContaining("safety"),
      expect.stringContaining("presence"),
    ]);
  });

  it("allows framework, React, MobileShell, authority, nav, metadata, shared CSS and shared chunks", () => {
    const root = createFixture({
      ".next/server/app/mobile/workbench/page_client-reference-manifest.js": rscManifest(
        "workbench",
        { includeExtendedSharedModules: true },
      ),
      ".next/static/chunks/shared-runtime.js":
        "export const shared = 'React MobileShell authority navigation metadata shared CSS';",
    });
    const result = runBoundary(root);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("sorts violations and emits byte-for-byte deterministic JSON", () => {
    const root = createFixture({
      "src/features/mobile/tasks/z.css": ".z { color: green; animation: orbit 1s; }",
      "src/features/mobile/tasks/a.css": ".a { backdrop-filter: blur(1px); }",
    });
    const first = runBoundary(root);
    const second = runBoundary(root);
    const report = parseReport(first.stdout);
    const sortKeys = report.violations.map(({ file, rule, match }) => `${file}\0${rule}\0${match}`);

    expect(first.stdout).toBe(second.stdout);
    expect(sortKeys).toEqual([...sortKeys].sort());
  });
});

function createFixture(files = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "astr-mobile-boundary-"));
  temporaryDirectories.push(root);
  const defaults = {
    "src/app/globals.css": globalsWitness(),
    "src/app/mobile/layout.tsx": `
      import { MobileAuthorityProvider } from "@/features/mobile/authority/MobileAuthorityProvider";
      import { MobileShell } from "@/features/mobile/shell/MobileShell";
      export default function Layout({ children }) {
        return <MobileAuthorityProvider><MobileShell>{children}</MobileShell></MobileAuthorityProvider>;
      }
    `,
    "src/app/mobile/page.tsx": `
      import { redirect } from "next/navigation";
      export default function Page() { redirect("/mobile/presence"); }
    `,
    "src/features/mobile/authority/MobileAuthorityProvider.tsx": `
      "use client";
      export function MobileAuthorityProvider({ children }) { return children; }
    `,
    "src/features/mobile/model/mobile-domains.ts": registrySource(DOMAINS),
    "src/features/mobile/shell/MobileShell.tsx": `
      "use client";
      import { FiveDomainNav } from "./FiveDomainNav";
      import { MOBILE_DOMAINS } from "../model/mobile-domains";
      export function MobileShell({ children }) { return <main>{children}<FiveDomainNav items={MOBILE_DOMAINS} /></main>; }
    `,
    "src/features/mobile/shell/FiveDomainNav.tsx": `
      import Link from "next/link";
      export function FiveDomainNav({ items }) { return <nav>{items.map((item) => <Link href={item.href}>{item.label}</Link>)}</nav>; }
    `,
    "src/features/mobile/shared/CapabilityGate.tsx": `
      export function CapabilityGate({ title }) { return <section><h1>{title}</h1></section>; }
    `,
    "src/features/mobile/presence/MobilePresenceDomain.tsx": `
      "use client";
      export function MobilePresenceDomain() {
        return <section><h1>Presence</h1><svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg></section>;
      }
    `,
    "src/features/mobile/tasks/LocalTaskDraftRegion.tsx": `
      "use client";
      export function LocalTaskDraftRegion() { return <section><h1>Tasks</h1></section>; }
    `,
    "src/features/mobile/workbench/MobileWorkbenchGate.tsx": `
      import { CapabilityGate } from "../shared/CapabilityGate";
      export function MobileWorkbenchGate() { return <CapabilityGate title="Workbench unavailable" />; }
    `,
    "src/features/mobile/knowledge/MobileKnowledgeGate.tsx": `
      import { CapabilityGate } from "../shared/CapabilityGate";
      export function MobileKnowledgeGate() { return <CapabilityGate title="Knowledge unavailable" />; }
    `,
    "src/features/mobile/safety/mobile-safety-client.ts": `
      export const readSafety = () => Promise.all([
        fetch("/api/core/v1/effector/status", { method: "GET" }),
        fetch("/api/core/v1/admin/effector/policy", { method: "GET" }),
        fetch("/api/core/v1/admin/effector/audit", { method: "GET" }),
      ]);
    `,
    "src/features/mobile/safety/MobileLocalSafetyDomain.tsx": `
      "use client";
      import { readSafety } from "./mobile-safety-client";
      export function MobileLocalSafetyDomain() { void readSafety; return <section><h1>Safety</h1></section>; }
    `,
    "next.config.ts": "export default {};",
    "package.json": "{}",
    "package-lock.json": "{}",
    "postcss.config.mjs": "export default {};",
    "tsconfig.json": "{}",
    "public/.keep": "",
    ".next/static/chunks/shared-runtime.js": "export const shared = true;",
    ".next/static/chunks/mobile-presence.js": "export const presence = true;",
    ".next/static/chunks/mobile-tasks.js": "export const tasks = true;",
    ".next/static/chunks/mobile-safety.js": "export const safety = true;",
    ".next/server/app-paths-manifest.json": JSON.stringify(
      Object.fromEntries(DOMAINS.map((domain) => [
        `/mobile/${domain}/page`,
        `app/mobile/${domain}/page.js`,
      ])),
    ),
  };

  for (const domain of DOMAINS) {
    const component = componentFor(domain);
    defaults[`src/app/mobile/${domain}/page.tsx`] = `
      import { ${component} } from "@/features/mobile/${domain}/${component}";
      export default function Page() { return <${component} />; }
    `;
    defaults[`.next/server/app/mobile/${domain}/page.js`] =
      `export const route = ${JSON.stringify(`/mobile/${domain}`)};`;
    defaults[`.next/server/app/mobile/${domain}/page_client-reference-manifest.js`] =
      rscManifest(domain);
  }

  for (const [relativePath, source] of Object.entries({ ...defaults, ...files })) {
    if (source === null) continue;
    const target = join(root, ...relativePath.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }

  const scannerTarget = join(root, "src/test/no-green-scanner.ts");
  mkdirSync(dirname(scannerTarget), { recursive: true });
  copyFileSync(resolve(process.cwd(), "src/test/no-green-scanner.ts"), scannerTarget);
  if (options.buildEvidence !== false) writeBuildEvidence(root);
  return root;
}

function globalsWitness() {
  return `
    body:has([data-route-surface="mobile"]) .astr-ambient,
    body:has([data-route-surface="mobile"]) .astr-grain {
      display: none;
      animation: none;
      background: none;
    }
  `;
}

function registrySource(domains) {
  const definitions = domains.map((id) => ({
    id,
    href: `/mobile/${id}`,
    label: id,
    index: "00",
    status: "unavailable",
  }));
  return `
    const domainDefinitions = ${JSON.stringify(definitions)} as const;
    export const MOBILE_DOMAINS = Object.freeze(domainDefinitions);
  `;
}

function componentFor(domain) {
  return {
    presence: "MobilePresenceDomain",
    tasks: "LocalTaskDraftRegion",
    workbench: "MobileWorkbenchGate",
    knowledge: "MobileKnowledgeGate",
    safety: "MobileLocalSafetyDomain",
  }[domain];
}

function rscManifest(domain, options = {}) {
  const routeKey = options.routeKey ?? `/mobile/${domain}/page`;
  const clientModules = {
    "[project]/node_modules/next/dist/client/app-dir/link.js": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
    "[project]/src/features/mobile/shell/MobileShell.tsx": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
    "[project]/src/features/mobile/authority/MobileAuthorityProvider.tsx": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
    "[project]/src/features/mobile/model/mobile-domains.ts": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
    "[project]/src/features/mobile/shared/CapabilityGate.tsx": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
    "[project]/src/app/globals.css": {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
    },
  };

  if (!new Set(["workbench", "knowledge", "wrong"]).has(domain)) {
    clientModules[`[project]/src/features/mobile/${domain}/${componentFor(domain)}.tsx`] = {
      chunks: [`/_next/static/chunks/mobile-${domain}.js`],
    };
  }
  if (options.foreignDomain) {
    clientModules[
      `[project]/src/features/mobile/${options.foreignDomain}/${componentFor(options.foreignDomain)}.tsx`
    ] = { chunks: ["/_next/static/chunks/shared-runtime.js"] };
  }
  if (options.includeExtendedSharedModules) {
    Object.assign(clientModules, {
      "[project]/node_modules/react/index.js": { chunks: ["/_next/static/chunks/shared-runtime.js"] },
      "[project]/src/features/mobile/shell/FiveDomainNav.tsx": { chunks: ["/_next/static/chunks/shared-runtime.js"] },
      "[project]/src/components/system/StateAnnouncer.tsx": { chunks: ["/_next/static/chunks/shared-runtime.js"] },
      "[project]/src/app/layout.tsx": { chunks: ["/_next/static/chunks/shared-runtime.js"] },
      "[project]/src/features/mobile/shared/shared.css": { chunks: ["/_next/static/chunks/shared-runtime.js"] },
    });
  }

  const domainChunk = new Set(["workbench", "knowledge", "wrong"]).has(domain)
    ? []
    : [`static/chunks/mobile-${domain}.js`];
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}] = ${JSON.stringify({
    clientModules,
    entryJSFiles: {
      "[project]/src/app/mobile/layout": ["static/chunks/shared-runtime.js"],
      [`[project]/src/app/mobile/${domain}/page`]: [
        "static/chunks/shared-runtime.js",
        ...domainChunk,
      ],
    },
  })};`;
}

function routeEvidence(domain, clientChunks) {
  return {
    route: `/mobile/${domain}`,
    serverEntry: `.next/server/app/mobile/${domain}/page.js`,
    clientChunks,
  };
}

function writeBuildEvidence(root) {
  const buildId = "fixture-mobile-build";
  const buildIdPath = join(root, ".next/BUILD_ID");
  mkdirSync(dirname(buildIdPath), { recursive: true });
  writeFileSync(buildIdPath, buildId);
  writeFileSync(
    join(root, ".next/astr-e2e-build.json"),
    JSON.stringify({
      version: 1,
      buildId,
      coreMode: "mock",
      coreOrigin: "http://127.0.0.1:18300",
      sourceHash: hashBuildInputs(root),
    }),
  );
}

function hashBuildInputs(root) {
  const hash = createHash("sha256");
  for (const relativePath of [
    "src",
    "public",
    "next.config.ts",
    "package.json",
    "package-lock.json",
    "postcss.config.mjs",
    "tsconfig.json",
  ]) {
    appendBuildInput(hash, root, relativePath);
  }
  return hash.digest("hex");
}

function appendBuildInput(hash, root, relativePath) {
  const absolutePath = join(root, ...relativePath.split("/"));
  if (statSync(absolutePath).isFile()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    return;
  }
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) appendBuildInput(hash, root, childPath);
    else {
      hash.update(childPath);
      hash.update("\0");
      hash.update(readFileSync(join(root, ...childPath.split("/"))));
    }
  }
}

function runBoundary(root) {
  return spawnSync(process.execPath, [boundaryScript, "--root", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function parseReport(stdout) {
  expect(stdout).not.toBe("");
  return JSON.parse(stdout);
}
