import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";

import { render, screen, within } from "@testing-library/react";
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
    const imports = [...source.matchAll(/^import .+ from "([^"]+)";$/gm)].map(
      (match) => match[1],
    );
    const sharedImports = [
      ...sharedSource.matchAll(/^import .+ from "([^"]+)";$/gm),
    ].map((match) => match[1]);
    const gateRule = css.match(/\.gate\s*\{([^}]*)\}/);
    const capabilityItemRule = css.match(
      /\.capabilities\s*>\s*li\s*\{([^}]*)\}/,
    );

    expect((html.match(/<h1/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<(?:button|form|input|textarea|a)\b/);
    expect(imports).toEqual(["react", "../shared/CapabilityGate"]);
    expect(source).not.toMatch(/^["']use client["'];/m);
    expect(sharedImports).toEqual(["react", "./CapabilityGate.module.css"]);
    expect(sharedSource).not.toMatch(
      /^["']use [^"']+["'];|\buse[A-Z]\w*\b|\b(?:window|document|fetch)\b|import\s*\(/m,
    );
    expect(css).toMatch(
      /\.gate\s*\{[\s\S]*?background:\s*var\(--astr-surface\)/,
    );
    expect(css).toMatch(
      /\.gate\s*\{[\s\S]*?border-inline-start:[^;]*var\(--astr-soul\)/,
    );
    expect(css).toMatch(
      /\.capabilities\s*\{[\s\S]*?grid-template-columns:/,
    );
    expect(gateRule, "gate surface rule").not.toBeNull();
    if (!gateRule) throw new Error("Missing gate surface rule");
    expect(gateRule[1]).not.toMatch(/border-radius\s*:|box-shadow\s*:/);
    expect(capabilityItemRule, "direct capability-item rule").not.toBeNull();
    if (!capabilityItemRule) throw new Error("Missing capability-item rule");
    expect(capabilityItemRule[1]).not.toMatch(
      /background\s*:|border-radius\s*:|box-shadow\s*:/,
    );
    expect(css).not.toMatch(
      /gradient|backdrop-filter|box-shadow|filter\s*:|@keyframes|animation\s*:|#[\da-f]{3,8}|\brgba?\(|\bhsla?\(|green|lime|emerald|chartreuse/i,
    );
  });
});
