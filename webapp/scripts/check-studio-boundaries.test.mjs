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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const boundaryScript = resolve(process.cwd(), "scripts/check-studio-boundaries.mjs");
const temporaryDirectories = [];
const REQUIRED_ENDPOINT_SENTENCE =
  "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。";
const EXPECTED_TAXONOMY = Object.freeze([
  Object.freeze({
    id: "workspace",
    label: "Workspace",
    purpose: "未来工作空间证据类型",
    state: "unavailable",
  }),
  Object.freeze({
    id: "run",
    label: "Run",
    purpose: "未来运行证据类型",
    state: "unavailable",
  }),
  Object.freeze({
    id: "tool",
    label: "Tool",
    purpose: "未来工具证据类型",
    state: "unavailable",
  }),
  Object.freeze({
    id: "trace",
    label: "Trace",
    purpose: "未来轨迹证据类型",
    state: "unavailable",
  }),
  Object.freeze({
    id: "source",
    label: "Source",
    purpose: "未来来源证据类型",
    state: "unavailable",
  }),
  Object.freeze({
    id: "artifact",
    label: "Artifact",
    purpose: "未来产物证据类型",
    state: "unavailable",
  }),
]);

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { force: true, recursive: true });
  }
});

describe("Studio production boundary command", () => {
  it("accepts the exact unavailable observatory contract with fresh production evidence", () => {
    const root = createFixture();
    const result = runBoundary(root);
    const report = parseReport(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toEqual({
      schemaVersion: 1,
      check: "studio-boundaries",
      passed: true,
      sourceFilesScanned: 6,
      taxonomy: EXPECTED_TAXONOMY,
      buildEvidence: {
        status: "checked",
        chunks: [
          ".next/static/chunks/root.js",
          ".next/static/chunks/studio-page.js",
          ".next/static/chunks/studio-shell.js",
        ],
      },
      violations: [],
    });
  });

  it("returns a nonzero status when the requested project root cannot be inspected", () => {
    const missingRoot = join(tmpdir(), `astr-studio-missing-${Date.now()}`);
    const result = runBoundary(missingRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing shared no-green rule source");
  });

  it.each([
    ["ts", "studio-render-request-animation-frame"],
    ["tsx", "studio-render-request-animation-frame"],
    ["js", "studio-render-request-animation-frame"],
    ["jsx", "studio-render-request-animation-frame"],
    ["mjs", "studio-render-request-animation-frame"],
    ["cjs", "studio-render-request-animation-frame"],
    ["mts", "studio-render-request-animation-frame"],
    ["cts", "studio-render-request-animation-frame"],
    ["css", "studio-visual-gradient"],
  ])("traverses a transitive local .%s dependency", (extension, expectedRule) => {
    const dependency = `src/components/studio-transitive.${extension}`;
    const root = createFixture({
      "src/app/studio/page.tsx": studioPageSource(
        `import \"@/components/studio-transitive.${extension}\";`,
      ),
      [dependency]: extension === "css"
        ? ".probe { background: linear-gradient(90deg, var(--a), var(--b)); }"
        : "requestAnimationFrame(() => undefined); export const probe = true;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: expectedRule,
      file: dependency,
    }));
  });

  it("resolves relative imports outside the Studio-owned roots", () => {
    const root = createFixture({
      "src/app/studio/page.tsx": studioPageSource(
        "import { probe } from \"../../components/relative-probe\"; void probe;",
      ),
      "src/components/relative-probe.ts":
        "export const probe = () => requestAnimationFrame(() => undefined);",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-render-request-animation-frame",
      file: "src/components/relative-probe.ts",
    }));
  });

  it("follows quoted and unquoted CSS imports into the transitive graph", () => {
    const root = createFixture({
      "src/features/studio/components/imports.css": `
        @import url(../../../components/unquoted-material.css);
        @import "../../../components/quoted-material.css";
      `,
      "src/components/unquoted-material.css":
        ".rogue { background: radial-gradient(circle, var(--a), var(--b)); }",
      "src/components/quoted-material.css":
        ".rogue { backdrop-filter: blur(18px); }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "studio-visual-gradient",
        file: "src/components/unquoted-material.css",
      }),
      expect.objectContaining({
        rule: "studio-visual-backdrop-filter",
        file: "src/components/quoted-material.css",
      }),
    ]));
  });

  it.each([
    [
      "CSS Modules composes",
      `.shell { composes: rogue from "../../../components/composed-material.css"; }`,
      "src/components/composed-material.css",
      ".rogue { background: linear-gradient(90deg, var(--a), var(--b)); }",
      "studio-visual-gradient",
    ],
    [
      "ICSS @value",
      `@value rogue from "../../../components/icss-green.css";`,
      "src/components/icss-green.css",
      ".rogue { color: rgb(0, 255, 0); }",
      "no-green-hardcode",
    ],
  ])("follows a %s dependency into the transitive graph", (
    _label,
    ownerSource,
    dependency,
    dependencySource,
    expectedRule,
  ) => {
    const root = createFixture({
      "src/features/studio/components/dependency.css": ownerSource,
      [dependency]: dependencySource,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: expectedRule,
      file: dependency,
    }));
  });

  it.each([
    ["CSS Modules composes", `.shell { composes: rogue from var(--source); }`],
    ["ICSS @value", `@value rogue from var(--source);`],
  ])("fails closed on a nonliteral %s dependency", (_label, source) => {
    const root = createFixture({
      "src/features/studio/components/nonliteral.css": source,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-css-dependency-nonliteral",
      file: "src/features/studio/components/nonliteral.css",
    }));
  });

  it("fails closed when a resolved local dependency has an unscannable extension", () => {
    const root = createFixture({
      "src/app/studio/page.tsx": studioPageSource(
        "import \"@/components/opaque.wasm\";",
      ),
      "src/components/opaque.wasm": "opaque renderer payload",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-local-import-unscannable",
      file: "src/app/studio/page.tsx",
      match: "@/components/opaque.wasm",
    }));
  });

  it("fails closed on an unscannable file added directly inside a Studio-owned root", () => {
    const root = createFixture({
      "src/features/studio/opaque.wasm": "opaque renderer payload",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-source-unscannable",
      file: "src/features/studio/opaque.wasm",
    }));
  });

  it("fails closed when an extensionless local import resolves ambiguously", () => {
    const root = createFixture({
      "src/app/studio/page.tsx": studioPageSource(
        "import \"@/components/ambiguous-probe\";",
      ),
      "src/components/ambiguous-probe.cjs": "export const benign = true;",
      "src/components/ambiguous-probe.ts":
        "requestAnimationFrame(() => undefined); export const renderer = true;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-local-import-ambiguous",
      file: "src/app/studio/page.tsx",
      match: "@/components/ambiguous-probe",
    }));
  });

  it.each([
    ["direct heavy import", "import \"pixi.js\";", "studio-heavy-visual-import"],
    ["unapproved direct import", "import \"zustand\";", "studio-external-import"],
    ["literal dynamic import", "void import(\"./late\");", "studio-dynamic-import"],
    ["computed dynamic import", "const target = \"./late\"; void import(target);", "studio-dynamic-import-nonliteral"],
    ["require call", "require(\"./late\");", "studio-require"],
    ["computed require call", "const target = \"./late\"; require(target);", "studio-require"],
  ])("rejects a %s", (_label, source, expectedRule) => {
    const root = createFixture({
      "src/features/studio/forbidden-load.ts": source,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: expectedRule,
      file: "src/features/studio/forbidden-load.ts",
    }));
  });

  it.each([
    ["module.require", `module.require("@/components/member-require-renderer")`],
    ["optional global require", `globalThis.require?.("@/components/member-require-renderer")`],
    ["parenthesized module.require", `(module.require)("@/components/member-require-renderer")`],
    ["nested parenthesized computed require", `((module["require"]))("@/components/member-require-renderer")`],
  ])("rejects and traverses %s", (_label, expression) => {
    const root = createFixture({
      "src/features/studio/member-require.cjs": `${expression};`,
      "src/components/member-require-renderer.ts":
        "requestAnimationFrame(() => undefined); export const renderer = true;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "studio-require",
        file: "src/features/studio/member-require.cjs",
      }),
      expect.objectContaining({
        rule: "studio-render-request-animation-frame",
        file: "src/components/member-require-renderer.ts",
      }),
    ]));
  });

  it("fails closed on a computed member require target", () => {
    const root = createFixture({
      "src/features/studio/member-require.cjs": `
        const target = "@/components/member-require-renderer";
        module.require(target);
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-require",
      file: "src/features/studio/member-require.cjs",
      match: "computed require",
    }));
  });

  it.each([
    ["fetch", "fetch(\"/health\")"],
    ["XMLHttpRequest", "new XMLHttpRequest()"],
    ["EventSource", "new EventSource(\"/events\")"],
    ["WebSocket", "new WebSocket(\"ws://localhost\")"],
    ["sendBeacon", "navigator.sendBeacon(\"/trace\")"],
  ])("rejects the %s request primitive", (_label, expression) => {
    const root = createFixture({
      "src/features/studio/request.ts": `${expression};`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-request-api",
      file: "src/features/studio/request.ts",
    }));
  });

  it.each([
    ["computed fetch", `globalThis["fetch"]("/health")`],
    ["optional computed fetch", `globalThis?.["fetch"]?.("/health")`],
    ["computed XMLHttpRequest", `new (globalThis["XMLHttpRequest"])()`],
    ["optional EventSource", `new (globalThis?.["EventSource"])("/events")`],
    ["optional WebSocket", `globalThis?.["WebSocket"]?.("ws://localhost")`],
    ["optional sendBeacon", `navigator?.["sendBeacon"]?.("/trace")`],
  ])("rejects the %s member-access request primitive", (_label, expression) => {
    const root = createFixture({
      "src/features/studio/computed-request.ts": `${expression};`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-request-api",
      file: "src/features/studio/computed-request.ts",
    }));
  });

  it.each([
    ["process.env", "export const origin = process.env.ASTR_CORE_URL;"],
    ["import.meta.env", "export const origin = import.meta.env.VITE_CORE_URL;"],
  ])("rejects %s reads", (_label, source) => {
    const root = createFixture({ "src/features/studio/environment.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-environment-read",
      file: "src/features/studio/environment.ts",
    }));
  });

  it.each([
    ["computed import.meta env", `export const origin = import.meta["env"].CORE_URL;`],
    ["optional process env", `export const origin = process?.env?.ASTR_CORE_URL;`],
    ["optional computed process env", `export const origin = process?.["env"]?.ASTR_CORE_URL;`],
    ["global computed process env", `export const origin = globalThis["process"]?.["env"]?.ASTR_CORE_URL;`],
  ])("rejects %s reads", (_label, source) => {
    const root = createFixture({ "src/features/studio/environment-escape.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-environment-read",
      file: "src/features/studio/environment-escape.ts",
    }));
  });

  it.each([
    ["client directive", `"use client"; export const clientOwned = true;`],
    ["client effect", "useEffect(() => undefined, []);"],
    ["client state", "const state = useState(null); void state;"],
  ])("rejects a %s", (_label, source) => {
    const root = createFixture({ "src/features/studio/client-owned.ts": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-client-boundary",
      file: "src/features/studio/client-owned.ts",
    }));
  });

  it.each(["client", "data", "controller", "mock", "fixture", "demo"])(
    "rejects a Studio %s fallback module",
    (kind) => {
      const dependency = `src/components/studio-${kind}.ts`;
      const root = createFixture({
        "src/app/studio/page.tsx": studioPageSource(
          `import \"@/components/studio-${kind}\";`,
        ),
        [dependency]: "export const fallback = true;",
      });
      const report = parseReport(runBoundary(root).stdout);

      expect(report.violations).toContainEqual(expect.objectContaining({
        rule: "studio-fallback-module",
        file: dependency,
      }));
    },
  );

  it.each([
    ["constant", `const endpoint = ${JSON.stringify("/v1/studio/*")}; void endpoint;`],
    ["href attribute", `export const Probe = () => <a href="/v1/studio/*">route</a>;`],
    ["action attribute", `export const Probe = () => <form action="/v1/studio/*" />;`],
    ["request argument", `fetch("/v1/studio/*");`],
    ["concatenation", `const endpoint = "/v1/" + "studio/*"; void endpoint;`],
    ["template", "const endpoint = `/v1/studio/*`; void endpoint;"],
    ["executable argument", `consume("/v1/studio/*");`],
    ["JSX expression", `export const Probe = () => <p>{${JSON.stringify(REQUIRED_ENDPOINT_SENTENCE)}}</p>;`],
  ])("rejects the Studio endpoint fragment in a %s", (_label, source) => {
    const root = createFixture({ "src/features/studio/endpoint-probe.tsx": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/endpoint-probe.tsx",
    }));
  });

  it("rejects the exact sentence when copied into a client fallback module", () => {
    const root = createFixture({
      "src/features/studio/studio-client.tsx":
        `export const Probe = () => <p>${REQUIRED_ENDPOINT_SENTENCE}</p>;`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "studio-fallback-module" }),
      expect.objectContaining({ rule: "studio-endpoint-context" }),
    ]));
  });

  it("requires exactly one immutable Workplane endpoint sentence", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        export function StudioUnavailableWorkplane() {
          return <main>Core 暂未提供 Studio 读取合同。</main>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-truth",
    }));
  });

  it("rejects the contract sentence when hidden in a non-readable JSXText context", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        export function StudioUnavailableWorkplane() {
          return <main><script>${REQUIRED_ENDPOINT_SENTENCE}</script></main>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/components/StudioUnavailableWorkplane.tsx",
    }));
  });

  it("rejects a readable endpoint decoy that is not returned by StudioUnavailableWorkplane", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        const decoy = <p>${REQUIRED_ENDPOINT_SENTENCE}</p>;
        void decoy;
        export function StudioUnavailableWorkplane() { return <main />; }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/components/StudioUnavailableWorkplane.tsx",
    }));
  });

  it("rejects an endpoint assembled by an interpolated template", () => {
    const root = createFixture({
      "src/features/studio/endpoint-template.ts":
        "const endpoint = `/v1/${\"studio\"}/*`; void endpoint;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/endpoint-template.ts",
    }));
  });

  it("rejects endpoint assembly through an identifier-bound fragment", () => {
    const root = createFixture({
      "src/features/studio/endpoint-identifier.ts": `
        const prefix = "/v1/";
        const endpoint = prefix + "studio/*";
        void endpoint;
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/endpoint-identifier.ts",
    }));
  });

  it("rejects the contract sentence in a statically dead logical branch", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        export function StudioUnavailableWorkplane() {
          return <main>{false && <p>${REQUIRED_ENDPOINT_SENTENCE}</p>}</main>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/components/StudioUnavailableWorkplane.tsx",
    }));
  });

  it("rejects a className that could hide the endpoint truth sentence", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        export function StudioUnavailableWorkplane() {
          return <main><p className="hidden">${REQUIRED_ENDPOINT_SENTENCE}</p></main>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/components/StudioUnavailableWorkplane.tsx",
    }));
  });

  it("rejects CSS that hides the allowlisted endpoint truth class", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        import styles from "./StudioSurface.module.css";
        export function StudioUnavailableWorkplane() {
          return <main><p className={styles.contractStatement}>${REQUIRED_ENDPOINT_SENTENCE}</p></main>;
        }
      `,
      "src/features/studio/components/StudioSurface.module.css":
        ".contractStatement { display: none; }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-visual-hidden-content",
      file: "src/features/studio/components/StudioSurface.module.css",
    }));
  });

  it("requires the endpoint truth sentence to use the exact contractStatement class", () => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        import styles from "./StudioSurface.module.css";
        export function StudioUnavailableWorkplane() {
          return <main><p className={styles.concealed}>${REQUIRED_ENDPOINT_SENTENCE}</p></main>;
        }
      `,
      "src/features/studio/components/StudioSurface.module.css":
        ".concealed { color: var(--astr-text-3); }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-endpoint-context",
      file: "src/features/studio/components/StudioUnavailableWorkplane.tsx",
    }));
  });

  it.each([
    ["clip-path concealment", "clip-path: inset(50%);"],
    ["zero physical sizing", "width: 0; height: 0; overflow: hidden;"],
    ["zero logical sizing", "inline-size: 0px; block-size: 0px; overflow: hidden;"],
  ])("rejects %s on the endpoint truth stylesheet", (_label, declaration) => {
    const root = createFixture({
      "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
        import styles from "./StudioSurface.module.css";
        export function StudioUnavailableWorkplane() {
          return <main><p className={styles.contractStatement}>${REQUIRED_ENDPOINT_SENTENCE}</p></main>;
        }
      `,
      "src/features/studio/components/StudioSurface.module.css":
        `.contractStatement { ${declaration} }`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-visual-hidden-content",
      file: "src/features/studio/components/StudioSurface.module.css",
    }));
  });

  it.each([
    ["RAF", "requestAnimationFrame(render);", "studio-render-request-animation-frame"],
    ["optional RAF", "window.requestAnimationFrame?.(render);", "studio-render-request-animation-frame"],
    ["Canvas JSX", "export const Probe = () => <canvas />;", "studio-render-canvas"],
    ["Canvas constructor", "new Canvas();", "studio-render-canvas"],
    ["OffscreenCanvas", "new OffscreenCanvas(10, 10);", "studio-render-canvas"],
    ["getContext", "surface[\"getContext\"](\"2d\");", "studio-render-get-context"],
    ["WebGL", "const renderer = new WebGLRenderer();", "studio-render-gpu"],
    ["WebGPU", "navigator.gpu.requestAdapter();", "studio-render-gpu"],
    ["Pixi", "import \"pixi.js\";", "studio-heavy-visual-import"],
    ["Three", "import \"three\";", "studio-heavy-visual-import"],
    ["Live2D", "import \"pixi-live2d-display-lipsyncpatch\";", "studio-heavy-visual-import"],
    ["framer-motion", "import \"framer-motion\";", "studio-heavy-visual-import"],
  ])("rejects %s renderer ownership", (_label, source, expectedRule) => {
    const root = createFixture({ "src/features/studio/renderer.tsx": source });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: expectedRule,
      file: "src/features/studio/renderer.tsx",
    }));
  });

  it("rejects gradients, backdrop filtering, blur, keyframes, and CSS animation", () => {
    const root = createFixture({
      "src/features/studio/components/material.css": `
        .gradient { background: linear-gradient(90deg, var(--a), var(--b)); }
        .glass { backdrop-filter: blur(20px); }
        .blur { filter: blur(8px); }
        @keyframes drift { to { transform: translateX(1px); } }
        .animated { animation: drift 2s linear infinite; }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);
    const rules = report.violations.map(({ rule }) => rule);

    expect(rules).toEqual(expect.arrayContaining([
      "studio-visual-gradient",
      "studio-visual-backdrop-filter",
      "studio-visual-blur",
      "studio-visual-animation",
    ]));
  });

  it("reuses the constitutional no-green scanner", () => {
    const root = createFixture({
      "src/features/studio/components/green.css": ".rogue { color: rgb(0, 255, 0); }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "no-green-hardcode",
      file: "src/features/studio/components/green.css",
    }));
  });

  it.each([
    ["button", "<button>Run</button>"],
    ["form", "<form />"],
    ["input", "<input />"],
    ["textarea", "<textarea />"],
    ["select", "<select />"],
    ["editor component", "<Editor />"],
    ["click handler", "<div onClick={() => undefined} />"],
    ["editable region", "<div contentEditable />"],
    ["progress", "<progress value={1} />"],
    ["details", "<details><summary>More</summary></details>"],
    ["summary", "<summary>More</summary>"],
    ["dynamic button role", `<div role={"button"} />`],
    ["template progress role", "<div role={`progressbar`} />"],
    ["ARIA fallback button role", `<div role="unknown button" />`],
    ["ARIA fallback tab role", `<div role={"unknown\t tab"} />`],
    ["unknown dynamic role", "<div role={roleName} />"],
    ["tab stop", "<div tabIndex={0} />"],
    ["dynamic tab stop", "<div tabIndex={tabIndex} />"],
    ["iframe", `<iframe src="/admin" />`],
    ["object embed", `<object data="/admin" />`],
    ["embed", `<embed src="/admin" />`],
    ["controlled audio", `<audio controls src="/tone.mp3" />`],
    ["image-map area", `<area href="/admin" />`],
  ])("rejects a %s action/editor primitive", (_label, jsx) => {
    const root = createFixture({
      "src/features/studio/action.tsx": `export const Probe = () => (${jsx});`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/action.tsx",
    }));
  });

  it.each([
    ["button", `React.createElement("button", null, "Run")`],
    ["progress", `React["createElement"]("progress", null)`],
    ["details", `createElement("details", null)`],
    ["iframe", `React.createElement("iframe", { src: "/admin" })`],
    ["dynamic tag", `React.createElement(tagName, null)`],
    ["parenthesized button", `(React.createElement)("button", null, "Run")`],
    ["nested parenthesized progress", `((React["createElement"]))("progress", null)`],
    ["image-map area", `React.createElement("area", { href: "/admin" })`],
    ["bare image-map area", `React.createElement("area", null)`],
  ])("rejects createElement for a %s action surface", (_label, expression) => {
    const root = createFixture({
      "src/features/studio/create-element.ts": `${expression};`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/create-element.ts",
    }));
  });

  it.each([
    ["interactive role", `{ role: "button" }`],
    ["live-region role", `{ role: "unknown status" }`],
    ["dynamic role", `{ role: roleName }`],
    ["tab stop", `{ tabIndex: 0 }`],
    ["dynamic tab index", `{ tabIndex }`],
    ["event handler", `{ onClick: run }`],
    ["dangerous HTML", `{ dangerouslySetInnerHTML: { __html: markup } }`],
    ["editable content", `{ contentEditable: false }`],
    ["live region", `{ "aria-live": "polite" }`],
    ["busy live region", `{ "aria-busy": false }`],
    ["autofocus", `{ autoFocus: false }`],
    ["dynamic props object", `props`],
    ["spread props", `{ ...props }`],
    ["computed prop name", `{ [propName]: value }`],
    ["action callback", `{ action: run }`],
    ["form action callback", `{ formAction: run }`],
    ["raw inner HTML", `{ innerHTML: markup }`],
    ["unknown prop name", `{ command: "run" }`],
    ["dynamic inert prop value", `{ id: run() }`],
  ])("rejects createElement %s props", (_label, props) => {
    const root = createFixture({
      "src/features/studio/create-element-props.ts":
        `React.createElement("div", ${props});`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/create-element-props.ts",
    }));
  });

  it("allows a createElement call with fully inspectable inert props", () => {
    const root = createFixture({
      "src/features/studio/create-element-props.ts": `
        React.createElement("div", {
          id: "probe",
          className: "probe",
          "aria-label": "Probe",
          "data-state": "idle",
        });
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).not.toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/create-element-props.ts",
    }));
  });

  it("rejects a JSX intrinsic action element hidden behind a local alias", () => {
    const root = createFixture({
      "src/features/studio/aliased-intrinsic.tsx": `
        const Tag = "button";
        export const Probe = () => <Tag />;
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/aliased-intrinsic.tsx",
    }));
  });

  it("rejects cloneElement overriding an otherwise compliant Studio exit", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": `
        import type { ReactNode } from "react";
        import React from "react";
        import Link from "next/link";
        import { ThemeToggle } from "@/components/astr/ThemeToggle";
        import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
        export function StudioShell({ children }: { children: ReactNode }) {
          return <div data-route-surface="studio">
            <nav>
              {React.cloneElement(
                <Link href="/" prefetch={false}>Presence</Link>,
                { href: "/evil", prefetch: true },
              )}
              <Link href="/admin" prefetch={false}>Control</Link>
              <Link href="/mobile/presence" prefetch={false}>Mobile</Link>
            </nav>
            <ThemeToggle />
            <VisualMotionRouteSlot />
            {children}
          </div>;
        }
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/components/StudioShell.tsx",
    }));
  });

  it("rejects a React createFactory action surface", () => {
    const root = createFixture({
      "src/features/studio/create-factory.ts": `React.createFactory("button");`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/create-factory.ts",
    }));
  });

  it.each([
    [
      "named import alias",
      `import { createElement as h } from "react"; h("button", null);`,
    ],
    [
      "local member alias",
      `import React from "react"; const h = React.createElement; h("area", null);`,
    ],
  ])("rejects a createElement %s", (_label, source) => {
    const root = createFixture({
      "src/features/studio/create-element-alias.ts": source,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/create-element-alias.ts",
    }));
  });

  it("treats JSX role attribute names case-insensitively", () => {
    const root = createFixture({
      "src/features/studio/uppercase-role.tsx":
        `export const Probe = () => <div ROLE="button" />;`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/uppercase-role.tsx",
    }));
  });

  it.each([
    ["script element", `<script>fetch("/health")</script>`],
    ["dangerous HTML", `<div dangerouslySetInnerHTML={{ __html: markup }} />`],
    ["action callback", `<Surface action={run} />`],
    ["form action callback", `<Surface formAction={run} />`],
    ["raw inner HTML", `<Surface innerHTML={markup} />`],
    ["unknown custom prop", `<Surface command="run" />`],
    ["executed prop value", `<div id={run()} />`],
    ["aria-live", `<div aria-live="polite" />`],
    ["aria-busy", `<div aria-busy={false} />`],
    ["autofocus", `<div autoFocus={false} />`],
    ["status role", `<div role="status" />`],
    ["alert role", `<div role="alert" />`],
    ["log role", `<div role="log" />`],
    ["timer role", `<div role="timer" />`],
    ["marquee role", `<div role="marquee" />`],
  ])("rejects a Studio-wide JSX %s surface", (_label, jsx) => {
    const root = createFixture({
      "src/features/studio/non-workplane-surface.tsx":
        `export const Probe = () => (${jsx});`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-action-primitive",
      file: "src/features/studio/non-workplane-surface.tsx",
    }));
  });

  it.each([
    ["wrong destination", "<Link href=\"/studio\" prefetch={false}>Studio</Link>"],
    ["missing prefetch policy", "<Link href=\"/\">Presence</Link>"],
    ["native anchor", "<a href=\"/admin\">Control</a>"],
  ])("rejects an extra navigation link with %s", (_label, jsx) => {
    const root = createFixture({
      "src/features/studio/extra-link.tsx": `
        import Link from "next/link";
        export const Probe = () => (${jsx});
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-navigation-link",
      file: "src/features/studio/extra-link.tsx",
    }));
  });

  it("rejects a lookalike local shared control", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": `
        import { ThemeToggle } from "@/features/studio/components/ThemeToggle";
        export function StudioShell({ children }) { return <div><ThemeToggle />{children}</div>; }
      `,
      "src/features/studio/components/ThemeToggle.tsx":
        "export const ThemeToggle = () => <button>theme</button>;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-shared-control",
      file: "src/features/studio/components/StudioShell.tsx",
    }));
  });

  it("rejects an additional side-effect import from an approved shared-control path", () => {
    const root = createFixture({
      "src/features/studio/control-side-effect.ts":
        `import "@/components/astr/ThemeToggle"; export const sideEffect = true;`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-shared-control",
      file: "src/features/studio/control-side-effect.ts",
    }));
  });

  it("rejects and traverses TypeScript import-equals require syntax", () => {
    const root = createFixture({
      "src/features/studio/import-equals.cts": `
        import renderer = require("@/components/import-equals-renderer");
        export const loaded = renderer;
      `,
      "src/components/import-equals-renderer.ts":
        "requestAnimationFrame(() => undefined); export = {};",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "studio-require",
        file: "src/features/studio/import-equals.cts",
      }),
      expect.objectContaining({
        rule: "studio-render-request-animation-frame",
        file: "src/components/import-equals-renderer.ts",
      }),
    ]));
  });

  it("requires the navigation Link binding to be the exact next/link default import", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": studioShellSource(
        "@/components/FauxLink",
      ),
      "src/components/FauxLink.ts": "export default function Link({ children }) { return children; }",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-navigation-link",
      file: "src/features/studio/components/StudioShell.tsx",
    }));
  });

  it("rejects an aliased next/link import and its otherwise invisible JSX usage", () => {
    const root = createFixture({
      "src/features/studio/aliased-link.tsx": `
        import Alias from "next/link";
        export const Probe = () => <Alias href="/unapproved">Escape</Alias>;
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-navigation-link",
      file: "src/features/studio/aliased-link.tsx",
    }));
  });

  it.each([
    ["missing", EXPECTED_TAXONOMY.slice(1)],
    ["reordered", [EXPECTED_TAXONOMY[1], EXPECTED_TAXONOMY[0], ...EXPECTED_TAXONOMY.slice(2)]],
    ["duplicate", [...EXPECTED_TAXONOMY, EXPECTED_TAXONOMY[0]]],
    ["wrong state", EXPECTED_TAXONOMY.map((entry) => entry.id === "run"
      ? { ...entry, state: "available" }
      : entry)],
    ["wrong purpose", EXPECTED_TAXONOMY.map((entry) => entry.id === "tool"
      ? { ...entry, purpose: "可执行工具" }
      : entry)],
  ])("rejects a %s taxonomy", (_label, taxonomy) => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts": taxonomySource(taxonomy),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.taxonomy).toEqual(taxonomy);
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it("rejects an opaque spread appended to six otherwise valid taxonomy entries", () => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts": `
        function defineStudioProjection(projection) { return projection; }
        const opaque = [];
        const projections = [
          ${EXPECTED_TAXONOMY.map((entry) =>
            `defineStudioProjection(${JSON.stringify(entry)})`).join(",\n")},
          ...opaque,
        ] as const;
        export const STUDIO_PROJECTIONS = Object.freeze(projections);
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it("rejects an exact decoy array when STUDIO_PROJECTIONS exports another registry", () => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts": `
        function defineStudioProjection(projection) { return projection; }
        const projections = [
          ${EXPECTED_TAXONOMY.map((entry) =>
            `defineStudioProjection(${JSON.stringify(entry)})`).join(",\n")}
        ] as const;
        const actual = [] as const;
        export const STUDIO_PROJECTIONS = Object.freeze(actual);
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it.each([
    ["let", "let projections"],
    ["var", "var projections"],
  ])("rejects a %s projections declaration", (_label, declaration) => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts":
        taxonomySource(EXPECTED_TAXONOMY).replace("const projections", declaration),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it("rejects reassignment of an otherwise exact const projections registry", () => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts":
        taxonomySource(EXPECTED_TAXONOMY).replace(
          "export const STUDIO_PROJECTIONS",
          "projections = [] as const;\nexport const STUDIO_PROJECTIONS",
        ),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it.each([
    ["pop mutation", "projections.pop();"],
    ["splice mutation", "projections.splice(0, 1);"],
    ["sort mutation", "projections.sort();"],
    ["Object.assign mutation", "Object.assign(projections, { length: 0 });"],
    ["alias escape", "const alias = projections; alias.pop();"],
    ["unknown call escape", "mutate(projections);"],
  ])("rejects a projections %s", (_label, mutation) => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts":
        taxonomySource(EXPECTED_TAXONOMY).replace(
          "export const STUDIO_PROJECTIONS",
          `${mutation}\nexport const STUDIO_PROJECTIONS`,
        ),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it.each([
    [
      "mutating projection factory",
      (source) => source.replace(
        "return Object.freeze(projection);",
        `projection.state = "available"; return projection;`,
      ),
    ],
    [
      "dynamic eval mutation",
      (source) => source.replace(
        "export const STUDIO_PROJECTIONS",
        `eval("projections.pop()");\nexport const STUDIO_PROJECTIONS`,
      ),
    ],
    [
      "shadowed Object.freeze",
      (source) => `const Object = { freeze: (value) => value };\n${source}`,
    ],
    [
      "exported registry mutation",
      (source) => `${source}\nSTUDIO_PROJECTIONS.pop();`,
    ],
  ])("rejects a taxonomy with %s", (_label, mutateSource) => {
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts":
        mutateSource(taxonomySource(EXPECTED_TAXONOMY)),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it.each([
    [
      "duplicate key",
      `{ id: "workspace", id: "run", label: "Workspace", purpose: "未来工作空间证据类型", state: "unavailable" }`,
    ],
    [
      "extra key",
      `{ id: "workspace", label: "Workspace", purpose: "未来工作空间证据类型", state: "unavailable", route: "/studio" }`,
    ],
    [
      "spread",
      `{ id: "workspace", label: "Workspace", purpose: "未来工作空间证据类型", state: "unavailable", ...extra }`,
    ],
    [
      "method",
      `{ id: "workspace", label: "Workspace", purpose: "未来工作空间证据类型", state: "unavailable", execute() {} }`,
    ],
  ])("rejects a taxonomy entry with a %s", (_label, firstEntry) => {
    const remaining = EXPECTED_TAXONOMY.slice(1)
      .map((entry) => `defineStudioProjection(${JSON.stringify(entry)})`)
      .join(",\n");
    const root = createFixture({
      "src/features/studio/model/studio-projections.ts": `
        function defineStudioProjection(projection) { return projection; }
        const extra = {};
        const projections = [
          defineStudioProjection(${firstEntry}),
          ${remaining}
        ] as const;
        export const STUDIO_PROJECTIONS = Object.freeze(projections);
      `,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-taxonomy-exact",
    }));
  });

  it.each([
    ["zero", studioShellSource("next/link", false)],
    ["two", studioShellSource(
      "next/link",
      true,
      "const duplicate = <aside data-route-surface=\"studio\" />; void duplicate;",
    )],
    ["computed", studioShellSource("next/link", "computed")],
  ])("rejects %s exact Studio route surfaces", (_label, shellSource) => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": shellSource,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-route-surface",
    }));
  });

  it("rejects a decoy route marker outside StudioShell", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": studioShellSource("next/link", false),
      "src/features/studio/route-decoy.tsx":
        "export const Decoy = () => <aside data-route-surface=\"studio\" />;",
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-route-surface",
      file: "src/features/studio/route-decoy.tsx",
    }));
  });

  it("rejects a StudioShell route marker in a statically dead logical branch", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": deadRouteStudioShellSource(),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-route-surface",
      file: "src/features/studio/components/StudioShell.tsx",
    }));
  });

  it("rejects the three links and two controls in a statically dead ternary branch", () => {
    const root = createFixture({
      "src/features/studio/components/StudioShell.tsx": deadChromeStudioShellSource(),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "studio-navigation-link" }),
      expect.objectContaining({ rule: "studio-shared-control" }),
    ]));
  });

  it.each([
    ["Pixi", "pixi.js"],
    ["Three", "three.module.js"],
    ["Live2D", "pixi-live2d-display"],
    ["framer-motion", "framer-motion"],
    ["2048 texture", "avatar.2048/texture_00.png"],
  ])("rejects %s bytes in a resolved Studio production chunk", (_label, bytes) => {
    const root = createFixture({
      ".next/static/chunks/studio-page.js": `export const payload = ${JSON.stringify(bytes)};`,
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-chunk-heavy-visual",
      file: ".next/static/chunks/studio-page.js",
    }));
  });

  it.each([
    ["RAF", "globalThis.requestAnimationFrame?.(tick)"],
    ["canvas context", "surface[\"getContext\"](\"webgl\")"],
    ["canvas creation", "React.createElement(\"canvas\")"],
    ["Turbopack jsx canvas", `(0,t.jsx)("canvas", {})`],
    ["Turbopack jsxs canvas", `(0,t.jsxs)("canvas", {})`],
    ["Turbopack createElement canvas", `(0,t.createElement)("canvas", {})`],
    ["member jsx canvas", `t.jsx("canvas", {})`],
    ["OffscreenCanvas", "new OffscreenCanvas(64, 64)"],
    ["WebGPU", "navigator.gpu.requestAdapter()"],
  ])("rejects %s renderer bytes in a resolved Studio production chunk", (_label, bytes) => {
    const root = createFixture({ ".next/static/chunks/studio-shell.js": bytes });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-chunk-renderer-api",
      file: ".next/static/chunks/studio-shell.js",
    }));
  });

  it("fails closed when stamped build identity evidence is missing", () => {
    const root = createFixture({}, { buildEvidence: false });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence).toEqual({ status: "missing", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-evidence-missing",
    }));
  });

  it("fails closed when Studio source changes after the stamped build", () => {
    const root = createFixture();
    writeFileSync(
      join(root, "src/app/studio/page.tsx"),
      studioPageSource("const changed = true; void changed;"),
    );
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence).toEqual({ status: "stale", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-evidence-stale",
    }));
  });

  it("fails closed when BUILD_ID does not match the stamp", () => {
    const root = createFixture();
    writeFileSync(join(root, ".next/BUILD_ID"), "different-build-id");
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence).toEqual({ status: "stale", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-evidence-stale",
      match: "BUILD_ID",
    }));
  });

  it("fails closed when /studio/page is absent from the app-paths manifest", () => {
    const root = createFixture({
      ".next/server/app-paths-manifest.json": JSON.stringify({ "/page": "app/page.js" }),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence.status).toBe("checked");
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-app-path-missing",
    }));
  });

  it("rejects an app-path entry that escapes the canonical server evidence root", () => {
    const root = createFixture({
      ".next/server/app-paths-manifest.json": JSON.stringify({
        "/studio/page": "../../package.json",
      }),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-app-path-invalid",
      file: ".next/server/app-paths-manifest.json",
    }));
  });

  it("fails closed when the Studio client-reference manifest is missing", () => {
    const root = createFixture();
    unlinkSync(join(root, ".next/server/app/studio/page_client-reference-manifest.js"));
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence.status).toBe("checked");
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-client-manifest-missing",
    }));
  });

  it("forbids checked build evidence with zero resolved Studio chunks", () => {
    const root = createFixture({
      ".next/server/app/studio/page_client-reference-manifest.js": studioManifest([]),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.buildEvidence).toEqual({ status: "checked", chunks: [] });
    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-chunks-empty",
    }));
  });

  it("fails closed when a referenced Studio chunk is missing", () => {
    const root = createFixture();
    unlinkSync(join(root, ".next/static/chunks/studio-page.js"));
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-chunk-missing",
      file: ".next/static/chunks/studio-page.js",
    }));
  });

  it("rejects a client-manifest chunk that escapes the canonical chunk root", () => {
    const root = createFixture({
      ".next/server/app/studio/page_client-reference-manifest.js": studioManifest([
        "../package.json",
      ]),
    });
    const report = parseReport(runBoundary(root).stdout);

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "studio-build-chunk-invalid",
      file: ".next/server/app/studio/page_client-reference-manifest.js",
    }));
  });
});

