import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileLayout from "./layout";

vi.mock("@/features/mobile/authority/MobileAuthorityProvider", () => ({
  MobileAuthorityProvider: ({
    serverAuthorityTrusted,
    children,
  }: {
    readonly serverAuthorityTrusted: boolean;
    readonly children: ReactNode;
  }) => (
    <section data-server-authority-trusted={String(serverAuthorityTrusted)}>
      {String(serverAuthorityTrusted)}
      {children}
    </section>
  ),
}));

vi.mock("@/features/mobile/shell/MobileShell", () => ({
  MobileShell: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
}));

const TARGET_ENV_NAMES = ["ASTR_CORE_URL", "NEXT_PUBLIC_ASTR_CORE"] as const;

function staticImportSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "layout.tsx",
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

function renderLayout(): string {
  return renderToString(
    <MobileLayout>
      <span data-probe-child="">route child</span>
    </MobileLayout>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Mobile route layout", () => {
  it.each([
    {
      name: "uses loopback defaults when both variables are absent",
      coreUrl: undefined,
      publicCoreUrl: undefined,
      trusted: true,
    },
    {
      name: "accepts two explicit loopback HTTP targets",
      coreUrl: "http://127.0.0.1:8300",
      publicCoreUrl: "https://localhost:9443/core",
      trusted: true,
    },
    {
      name: "accepts explicit IPv6 loopback targets",
      coreUrl: "http://[::1]:8300",
      publicCoreUrl: "https://[::1]/core",
      trusted: true,
    },
    {
      name: "fails closed when the private target is remote",
      coreUrl: "https://remote.example:8300/private-core",
      publicCoreUrl: "http://127.0.0.1:8300",
      trusted: false,
    },
    {
      name: "fails closed when the public target is remote",
      coreUrl: "http://localhost:8300",
      publicCoreUrl: "https://public.example:8300/public-core",
      trusted: false,
    },
    {
      name: "fails closed when the private target is invalid",
      coreUrl: "not a URL",
      publicCoreUrl: "http://localhost:8300",
      trusted: false,
    },
    {
      name: "fails closed when the public target is not HTTP",
      coreUrl: "http://localhost:8300",
      publicCoreUrl: "file:///tmp/core",
      trusted: false,
    },
  ])("$name", ({ coreUrl, publicCoreUrl, trusted }) => {
    vi.stubEnv("ASTR_CORE_URL", coreUrl);
    vi.stubEnv("NEXT_PUBLIC_ASTR_CORE", publicCoreUrl);

    const html = renderLayout();

    expect(html).toContain(
      `data-server-authority-trusted="${String(trusted)}"`,
    );
    expect(html).toContain("route child");
    expect(html).not.toMatch(
      /ASTR_CORE_URL|NEXT_PUBLIC_ASTR_CORE|remote\.example|public\.example|8300/,
    );
    if (coreUrl) expect(html).not.toContain(coreUrl);
    if (publicCoreUrl) expect(html).not.toContain(publicCoreUrl);
  });

  it("reassesses the current environment for every layout evaluation", () => {
    vi.stubEnv("ASTR_CORE_URL", "http://127.0.0.1:8300");
    vi.stubEnv("NEXT_PUBLIC_ASTR_CORE", "http://localhost:8300");
    expect(renderLayout()).toContain('data-server-authority-trusted="true"');

    vi.stubEnv("ASTR_CORE_URL", "https://remote.example/private-core");
    expect(renderLayout()).toContain('data-server-authority-trusted="false"');
  });

  it("is a server-only composition root with an exact import boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/mobile/layout.tsx"),
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "layout.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const reactImport = sourceFile.statements.find(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "react",
    );
    const exportedDeclarations = sourceFile.statements.filter((statement) => {
      if (!(
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isVariableStatement(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      )) return false;
      return statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    });
    const forbiddenSyntax: ts.Node[] = [];

    function visit(node: ts.Node): void {
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

    expect(staticImportSpecifiers(source)).toEqual([
      "react",
      "@/features/mobile/authority/loopback-authority",
      "@/features/mobile/authority/MobileAuthorityProvider",
      "@/features/mobile/shell/MobileShell",
    ]);
    expect(reactImport?.importClause?.isTypeOnly).toBe(true);
    expect(reactImport?.importClause?.name).toBeUndefined();
    expect(
      reactImport?.importClause?.namedBindings &&
        ts.isNamedImports(reactImport.importClause.namedBindings)
        ? reactImport.importClause.namedBindings.elements.map(
            (element) => element.name.text,
          )
        : [],
    ).toEqual(["ReactNode"]);
    expect(exportedDeclarations).toHaveLength(1);
    expect(ts.isFunctionDeclaration(exportedDeclarations[0])).toBe(true);
    expect(
      exportedDeclarations[0] && ts.canHaveModifiers(exportedDeclarations[0])
        ? ts
            .getModifiers(exportedDeclarations[0])
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
        : false,
    ).toBe(true);
    expect(forbiddenSyntax).toHaveLength(0);
    expect(source).not.toMatch(
      /^\s*["']use client["'];|\b(?:headers|cookies|window|document|localStorage|sessionStorage)\b|@\/features\/mobile\/(?:presence|tasks|workbench|knowledge|safety)|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/m,
    );
    expect(source.match(/process\.env\.[A-Z0-9_]+/g)?.sort()).toEqual(
      TARGET_ENV_NAMES.map((name) => `process.env.${name}`).sort(),
    );
  });
});
