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

const boundaryScript = resolve(process.cwd(), "scripts/check-control-boundaries.mjs");
const temporaryDirectories = [];
const EXPECTED_CONTROL_MODULES = Object.freeze([
  ["dashboard", "planned"],
  ["platform-gateway", "planned"],
  ["model-router", "planned"],
  ["plugins-skills-mcp", "planned"],
  ["sessions-people", "planned"],
  ["schedule", "planned"],
  ["logs-trace", "planned"],
  ["settings", "planned"],
  ["resources-knowledge", "planned"],
  ["setup", "planned"],
  ["soul", "planned"],
  ["memory", "planned"],
  ["emotion", "planned"],
  ["moa-teaching", "planned"],
  ["training", "planned"],
  ["voice", "planned"],
  ["effector", "available"],
  ["migration", "planned"],
]);

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { force: true, recursive: true });
  }
});

describe("Control production boundary command", () => {
  it("accepts exact Effector availability with truthful nonzero Admin build evidence", () => {
    const root = createFixture();
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toEqual({
      schemaVersion: 1,
      check: "control-boundaries",
      passed: true,
      sourceFilesScanned: 3,
      availableModules: ["effector"],
      buildEvidence: {
        status: "checked",
        chunks: [
          ".next/static/chunks/control-admin.js",
          ".next/static/chunks/control-effector.js",
        ],
      },
      violations: [],
    });
  });

  it("rejects every forbidden renderer ownership form in Admin or Control source", () => {
    const root = createFixture({
      "src/features/control/rogue-renderer.tsx": `
        requestAnimationFrame(render);
        surface.getContext("webgl");
        export const view = <canvas />;
        const app = new Application();
        Ticker.shared.add(render);
      `,
    });
    const report = parseReport(runBoundary(root).stdout);
    const rules = report.violations.map(({ rule }) => rule);

    expect(rules).toEqual(expect.arrayContaining([
      "control-render-request-animation-frame",
      "control-render-get-context",
      "control-render-canvas",
      "control-render-application",
      "control-render-shared-ticker",
    ]));
  });

  it("rejects Control-owned gradients, CSS animation, and backdrop filtering", () => {
    const root = createFixture({
      "src/features/control/rogue-material.css": `
        .gradient { background: radial-gradient(circle, #000, #111); }
        .animated { animation: drift 9s linear infinite; }
        .glass { backdrop-filter: blur(18px); }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);
    const rules = report.violations.map(({ rule }) => rule);

    expect(rules).toEqual(expect.arrayContaining([
      "control-visual-gradient",
      "control-visual-animation",
      "control-visual-backdrop-filter",
    ]));
  });

  it("rejects Live2D, Pixi, and Soul Lens imports in the Control boundary", () => {
    const root = createFixture({
      "src/app/admin/rogue-imports.ts": `
        import "pixi.js";
        import("pixi-live2d-display-lipsyncpatch/cubism4");
        export { SoulLensPass } from "../../features/presence/visual/soul-lens-pass";
      `,
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations.filter(({ rule }) => rule === "control-heavy-visual-import"))
      .toHaveLength(3);
  });

  it("rejects renderer ownership hidden in a transitive local dependency", () => {
    const root = createFixture({
      "src/app/admin/page.tsx": `
        import { mountRenderer } from "@/components/rogue-renderer";
        export default function AdminPage() { mountRenderer(); return <main>Control</main>; }
      `,
      "src/components/rogue-renderer.ts": `
        export function mountRenderer() {
          requestAnimationFrame(() => undefined);
          document.createElement("canvas").getContext("webgl");
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "control-render-request-animation-frame",
        file: "src/components/rogue-renderer.ts",
      }),
      expect.objectContaining({
        rule: "control-render-get-context",
        file: "src/components/rogue-renderer.ts",
      }),
    ]));
  });

  it.each(["cjs", "cts"])
    ("scans a transitive local .%s dependency instead of silently skipping it", (extension) => {
      const root = createFixture({
        "src/app/admin/page.tsx": `
          import "@/components/rogue-renderer.${extension}";
          export default function AdminPage() { return <main>Control</main>; }
        `,
        [`src/components/rogue-renderer.${extension}`]: `
          window.requestAnimationFrame?.(() => undefined);
        `,
      });
      const report = parseReport(runBoundary(root).stdout);

      expect(report.violations).toContainEqual(expect.objectContaining({
        rule: "control-render-request-animation-frame",
        file: `src/components/rogue-renderer.${extension}`,
      }));
    });

  it("fails closed when a resolved local dependency has an unscannable extension", () => {
    const root = createFixture({
      "src/app/admin/page.tsx": `
        import "@/components/opaque.wasm";
        export default function AdminPage() { return <main>Control</main>; }
      `,
      "src/components/opaque.wasm": "opaque renderer payload",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "control-local-import-unscannable",
      file: "src/app/admin/page.tsx",
      match: "@/components/opaque.wasm",
    }));
  });

  it("follows an unquoted CSS url import into the transitive graph", () => {
    const root = createFixture({
      "src/features/control/control.css": `
        @import url(../../components/rogue-material.css);
      `,
      "src/components/rogue-material.css": `
        .rogue { background: radial-gradient(circle, #000, #111); }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "control-visual-gradient",
      file: "src/components/rogue-material.css",
    }));
  });

  it("rejects optional, bracketed, and createElement renderer equivalents", () => {
    const root = createFixture({
      "src/features/control/rogue-renderer.tsx": `
        window.requestAnimationFrame?.(tick);
        surface.getContext?.("webgl");
        surface["getContext"]("webgl");
        React.createElement("canvas");
      `,
    });
    const report = parseReport(runBoundary(root).stdout);
    const rules = report.violations.map(({ rule }) => rule);

    expect(rules).toEqual(expect.arrayContaining([
      "control-render-request-animation-frame",
      "control-render-get-context",
      "control-render-canvas",
    ]));
  });

  it("fails closed on a computed dynamic import in the transitive Control graph", () => {
    const root = createFixture({
      "src/app/admin/page.tsx": `
        const target = "@/components/renderer";
        export default async function AdminPage() {
          await import(target);
          return <main>Control</main>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "control-dynamic-import-nonliteral",
      file: "src/app/admin/page.tsx",
    }));
  });

  it("reuses the constitutional no-green scanner", () => {
    const root = createFixture({
      "src/features/control/control.css": ".control { color: rgb(0, 255, 0); }",
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "no-green-hardcode",
      file: "src/features/control/control.css",
    }));
  });

  it("fails unless the registry's available modules are exactly Effector", () => {
    const root = createFixture({
      "src/features/control/model/control-modules.ts": registrySource([
        ["dashboard", "available"],
        ["effector", "available"],
      ]),
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.availableModules).toEqual(["dashboard", "effector"]);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "control-available-modules",
    }));
  });

  it.each([
    [
      "a planned module is missing",
      EXPECTED_CONTROL_MODULES.slice(1),
      "control-module-registry-membership",
    ],
    [
      "a module ID is duplicated",
      [...EXPECTED_CONTROL_MODULES, EXPECTED_CONTROL_MODULES[0]],
      "control-module-registry-duplicate",
    ],
    [
      "a route does not match its module ID",
      EXPECTED_CONTROL_MODULES.map(([id, status]) => ({
        id,
        status,
        href: id === "dashboard" ? "/admin/not-dashboard" : `/admin/${id}`,
      })),
      "control-module-registry-route",
    ],
  ])("rejects route truth when %s", (_label, entries, expectedRule) => {
    const root = createFixture({
      "src/features/control/model/control-modules.ts": registrySource(entries),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({ rule: expectedRule }));
  });

  it.each([
    ["pixi", "imported pixi.js runtime"],
    ["live2d", "pixi-live2d-display"],
    ["soul-lens", "soul-lens-pass"],
    ["2048 texture", "haru/haru_greeter_t03.2048/texture_00.png"],
  ])("rejects %s bytes in a resolved Admin production chunk", (_label, bytes) => {
    const root = createFixture({
      ".next/static/chunks/control-effector.js": `export const payload = ${JSON.stringify(bytes)};`,
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "admin-chunk-heavy-visual",
      file: ".next/static/chunks/control-effector.js",
    }));
  });

  it.each([
    ["RAF", "globalThis.requestAnimationFrame?.(tick)"],
    ["canvas context", "surface[\"getContext\"](\"webgl\")"],
    ["canvas creation", "React.createElement(\"canvas\")"],
  ])("rejects %s renderer bytes in a resolved Admin production chunk", (_label, bytes) => {
    const root = createFixture({
      ".next/static/chunks/control-effector.js": bytes,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "admin-chunk-renderer-api",
      file: ".next/static/chunks/control-effector.js",
    }));
  });

  it("fails closed when Admin build identity evidence is missing", () => {
    const root = createFixture({}, { buildEvidence: false });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "missing", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "admin-chunk-build-evidence-missing",
    }));
  });

  it("fails closed when Control source changes after the stamped build", () => {
    const root = createFixture();
    writeFileSync(
      join(root, "src/app/admin/page.tsx"),
      "export default function AdminPage() { return <main>changed</main>; }",
    );
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "stale", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "admin-chunk-build-evidence-stale",
    }));
  });

  it("forbids checked build evidence with zero resolved Admin chunks", () => {
    const root = createFixture({
      ".next/server/app/admin/page_client-reference-manifest.js": adminManifest(
        "/admin/page",
        "src/app/admin/page",
        [],
      ),
      ".next/server/app/admin/[module]/page_client-reference-manifest.js": adminManifest(
        "/admin/[module]/page",
        "src/app/admin/[module]/page",
        [],
      ),
    });
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "checked", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "admin-chunk-entry-missing",
    }));
  });
});

