import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";

import { render, screen, within } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { MobileWorkbenchGate } from "./MobileWorkbenchGate";

const CAPABILITIES = [
  "Workspace",
  "Run",
  "Tool",
  "Trace",
  "Source",
  "Artifact",
] as const;

function staticImportSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  return sourceFile.statements.flatMap((statement) => {
    if (ts.isImportEqualsDeclaration(statement)) return ["<import-equals>"];
    if (!ts.isImportDeclaration(statement)) return [];
    return ts.isStringLiteralLike(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : ["<non-literal-import>"];
  });
}

function extractTopLevelCssRule(css: string, selector: string): string | null {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let preludeStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      if (depth === 0) {
        const prelude = source.slice(preludeStart, index).trim();
        if (prelude === selector) {
          let ruleDepth = 1;
          for (let end = index + 1; end < source.length; end += 1) {
            if (source[end] === "{") ruleDepth += 1;
            if (source[end] === "}") ruleDepth -= 1;
            if (ruleDepth === 0) return source.slice(index + 1, end);
          }
          throw new Error(`Unclosed CSS rule: ${selector}`);
        }
      }
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth < 0) throw new Error("Unexpected CSS closing brace");
      if (depth === 0) preludeStart = index + 1;
    }
  }

  if (depth !== 0) throw new Error("Unclosed CSS block");
  return null;
}

function expectNoFakeControls(container: HTMLElement): void {
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("[disabled]")).toBeNull();
  expect(
    container.querySelector(
      "[aria-live], [aria-busy], [role='progressbar'], select, [tabindex], [contenteditable]",
    ),
  ).toBeNull();
}

describe("MobileWorkbenchGate", () => {
  it("sees multiline and side-effect imports without accepting media fallbacks", () => {
    const mutatedSource = [
      "import {",
      "  type ReactNode,",
      "} from 'react';",
      "import './unexpected.css';",
    ].join("\n");
    const mutatedCss = [
      ".gate { color: var(--astr-text); }",
      "@media (max-width: 44rem) {",
      "  .gate { background: var(--astr-surface); }",
      "}",
    ].join("\n");

    expect(staticImportSpecifiers(mutatedSource, "mutated.tsx")).toEqual([
      "react",
      "./unexpected.css",
    ]);
    expect(extractTopLevelCssRule(mutatedCss, ".gate")).toBe(
      " color: var(--astr-text); ",
    );
  });

  it("renders the exact unavailable Studio boundary without simulated work", () => {
    const { container } = render(<MobileWorkbenchGate />);

    expect(
      screen.getByRole("heading", { level: 1, name: "AI 工作台" }),
    ).toBeVisible();
    expect(screen.getByText("Studio 投影未启用")).toBeVisible();
    expect(
      screen.getByText("缺少已授权 authority、认证 scopes 与只读 endpoints"),
    ).toBeVisible();
    expect(
      screen.getByText("没有可验证的 Run、模型路由、成本或产物数据。"),
    ).toBeVisible();

    const list = screen.getByRole("list", { name: "AI 工作台能力边界" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(CAPABILITIES);

    expectNoFakeControls(container);
    expect(container.textContent).toBe(
      [
        "WORKBENCH / CAPABILITY BOUNDARY",
        "AI 工作台",
        "Studio 投影未启用",
        "缺少已授权 authority、认证 scopes 与只读 endpoints",
        "没有可验证的 Run、模型路由、成本或产物数据。",
        ...CAPABILITIES,
      ].join(""),
    );
    expect(container).not.toHaveTextContent("$0");
    expect(container).not.toHaveTextContent(/成功|已完成|产物已返回|示例任务/);
    expect(container).not.toHaveTextContent(/\d+(?:\.\d+)?(?:%|次|个|条|项)/);
  });

  it("is server-renderable and keeps the shared visual seam static and solid", () => {
    const html = renderToString(<MobileWorkbenchGate />);
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/workbench/MobileWorkbenchGate.tsx",
      ),
      "utf8",
    );
    const sharedSource = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/shared/CapabilityGate.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/shared/CapabilityGate.module.css",
      ),
      "utf8",
    );
    const imports = staticImportSpecifiers(source, "MobileWorkbenchGate.tsx");
    const sharedImports = staticImportSpecifiers(
      sharedSource,
      "CapabilityGate.tsx",
    );
    const gateRule = extractTopLevelCssRule(css, ".gate");
    const capabilitiesRule = extractTopLevelCssRule(css, ".capabilities");
    const capabilityItemRule = extractTopLevelCssRule(
      css,
      ".capabilities > li",
    );

    expect((html.match(/<h1/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<(?:button|form|input|textarea|a)\b/);
    expect(imports).toEqual(["react", "../shared/CapabilityGate"]);
    expect(source).not.toMatch(/^["']use client["'];/m);
    expect(sharedImports).toEqual(["react", "./CapabilityGate.module.css"]);
    expect(sharedSource).not.toMatch(
      /^["']use [^"']+["'];|\buse[A-Z]\w*\b|\b(?:window|document|fetch)\b|import\s*\(/m,
    );
    expect(gateRule, "gate surface rule").not.toBeNull();
    if (!gateRule) throw new Error("Missing gate surface rule");
    expect(gateRule).toMatch(/background:\s*var\(--astr-surface\)\s*;/);
    expect(gateRule).toMatch(
      /border-inline-start:\s*3px solid var\(--astr-soul\)\s*;/,
    );
    expect(gateRule).not.toMatch(/border-radius\s*:|box-shadow\s*:/);
    expect(capabilitiesRule, "desktop capabilities rule").not.toBeNull();
    if (!capabilitiesRule) throw new Error("Missing desktop capabilities rule");
    expect(capabilitiesRule).toMatch(
      /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*;/,
    );
    expect(capabilityItemRule, "direct capability-item rule").not.toBeNull();
    if (!capabilityItemRule) throw new Error("Missing capability-item rule");
    expect(capabilityItemRule).not.toMatch(
      /background\s*:|border-radius\s*:|box-shadow\s*:/,
    );
    expect(css).not.toMatch(
      /gradient|backdrop-filter|box-shadow|filter\s*:|@keyframes|animation\s*:|#[\da-f]{3,8}|\brgba?\(|\bhsla?\(|green|lime|emerald|chartreuse/i,
    );
  });
});
