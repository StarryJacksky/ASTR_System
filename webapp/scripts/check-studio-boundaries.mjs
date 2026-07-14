import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");
const NO_GREEN_RULE_SOURCE = "src/test/no-green-scanner.ts";
const STUDIO_REGISTRY_SOURCE = "src/features/studio/model/studio-projections.ts";
const STUDIO_WORKPLANE_SOURCE =
  "src/features/studio/components/StudioUnavailableWorkplane.tsx";
const STUDIO_SHELL_SOURCE = "src/features/studio/components/StudioShell.tsx";
const REQUIRED_ENDPOINT_SENTENCE =
  "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。";
const STUDIO_SOURCE_ROOTS = Object.freeze([
  "src/app/studio",
  "src/features/studio",
]);
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
const BUILD_FINGERPRINT_INPUTS = Object.freeze([
  "src",
  "public",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "postcss.config.mjs",
  "tsconfig.json",
]);
const BUILD_STAMP_SOURCE = ".next/astr-e2e-build.json";
const BUILD_ID_SOURCE = ".next/BUILD_ID";
const APP_PATHS_MANIFEST_SOURCE = ".next/server/app-paths-manifest.json";
const CLIENT_MANIFEST_SOURCE =
  ".next/server/app/studio/page_client-reference-manifest.js";
const STUDIO_ROUTE = "/studio/page";
const STUDIO_ENTRY = "src/app/studio/page";
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const ALLOWED_EXTERNAL_IMPORTS = new Set(["next", "next/link", "react"]);
const SHARED_CONTROL_IMPORTS = new Map([
  ["ThemeToggle", "@/components/astr/ThemeToggle"],
  ["VisualMotionRouteSlot", "@/components/system/VisualMotionToggle"],
]);
const ALLOWED_NAVIGATION_DESTINATIONS = Object.freeze([
  "/",
  "/admin",
  "/mobile/presence",
]);
const REQUEST_API_NAMES = new Set([
  "fetch",
  "XMLHttpRequest",
  "EventSource",
  "WebSocket",
  "sendBeacon",
]);
const ACTION_ELEMENT_NAMES = new Set([
  "area",
  "button",
  "details",
  "dialog",
  "embed",
  "fieldset",
  "form",
  "iframe",
  "input",
  "meter",
  "object",
  "option",
  "output",
  "progress",
  "script",
  "select",
  "summary",
  "textarea",
]);
const MEDIA_ELEMENT_NAMES = new Set(["audio", "video"]);
const INTERACTIVE_ROLE_NAMES = new Set([
  "button",
  "checkbox",
  "combobox",
  "form",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "progressbar",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
const LIVE_REGION_ROLE_NAMES = new Set([
  "alert",
  "log",
  "marquee",
  "status",
  "timer",
]);
const ALWAYS_FORBIDDEN_ACTION_PROP_NAMES = new Set([
  "action",
  "aria-busy",
  "aria-live",
  "autofocus",
  "contenteditable",
  "dangerouslysetinnerhtml",
  "formaction",
  "innerhtml",
]);
const SAFE_CREATE_ELEMENT_PROP_NAMES = new Set([
  "children",
  "classname",
  "dir",
  "id",
  "key",
  "lang",
  "slot",
  "title",
  "translate",
]);
const SAFE_JSX_PROP_NAMES = new Set([
  ...SAFE_CREATE_ELEMENT_PROP_NAMES,
  "href",
  "prefetch",
  "role",
  "tabindex",
]);
const REACT_INJECTION_API_NAMES = new Set(["cloneElement", "createFactory"]);
const TRACKED_REACT_API_NAMES = new Set([
  "cloneElement",
  "createElement",
  "createFactory",
]);
const HEAVY_IMPORT_PATTERN =
  /(?:^|[/@._-])(?:pixi(?:\.js)?|three(?:\.js)?|live2d|framer[-_]motion)(?:$|[/@._-])/i;
const FALLBACK_MODULE_PATTERN =
  /(?:^|[/._-])(?:client|data|controller|mock|fixture|demo)(?:$|[/._-])/i;
const HEAVY_CHUNK_PATTERN =
  /pixi(?:\.js)?|live2d|framer[-_]motion|three(?:\.module)?\.js|\.2048(?:[/\\.]|$)/i;
const RENDER_CHUNK_PATTERN =
  /\brequestAnimationFrame\b|(?:\.\s*getContext\b|\[\s*["']getContext["']\s*\])|\b(?:createElement|jsx|jsxs)\b\s*\)?\s*\(\s*["']canvas["']|\b(?:OffscreenCanvas|WebGL|WebGPU)\b|navigator\s*\.\s*gpu\b/i;
const VISUAL_RULES = Object.freeze([
  Object.freeze({
    rule: "studio-visual-gradient",
    pattern: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi,
  }),
  Object.freeze({
    rule: "studio-visual-backdrop-filter",
    pattern: /\b(?:-webkit-)?backdrop-filter\s*:/gi,
  }),
  Object.freeze({
    rule: "studio-visual-blur",
    pattern: /(?<!backdrop-)\bfilter\s*:\s*blur\s*\(/gi,
  }),
  Object.freeze({
    rule: "studio-visual-animation",
    pattern: /@keyframes\b|\banimation(?:-[a-z-]+)?\s*:/gi,
  }),
  Object.freeze({
    rule: "studio-visual-transition",
    pattern: /\btransition(?:-[a-z-]+)?\s*:/gi,
  }),
  Object.freeze({
    rule: "studio-visual-box-shadow",
    pattern: /\bbox-shadow\s*:/gi,
  }),
  Object.freeze({
    rule: "studio-visual-raw-color",
    pattern: /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/gi,
  }),
  Object.freeze({
    rule: "studio-visual-generic-material",
    pattern: /\b(?:card|tile|glass|bento|crosshair|radar|scanline)\b/gi,
  }),
  Object.freeze({
    rule: "studio-visual-hidden-content",
    pattern: /\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*(?:hidden|collapse)\b|\bcontent-visibility\s*:\s*hidden\b|\bopacity\s*:\s*0(?:\D|$)|\bclip\s*:\s*rect\s*\(|\bclip-path\s*:\s*inset\s*\(|(?<![-\w])(?:width|height|inline-size|block-size)\s*:\s*0(?:[a-z%]+)?(?=\s*(?:[;!}]|$))/gi,
  }),
]);

export async function checkStudioBoundaries({ root = defaultProjectRoot } = {}) {
  const projectRoot = resolve(root);
  const typescript = await loadTypeScript();
  const findForbiddenGreenUsages = await loadNoGreenScanner(projectRoot, typescript);
  const boundaryEntryFiles = STUDIO_SOURCE_ROOTS
    .flatMap((sourceRoot) => listProductionSourceFiles(
      resolve(projectRoot, ...sourceRoot.split("/")),
    ))
    .sort();
  const unscannableOwnedFiles = STUDIO_SOURCE_ROOTS.flatMap((sourceRoot) =>
    listUnscannableOwnedFiles(
      projectRoot,
      resolve(projectRoot, ...sourceRoot.split("/")),
    )
  );
  const sourceGraph = collectStudioSourceGraph(projectRoot, boundaryEntryFiles, typescript);
  const sourceFiles = sourceGraph.files;
  const violations = [...sourceGraph.violations, ...unscannableOwnedFiles];
  const contract = {
    endpointSentenceCount: 0,
    routeSurfaceCount: 0,
    links: [],
    linkImports: [],
    controls: new Map(
      [...SHARED_CONTROL_IMPORTS].map(([name]) => [name, { imports: [], usages: [] }]),
    ),
  };

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    const displayFile = relativePath(projectRoot, file);

    if (FALLBACK_MODULE_PATTERN.test(displayFile)) {
      violations.push(createViolation(
        "studio-fallback-module",
        displayFile,
        "Studio source may not introduce client, data, controller, mock, fixture, or demo fallbacks.",
        displayFile,
      ));
    }

    for (const usage of findForbiddenGreenUsages(source)) {
      violations.push(createViolation(
        "no-green-hardcode",
        displayFile,
        `Constitutional no-green scanner rejected ${usage}.`,
        usage,
      ));
    }

    if (extname(file).toLowerCase() === ".css") {
      inspectCssSource(source, displayFile, violations);
      continue;
    }

    inspectScriptSource({
      source,
      file,
      displayFile,
      typescript,
      violations,
      contract,
    });
  }

  inspectStudioContract(contract, violations);
  const taxonomy = inspectStudioTaxonomy(projectRoot, typescript);
  violations.push(...taxonomy.violations);
  const buildEvidence = inspectStudioBuildEvidence(projectRoot);
  violations.push(...buildEvidence.violations);
  violations.sort(compareViolations);

  return Object.freeze({
    schemaVersion: 1,
    check: "studio-boundaries",
    passed: violations.length === 0,
    sourceFilesScanned: sourceFiles.length,
    taxonomy: Object.freeze(taxonomy.entries.map((entry) => Object.freeze(entry))),
    buildEvidence: Object.freeze({
      status: buildEvidence.status,
      chunks: Object.freeze(buildEvidence.chunks),
    }),
    violations: Object.freeze(violations),
  });
}

async function loadTypeScript() {
  const imported = await import("typescript");
  return imported.default ?? imported;
}

async function loadNoGreenScanner(projectRoot, typescript) {
  const scannerPath = resolve(projectRoot, ...NO_GREEN_RULE_SOURCE.split("/"));
  if (!existsSync(scannerPath)) {
    throw new Error(`Missing shared no-green rule source: ${NO_GREEN_RULE_SOURCE}.`);
  }

  try {
    const imported = await import(`${pathToFileURL(scannerPath).href}?studio-boundary=1`);
    if (typeof imported.findForbiddenGreenUsages === "function") {
      return imported.findForbiddenGreenUsages;
    }
  } catch (error) {
    if (!isUnsupportedTypeScriptImport(error)) throw error;
  }

  const source = readFileSync(scannerPath, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ES2022,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: scannerPath,
  }).outputText;
  const imported = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  if (typeof imported.findForbiddenGreenUsages !== "function") {
    throw new Error(`${NO_GREEN_RULE_SOURCE} does not export findForbiddenGreenUsages.`);
  }
  return imported.findForbiddenGreenUsages;
}

function isUnsupportedTypeScriptImport(error) {
  return error instanceof Error && (
    error.code === "ERR_UNKNOWN_FILE_EXTENSION" ||
    /unknown file extension.*\.ts/i.test(error.message)
  );
}

function listProductionSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__") return [];
      return listProductionSourceFiles(file);
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      return [];
    }
    if (/(?:^|\.)test\.|(?:^|\.)spec\.|\.d\.ts$/.test(entry.name)) return [];
    return [file];
  });
}

function listUnscannableOwnedFiles(projectRoot, directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__" || entry.name === "__snapshots__") {
        return [];
      }
      return listUnscannableOwnedFiles(projectRoot, file);
    }
    if (!entry.isFile()) return [];
    if (/(?:^|\.)test\.|(?:^|\.)spec\.|\.d\.ts$/.test(entry.name)) return [];
    if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) return [];
    const displayFile = relativePath(projectRoot, file);
    return [createViolation(
      "studio-source-unscannable",
      displayFile,
      "Every production file inside a Studio-owned root must use an inspectable extension.",
      extname(entry.name) || "no extension",
    )];
  });
}

