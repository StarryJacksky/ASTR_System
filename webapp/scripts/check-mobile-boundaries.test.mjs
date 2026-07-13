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
import ts from "typescript";

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
    [
      "Safety computed Object.fromEntries PUT",
      "src/features/mobile/safety/rogue.ts",
      `fetch('/api/core/v1/effector/status', {
        ...Object.fromEntries([['method', 'PUT']]),
      });`,
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
    ["CoreClient", "import { CoreClient } from '@/lib/transport'; export { CoreClient };"],
    ["Core library", "import { request } from '@/lib/core/client'; export { request };"],
    ["direct fetch", "export const load = () => fetch('/api/core/v1/status');"],
    ["window fetch", "export const load = () => window.fetch('/api/core/v1/status');"],
    ["element fetch", "export const load = () => globalThis['fetch']('/api/core/v1/status');"],
    ["window WebSocket", "export const open = () => new window.WebSocket('ws://127.0.0.1');"],
    [
      "element XMLHttpRequest",
      "export const open = () => new globalThis['XMLHttpRequest']();",
    ],
  ])("rejects Shell/Nav %s access", (_label, source) => {
    const file = "src/features/mobile/shell/rogue.ts";
    const root = createFixture({ [file]: source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-shell-network-access",
      file,
    }));
  });

  it.each([
    ["client boundary", `"use client"; export const marker = true;`],
    ["network request", "export const load = () => fetch('/api/core/v1/status');"],
    [
      "element network request",
      "export const load = () => globalThis['fetch']('/api/core/v1/status');",
    ],
  ])("rejects Workbench/Knowledge %s", (_label, source) => {
    const file = "src/features/mobile/knowledge/rogue.ts";
    const root = createFixture({ [file]: source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-static-runtime-access",
      file,
    }));
  });

  it("rejects a concatenated W5 endpoint in source", () => {
    const file = "src/features/mobile/tasks/rogue.ts";
    const root = createFixture({
      [file]: `export const endpoint = '/v1/' + 'devices' + '/bind';`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-w5-capability",
      file,
    }));
  });

  it("rejects a W5 endpoint assembled through a runtime-selected segment", () => {
    const file = "src/features/mobile/tasks/rogue.ts";
    const root = createFixture({
      [file]: `
        const domain = globalThis.mobileDomain || "devices";
        export const endpoint = "/v1/" + domain + "/bind";
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-w5-capability",
      file,
    }));
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

  it("treats .test-helper.ts as production source rather than a test file", () => {
    const file = "src/features/mobile/tasks/mobile.test-helper.ts";
    const root = createFixture({ [file]: "export const paint = 'linear-gradient(green, lime)';" });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-forbidden-gradient",
      file,
    }));
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

  it("rejects spread extras hidden beside five valid registry literals", () => {
    const exact = JSON.parse(registryDefinitionsJson(DOMAINS));
    const source = `
      const extras = [{ id: "dispatch", href: "/mobile/dispatch" }];
      const domainDefinitions = ${JSON.stringify(exact)} as const;
      const registryWithExtra = [...domainDefinitions, ...extras] as const;
      export const MOBILE_DOMAINS = Object.freeze(registryWithExtra);
    `;
    const root = createFixture({ "src/features/mobile/model/mobile-domains.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-domain-registry",
    }));
  });

  it("rejects an exact decoy domainDefinitions array when MOBILE_DOMAINS exports another value", () => {
    const exact = registryDefinitionsJson(DOMAINS);
    const source = `
      const domainDefinitions = ${exact} as const;
      const decoy = domainDefinitions.slice(0, 4);
      export const MOBILE_DOMAINS = Object.freeze(decoy);
    `;
    const root = createFixture({ "src/features/mobile/model/mobile-domains.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-domain-registry",
    }));
  });

  it("rejects registry object spreads that override an exact literal id and href", () => {
    const definitions = JSON.parse(registryDefinitionsJson(DOMAINS));
    const [presence, ...remaining] = definitions;
    const presenceSource = `${JSON.stringify(presence).slice(0, -1)},
      ...{ id: "dispatch", href: "/mobile/dispatch" }
    }`;
    const source = `
      const domainDefinitions = [${presenceSource}, ${remaining.map(JSON.stringify).join(", ")}]
        as const;
      export const MOBILE_DOMAINS = domainDefinitions;
    `;
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

  it("rejects a later same-specificity ambient cascade override after a valid witness", () => {
    const root = createFixture({
      "src/app/globals.css": `${globalsWitness()}
        body:has([data-route-surface="mobile"]) .astr-grain {
          animation: orbit 9s linear infinite;
          background: red;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-global-ambient-witness",
    }));
  });

  it("rejects a later higher-specificity Mobile ambient and grain override", () => {
    const root = createFixture({
      "src/app/globals.css": `${globalsWitness()}
        html body:has([data-route-surface="mobile"]) .astr-ambient,
        html body:has([data-route-surface="mobile"]) .astr-grain {
          display: block;
          animation: orbit 9s linear infinite;
          background: red;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-global-ambient-witness",
    }));
  });

  it("rejects a higher-specificity ambient override with a single-quoted Mobile attribute selector", () => {
    const root = createFixture({
      "src/app/globals.css": `${globalsWitness()}
        html body:has([data-route-surface='mobile']) .astr-ambient {
          display: block;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-global-ambient-witness",
    }));
  });

  it("rejects a higher-specificity grain override with an unquoted Mobile attribute selector", () => {
    const root = createFixture({
      "src/app/globals.css": `${globalsWitness()}
        html body:has([data-route-surface=mobile]) .astr-grain {
          animation: orbit 9s linear infinite;
        }
      `,
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

  it("rejects Object.fromEntries PUT bytes in a Safety-owned chunk", () => {
    const file = ".next/static/chunks/mobile-safety.js";
    const root = createFixture({
      [file]: `fetch(path,Object.fromEntries([["method","PUT"]]))`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-safety-mutation",
      file,
    }));
  });

  it("rejects concatenated W5 endpoint bytes in a route-owned chunk", () => {
    const file = ".next/static/chunks/mobile-tasks.js";
    const root = createFixture({
      [file]: `export const endpoint="/v1/"+"devices"+"/bind";`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-w5-capability",
      file,
    }));
  });

  it("rejects runtime-composed W5 endpoint anchors and segments in a route-owned chunk", () => {
    const file = ".next/static/chunks/mobile-tasks.js";
    const root = createFixture({
      [file]: `
        const domain = globalThis.mobileDomain || "devices";
        export const endpoint = "/v1/" + domain + "/bind";
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-w5-capability",
      file,
    }));
  });

  it("unions own clientModules chunks into route validation and heavy-byte scanning", () => {
    const manifestFile = ".next/server/app/mobile/presence/page_client-reference-manifest.js";
    const hiddenChunk = ".next/static/chunks/mobile-presence-hidden.js";
    const root = createFixture({
      [manifestFile]: rscManifest("presence", {
        extraOwnedChunk: "static/chunks/mobile-presence-hidden.js",
      }),
      [hiddenChunk]: `export const hidden = "pixi.js";`,
    });
    const report = parseReport(runBoundary(root).stdout);
    const presence = report.buildEvidence.routes.find(({ route }) => route === "/mobile/presence");

    expect(presence.clientChunks).toContain(hiddenChunk);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-route-heavy-bytes",
      file: hiddenChunk,
    }));
  });

  it("forbids a Workbench-owned client module even without a dedicated page chunk", () => {
    const file = ".next/server/app/mobile/workbench/page_client-reference-manifest.js";
    const root = createFixture({
      [file]: rscManifest("workbench", { ownClientModule: true }),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-static-route-client-boundary",
      file,
    }));
  });

  it("forbids a dedicated Knowledge page chunk without a domain client module", () => {
    const manifestFile = ".next/server/app/mobile/knowledge/page_client-reference-manifest.js";
    const chunkFile = ".next/static/chunks/mobile-knowledge.js";
    const root = createFixture({
      [manifestFile]: rscManifest("knowledge", {
        dedicatedChunk: "static/chunks/mobile-knowledge.js",
      }),
      [chunkFile]: "export const knowledge = true;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "mobile-static-route-client-boundary",
      file: manifestFile,
    }));
  });

  it("scans route-owned entryCSSFiles outside source roots with shared visual rules", () => {
    const manifestFile = ".next/server/app/mobile/tasks/page_client-reference-manifest.js";
    const cssFile = ".next/static/chunks/mobile-tasks-owned.css";
    const root = createFixture({
      [manifestFile]: rscManifest("tasks", {
        ownedCss: "static/chunks/mobile-tasks-owned.css",
      }),
      [cssFile]: ".task { color: green; background: linear-gradient(#111, #222); }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "no-green-hardcode", file: cssFile }),
      expect.objectContaining({ rule: "mobile-forbidden-gradient", file: cssFile }),
    ]));
  });

  it("scans Mobile-layout CSS while excluding root-layout shared CSS", () => {
    const mobileCss = ".next/static/chunks/shared-mobile.css";
    const rootCss = ".next/static/chunks/root-shared.css";
    const root = createFixture({
      [mobileCss]: ".mobile { color: green; background: linear-gradient(#111, #222); }",
      [rootCss]: ".root { color: green; background: linear-gradient(#111, #222); }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "no-green-hardcode", file: mobileCss }),
      expect.objectContaining({ rule: "mobile-forbidden-gradient", file: mobileCss }),
    ]));
    expect(report.violations).not.toContainEqual(expect.objectContaining({ file: rootCss }));
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

describe("Mobile coverage configuration contract", () => {
  const configPath = resolve(process.cwd(), "vitest.config.mts");

  it("preserves existing coverage, adds Mobile coverage, and locks exact thresholds", () => {
    expect(inspectCoverageConfig(readFileSync(configPath, "utf8"))).toEqual([]);
  });

  it.each([
    ["lib include", (source) => source.replace('"src/lib/**/*.ts",', "")],
    ["system include", (source) => source.replace('"src/components/system/**/*.tsx",', "")],
    ["Mobile include", (source) => source.replace('"src/features/mobile/**/*.{ts,tsx}",', "")],
    ["test-support exclude", (source) => source.replace('"**/*.test-*.*",', "")],
    ["json-summary reporter", (source) => source.replace(', "json-summary"', "")],
    ["aggregate branch threshold", (source) => source.replace("branches: 85,", "branches: 84,")],
    [
      "critical threshold",
      (source) => source.replace(
        '"src/features/mobile/safety/mobile-safety-client.ts": {',
        '"src/features/mobile/safety/mobile-safety-client-renamed.ts": {',
      ),
    ],
  ])("mutation guard rejects removal of %s", (_label, mutate) => {
    const source = readFileSync(configPath, "utf8");
    expect(inspectCoverageConfig(mutate(source))).not.toEqual([]);
  });

  it("rejects a later coverage spread that overrides the locked thresholds", () => {
    const source = readFileSync(configPath, "utf8");
    const mutated = source
      .replace(
        "export default defineConfig",
        "const weakenedCoverage = { thresholds: {} };\n\nexport default defineConfig",
      )
      .replace(
        "      },\n    },\n  },\n});",
        "      },\n      ...weakenedCoverage,\n    },\n  },\n});",
      );

    expect(mutated).not.toBe(source);
    expect(mutated).toContain("...weakenedCoverage");
    expect(inspectCoverageConfig(mutated)).not.toEqual([]);
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
    ".next/static/chunks/root-shared.css": ".root { color: #8bcfff; }",
    ".next/static/chunks/shared-mobile.css": ".shared { color: #8bcfff; }",
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
  return `
    const domainDefinitions = ${registryDefinitionsJson(domains)} as const;
    export const MOBILE_DOMAINS = Object.freeze(domainDefinitions);
  `;
}

function registryDefinitionsJson(domains) {
  const definitions = domains.map((id) => ({
    id,
    href: `/mobile/${id}`,
    label: id,
    index: "00",
    status: "unavailable",
  }));
  return JSON.stringify(definitions);
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
      chunks: [
        `/_next/static/chunks/mobile-${domain}.js`,
        ...(options.extraOwnedChunk ? [`/_next/${options.extraOwnedChunk}`] : []),
      ],
    };
  }
  if (options.ownClientModule && new Set(["workbench", "knowledge"]).has(domain)) {
    clientModules[`[project]/src/features/mobile/${domain}/${componentFor(domain)}.tsx`] = {
      chunks: ["/_next/static/chunks/shared-runtime.js"],
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

  const domainChunk = options.dedicatedChunk
    ? [options.dedicatedChunk]
    : new Set(["workbench", "knowledge", "wrong"]).has(domain)
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
    entryCSSFiles: {
      "[project]/src/app/layout": [
        { path: "static/chunks/root-shared.css", inlined: false },
      ],
      "[project]/src/app/mobile/layout": [
        { path: "static/chunks/root-shared.css", inlined: false },
        { path: "static/chunks/shared-mobile.css", inlined: false },
      ],
      [`[project]/src/app/mobile/${domain}/page`]: [
        { path: "static/chunks/root-shared.css", inlined: false },
        { path: "static/chunks/shared-mobile.css", inlined: false },
        ...(options.ownedCss ? [{ path: options.ownedCss, inlined: false }] : []),
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

function inspectCoverageConfig(source) {
  const violations = [];
  const sourceFile = ts.createSourceFile(
    "vitest.config.mts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exported = sourceFile.statements.find(ts.isExportAssignment);
  const configCall = exported ? unwrapConfigExpression(exported.expression) : null;
  const config = configCall && ts.isCallExpression(configCall)
    ? unwrapConfigExpression(configCall.arguments[0])
    : null;
  if (config && ts.isObjectLiteralExpression(config) && hasUnsafeObjectOverrides(config)) {
    violations.push("config:no-spread-or-duplicate-overrides");
  }
  const test = config && ts.isObjectLiteralExpression(config)
    ? objectPropertyValue(config, "test")
    : null;
  if (test && ts.isObjectLiteralExpression(test) && hasUnsafeObjectOverrides(test)) {
    violations.push("test:no-spread-or-duplicate-overrides");
  }
  const coverage = test && ts.isObjectLiteralExpression(test)
    ? objectPropertyValue(test, "coverage")
    : null;
  if (!coverage || !ts.isObjectLiteralExpression(coverage)) return ["coverage-object"];
  if (hasUnsafeObjectOverrides(coverage)) {
    violations.push("coverage:no-spread-or-duplicate-overrides");
  }

  const includes = stringArray(objectPropertyValue(coverage, "include"));
  for (const required of [
    "src/lib/**/*.ts",
    "src/components/system/**/*.tsx",
    "src/features/mobile/**/*.{ts,tsx}",
  ]) {
    if (!includes.includes(required)) violations.push(`include:${required}`);
  }

  const expectedExcludes = [
    "**/*.test.*",
    "**/*.test-*.*",
    "**/*.spec.*",
    "**/*.spec-*.*",
    "**/*.d.ts",
    "**/__tests__/**",
    "**/{test,tests,fixture,fixtures}/**",
    "**/__snapshots__/**",
    "**/*.snap",
  ].sort();
  const excludes = stringArray(objectPropertyValue(coverage, "exclude")).sort();
  if (JSON.stringify(excludes) !== JSON.stringify(expectedExcludes)) {
    violations.push("exclude:exact-test-support-set");
  }

  const reporters = stringArray(objectPropertyValue(coverage, "reporter"));
  if (!reporters.includes("json-summary")) violations.push("reporter:json-summary");

  const thresholds = objectPropertyValue(coverage, "thresholds");
  if (!thresholds || !ts.isObjectLiteralExpression(thresholds)) {
    violations.push("thresholds:object");
    return violations.sort();
  }
  if (hasUnsafeObjectOverrides(thresholds)) {
    violations.push("thresholds:no-spread-or-duplicate-overrides");
  }
  const expectedThresholds = new Map([
    [
      "src/features/mobile/**/*.{ts,tsx}",
      { lines: 90, statements: 90, functions: 90, branches: 85 },
    ],
    [
      "src/features/mobile/authority/loopback-authority.ts",
      { lines: 100, statements: 100, functions: 100, branches: 100 },
    ],
    [
      "src/features/mobile/tasks/{local-task-draft,local-task-draft-storage}.ts",
      { lines: 100, statements: 100, functions: 100, branches: 100 },
    ],
    [
      "src/features/mobile/safety/mobile-safety-client.ts",
      { lines: 100, statements: 100, functions: 100, branches: 100 },
    ],
    [
      "src/features/mobile/safety/create-mobile-safety-controller.ts",
      { lines: 100, statements: 100, functions: 100, branches: 100 },
    ],
  ]);
  for (const [glob, expected] of expectedThresholds) {
    const threshold = objectPropertyValue(thresholds, glob);
    if (!threshold || !ts.isObjectLiteralExpression(threshold)) {
      violations.push(`threshold:${glob}`);
      continue;
    }
    if (hasUnsafeObjectOverrides(threshold)) {
      violations.push(`threshold:${glob}:no-spread-or-duplicate-overrides`);
    }
    for (const [metric, value] of Object.entries(expected)) {
      const actual = objectPropertyValue(threshold, metric);
      if (!actual || !ts.isNumericLiteral(actual) || Number(actual.text) !== value) {
        violations.push(`threshold:${glob}:${metric}`);
      }
    }
  }
  return violations.sort();
}

function unwrapConfigExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function objectPropertyValue(object, key) {
  const matches = object.properties.filter((property) =>
    ts.isPropertyAssignment(property) && objectPropertyKey(property) === key,
  );
  return matches.length === 1 ? unwrapConfigExpression(matches[0].initializer) : null;
}

function hasUnsafeObjectOverrides(object) {
  const keys = new Set();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) return true;
    const key = objectPropertyKey(property);
    if (key === null) continue;
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

function objectPropertyKey(property) {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (
    ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(unwrapConfigExpression(name.expression))
  ) {
    return unwrapConfigExpression(name.expression).text;
  }
  return null;
}

function stringArray(expression) {
  if (!expression || !ts.isArrayLiteralExpression(expression)) return [];
  return expression.elements.flatMap((element) => {
    const value = unwrapConfigExpression(element);
    return value && ts.isStringLiteralLike(value) ? [value.text] : [];
  });
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
