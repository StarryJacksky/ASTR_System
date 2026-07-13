import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import MobileTasksPage from "./page";

const PAGE_FILE = resolve(process.cwd(), "src/app/mobile/tasks/page.tsx");
const DOMAIN_IMPORT = "@/features/mobile/tasks/LocalTaskDraftRegion";

function assertExactPageBoundary(source: string): void {
  const sourceFile = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const jsxTags: string[] = [];
  const dynamicImports: ts.Node[] = [];

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.ImportKeyword) dynamicImports.push(node);
    if (ts.isJsxSelfClosingElement(node)) jsxTags.push(node.tagName.getText(sourceFile));
    if (ts.isJsxOpeningElement(node)) jsxTags.push(node.tagName.getText(sourceFile));
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);

  expect(imports).toHaveLength(1);
  expect(
    ts.isStringLiteralLike(imports[0].moduleSpecifier)
      ? imports[0].moduleSpecifier.text
      : "<non-literal>",
  ).toBe(DOMAIN_IMPORT);
  expect(imports[0].importClause?.isTypeOnly).toBe(false);
  expect(imports[0].importClause?.name).toBeUndefined();
  expect(
    imports[0].importClause?.namedBindings &&
      ts.isNamedImports(imports[0].importClause.namedBindings)
      ? imports[0].importClause.namedBindings.elements.map(
          (element) => element.name.text,
        )
      : [],
  ).toEqual(["LocalTaskDraftRegion"]);
  expect(jsxTags).toEqual(["LocalTaskDraftRegion"]);
  expect(dynamicImports).toHaveLength(0);
  expect(source).not.toMatch(/^\s*["']use client["'];/m);
}

describe("Mobile Tasks page", () => {
  it("renders exactly one route heading and the local-draft storage marker", () => {
    const html = renderToStaticMarkup(<MobileTasksPage />);
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector('[data-storage-phase="checking"]')).not.toBeNull();
  });

  it("is an explicit server page with one static domain import and no wrapper", () => {
    assertExactPageBoundary(readFileSync(PAGE_FILE, "utf8"));
  });
});