function createFixture(files = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "astr-control-boundary-"));
  temporaryDirectories.push(root);
  const defaults = {
    "src/app/admin/page.tsx": "export default function AdminPage() { return <main>Control</main>; }",
    "src/app/admin/[module]/page.tsx": "export default function ModulePage() { return <main>Module</main>; }",
    "src/features/control/model/control-modules.ts": registrySource(EXPECTED_CONTROL_MODULES),
    ".next/server/app/admin/page_client-reference-manifest.js": adminManifest(
      "/admin/page",
      "src/app/admin/page",
      ["static/chunks/control-admin.js"],
    ),
    ".next/server/app/admin/[module]/page_client-reference-manifest.js": adminManifest(
      "/admin/[module]/page",
      "src/app/admin/[module]/page",
      ["static/chunks/control-admin.js", "static/chunks/control-effector.js"],
    ),
    ".next/static/chunks/control-admin.js": "export const admin = true;",
    ".next/static/chunks/control-effector.js": "export const effector = true;",
    "next.config.ts": "export default {};",
    "package.json": "{}",
    "package-lock.json": "{}",
    "postcss.config.mjs": "export default {};",
    "tsconfig.json": "{}",
    "public/.keep": "",
  };

  for (const [relativePath, source] of Object.entries({ ...defaults, ...files })) {
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

function registrySource(entries, { wrapped = true } = {}) {
  const modules = entries.map((entry) => {
    const value = Array.isArray(entry)
      ? { id: entry[0], status: entry[1] }
      : entry;
    return {
      id: value.id,
      href: value.href ?? `/admin/${value.id}`,
      status: value.status,
    };
  });
  const moduleSource = modules
    .map((module) => wrapped
      ? `defineControlModule(${JSON.stringify(module)})`
      : JSON.stringify(module))
    .join(",\n");
  return `${wrapped ? "function defineControlModule(module) { return Object.freeze(module); }\n" : ""}const modules = [${moduleSource}] as const;
export const CONTROL_MODULES = Object.freeze(modules);`;
}

function adminManifest(route, entry, chunks) {
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify({
    entryJSFiles: { [`[project]/${entry}`]: chunks },
  })};`;
}

function writeBuildEvidence(root) {
  const buildId = "fixture-control-build";
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