function collectStudioSourceGraph(projectRoot, entryFiles, typescript) {
  const pending = [...entryFiles];
  const visited = new Set();
  const violations = [];

  while (pending.length > 0) {
    const file = resolve(pending.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const displayFile = relativePath(projectRoot, file);

    for (const reference of importedModuleReferences(source, file, typescript)) {
      const specifier = reference.specifier;
      if (reference.kind === "dynamic") {
        violations.push(createViolation(
          specifier === null ? "studio-dynamic-import-nonliteral" : "studio-dynamic-import",
          displayFile,
          "Studio's source graph may not use dynamic loading.",
          specifier ?? "computed import",
        ));
      } else if (reference.kind === "require") {
        violations.push(createViolation(
          "studio-require",
          displayFile,
          "Studio's source graph may not use CommonJS require loading.",
          specifier ?? "computed require",
        ));
      } else if (reference.kind === "css-nonliteral") {
        violations.push(createViolation(
          "studio-css-dependency-nonliteral",
          displayFile,
          "Studio CSS dependencies must use a literal local path.",
          reference.match ?? "computed CSS dependency",
        ));
      }

      if (specifier === null) continue;
      if (HEAVY_IMPORT_PATTERN.test(specifier)) {
        violations.push(createViolation(
          "studio-heavy-visual-import",
          displayFile,
          "Studio may not import Pixi, Three, Live2D, or framer-motion.",
          specifier,
        ));
      }
      if (FALLBACK_MODULE_PATTERN.test(specifier)) {
        violations.push(createViolation(
          "studio-fallback-module",
          displayFile,
          "Studio may not import a client, data, controller, mock, fixture, or demo fallback.",
          specifier,
        ));
      }

      if (!isLocalModuleSpecifier(specifier)) {
        if (!ALLOWED_EXTERNAL_IMPORTS.has(specifier)) {
          violations.push(createViolation(
            "studio-external-import",
            displayFile,
            "Studio may import only React and the approved Next.js server/navigation surfaces.",
            specifier,
          ));
        }
        continue;
      }

      if (
        reference.kind === "static" &&
        [...SHARED_CONTROL_IMPORTS.values()].includes(specifier)
      ) {
        continue;
      }

      const dependencies = resolveLocalSourceModules(projectRoot, file, specifier);
      if (dependencies.length === 0) {
        violations.push(createViolation(
          "studio-local-import-unresolved",
          displayFile,
          "A local Studio dependency could not be resolved for boundary inspection.",
          specifier,
        ));
        continue;
      }
      if (dependencies.length > 1) {
        violations.push(createViolation(
          "studio-local-import-ambiguous",
          displayFile,
          "An extensionless Studio import resolves to multiple inspectable files.",
          specifier,
        ));
      }
      for (const dependency of dependencies) {
        if (!isWithin(projectRoot, dependency)) {
          violations.push(createViolation(
            "studio-local-import-outside-project",
            displayFile,
            "A local Studio dependency resolves outside the project boundary.",
            specifier,
          ));
          continue;
        }
        const dependencyExtension = extname(dependency).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(dependencyExtension)) {
          violations.push(createViolation(
            "studio-local-import-unscannable",
            displayFile,
            "A resolved local Studio dependency has an unsupported source extension.",
            specifier,
          ));
          continue;
        }
        pending.push(dependency);
      }
    }
  }

  return { files: [...visited].sort(), violations };
}

