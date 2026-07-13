import { createHash, type Hash } from "node:crypto";
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
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

interface BoundaryViolation {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
}

interface BoundaryReport {
  readonly schemaVersion: 1;
  readonly check: "presence-boundaries";
  readonly passed: boolean;
  readonly noGreenRuleSource: string;
  readonly buildEvidence: {
    readonly status: "checked" | "missing" | "stale";
    readonly chunks: readonly string[];
  };
  readonly violations: readonly BoundaryViolation[];
}

const temporaryDirectories: string[] = [];
const boundaryScript = resolve(process.cwd(), "scripts/check-presence-boundaries.mjs");

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe("Presence production boundary command", () => {
  it("reuses the constitutional no-green scanner and accepts a truthful light initial route", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        import "./presence.css";
        export const loadVisual = () => import("./visual/visual-scene");
        export function PresenceExperience() {
          return <div aria-disabled="true"><span>Task</span><span>remote capability is not enabled</span></div>;
        }
      `,
      "src/features/presence/presence.css": ".presence { color: #8bcfff; }",
      "src/features/presence/visual/visual-scene.ts": `
        import "pixi-live2d-display-lipsyncpatch/cubism4";
        export const texture = "haru/haru_greeter_t03.2048/texture_00.png";
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toMatchObject({
      schemaVersion: 1,
      check: "presence-boundaries",
      passed: true,
      noGreenRuleSource: "src/test/no-green-scanner.ts",
      buildEvidence: {
        status: "checked",
        chunks: [".next/static/chunks/presence-page.js"],
      },
      violations: [],
    });
  });

  it("fails closed when the RSC manifest has no initial page entry", () => {
    const root = createFixture({
      ".next/server/app/page_client-reference-manifest.js": `
        globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
        globalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify({
          entryJSFiles: { "[project]/src/app/layout": ["static/chunks/layout.js"] },
        })};
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "checked", chunks: [] });
    expect(report.violations).toContainEqual(
      expect.objectContaining({ rule: "initial-chunk-entry-missing" }),
    );
  });

  it("fails closed when the initial-route build fingerprint is missing", () => {
    const root = createFixture({}, { buildEvidence: false });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "missing", chunks: [] });
    expect(report.violations).toContainEqual(
      expect.objectContaining({ rule: "initial-chunk-build-evidence-missing" }),
    );
  });

  it("fails closed when source changes after the initial-route build fingerprint", () => {
    const root = createFixture({});
    writeFileSync(
      join(root, "src/features/presence/PresenceExperience.tsx"),
      'export function PresenceExperience() { return <div>changed after build</div>; }',
    );

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({ status: "stale", chunks: [] });
    expect(report.violations).toContainEqual(
      expect.objectContaining({ rule: "initial-chunk-build-evidence-stale" }),
    );
  });

  it("rejects hard-coded green through that single shared scanner", () => {
    const root = createFixture({
      "src/features/presence/presence.css": ".presence { color: rgb(0, 255, 0); }",
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toEqual([
      expect.objectContaining({
        rule: "no-green-hardcode",
        file: "src/features/presence/presence.css",
      }),
    ]);
  });

  it("rejects every private visual context, application, RAF and ticker form outside the runtime allowlist", () => {
    const root = createFixture({
      "src/features/presence/rogue-visual.ts": `
        requestAnimationFrame(render);
        canvas.getContext("webgl");
        new Application();
        new PIXI.Application();
        new Ticker();
        PIXI.Ticker.shared.add(render);
        Live2DModel.registerTicker(Ticker);
      `,
    });

    const result = runBoundary(root);
    const rules = parseReport(result.stdout).violations.map(({ rule }) => rule);

    expect(result.status).not.toBe(0);
    expect(rules).toEqual(expect.arrayContaining([
      "visual-api-request-animation-frame",
      "visual-api-get-context",
      "visual-api-application-construction",
      "visual-api-independent-ticker",
      "visual-api-shared-ticker",
      "visual-api-register-ticker",
    ]));
  });

  it("keeps the sole Presence runtime as an explicit visual API allowlist", () => {
    const root = createFixture({
      "src/features/presence/visual/presence-visual-runtime.ts": `
        export function create(applicationModule) {
          return new applicationModule.Application();
        }
      `,
    });

    const result = runBoundary(root);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("rejects a heavy static initial-route import while permitting the same module behind import()", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        import { inventory } from "./visual/live2d-assets";
        export function PresenceExperience() { return <div>{inventory.length}</div>; }
      `,
      "src/features/presence/visual/live2d-assets.ts": `
        import lock from "../../../../live2d-assets.lock.json";
        export const inventory = lock.assets;
      `,
      "live2d-assets.lock.json": JSON.stringify({ assets: [] }),
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "initial-route-heavy-import",
        file: "src/features/presence/PresenceExperience.tsx",
      }),
    ]));
  });

  it("rejects heavy bytes in a built initial page chunk", () => {
    const root = createFixture({
      ".next/server/app/page_client-reference-manifest.js": clientReferenceManifest([
        "static/chunks/presence-page.js",
      ]),
      ".next/static/chunks/presence-page.js": `
        const texture = "haru/haru_greeter_t03.2048/texture_00.png";
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.buildEvidence).toEqual({
      status: "checked",
      chunks: [".next/static/chunks/presence-page.js"],
    });
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "initial-chunk-heavy-asset",
        file: ".next/static/chunks/presence-page.js",
      }),
    ]));
  });

  it("rejects invented Task and remote capability actions without rejecting unavailable boundary copy", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        export function PresenceExperience() {
          return <button onClick={() => fetch("/api/tasks/run")}>Run remote Task</button>;
        }
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "invented-remote-capability" }),
    ]));
  });

  it("rejects unprovided Core endpoint strings passed through request wrappers", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        const endpoint = "/v1/tasks/run";
        const requestCore = (path: string) => path;
        export function PresenceExperience() {
          requestCore(endpoint);
          return <div>Presence</div>;
        }
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(
      expect.objectContaining({
        rule: "invented-remote-capability",
        file: "src/features/presence/PresenceExperience.tsx",
      }),
    );
  });

  it("rejects invented voiceprint subpaths outside status and enroll", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        const endpoint = "/v1/voiceprint/delete";
        const requestCore = (path: string) => path;
        export function PresenceExperience() {
          requestCore(endpoint);
          return <div>Presence</div>;
        }
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toContainEqual(
      expect.objectContaining({
        rule: "invented-remote-capability",
        file: "src/features/presence/PresenceExperience.tsx",
      }),
    );
  });

  it("rejects passive UI claims that a remote Task or artifact already exists", () => {
    const root = createFixture({
      "src/features/presence/PresenceExperience.tsx": `
        "use client";
        export function PresenceExperience() {
          return <div>Remote Task complete; artifact approved</div>;
        }
      `,
    });

    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "invented-remote-capability",
        detail: expect.stringMatching(/claims remote capability state/i),
      }),
    ]));
  });
});

function createFixture(
  files: Readonly<Record<string, string>>,
  options: { readonly buildEvidence?: boolean } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "astr-presence-boundary-"));
  temporaryDirectories.push(root);
  const defaults: Record<string, string> = {
    "src/app/page.tsx": `
      import { PresenceExperience } from "../features/presence/PresenceExperience";
      export default function Page() { return <PresenceExperience />; }
    `,
    "src/features/presence/PresenceExperience.tsx": `
      "use client";
      export function PresenceExperience() {
        return <div aria-disabled="true">Task remote capability is not enabled</div>;
      }
    `,
    ".next/server/app/page_client-reference-manifest.js": clientReferenceManifest([
      "static/chunks/presence-page.js",
    ]),
    ".next/static/chunks/presence-page.js": "export const presence = true;",
    "next.config.ts": "export default {};",
    "package.json": "{}",
    "package-lock.json": "{}",
    "postcss.config.mjs": "export default {};",
    "tsconfig.json": "{}",
    "public/.keep": "",
  };

  for (const [relativePath, source] of Object.entries({ ...defaults, ...files })) {
    const path = join(root, ...relativePath.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }

  const scannerTarget = join(root, "src/test/no-green-scanner.ts");
  mkdirSync(dirname(scannerTarget), { recursive: true });
  copyFileSync(resolve(process.cwd(), "src/test/no-green-scanner.ts"), scannerTarget);
  if (options.buildEvidence !== false) writeBuildEvidence(root);
  return root;
}

function writeBuildEvidence(root: string): void {
  const buildId = "fixture-build";
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

function hashBuildInputs(root: string): string {
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

function appendBuildInput(hash: Hash, root: string, relativePath: string): void {
  const absolutePath = join(root, ...relativePath.split("/"));
  if (statSync(absolutePath).isFile()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    return;
  }
  const entries = readdirSync(absolutePath, { withFileTypes: true, encoding: "utf8" });
  if (!Array.isArray(entries)) throw new TypeError("Expected directory entries.");
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

function runBoundary(root: string) {
  return spawnSync(process.execPath, [boundaryScript, "--root", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function parseReport(stdout: string): BoundaryReport {
  expect(stdout).not.toBe("");
  return JSON.parse(stdout) as BoundaryReport;
}

function clientReferenceManifest(chunks: readonly string[]): string {
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify({
    entryJSFiles: { "[project]/src/app/page": chunks },
  })};`;
}