function createFixture(files = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "astr-studio-boundary-"));
  temporaryDirectories.push(root);
  const defaults = {
    "src/app/studio/page.tsx": studioPageSource(),
    "src/app/studio/layout.tsx": `
      import type { ReactNode } from "react";
      import { StudioShell } from "@/features/studio/components/StudioShell";
      export default function StudioLayout({ children }: { children: ReactNode }) {
        return <StudioShell>{children}</StudioShell>;
      }
    `,
    "src/features/studio/components/StudioShell.tsx": studioShellSource(),
    "src/features/studio/components/StudioUnavailableWorkplane.tsx": `
      import { STUDIO_PROJECTIONS } from "@/features/studio/model/studio-projections";
      export function StudioUnavailableWorkplane() {
        return <main>
          <p>${REQUIRED_ENDPOINT_SENTENCE}</p>
          <ul>{STUDIO_PROJECTIONS.map((projection) => <li key={projection.id}>{projection.label}</li>)}</ul>
        </main>;
      }
    `,
    "src/features/studio/components/studio.css": ".workplane { color: var(--text-primary); }",
    "src/features/studio/model/studio-projections.ts": taxonomySource(EXPECTED_TAXONOMY),
    "src/components/astr/ThemeToggle.tsx":
      "export function ThemeToggle() { return null; }",
    "src/components/system/VisualMotionToggle.tsx":
      "export function VisualMotionRouteSlot() { return null; }",
    ".next/server/app-paths-manifest.json": JSON.stringify({
      "/studio/page": "app/studio/page.js",
    }),
    ".next/server/app/studio/page.js": "export const route = true;",
    ".next/server/app/studio/page_client-reference-manifest.js": studioManifest([
      "static/chunks/root.js",
      "static/chunks/studio-shell.js",
      "static/chunks/studio-page.js",
    ]),
    ".next/static/chunks/root.js": "export const root = true;",
    ".next/static/chunks/studio-shell.js": "export const shell = true;",
    ".next/static/chunks/studio-page.js": "export const page = true;",
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

function studioPageSource(extra = "") {
  return `
    import { StudioUnavailableWorkplane } from "@/features/studio/components/StudioUnavailableWorkplane";
    ${extra}
    export default function StudioPage() {
      return <div><StudioUnavailableWorkplane /></div>;
    }
  `;
}

function studioShellSource(linkModule = "next/link", routeSurface = true, extra = "") {
  const surface = routeSurface === "computed"
    ? "data-route-surface={\"studio\"}"
    : routeSurface
      ? "data-route-surface=\"studio\""
      : "";
  return `
    import type { ReactNode } from "react";
    import Link from ${JSON.stringify(linkModule)};
    import { ThemeToggle } from "@/components/astr/ThemeToggle";
    import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
    ${extra}
    export function StudioShell({ children }: { children: ReactNode }) {
      return <div ${surface}>
        <nav>
          <Link href="/" prefetch={false}>Presence</Link>
          <Link href="/admin" prefetch={false}>Control</Link>
          <Link href="/mobile/presence" prefetch={false}>Mobile</Link>
        </nav>
        <ThemeToggle />
        <VisualMotionRouteSlot />
        {children}
      </div>;
    }
  `;
}

function deadRouteStudioShellSource() {
  return `
    import type { ReactNode } from "react";
    import Link from "next/link";
    import { ThemeToggle } from "@/components/astr/ThemeToggle";
    import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
    export function StudioShell({ children }: { children: ReactNode }) {
      return <div>
        {false && <aside data-route-surface="studio" />}
        <nav>
          <Link href="/" prefetch={false}>Presence</Link>
          <Link href="/admin" prefetch={false}>Control</Link>
          <Link href="/mobile/presence" prefetch={false}>Mobile</Link>
        </nav>
        <ThemeToggle />
        <VisualMotionRouteSlot />
        {children}
      </div>;
    }
  `;
}

function deadChromeStudioShellSource() {
  return `
    import type { ReactNode } from "react";
    import Link from "next/link";
    import { ThemeToggle } from "@/components/astr/ThemeToggle";
    import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";
    export function StudioShell({ children }: { children: ReactNode }) {
      return <div data-route-surface="studio">
        {false ? <>
          <Link href="/" prefetch={false}>Presence</Link>
          <Link href="/admin" prefetch={false}>Control</Link>
          <Link href="/mobile/presence" prefetch={false}>Mobile</Link>
          <ThemeToggle />
          <VisualMotionRouteSlot />
        </> : null}
        {children}
      </div>;
    }
  `;
}

function taxonomySource(taxonomy) {
  const entries = taxonomy
    .map((entry) => `defineStudioProjection(${JSON.stringify(entry)})`)
    .join(",\n");
  return `
    function defineStudioProjection(projection) { return Object.freeze(projection); }
    const projections = [${entries}] as const;
    export const STUDIO_PROJECTIONS = Object.freeze(projections);
  `;
}

function studioManifest(chunks) {
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/studio/page"] = ${JSON.stringify({
    entryJSFiles: { "[project]/src/app/studio/page": chunks },
  })};`;
}

function writeBuildEvidence(root) {
  const buildId = "fixture-studio-build";
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
  const result = spawnSync(process.execPath, [boundaryScript, "--root", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const stdout = result.stdout.trim();
  if (stdout.startsWith("{")) {
    const report = JSON.parse(stdout);
    if (report.passed === false) expect(result.status, result.stderr).toBe(1);
  }
  return result;
}

function parseReport(stdout) {
  expect(stdout).not.toBe("");
  return JSON.parse(stdout);
}
