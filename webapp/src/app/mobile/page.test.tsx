import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string): never => {
    void target;
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import MobileIndexPage from "./page";

beforeEach(() => {
  redirectMock.mockClear();
});

describe("Mobile index route", () => {
  it("redirects exactly once to the Presence route", () => {
    expect(() => MobileIndexPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/mobile/presence");
  });

  it("contains only the static redirect and no client or markup surface", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/mobile/page.tsx"),
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "page.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const imports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement)) return [];
      return ts.isStringLiteralLike(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : ["<non-literal-import>"];
    });
    const redirectCalls: ts.CallExpression[] = [];
    const jsxNodes: ts.Node[] = [];
    const forbiddenSyntax: ts.Node[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "redirect"
      ) {
        redirectCalls.push(node);
      }
      if (
        ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node)
      ) {
        jsxNodes.push(node);
      }
      if (
        node.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isExportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node)
      ) {
        forbiddenSyntax.push(node);
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);

    expect(imports).toEqual(["next/navigation"]);
    expect(redirectCalls).toHaveLength(1);
    expect(redirectCalls[0].arguments).toHaveLength(1);
    expect(redirectCalls[0].arguments[0]).toMatchObject({
      kind: ts.SyntaxKind.StringLiteral,
      text: "/mobile/presence",
    });
    expect(jsxNodes).toHaveLength(0);
    expect(forbiddenSyntax).toHaveLength(0);
    expect(source).not.toMatch(
      /^\s*["']use client["'];|@\/features\/|<(?:main|div|section|span)\b/m,
    );
  });

  it("publishes five explicit domain pages without a barrel or dynamic route", () => {
    const domainImports = new Map([
      ["presence", "@/features/mobile/presence/MobilePresenceDomain"],
      ["tasks", "@/features/mobile/tasks/LocalTaskDraftRegion"],
      ["workbench", "@/features/mobile/workbench/MobileWorkbenchGate"],
      ["knowledge", "@/features/mobile/knowledge/MobileKnowledgeGate"],
      ["safety", "@/features/mobile/safety/MobileLocalSafetyDomain"],
    ]);

    for (const [domain, expectedImport] of domainImports) {
      const pagePath = resolve(
        process.cwd(),
        "src/app/mobile",
        domain,
        "page.tsx",
      );
      expect(existsSync(pagePath), `${domain} page is missing`).toBe(true);

      const source = readFileSync(pagePath, "utf8");
      const sourceFile = ts.createSourceFile(
        `${domain}/page.tsx`,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const imports = sourceFile.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement)) return [];
        return ts.isStringLiteralLike(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : ["<non-literal-import>"];
      });
      const dynamicImports: ts.Node[] = [];

      function visit(node: ts.Node): void {
        if (node.kind === ts.SyntaxKind.ImportKeyword) dynamicImports.push(node);
        ts.forEachChild(node, visit);
      }
      ts.forEachChild(sourceFile, visit);

      expect(imports, `${domain} import ownership`).toEqual([expectedImport]);
      expect(dynamicImports, `${domain} dynamic import ownership`).toHaveLength(0);
    }

    expect(
      existsSync(resolve(process.cwd(), "src/features/mobile/index.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/app/mobile/[domain]")),
    ).toBe(false);
  });
});
