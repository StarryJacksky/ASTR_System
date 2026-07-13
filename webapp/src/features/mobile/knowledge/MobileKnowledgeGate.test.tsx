import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";

import { render, screen } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { MobileKnowledgeGate } from "./MobileKnowledgeGate";

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

describe("MobileKnowledgeGate", () => {
  it("states that the safe read projection is unavailable without inventing knowledge facts", () => {
    const { container } = render(<MobileKnowledgeGate />);

    expect(
      screen.getByRole("heading", { level: 1, name: "知识" }),
    ).toBeVisible();
    expect(screen.getByText("安全只读知识投影未启用。")).toBeVisible();
    expect(
      screen.getByText("尚无已授权、可验证的知识只读端点"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "未来只回答哪些结果值得长期保留与检索；当前不展示任何知识事实。",
      ),
    ).toBeVisible();

    expectNoFakeControls(container);
    expect(container.textContent).toBe(
      [
        "KNOWLEDGE / READ PROJECTION",
        "知识",
        "安全只读知识投影未启用。",
        "尚无已授权、可验证的知识只读端点",
        "未来只回答哪些结果值得长期保留与检索；当前不展示任何知识事实。",
      ].join(""),
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(container).not.toHaveTextContent(
      /搜索|写入|删除|导入|加入知识|记忆|索引|更新时间|SoulPackage|聊天历史|prompt|路径/i,
    );
    expect(container).not.toHaveTextContent(/\d+(?:\.\d+)?(?:%|次|个|条|项)/);
    expect(container).not.toHaveTextContent(/\d{1,4}[-/:年]\d{1,2}/);
  });

  it("server-renders one semantic heading with no interactive surface", () => {
    const html = renderToString(<MobileKnowledgeGate />);
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/knowledge/MobileKnowledgeGate.tsx",
      ),
      "utf8",
    );
    const imports = staticImportSpecifiers(source, "MobileKnowledgeGate.tsx");

    expect((html.match(/<h1/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<(?:button|form|input|textarea|a)\b/);
    expect(imports).toEqual(["react", "../shared/CapabilityGate"]);
    expect(source).not.toMatch(/^["']use client["'];/m);
  });
});