function importedModuleReferences(source, file, typescript) {
  if (extname(file).toLowerCase() === ".css") {
    const references = [
      ...source.matchAll(
        /@import\s+(?:url\(\s*)?(?:["']([^"']+)["']|([^"'\s;)]+))\s*\)?/gi,
      ),
    ].map((match) => ({ kind: "static", specifier: match[1] ?? match[2] }));
    for (const pattern of [
      /\bcomposes\s*:[^;{}]*?\bfrom\s+([^;{}]+?)(?=\s*;|\s*}|$)/gi,
      /@value\s+[^;{}]*?\bfrom\s+([^;{}]+?)(?=\s*;|\s*}|$)/gi,
    ]) {
      for (const match of source.matchAll(pattern)) {
        references.push(cssDependencyReference(match[1]));
      }
    }
    return references;
  }
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKindFor(file, typescript),
  );
  const references = [];
  const visit = (node) => {
    if (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) {
      if (typeof node.moduleSpecifier?.text === "string") {
        references.push({ kind: "static", specifier: node.moduleSpecifier.text });
      }
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      references.push({
        kind: "require",
        specifier: expression && typescript.isStringLiteralLike(expression)
          ? expression.text
          : null,
      });
    } else if (
      typescript.isCallExpression(node) &&
      node.expression.kind === typescript.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      references.push({
        kind: "dynamic",
        specifier: argument && typescript.isStringLiteralLike(argument) ? argument.text : null,
      });
    } else if (
      typescript.isCallExpression(node) &&
      accessedMemberName(node.expression, typescript) === "require"
    ) {
      const argument = node.arguments[0];
      references.push({
        kind: "require",
        specifier: argument && typescript.isStringLiteralLike(argument) ? argument.text : null,
      });
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function cssDependencyReference(rawTarget) {
  const target = rawTarget.trim();
  const quoted = target.match(/^(["'])([^"']+)\1$/);
  if (quoted) return { kind: "static", specifier: quoted[2] };
  if (/^(?:\.\.?\/|@\/)[^\s();{}]+$/.test(target)) {
    return { kind: "static", specifier: target };
  }
  return { kind: "css-nonliteral", specifier: null, match: target };
}

function isLocalModuleSpecifier(specifier) {
  return specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("@/");
}

function resolveLocalSourceModules(projectRoot, importer, rawSpecifier) {
  const specifier = rawSpecifier.replace(/[?#].*$/, "");
  const unresolved = specifier.startsWith("@/")
    ? resolve(projectRoot, "src", specifier.slice(2))
    : resolve(dirname(importer), specifier);
  const candidates = [unresolved];
  if (extname(unresolved) === "") {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${unresolved}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(resolve(unresolved, `index${extension}`));
    }
  }
  return [...new Set(candidates
    .filter((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    .map((candidate) => resolve(candidate)))];
}

function inspectCssSource(source, displayFile, violations) {
  for (const { rule, pattern } of VISUAL_RULES) {
    for (const match of source.matchAll(pattern)) {
      violations.push(createViolation(
        rule,
        displayFile,
        "Studio material must remain static, transparent, token-driven, and non-HUD.",
        match[0],
      ));
    }
  }
}

function collectReactApiAliases(sourceFile, typescript) {
  const aliases = new Map();
  const reactObjects = new Set();
  const declarations = [];
  for (const statement of sourceFile.statements) {
    if (
      typescript.isImportDeclaration(statement) &&
      statement.moduleSpecifier?.text === "react" &&
      !statement.importClause?.isTypeOnly
    ) {
      const importClause = statement.importClause;
      if (importClause?.name) reactObjects.add(importClause.name.text);
      const bindings = importClause?.namedBindings;
      if (bindings && typescript.isNamespaceImport(bindings)) {
        reactObjects.add(bindings.name.text);
      } else if (bindings && typescript.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          const importedName = element.propertyName?.text ?? element.name.text;
          if (TRACKED_REACT_API_NAMES.has(importedName)) {
            aliases.set(element.name.text, importedName);
          }
        }
      }
    }
  }
  const collectDeclarations = (node) => {
    if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.initializer
    ) declarations.push(node);
    typescript.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const localName = declaration.name.text;
      const initializer = unwrapExpression(declaration.initializer, typescript);
      if (typescript.isIdentifier(initializer)) {
        if (reactObjects.has(initializer.text) && !reactObjects.has(localName)) {
          reactObjects.add(localName);
          changed = true;
        }
        const canonicalName = aliases.get(initializer.text);
        if (canonicalName && aliases.get(localName) !== canonicalName) {
          aliases.set(localName, canonicalName);
          changed = true;
        }
      } else if (
        typescript.isPropertyAccessExpression(initializer) ||
        typescript.isElementAccessExpression(initializer)
      ) {
        const owner = unwrapExpression(initializer.expression, typescript);
        const memberName = accessedMemberName(initializer, typescript);
        if (
          typescript.isIdentifier(owner) &&
          reactObjects.has(owner.text) &&
          TRACKED_REACT_API_NAMES.has(memberName) &&
          aliases.get(localName) !== memberName
        ) {
          aliases.set(localName, memberName);
          changed = true;
        }
      }
    }
  }
  return aliases;
}

function collectStaticJsxIntrinsicAliases(sourceFile, typescript) {
  const aliases = new Map();
  const declarations = [];
  const collectDeclarations = (node) => {
    if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.initializer
    ) declarations.push(node);
    typescript.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const initializer = unwrapExpression(declaration.initializer, typescript);
      const target = typescript.isStringLiteralLike(initializer)
        ? initializer.text.toLowerCase()
        : typescript.isIdentifier(initializer)
          ? aliases.get(initializer.text)
          : null;
      if (target && aliases.get(declaration.name.text) !== target) {
        aliases.set(declaration.name.text, target);
        changed = true;
      }
    }
  }
  return aliases;
}

function inspectScriptSource({
  source,
  file,
  displayFile,
  typescript,
  violations,
  contract,
}) {
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKindFor(file, typescript),
  );
  const reactApiAliases = collectReactApiAliases(sourceFile, typescript);
  const jsxIntrinsicAliases = collectStaticJsxIntrinsicAliases(sourceFile, typescript);
  for (const diagnostic of sourceFile.parseDiagnostics) {
    violations.push(createViolation(
      "studio-source-parse",
      displayFile,
      typescript.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      source.slice(diagnostic.start ?? 0, (diagnostic.start ?? 0) + (diagnostic.length ?? 0)),
    ));
  }

  const directives = sourceFile.statements
    .filter(typescript.isExpressionStatement)
    .map((statement) => statement.expression)
    .filter(typescript.isStringLiteralLike)
    .map((expression) => expression.text);
  if (directives.includes("use client")) {
    violations.push(createViolation(
      "studio-client-boundary",
      displayFile,
      "Studio-owned modules must remain server-owned.",
      "use client",
    ));
  }

  const seen = new Set();
  const record = (rule, node, detail) => {
    const key = `${rule}:${node.pos}:${node.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(createViolation(rule, displayFile, detail, node.getText(sourceFile)));
  };

  const visit = (node) => {
    if (typescript.isImportDeclaration(node)) {
      inspectSharedControlImport(node, sourceFile, displayFile, contract, violations, typescript);
      inspectNavigationImport(node, sourceFile, displayFile, contract, violations);
    } else if (
      typescript.isExportDeclaration(node) &&
      [...SHARED_CONTROL_IMPORTS.values()].includes(node.moduleSpecifier?.text)
    ) {
      violations.push(createViolation(
        "studio-shared-control",
        displayFile,
        "Approved shared controls may only be imported by StudioShell with their exact named binding.",
        node.getText(sourceFile),
      ));
    }

    if (typescript.isIdentifier(node)) {
      if (REQUEST_API_NAMES.has(node.text)) {
        record(
          "studio-request-api",
          node,
          "Studio may not own a request, stream, socket, or beacon primitive.",
        );
      }
      if (node.text === "requestAnimationFrame") {
        record(
          "studio-render-request-animation-frame",
          node,
          "Studio may not own an animation frame loop.",
        );
      }
      if (node.text === "Canvas" || node.text === "OffscreenCanvas") {
        record("studio-render-canvas", node, "Studio may not own a canvas surface.");
      }
      if (/^(?:WebGL|WebGPU)/.test(node.text) || node.text === "gpu") {
        record("studio-render-gpu", node, "Studio may not own WebGL or WebGPU.");
      }
      if (["useEffect", "useState", "useReducer", "useSyncExternalStore"].includes(node.text)) {
        record(
          "studio-client-boundary",
          node,
          "Studio-owned modules may not introduce client state or effects.",
        );
      }
    }

    if (typescript.isPropertyAccessExpression(node) || typescript.isElementAccessExpression(node)) {
      const memberName = accessedMemberName(node, typescript);
      if (memberName === "getContext") {
        record("studio-render-get-context", node, "Studio may not acquire a rendering context.");
      }
      if (memberName === "requestAnimationFrame") {
        record(
          "studio-render-request-animation-frame",
          node,
          "Studio may not own an animation frame loop.",
        );
      }
      if (memberName === "gpu") {
        record("studio-render-gpu", node, "Studio may not own WebGL or WebGPU.");
      }
      if (REQUEST_API_NAMES.has(memberName)) {
        record(
          "studio-request-api",
          node,
          "Studio may not own a request, stream, socket, or beacon primitive.",
        );
      }
      if (isEnvironmentAccess(node, typescript)) {
        record(
          "studio-environment-read",
          node,
          "Studio may not discover a service endpoint through environment state.",
        );
      }
    }

    if (typescript.isCallExpression(node)) {
      const callTarget = unwrapExpression(node.expression, typescript);
      const calledName = typescript.isIdentifier(callTarget) && reactApiAliases.has(callTarget.text)
        ? reactApiAliases.get(callTarget.text)
        : accessedMemberName(callTarget, typescript);
      const firstArgument = node.arguments[0];
      if (calledName === "createElement") {
        const elementName = firstArgument && typescript.isStringLiteralLike(firstArgument)
          ? firstArgument.text.toLowerCase()
          : null;
        if (elementName === "canvas") {
          record("studio-render-canvas", node, "Studio may not create a canvas surface.");
        }
        if (
          elementName === null ||
          ACTION_ELEMENT_NAMES.has(elementName) ||
          MEDIA_ELEMENT_NAMES.has(elementName) ||
          elementName === "a"
        ) {
          record(
            "studio-action-primitive",
            node,
            "Studio may not create dynamic, interactive, embedded, or media elements.",
          );
        }
        if (hasUnsafeCreateElementProps(node.arguments[1], typescript)) {
          record(
            "studio-action-primitive",
            node,
            "Studio createElement props must be static, inspectable, and non-interactive.",
          );
        }
      }
      if (REACT_INJECTION_API_NAMES.has(calledName)) {
        record(
          "studio-action-primitive",
          node,
          "Studio may not inject or manufacture React element surfaces.",
        );
      }
    }

    if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) {
      inspectJsxElement(
        node,
        sourceFile,
        displayFile,
        contract,
        violations,
        typescript,
        jsxIntrinsicAliases,
      );
    }

    if (typescript.isJsxText(node)) {
      const text = compact(node.text);
      if (containsEndpointMaterial(text)) {
        if (
          displayFile === STUDIO_WORKPLANE_SOURCE &&
          text === REQUIRED_ENDPOINT_SENTENCE &&
          isReadableContractJsxText(node, sourceFile, typescript)
        ) {
          contract.endpointSentenceCount += 1;
        } else {
          record(
            "studio-endpoint-context",
            node,
            "The Studio endpoint fragment is allowed only as the exact Workplane JSXText sentence.",
          );
        }
      }
    } else if (typescript.isStringLiteralLike(node) && containsEndpointMaterial(node.text)) {
      record(
        "studio-endpoint-context",
        node,
        "The Studio endpoint fragment may not appear in executable or attribute context.",
      );
    } else if (
      typescript.isTemplateExpression(node) &&
      (
        containsEndpointMaterial(node.getText(sourceFile)) ||
        containsEndpointMaterial(staticStringValue(node, typescript) ?? "")
      )
    ) {
      record(
        "studio-endpoint-context",
        node,
        "The Studio endpoint fragment may not be assembled in a template.",
      );
    } else if (
      typescript.isBinaryExpression(node) &&
      node.operatorToken.kind === typescript.SyntaxKind.PlusToken &&
      containsEndpointMaterial(staticStringValue(node, typescript) ?? "")
    ) {
      record(
        "studio-endpoint-context",
        node,
        "The Studio endpoint fragment may not be assembled by concatenation.",
      );
    }

    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isEnvironmentAccess(node, typescript) {
  if (accessedMemberName(node, typescript) !== "env") return false;
  const owner = node.expression;
  if (typescript.isIdentifier(owner) && owner.text === "process") return true;
  if (
    typescript.isMetaProperty(owner) &&
    owner.keywordToken === typescript.SyntaxKind.ImportKeyword &&
    owner.name.text === "meta"
  ) return true;
  return (
    (typescript.isPropertyAccessExpression(owner) || typescript.isElementAccessExpression(owner)) &&
    accessedMemberName(owner, typescript) === "process"
  );
}

function isReadableContractJsxText(node, sourceFile, typescript) {
  const parent = node.parent;
  if (!parent || !typescript.isJsxElement(parent)) return false;
  if (parent.openingElement.tagName.getText(sourceFile).toLowerCase() !== "p") return false;
  if (!isReturnedByNamedExport(node, sourceFile, typescript, "StudioUnavailableWorkplane")) {
    return false;
  }
  if (!isStaticallyReachable(node, typescript)) return false;

  const hasApprovedStylesImport = sourceFile.statements.some((statement) =>
    typescript.isImportDeclaration(statement) &&
    statement.moduleSpecifier?.text === "./StudioSurface.module.css" &&
    statement.importClause?.name?.text === "styles" &&
    !statement.importClause.namedBindings
  );
  let current = parent;
  while (current && current !== sourceFile) {
    if (typescript.isJsxElement(current)) {
      for (const attribute of current.openingElement.attributes.properties) {
        if (!typescript.isJsxAttribute(attribute)) return false;
        const name = attribute.name.getText(sourceFile);
        if (name === "hidden" || name === "style" || name === "aria-hidden") return false;
        if (name === "className") {
          const expression = attribute.initializer && typescript.isJsxExpression(attribute.initializer)
            ? attribute.initializer.expression
            : null;
          if (
            !hasApprovedStylesImport ||
            !expression ||
            !typescript.isPropertyAccessExpression(expression) ||
            !typescript.isIdentifier(expression.expression) ||
            expression.expression.text !== "styles" ||
            (current === parent && expression.name.text !== "contractStatement")
          ) return false;
        }
      }
    }
    if (typescript.isFunctionLike(current)) break;
    current = current.parent;
  }
  return true;
}

function isReturnedByNamedExport(node, sourceFile, typescript, functionName) {
  let current = node.parent;
  let insideReturn = false;
  while (current && current !== sourceFile) {
    if (typescript.isReturnStatement(current)) insideReturn = true;
    if (typescript.isFunctionLike(current)) {
      return Boolean(
        insideReturn &&
        typescript.isFunctionDeclaration(current) &&
        current.name?.text === functionName &&
        current.modifiers?.some(({ kind }) => kind === typescript.SyntaxKind.ExportKeyword),
      );
    }
    current = current.parent;
  }
  return false;
}

function isStaticallyReachable(node, typescript) {
  let child = node;
  let current = node.parent;
  while (current) {
    if (typescript.isBinaryExpression(current) && child === current.right) {
      const left = staticPrimitiveValue(current.left, typescript);
      if (left.known) {
        if (
          current.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken &&
          !left.value
        ) return false;
        if (
          current.operatorToken.kind === typescript.SyntaxKind.BarBarToken &&
          Boolean(left.value)
        ) return false;
        if (
          current.operatorToken.kind === typescript.SyntaxKind.QuestionQuestionToken &&
          left.value !== null && left.value !== undefined
        ) return false;
      }
    }
    if (typescript.isConditionalExpression(current)) {
      const condition = staticPrimitiveValue(current.condition, typescript);
      if (condition.known) {
        if (child === current.whenTrue && !condition.value) return false;
        if (child === current.whenFalse && Boolean(condition.value)) return false;
      }
    }
    if (typescript.isIfStatement(current)) {
      const condition = staticPrimitiveValue(current.expression, typescript);
      if (condition.known) {
        if (child === current.thenStatement && !condition.value) return false;
        if (child === current.elseStatement && Boolean(condition.value)) return false;
      }
    }
    child = current;
    current = current.parent;
  }
  return true;
}

function containsEndpointMaterial(value) {
  return /\/v1\/|\/api\/|studio\/\*/i.test(value);
}

function inspectNavigationImport(node, sourceFile, displayFile, contract, violations) {
  const localName = node.importClause?.name?.text;
  const specifier = node.moduleSpecifier?.text;
  if (localName !== "Link" && specifier !== "next/link") return;
  const valid = specifier === "next/link" &&
    displayFile === STUDIO_SHELL_SOURCE &&
    localName === "Link" &&
    !node.importClause?.isTypeOnly &&
    !node.importClause?.namedBindings;
  contract.linkImports.push({ file: displayFile, valid });
  if (!valid) {
    violations.push(createViolation(
      "studio-navigation-link",
      displayFile,
      "StudioShell's Link binding must be the default import from next/link.",
      node.getText(sourceFile),
    ));
  }
}

function inspectSharedControlImport(
  node,
  sourceFile,
  displayFile,
  contract,
  violations,
  typescript,
) {
  const specifier = node.moduleSpecifier?.text;
  const bindings = node.importClause?.namedBindings;
  if (typeof specifier !== "string") return;
  const approvedName = [...SHARED_CONTROL_IMPORTS]
    .find(([, approvedSpecifier]) => approvedSpecifier === specifier)?.[0] ?? null;
  const elements = bindings && typescript.isNamedImports(bindings) ? [...bindings.elements] : [];
  const controlledNames = elements
    .map((element) => element.propertyName?.text ?? element.name.text)
    .filter((name) => SHARED_CONTROL_IMPORTS.has(name));
  if (approvedName === null && controlledNames.length === 0) return;

  const exactElement = elements.length === 1 ? elements[0] : null;
  const valid = approvedName !== null &&
    displayFile === STUDIO_SHELL_SOURCE &&
    !node.importClause?.isTypeOnly &&
    !node.importClause?.name &&
    exactElement !== null &&
    (exactElement.propertyName?.text ?? exactElement.name.text) === approvedName &&
    exactElement.name.text === approvedName;
  const evidenceNames = approvedName === null ? controlledNames : [approvedName];
  for (const name of new Set(evidenceNames)) {
    contract.controls.get(name).imports.push({ file: displayFile, valid });
  }
  if (!valid) {
    violations.push(createViolation(
      "studio-shared-control",
      displayFile,
      "Shared controls require the exact sole named import in StudioShell.",
      node.getText(sourceFile),
    ));
  }
}

function hasUnsafeCreateElementProps(argument, typescript) {
  if (!argument) return false;
  const candidate = unwrapExpression(argument, typescript);
  if (
    candidate.kind === typescript.SyntaxKind.NullKeyword ||
    (typescript.isIdentifier(candidate) && candidate.text === "undefined")
  ) return false;
  if (!typescript.isObjectLiteralExpression(candidate)) return true;

  for (const property of candidate.properties) {
    if (!typescript.isPropertyAssignment(property)) return true;
    const nameNode = property.name;
    const name = typescript.isIdentifier(nameNode) || typescript.isStringLiteral(nameNode)
      ? nameNode.text
      : null;
    if (name === null || isAlwaysForbiddenActionProp(name)) return true;

    const normalizedName = name.toLowerCase();
    if (normalizedName === "role") {
      const role = staticPrimitiveValue(property.initializer, typescript);
      if (
        !role.known ||
        typeof role.value !== "string" ||
        role.value.toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean)
          .some((token) => isForbiddenRoleName(token))
      ) return true;
    }
    if (normalizedName === "tabindex") {
      const tabIndex = staticPrimitiveValue(property.initializer, typescript);
      if (!tabIndex.known || !["-1", -1].includes(tabIndex.value)) return true;
      continue;
    }
    if (normalizedName === "role") continue;
    if (
      !SAFE_CREATE_ELEMENT_PROP_NAMES.has(normalizedName) &&
      !normalizedName.startsWith("aria-") &&
      !normalizedName.startsWith("data-")
    ) return true;
    if (!staticPrimitiveValue(property.initializer, typescript).known) return true;
  }
  return false;
}

function isAlwaysForbiddenActionProp(name) {
  const normalizedName = name.toLowerCase();
  return ALWAYS_FORBIDDEN_ACTION_PROP_NAMES.has(normalizedName) ||
    (normalizedName.startsWith("on") && normalizedName.length > 2);
}

function isForbiddenRoleName(name) {
  return INTERACTIVE_ROLE_NAMES.has(name) || LIVE_REGION_ROLE_NAMES.has(name);
}

function containsExecutablePropExpression(expression, typescript) {
  let executable = false;
  const visit = (node) => {
    if (
      typescript.isCallExpression(node) ||
      typescript.isNewExpression(node) ||
      typescript.isTaggedTemplateExpression(node) ||
      typescript.isArrowFunction(node) ||
      typescript.isFunctionExpression(node)
    ) {
      executable = true;
      return;
    }
    typescript.forEachChild(node, visit);
  };
  visit(expression);
  return executable;
}

function hasUnsafeJsxPropShape(name, initializer, typescript) {
  const normalizedName = name.toLowerCase();
  if (normalizedName === "role" || normalizedName === "tabindex") return false;
  if (
    !SAFE_JSX_PROP_NAMES.has(normalizedName) &&
    !normalizedName.startsWith("aria-") &&
    !normalizedName.startsWith("data-")
  ) return true;
  if (!initializer) return normalizedName !== "aria-hidden";
  if (typescript.isStringLiteral(initializer)) return false;
  if (!typescript.isJsxExpression(initializer) || !initializer.expression) return true;
  if (staticPrimitiveValue(initializer.expression, typescript).known) return false;
  const expression = unwrapExpression(initializer.expression, typescript);
  if (containsExecutablePropExpression(expression, typescript)) return true;
  if (
    normalizedName === "classname" &&
    typescript.isPropertyAccessExpression(expression) &&
    typescript.isIdentifier(expression.expression) &&
    expression.expression.text === "styles"
  ) return false;
  if (
    normalizedName === "key" &&
    typescript.isPropertyAccessExpression(expression) &&
    typescript.isIdentifier(expression.expression) &&
    expression.expression.text === "projection" &&
    expression.name.text === "id"
  ) return false;
  if (
    normalizedName === "data-projection-state" &&
    typescript.isPropertyAccessExpression(expression) &&
    typescript.isIdentifier(expression.expression) &&
    expression.expression.text === "projection" &&
    expression.name.text === "state"
  ) return false;
  return true;
}

function inspectJsxElement(
  node,
  sourceFile,
  displayFile,
  contract,
  violations,
  typescript,
  jsxIntrinsicAliases,
) {
  const tagName = node.tagName.getText(sourceFile);
  const lowerTagName = tagName.toLowerCase();
  const effectiveLowerTagName = jsxIntrinsicAliases.get(tagName) ?? lowerTagName;
  const attributes = node.attributes.properties;
  const validShellContext = displayFile === STUDIO_SHELL_SOURCE &&
    isReturnedByNamedExport(node, sourceFile, typescript, "StudioShell") &&
    isStaticallyReachable(node, typescript);

  for (const attribute of attributes) {
    if (typescript.isJsxSpreadAttribute(attribute)) {
      violations.push(createViolation(
        "studio-route-surface",
        displayFile,
        "Studio JSX may not hide route markers or action props in a spread attribute.",
        attribute.getText(sourceFile),
      ));
      continue;
    }
    if (!typescript.isJsxAttribute(attribute)) continue;
    const attributeName = attribute.name.getText(sourceFile);
    if (attributeName === "data-route-surface") {
      if (
        validShellContext &&
        attribute.initializer &&
        typescript.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === "studio"
      ) {
        contract.routeSurfaceCount += 1;
      } else {
        violations.push(createViolation(
          "studio-route-surface",
          displayFile,
          "The Studio route marker must be an immutable data-route-surface=\"studio\" attribute.",
          attribute.getText(sourceFile),
        ));
      }
    }
    if (
      isAlwaysForbiddenActionProp(attributeName) ||
      hasUnsafeJsxPropShape(attributeName, attribute.initializer, typescript)
    ) {
      violations.push(createViolation(
        "studio-action-primitive",
        displayFile,
        "Studio props must be allowlisted, static, inert, and non-executable.",
        attribute.getText(sourceFile),
      ));
    }
    if (attributeName.toLowerCase() === "role") {
      const role = jsxStaticAttributeValue(attribute, typescript);
      const roleTokens = role.known && typeof role.value === "string"
        ? role.value.toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean)
        : [];
      if (
        !role.known ||
        typeof role.value !== "string" ||
        roleTokens.some((token) => isForbiddenRoleName(token))
      ) {
        violations.push(createViolation(
          "studio-action-primitive",
          displayFile,
          "Studio may not introduce an interactive ARIA primitive.",
          attribute.getText(sourceFile),
        ));
      }
    }
    if (attributeName.toLowerCase() === "tabindex") {
      const tabIndex = jsxStaticAttributeValue(attribute, typescript);
      if (!tabIndex.known || !["-1", -1].includes(tabIndex.value)) {
        violations.push(createViolation(
          "studio-action-primitive",
          displayFile,
          "Studio may not add a tab stop; only the static -1 main focus target is allowed.",
          attribute.getText(sourceFile),
        ));
      }
    }
  }

  if (tagName === "Link") {
    const href = jsxAttributeValue(attributes, "href", typescript);
    const prefetchFalse = jsxFalseAttribute(attributes, "prefetch", typescript);
    contract.links.push({
      file: displayFile,
      href,
      prefetchFalse,
      validContext: validShellContext,
      match: node.getText(sourceFile),
    });
    if (
      !validShellContext ||
      !ALLOWED_NAVIGATION_DESTINATIONS.includes(href) ||
      !prefetchFalse
    ) {
      violations.push(createViolation(
        "studio-navigation-link",
        displayFile,
        "Only the three exact cross-space Link exits with prefetch={false} are allowed.",
        node.getText(sourceFile),
      ));
    }
  } else if (effectiveLowerTagName === "a") {
    contract.links.push({ file: displayFile, href: null, prefetchFalse: false, match: node.getText(sourceFile) });
    violations.push(createViolation(
      "studio-navigation-link",
      displayFile,
      "Studio cross-space exits must use the approved Link contract.",
      node.getText(sourceFile),
    ));
  }

  if (
    ACTION_ELEMENT_NAMES.has(effectiveLowerTagName) ||
    MEDIA_ELEMENT_NAMES.has(effectiveLowerTagName)
  ) {
    violations.push(createViolation(
      "studio-action-primitive",
      displayFile,
      "Studio may not expose action, form, input, or editor primitives.",
      node.getText(sourceFile),
    ));
  }
  if (effectiveLowerTagName === "canvas") {
    violations.push(createViolation(
      "studio-render-canvas",
      displayFile,
      "Studio may not own a canvas surface.",
      node.getText(sourceFile),
    ));
  }
  if (/^(?:Editor|.*(?:Button|Form|Input|Select|Textarea|Upload|Download|Approve|Retry))$/.test(tagName)) {
    violations.push(createViolation(
      "studio-action-primitive",
      displayFile,
      "Studio may not compose an action or editor component.",
      node.getText(sourceFile),
    ));
  }

  if (SHARED_CONTROL_IMPORTS.has(tagName)) {
    const valid = validShellContext;
    contract.controls.get(tagName).usages.push({
      file: displayFile,
      valid,
    });
    if (!valid) {
      violations.push(createViolation(
        "studio-shared-control",
        displayFile,
        `${tagName} must be unconditionally returned by StudioShell.`,
        node.getText(sourceFile),
      ));
    }
  }
}

function jsxAttributeValue(attributes, name, typescript) {
  for (const attribute of attributes) {
    if (!typescript.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    return jsxStringAttributeValue(attribute, typescript);
  }
  return null;
}

function jsxStringAttributeValue(attribute, typescript) {
  if (!attribute.initializer) return null;
  if (typescript.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return null;
}

function jsxStaticAttributeValue(attribute, typescript) {
  if (!attribute.initializer) return { known: true, value: true };
  if (typescript.isStringLiteral(attribute.initializer)) {
    return { known: true, value: attribute.initializer.text };
  }
  if (!typescript.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return { known: false, value: undefined };
  }
  return staticPrimitiveValue(attribute.initializer.expression, typescript);
}

function jsxFalseAttribute(attributes, name, typescript) {
  for (const attribute of attributes) {
    if (!typescript.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    return Boolean(
      attribute.initializer &&
      typescript.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression?.kind === typescript.SyntaxKind.FalseKeyword,
    );
  }
  return false;
}

function inspectStudioContract(contract, violations) {
  if (contract.endpointSentenceCount !== 1) {
    violations.push(createViolation(
      "studio-endpoint-truth",
      STUDIO_WORKPLANE_SOURCE,
      "The exact human-readable /v1/studio/* Workplane sentence must occur once as JSXText.",
      String(contract.endpointSentenceCount),
    ));
  }
  if (contract.routeSurfaceCount !== 1) {
    violations.push(createViolation(
      "studio-route-surface",
      "src/app/studio",
      "Exactly one immutable Studio route surface is required.",
      String(contract.routeSurfaceCount),
    ));
  }

  const exactLinkImport = contract.linkImports.length === 1 && contract.linkImports[0].valid;
  const exactLinks = exactLinkImport &&
    contract.links.length === ALLOWED_NAVIGATION_DESTINATIONS.length &&
    contract.links.every(({ file, validContext }) =>
      file === STUDIO_SHELL_SOURCE && validContext
    ) &&
    ALLOWED_NAVIGATION_DESTINATIONS.every((href) =>
      contract.links.filter((link) => link.href === href && link.prefetchFalse).length === 1
    );
  if (!exactLinks) {
    violations.push(createViolation(
      "studio-navigation-link",
      STUDIO_SHELL_SOURCE,
      "StudioShell must expose exactly Presence, Control, and Mobile as non-prefetched exits.",
      contract.links.map(({ href }) => href ?? "native-anchor").join(", ") || "none",
    ));
  }

  for (const [name, evidence] of contract.controls) {
    const exact = evidence.imports.length === 1 &&
      evidence.imports[0].valid &&
      evidence.usages.length === 1 &&
      evidence.usages[0].valid;
    if (!exact) {
      violations.push(createViolation(
        "studio-shared-control",
        STUDIO_SHELL_SOURCE,
        `StudioShell must use exactly one approved ${name} shared control.`,
        `${evidence.imports.length} imports, ${evidence.usages.length} usages`,
      ));
    }
  }
}

function staticStringValue(expression, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (typescript.isStringLiteralLike(candidate)) return candidate.text;
  if (
    typescript.isBinaryExpression(candidate) &&
    candidate.operatorToken.kind === typescript.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(candidate.left, typescript);
    const right = staticStringValue(candidate.right, typescript);
    return left === null || right === null ? null : left + right;
  }
  if (typescript.isTemplateExpression(candidate)) {
    let value = candidate.head.text;
    for (const span of candidate.templateSpans) {
      const expressionValue = staticStringValue(span.expression, typescript);
      if (expressionValue === null) return null;
      value += expressionValue + span.literal.text;
    }
    return value;
  }
  return null;
}

function staticPrimitiveValue(expression, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (typescript.isStringLiteralLike(candidate)) {
    return { known: true, value: candidate.text };
  }
  if (typescript.isNumericLiteral(candidate)) {
    return { known: true, value: Number(candidate.text) };
  }
  if (candidate.kind === typescript.SyntaxKind.TrueKeyword) {
    return { known: true, value: true };
  }
  if (candidate.kind === typescript.SyntaxKind.FalseKeyword) {
    return { known: true, value: false };
  }
  if (candidate.kind === typescript.SyntaxKind.NullKeyword) {
    return { known: true, value: null };
  }
  if (typescript.isIdentifier(candidate) && candidate.text === "undefined") {
    return { known: true, value: undefined };
  }
  if (typescript.isPrefixUnaryExpression(candidate)) {
    const operand = staticPrimitiveValue(candidate.operand, typescript);
    if (!operand.known) return operand;
    if (candidate.operator === typescript.SyntaxKind.ExclamationToken) {
      return { known: true, value: !operand.value };
    }
    if (candidate.operator === typescript.SyntaxKind.MinusToken && typeof operand.value === "number") {
      return { known: true, value: -operand.value };
    }
    if (candidate.operator === typescript.SyntaxKind.PlusToken && typeof operand.value === "number") {
      return { known: true, value: operand.value };
    }
  }
  const stringValue = staticStringValue(candidate, typescript);
  if (stringValue !== null) return { known: true, value: stringValue };
  return { known: false, value: undefined };
}

function inspectStudioTaxonomy(projectRoot, typescript) {
  const registryPath = resolve(projectRoot, ...STUDIO_REGISTRY_SOURCE.split("/"));
  if (!existsSync(registryPath)) {
    return {
      entries: [],
      violations: [createViolation(
        "studio-taxonomy-exact",
        STUDIO_REGISTRY_SOURCE,
        "The exact six-entry Studio projection taxonomy is required.",
        "missing registry",
      )],
    };
  }

  const source = readFileSync(registryPath, "utf8");
  const sourceFile = typescript.createSourceFile(
    registryPath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const projectionFactoryDeclarations = sourceFile.statements.filter((statement) =>
    typescript.isFunctionDeclaration(statement) &&
    statement.name?.text === "defineStudioProjection"
  );
  const projectionFactoryIsExact = projectionFactoryDeclarations.length === 1 &&
    isExactProjectionFactory(projectionFactoryDeclarations[0], typescript);
  let projectionArray;
  let projectionDeclarationCount = 0;
  let projectionDeclarationIsConst = false;
  let projectionWriteCount = 0;
  let projectionDeclarationNode = null;
  let studioExportCount = 0;
  let studioExportIsExact = false;
  let studioExportDeclarationNode = null;
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
      ({ kind }) => kind === typescript.SyntaxKind.ExportKeyword,
    );
    const declaredConst = Boolean(
      statement.declarationList.flags & typescript.NodeFlags.Const,
    );
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(sourceFile);
      if (name === "projections") {
        projectionDeclarationCount += 1;
        projectionDeclarationIsConst = declaredConst;
        projectionDeclarationNode = declaration;
        if (declaration.initializer) {
          const initializer = unwrapExpression(declaration.initializer, typescript);
          if (typescript.isArrayLiteralExpression(initializer)) projectionArray = initializer;
        }
      }
      if (name === "STUDIO_PROJECTIONS") {
        studioExportCount += 1;
        studioExportDeclarationNode = declaration;
        studioExportIsExact = Boolean(
          exported &&
          declaredConst &&
          declaration.initializer &&
          isExactFrozenProjectionExport(declaration.initializer, typescript)
        );
      }
    }
  }

  const visitProjectionWrites = (node) => {
    if (
      typescript.isBinaryExpression(node) &&
      node.operatorToken.kind >= typescript.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= typescript.SyntaxKind.LastAssignment &&
      assignmentTargetContainsName(node.left, "projections", typescript)
    ) {
      projectionWriteCount += 1;
    } else if (
      (typescript.isPrefixUnaryExpression(node) || typescript.isPostfixUnaryExpression(node)) &&
      [typescript.SyntaxKind.PlusPlusToken, typescript.SyntaxKind.MinusMinusToken]
        .includes(node.operator) &&
      assignmentTargetContainsName(node.operand, "projections", typescript)
    ) {
      projectionWriteCount += 1;
    }
    typescript.forEachChild(node, visitProjectionWrites);
  };
  visitProjectionWrites(sourceFile);

  const exactExportExpression = studioExportDeclarationNode?.initializer
    ? unwrapExpression(studioExportDeclarationNode.initializer, typescript)
    : null;
  const approvedExportArgument = exactExportExpression &&
    typescript.isCallExpression(exactExportExpression) &&
    exactExportExpression.arguments.length === 1
    ? exactExportExpression.arguments[0]
    : null;
  let unapprovedProjectionReferenceCount = 0;
  const visitProjectionReferences = (node) => {
    if (
      typescript.isIdentifier(node) &&
      node.text === "projections" &&
      node !== projectionDeclarationNode?.name &&
      node !== approvedExportArgument
    ) {
      unapprovedProjectionReferenceCount += 1;
    }
    typescript.forEachChild(node, visitProjectionReferences);
  };
  visitProjectionReferences(sourceFile);

  const identifierCounts = new Map([
    ["Object", 0],
    ["STUDIO_PROJECTIONS", 0],
    ["defineStudioProjection", 0],
    ["projections", 0],
  ]);
  let dynamicCodeCount = 0;
  const visitTaxonomySemantics = (node) => {
    if (typescript.isIdentifier(node) && identifierCounts.has(node.text)) {
      identifierCounts.set(node.text, identifierCounts.get(node.text) + 1);
    }
    if (typescript.isCallExpression(node) || typescript.isNewExpression(node)) {
      const calledName = accessedMemberName(node.expression, typescript);
      if (calledName === "eval" || calledName === "Function") dynamicCodeCount += 1;
    }
    typescript.forEachChild(node, visitTaxonomySemantics);
  };
  visitTaxonomySemantics(sourceFile);
  const taxonomySemanticsAreExact = projectionFactoryIsExact &&
    dynamicCodeCount === 0 &&
    identifierCounts.get("Object") === 2 &&
    identifierCounts.get("STUDIO_PROJECTIONS") === 1 &&
    identifierCounts.get("defineStudioProjection") === EXPECTED_TAXONOMY.length + 1 &&
    identifierCounts.get("projections") === 2;

  const entries = [];
  let allEntriesInspectable = Boolean(
    projectionDeclarationCount === 1 &&
    projectionDeclarationIsConst &&
    projectionWriteCount === 0 &&
    unapprovedProjectionReferenceCount === 0 &&
    taxonomySemanticsAreExact &&
    studioExportCount === 1 &&
    studioExportIsExact &&
    projectionArray &&
    projectionArray.elements.length === EXPECTED_TAXONOMY.length,
  );
  if (projectionArray) {
    for (const element of projectionArray.elements) {
      const candidate = unwrapProjectionDefinition(element, typescript);
      if (candidate === null) {
        allEntriesInspectable = false;
        continue;
      }
      if (!hasExactProjectionProperties(candidate, typescript)) {
        allEntriesInspectable = false;
        continue;
      }
      const id = stringProperty(candidate, "id", typescript);
      const label = stringProperty(candidate, "label", typescript);
      const purpose = stringProperty(candidate, "purpose", typescript);
      const state = stringProperty(candidate, "state", typescript);
      if ([id, label, purpose, state].every((value) => value !== null)) {
        entries.push({ id, label, purpose, state });
      } else {
        allEntriesInspectable = false;
      }
    }
  }

  const violations = [];
  if (
    !allEntriesInspectable ||
    JSON.stringify(entries) !== JSON.stringify(EXPECTED_TAXONOMY)
  ) {
    violations.push(createViolation(
      "studio-taxonomy-exact",
      STUDIO_REGISTRY_SOURCE,
      "Studio taxonomy IDs, order, labels, purposes, and unavailable states must be exact.",
      entries.map(({ id, state }) => `${id}:${state}`).join(", ") || "none",
    ));
  }
  return { entries, violations };
}

function isExactProjectionFactory(declaration, typescript) {
  if (
    declaration.modifiers?.length ||
    declaration.asteriskToken ||
    declaration.parameters.length !== 1 ||
    !typescript.isIdentifier(declaration.parameters[0].name) ||
    declaration.parameters[0].name.text !== "projection" ||
    declaration.parameters[0].initializer ||
    !declaration.body ||
    declaration.body.statements.length !== 1 ||
    !typescript.isReturnStatement(declaration.body.statements[0]) ||
    !declaration.body.statements[0].expression
  ) return false;
  return isExactObjectFreezeCall(
    declaration.body.statements[0].expression,
    "projection",
    typescript,
  );
}

function isExactObjectFreezeCall(expression, argumentName, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  return Boolean(
    typescript.isCallExpression(candidate) &&
    candidate.arguments.length === 1 &&
    typescript.isPropertyAccessExpression(candidate.expression) &&
    !candidate.expression.questionDotToken &&
    typescript.isIdentifier(candidate.expression.expression) &&
    candidate.expression.expression.text === "Object" &&
    candidate.expression.name.text === "freeze" &&
    typescript.isIdentifier(candidate.arguments[0]) &&
    candidate.arguments[0].text === argumentName
  );
}

function assignmentTargetContainsName(expression, name, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (typescript.isIdentifier(candidate)) return candidate.text === name;
  if (typescript.isPropertyAccessExpression(candidate)) {
    return assignmentTargetContainsName(candidate.expression, name, typescript);
  }
  if (typescript.isElementAccessExpression(candidate)) {
    return assignmentTargetContainsName(candidate.expression, name, typescript);
  }
  if (typescript.isArrayLiteralExpression(candidate)) {
    return candidate.elements.some((element) =>
      !typescript.isOmittedExpression(element) &&
      assignmentTargetContainsName(element, name, typescript)
    );
  }
  if (typescript.isObjectLiteralExpression(candidate)) {
    return candidate.properties.some((property) => {
      if (typescript.isShorthandPropertyAssignment(property)) {
        return property.name.text === name;
      }
      if (typescript.isPropertyAssignment(property)) {
        return assignmentTargetContainsName(property.initializer, name, typescript);
      }
      if (typescript.isSpreadAssignment(property)) {
        return assignmentTargetContainsName(property.expression, name, typescript);
      }
      return false;
    });
  }
  return false;
}

function isExactFrozenProjectionExport(expression, typescript) {
  return isExactObjectFreezeCall(expression, "projections", typescript);
}

function hasExactProjectionProperties(object, typescript) {
  if (object.properties.length !== 4) return false;
  const keys = [];
  for (const property of object.properties) {
    if (!typescript.isPropertyAssignment(property)) return false;
    const name = property.name;
    const key = typescript.isIdentifier(name) || typescript.isStringLiteral(name)
      ? name.text
      : null;
    if (key === null) return false;
    keys.push(key);
  }
  const expected = ["id", "label", "purpose", "state"].sort();
  const actual = [...keys].sort();
  return new Set(keys).size === keys.length &&
    actual.every((key, index) => key === expected[index]);
}

function unwrapProjectionDefinition(expression, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (
    !typescript.isCallExpression(candidate) ||
    !typescript.isIdentifier(candidate.expression) ||
    candidate.expression.text !== "defineStudioProjection" ||
    candidate.arguments.length !== 1
  ) return null;
  const argument = unwrapExpression(candidate.arguments[0], typescript);
  return typescript.isObjectLiteralExpression(argument) ? argument : null;
}

function unwrapExpression(expression, typescript) {
  let current = expression;
  while (
    typescript.isAsExpression(current) ||
    typescript.isSatisfiesExpression(current) ||
    typescript.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function stringProperty(object, propertyName, typescript) {
  for (const property of object.properties) {
    if (!typescript.isPropertyAssignment(property)) continue;
    const name = property.name;
    const key = typescript.isIdentifier(name) || typescript.isStringLiteral(name)
      ? name.text
      : null;
    if (key !== propertyName) continue;
    const value = unwrapExpression(property.initializer, typescript);
    return typescript.isStringLiteralLike(value) ? value.text : null;
  }
  return null;
}

function inspectStudioBuildEvidence(projectRoot) {
  const buildStampPath = resolve(projectRoot, ...BUILD_STAMP_SOURCE.split("/"));
  const buildIdPath = resolve(projectRoot, ...BUILD_ID_SOURCE.split("/"));
  const missingIdentity = [buildStampPath, buildIdPath].filter((file) => !existsSync(file));
  if (missingIdentity.length > 0) {
    return {
      status: "missing",
      chunks: [],
      violations: [createViolation(
        "studio-build-evidence-missing",
        relativePath(projectRoot, missingIdentity[0]),
        "Stamped Studio production build identity evidence is required.",
        missingIdentity.map((file) => relativePath(projectRoot, file)).join(", "),
      )],
    };
  }

  try {
    const stamp = JSON.parse(readFileSync(buildStampPath, "utf8"));
    const buildId = readFileSync(buildIdPath, "utf8").trim();
    if (stamp?.version !== 1) throw new BuildIdentityError("version", "Invalid build stamp version.");
    if (typeof stamp.buildId !== "string" || stamp.buildId !== buildId) {
      throw new BuildIdentityError("BUILD_ID", "The build stamp does not match BUILD_ID.");
    }
    if (
      typeof stamp.sourceHash !== "string" ||
      stamp.sourceHash !== hashBuildInputs(projectRoot)
    ) {
      throw new BuildIdentityError(
        "sourceHash",
        "The stamped build does not match the current source fingerprint.",
      );
    }
  } catch (error) {
    return {
      status: "stale",
      chunks: [],
      violations: [createViolation(
        "studio-build-evidence-stale",
        BUILD_STAMP_SOURCE,
        error instanceof Error ? error.message : String(error),
        error instanceof BuildIdentityError ? error.field : "build stamp",
      )],
    };
  }

  const violations = [];
  inspectStudioAppPath(projectRoot, violations);
  const chunks = inspectStudioClientManifest(projectRoot, violations);
  for (const displayFile of chunks) inspectStudioChunk(projectRoot, displayFile, violations);
  return { status: "checked", chunks, violations };
}

class BuildIdentityError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

function inspectStudioAppPath(projectRoot, violations) {
  const manifestPath = resolve(projectRoot, ...APP_PATHS_MANIFEST_SOURCE.split("/"));
  if (!existsSync(manifestPath)) {
    violations.push(createViolation(
      "studio-build-app-path-missing",
      APP_PATHS_MANIFEST_SOURCE,
      "The production app-paths manifest must contain /studio/page.",
      "missing manifest",
    ));
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    violations.push(createViolation(
      "studio-build-app-path-invalid",
      APP_PATHS_MANIFEST_SOURCE,
      error instanceof Error ? error.message : String(error),
      "invalid JSON",
    ));
    return;
  }
  const entry = manifest?.[STUDIO_ROUTE];
  if (typeof entry !== "string" || entry.length === 0) {
    violations.push(createViolation(
      "studio-build-app-path-missing",
      APP_PATHS_MANIFEST_SOURCE,
      `Missing ${STUDIO_ROUTE}.`,
      STUDIO_ROUTE,
    ));
    return;
  }

  const serverRoot = resolve(projectRoot, ".next/server");
  const safeEntry = isSafeBuildRelativePath(entry, "app/", ".js");
  const serverEntry = safeEntry
    ? resolve(serverRoot, ...entry.split("/"))
    : null;
  if (!safeEntry || serverEntry === null || !isWithin(serverRoot, serverEntry)) {
    violations.push(createViolation(
      "studio-build-app-path-invalid",
      APP_PATHS_MANIFEST_SOURCE,
      "The Studio app-path entry must remain beneath .next/server/app and name a JavaScript file.",
      entry,
    ));
    return;
  }
  if (!existsSync(serverEntry) || !statSync(serverEntry).isFile()) {
    violations.push(createViolation(
      "studio-build-app-path-missing",
      APP_PATHS_MANIFEST_SOURCE,
      "The Studio app-path entry references a missing server file.",
      entry,
    ));
  }
}

function inspectStudioClientManifest(projectRoot, violations) {
  const manifestPath = resolve(projectRoot, ...CLIENT_MANIFEST_SOURCE.split("/"));
  if (!existsSync(manifestPath)) {
    violations.push(createViolation(
      "studio-build-client-manifest-missing",
      CLIENT_MANIFEST_SOURCE,
      "The Studio client-reference manifest is required.",
      STUDIO_ROUTE,
    ));
    return [];
  }
  try {
    const manifest = readRscManifest(manifestPath, STUDIO_ROUTE);
    const { chunks, invalid } = chunksForEntry(manifest, STUDIO_ENTRY);
    for (const chunk of invalid) {
      violations.push(createViolation(
        "studio-build-chunk-invalid",
        CLIENT_MANIFEST_SOURCE,
        "Studio chunks must remain JavaScript files beneath .next/static/chunks.",
        chunk,
      ));
    }
    if (chunks.length === 0) {
      violations.push(createViolation(
        "studio-build-chunks-empty",
        CLIENT_MANIFEST_SOURCE,
        "The checked Studio route must resolve at least one production chunk.",
        STUDIO_ENTRY,
      ));
    }
    return chunks;
  } catch (error) {
    violations.push(createViolation(
      "studio-build-client-manifest-invalid",
      CLIENT_MANIFEST_SOURCE,
      error instanceof Error ? error.message : String(error),
      STUDIO_ROUTE,
    ));
    return [];
  }
}

function inspectStudioChunk(projectRoot, displayFile, violations) {
  const chunkRoot = resolve(projectRoot, ".next/static/chunks");
  const prefix = ".next/static/chunks/";
  const relativeChunk = displayFile.startsWith(prefix) ? displayFile.slice(prefix.length) : null;
  const file = relativeChunk === null
    ? null
    : resolve(chunkRoot, ...relativeChunk.split("/"));
  if (
    file === null ||
    !isWithin(chunkRoot, file) ||
    extname(file).toLowerCase() !== ".js"
  ) {
    violations.push(createViolation(
      "studio-build-chunk-invalid",
      displayFile,
      "The Studio chunk path escapes the canonical JavaScript chunk root.",
      displayFile,
    ));
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    violations.push(createViolation(
      "studio-build-chunk-missing",
      displayFile,
      "The Studio build manifest references a missing chunk.",
      displayFile,
    ));
    return;
  }
  const source = readFileSync(file, "utf8");
  const heavyMatch = source.match(HEAVY_CHUNK_PATTERN);
  if (heavyMatch) {
    violations.push(createViolation(
      "studio-chunk-heavy-visual",
      displayFile,
      "A Studio production chunk contains a prohibited heavy visual dependency.",
      heavyMatch[0],
    ));
  }
  const rendererMatch = source.match(RENDER_CHUNK_PATTERN);
  if (rendererMatch) {
    violations.push(createViolation(
      "studio-chunk-renderer-api",
      displayFile,
      "A Studio production chunk contains a prohibited renderer API.",
      rendererMatch[0],
    ));
  }
}

function readRscManifest(manifestPath, route) {
  const source = readFileSync(manifestPath, "utf8");
  const assignment = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}]`;
  const assignmentIndex = source.indexOf(assignment);
  if (assignmentIndex < 0) throw new Error(`Missing ${route} RSC manifest assignment.`);
  const objectStart = source.indexOf("{", assignmentIndex + assignment.length);
  if (objectStart < 0) throw new Error(`Missing ${route} RSC manifest object.`);
  const objectEnd = findBalancedObjectEnd(source, objectStart);
  return JSON.parse(source.slice(objectStart, objectEnd + 1));
}

function findBalancedObjectEnd(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unterminated RSC manifest object.");
}

function chunksForEntry(manifest, expectedEntry) {
  const entryFiles = manifest?.entryJSFiles;
  if (!entryFiles || typeof entryFiles !== "object") return { chunks: [], invalid: [] };
  const rawChunks = Object.entries(entryFiles)
    .filter(([entry]) => entry.replace("[project]", "").replace(/^\/+/, "") === expectedEntry)
    .flatMap(([, files]) => Array.isArray(files) ? files : [])
    .filter((chunk) => typeof chunk === "string");
  const chunks = new Set();
  const invalid = [];
  for (const rawChunk of rawChunks) {
    const chunk = rawChunk.replace(/^\/?_next\//, "").replace(/^\/+/, "");
    if (!isSafeBuildRelativePath(chunk, "static/chunks/", ".js")) {
      invalid.push(rawChunk);
      continue;
    }
    chunks.add(`.next/${chunk}`);
  }
  return { chunks: [...chunks].sort(), invalid: [...new Set(invalid)].sort() };
}

function isSafeBuildRelativePath(value, requiredPrefix, requiredExtension) {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/") ||
    !value.startsWith(requiredPrefix) ||
    !value.toLowerCase().endsWith(requiredExtension)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function hashBuildInputs(projectRoot) {
  const hash = createHash("sha256");
  for (const relativePathFromRoot of BUILD_FINGERPRINT_INPUTS) {
    appendBuildInput(hash, projectRoot, relativePathFromRoot);
  }
  return hash.digest("hex");
}

function appendBuildInput(hash, projectRoot, relativePathFromRoot) {
  const absolutePath = resolve(projectRoot, ...relativePathFromRoot.split("/"));
  if (statSync(absolutePath).isFile()) {
    hash.update(relativePathFromRoot);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    return;
  }
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = `${relativePathFromRoot}/${entry.name}`;
    if (entry.isDirectory()) appendBuildInput(hash, projectRoot, childPath);
    else {
      hash.update(childPath);
      hash.update("\0");
      hash.update(readFileSync(resolve(projectRoot, ...childPath.split("/"))));
    }
  }
}

function accessedMemberName(expression, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (typescript.isIdentifier(candidate)) return candidate.text;
  if (typescript.isPropertyAccessExpression(candidate)) return candidate.name.text;
  if (typescript.isElementAccessExpression(candidate)) {
    const argument = candidate.argumentExpression;
    return argument && typescript.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
}

function scriptKindFor(file, typescript) {
  if (file.endsWith(".tsx")) return typescript.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return typescript.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return typescript.ScriptKind.JS;
  }
  return typescript.ScriptKind.TS;
}

function createViolation(rule, file, detail, match) {
  return Object.freeze({ rule, file, detail, match: compact(String(match)) });
}

function compareViolations(left, right) {
  return left.file.localeCompare(right.file) ||
    left.rule.localeCompare(right.rule) ||
    left.match.localeCompare(right.match);
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function relativePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

function isWithin(root, file) {
  const fromRoot = relative(resolve(root), resolve(file));
  return fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function parseArguments(argv) {
  let root = defaultProjectRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory path.");
      root = resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true, root };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { help: false, root };
}

function usage() {
  return "Usage: node scripts/check-studio-boundaries.mjs [--root <webapp-root>]";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await checkStudioBoundaries({ root: options.root });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
