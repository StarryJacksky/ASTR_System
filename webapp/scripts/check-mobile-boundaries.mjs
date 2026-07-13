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

const MOBILE_DOMAINS = Object.freeze([
  "presence",
  "tasks",
  "workbench",
  "knowledge",
  "safety",
]);
const NO_GREEN_RULE_SOURCE = "src/test/no-green-scanner.ts";
const MOBILE_REGISTRY_SOURCE = "src/features/mobile/model/mobile-domains.ts";
const GLOBALS_SOURCE = "src/app/globals.css";
const APP_PATHS_MANIFEST = ".next/server/app-paths-manifest.json";
const SOURCE_ROOTS = Object.freeze([
  "src/app/mobile",
  "src/features/mobile",
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
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const EXCLUDED_SOURCE_DIRECTORIES = new Set([
  "__fixtures__",
  "__snapshots__",
  "__tests__",
  "fixture",
  "fixtures",
  "snapshot",
  "snapshots",
  "test",
  "tests",
]);
const ROUTES = Object.freeze(MOBILE_DOMAINS.map((domain) => Object.freeze({
  domain,
  route: `/mobile/${domain}`,
  routeKey: `/mobile/${domain}/page`,
  appPath: `app/mobile/${domain}/page.js`,
  serverEntry: `.next/server/app/mobile/${domain}/page.js`,
  manifest: `.next/server/app/mobile/${domain}/page_client-reference-manifest.js`,
  layoutEntry: "src/app/mobile/layout",
  pageEntry: `src/app/mobile/${domain}/page`,
})));
const EXACT_SAFETY_GET_PATHS = new Set([
  "/api/core/v1/effector/status",
  "/api/core/v1/admin/effector/policy",
  "/api/core/v1/admin/effector/audit",
]);

const HEAVY_IMPORT_PATTERN = /(?:^|[/@._-])(?:pixi(?:\.js)?|live2d|three(?:\.js)?|framer[-_]motion)(?:$|[/@._-])/i;
const HEAVY_BYTE_PATTERN = /pixi(?:\.js)?|live2d|(?:^|["'`/@._-])three(?:\.module)?\.js|framer[-_]motion|\.2048(?:[/\\.]|$)/i;
const W5_IMPORT_PATTERN = /(?:^|[/@._-])(?:dispatch|remote[-_]?(?:task|device)|devices?|approvals?|artifacts?|provenance|studio[-_]client|knowledge[-_]client)(?:$|[/@._-])/i;
const W5_ENDPOINT_PATTERN = /\/(?:api\/(?:core\/)?(?:v1\/)?|v1\/)(?:tasks?|devices?|approvals?|artifacts?|dispatch|provenance|studio|knowledge)(?:[/"'`?#]|$)/gi;
const W5_DECLARATION_PATTERN = /(?:Dispatch|Remote(?:Task|Device)|Device(?:Binding|Identity)|Approval|Artifact|Provenance|Studio(?:Run|Client)|Knowledge(?:Record|Client)|AckContract)/i;
const STATIC_CORE_IMPORT_PATTERN = /(?:^|\/)(?:features\/(?:presence|control)(?:\/|$)|lib\/(?:core(?:\/|[-_]client)?|studio[-_]client|memory)(?:\/|$)|(?:core|studio|memory)[-_]?client(?:\/|$))/i;
const SAFETY_MUTATION_IDENTIFIER_PATTERN = /\b(?:patchPolicy|setPolicy|resetE?stop|triggerE?stop|dispatchTask|createControlClient|ControlClient|EffectorClient)\b/g;
const SAFETY_MUTATION_CHUNK_PATTERN = /method\s*[:=]\s*["'](?:POST|PUT|PATCH|DELETE)["']|\/api\/core\/v1\/(?:effector\/(?:estop|reset)|admin\/effector\/(?:policy|audit)\/)|(?:Control|Effector)Client|features\/control/i;

export async function checkMobileBoundaries({ root = defaultProjectRoot } = {}) {
  const projectRoot = resolve(root);
  const typescript = await loadTypeScript();
  const violations = [];
  let findForbiddenGreenUsages = () => [];

  try {
    findForbiddenGreenUsages = await loadNoGreenScanner(projectRoot, typescript);
  } catch (error) {
    violations.push(createViolation(
      "mobile-no-green-scanner-missing",
      NO_GREEN_RULE_SOURCE,
      error instanceof Error ? error.message : String(error),
      NO_GREEN_RULE_SOURCE,
    ));
  }

  const sourceFiles = [...new Set(SOURCE_ROOTS.flatMap((sourceRoot) =>
    listProductionSourceFiles(resolve(projectRoot, ...sourceRoot.split("/"))),
  ))].sort();

  for (const file of sourceFiles) {
    const displayFile = relativePath(projectRoot, file);
    const source = readFileSync(file, "utf8");
    const code = stripComments(source);

    for (const usage of findForbiddenGreenUsages(source)) {
      violations.push(createViolation(
        "no-green-hardcode",
        displayFile,
        "The shared constitutional no-green scanner rejected Mobile production source.",
        usage,
      ));
    }

    violations.push(...findVisualSourceViolations(code, displayFile));
    if (extname(file) === ".css") continue;

    const sourceFile = typescript.createSourceFile(
      file,
      source,
      typescript.ScriptTarget.Latest,
      true,
      scriptKindFor(file, typescript),
    );
    const imports = importedModuleSpecifiers(sourceFile, typescript);

    for (const specifier of imports) {
      if (HEAVY_IMPORT_PATTERN.test(specifier)) {
        violations.push(createViolation(
          "mobile-heavy-import",
          displayFile,
          "Mobile source may not import Pixi, Live2D, Three, or framer-motion.",
          specifier,
        ));
      }
      if (W5_IMPORT_PATTERN.test(specifier)) {
        violations.push(createViolation(
          "mobile-w5-capability",
          displayFile,
          "Mobile may not import future W5 Dispatch, device, approval, artifact, provenance, Studio, or Knowledge capabilities.",
          specifier,
        ));
      }
    }

    violations.push(...findW5SourceViolations(sourceFile, displayFile, typescript));

    if (isShellOrNavigationSource(displayFile)) {
      for (const specifier of imports) {
        const modulePath = normalizeImportedProjectPath(projectRoot, file, specifier);
        const domain = businessDomainForModule(modulePath);
        if (domain !== null) {
          violations.push(createViolation(
            "mobile-shell-business-import",
            displayFile,
            "The Mobile shell and navigation may consume metadata, not domain business modules.",
            specifier,
          ));
        }
      }
    }

    if (isStaticDomainSource(displayFile)) {
      for (const specifier of imports) {
        if (STATIC_CORE_IMPORT_PATTERN.test(specifier.replaceAll("\\", "/"))) {
          violations.push(createViolation(
            "mobile-static-core-import",
            displayFile,
            "Workbench, Knowledge, and their shared gate may not import Core or desktop business clients.",
            specifier,
          ));
        }
      }
    }

    if (displayFile.startsWith("src/features/mobile/safety/")) {
      violations.push(...findSafetySourceViolations(
        sourceFile,
        imports,
        displayFile,
        typescript,
      ));
    }
  }

  const globals = inspectGlobalsWitness(projectRoot, findForbiddenGreenUsages);
  violations.push(...globals.violations);
  const registry = inspectMobileRegistry(projectRoot, typescript);
  violations.push(...registry.violations);
  const buildEvidence = inspectMobileBuildEvidence(projectRoot);
  violations.push(...buildEvidence.violations);

  const sortedViolations = dedupeViolations(violations).sort(compareViolations);
  return Object.freeze({
    schemaVersion: 1,
    check: "mobile-boundaries",
    passed: sortedViolations.length === 0,
    sourceFilesScanned: sourceFiles.length + globals.filesScanned,
    domains: Object.freeze(registry.domains),
    buildEvidence: Object.freeze({
      status: buildEvidence.status,
      routes: Object.freeze(buildEvidence.routes),
    }),
    violations: Object.freeze(sortedViolations),
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
    const imported = await import(`${pathToFileURL(scannerPath).href}?mobile-boundary=1`);
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
  const imported = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
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
      if (EXCLUDED_SOURCE_DIRECTORIES.has(entry.name.toLowerCase())) return [];
      return listProductionSourceFiles(file);
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) return [];
    if (/(?:^|\.)test(?:[.-]|$)|(?:^|\.)spec(?:[.-]|$)|\.d\.ts$|\.snap$/i.test(entry.name)) return [];
    return [file];
  });
}

function stripComments(source) {
  let result = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote !== null) {
      result += character;
      if (character === "\\" && next !== undefined) {
        result += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      if (index < source.length) result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") result += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function findVisualSourceViolations(source, file) {
  const violations = [];
  for (const match of source.matchAll(/\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(|\bgradient\b/gi)) {
    violations.push(createViolation(
      "mobile-forbidden-gradient",
      file,
      "Mobile production source must use solid layered surfaces, not gradients.",
      match[0],
    ));
  }
  for (const match of source.matchAll(/\b(?:-webkit-)?backdrop-filter\s*:/gi)) {
    violations.push(createViolation(
      "mobile-forbidden-glass",
      file,
      "Mobile production source must not use backdrop-filter glass.",
      match[0],
    ));
  }
  for (const match of source.matchAll(/@(?:-webkit-)?keyframes\b|\banimation(?:-name|Name)\s*:/gi)) {
    violations.push(createViolation(
      "mobile-forbidden-animation",
      file,
      "Mobile production source must not define keyframes or animation-name.",
      match[0],
    ));
  }
  for (const match of source.matchAll(/\banimation\s*:\s*([^;}\n]+)/gi)) {
    const normalized = match[1]
      .trim()
      .replace(/\s*!important\s*$/i, "")
      .replace(/^(["'])none\1,?$/i, "none");
    if (normalized.toLowerCase() === "none") continue;
    violations.push(createViolation(
      "mobile-forbidden-animation",
      file,
      "Only animation:none first-paint suppression is allowed in Mobile production source.",
      match[0],
    ));
  }
  for (const match of source.matchAll(/\brequestAnimationFrame\s*\(/g)) {
    violations.push(createViolation(
      "mobile-render-request-animation-frame",
      file,
      "Mobile route source may not own a requestAnimationFrame loop.",
      match[0],
    ));
  }
  for (const match of source.matchAll(/<\s*canvas\b|["'`]canvas["'`]|\b(?:OffscreenCanvas|HTMLCanvasElement|WebGL(?:2)?RenderingContext)\b|\.\s*getContext\s*\(|\bwebgl2?\b/gi)) {
    violations.push(createViolation(
      "mobile-render-canvas-webgl",
      file,
      "Mobile route source may use static SVG, but not Canvas or WebGL ownership.",
      match[0],
    ));
  }
  return violations;
}

function importedModuleSpecifiers(sourceFile, typescript) {
  const specifiers = [];
  const visit = (node) => {
    if (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) {
      if (typeof node.moduleSpecifier?.text === "string") specifiers.push(node.moduleSpecifier.text);
    } else if (
      typescript.isCallExpression(node) &&
      (node.expression.kind === typescript.SyntaxKind.ImportKeyword ||
        (typescript.isIdentifier(node.expression) && node.expression.text === "require")) &&
      typescript.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function findW5SourceViolations(sourceFile, file, typescript) {
  const violations = [];
  const visit = (node) => {
    if (typescript.isStringLiteralLike(node)) {
      for (const match of node.text.matchAll(W5_ENDPOINT_PATTERN)) {
        violations.push(createViolation(
          "mobile-w5-capability",
          file,
          "Mobile may not reference future W5 endpoints.",
          match[0],
        ));
      }
    }
    if (
      (typescript.isInterfaceDeclaration(node) ||
        typescript.isTypeAliasDeclaration(node) ||
        typescript.isClassDeclaration(node) ||
        typescript.isEnumDeclaration(node)) &&
      node.name &&
      W5_DECLARATION_PATTERN.test(node.name.text)
    ) {
      violations.push(createViolation(
        "mobile-w5-capability",
        file,
        "Mobile may not declare future W5 capability contracts before their backend authority exists.",
        node.name.text,
      ));
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function isShellOrNavigationSource(file) {
  return file === "src/app/mobile/layout.tsx" || file.startsWith("src/features/mobile/shell/");
}

function isStaticDomainSource(file) {
  return file.startsWith("src/features/mobile/workbench/") ||
    file.startsWith("src/features/mobile/knowledge/") ||
    file.startsWith("src/features/mobile/shared/");
}

function normalizeImportedProjectPath(projectRoot, importer, specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`.replaceAll("\\", "/");
  if (!specifier.startsWith(".")) return specifier.replaceAll("\\", "/");
  return relativePath(projectRoot, resolve(dirname(importer), specifier));
}

function businessDomainForModule(modulePath) {
  const normalized = normalizeManifestModule(modulePath);
  const mobileMatch = normalized.match(/^src\/(?:features|app)\/mobile\/(presence|tasks|workbench|knowledge|safety)(?:\/|$)/);
  if (mobileMatch) return mobileMatch[1];
  if (normalized.startsWith("src/features/presence/")) return "presence";
  if (normalized.startsWith("src/features/control/")) return "control";
  return null;
}

function findSafetySourceViolations(sourceFile, imports, file, typescript) {
  const violations = [];
  for (const specifier of imports) {
    if (/features\/control(?:\/|$)|(?:^|[/@._-])(?:control|effector)[-_]?client(?:$|[/@._-])/i.test(specifier)) {
      violations.push(createViolation(
        "mobile-safety-mutation",
        file,
        "Mobile Safety must use its dedicated GET-only client, never a Control mutation client.",
        specifier,
      ));
    }
  }

  const sourceText = sourceFile.getFullText();
  for (const match of sourceText.matchAll(SAFETY_MUTATION_IDENTIFIER_PATTERN)) {
    violations.push(createViolation(
      "mobile-safety-mutation",
      file,
      "Mobile Safety must not expose policy, e-stop, reset, Dispatch, or Control mutation methods.",
      match[0],
    ));
  }

  const visit = (node) => {
    if (typescript.isStringLiteralLike(node)) {
      const value = node.text;
      if ((value.includes("/api/core/") || /\/v1\//.test(value)) && !EXACT_SAFETY_GET_PATHS.has(value)) {
        violations.push(createViolation(
          "mobile-safety-mutation",
          file,
          "Mobile Safety may reference only its three exact GET projection paths.",
          value,
        ));
      }
    }
    if (typescript.isPropertyAssignment(node)) {
      const propertyName = propertyNameText(node.name, typescript);
      const initializer = unwrapExpression(node.initializer, typescript);
      if (
        propertyName === "method" &&
        (!typescript.isStringLiteralLike(initializer) || initializer.text.toUpperCase() !== "GET")
      ) {
        violations.push(createViolation(
          "mobile-safety-mutation",
          file,
          "Mobile Safety request methods must be GET.",
          initializer.getText(sourceFile),
        ));
      }
    } else if (
      typescript.isShorthandPropertyAssignment(node) &&
      node.name.text === "method"
    ) {
      violations.push(createViolation(
        "mobile-safety-mutation",
        file,
        "Mobile Safety request methods must be the literal GET value.",
        node.getText(sourceFile),
      ));
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function inspectGlobalsWitness(projectRoot, findForbiddenGreenUsages) {
  const file = resolve(projectRoot, ...GLOBALS_SOURCE.split("/"));
  if (!existsSync(file)) {
    return {
      filesScanned: 0,
      violations: [createViolation(
        "mobile-global-ambient-witness",
        GLOBALS_SOURCE,
        "The exact Mobile ambient and grain first-paint suppression is missing.",
        "missing globals.css",
      )],
    };
  }

  const source = stripComments(readFileSync(file, "utf8"));
  const requiredSelectors = [
    'body:has([data-route-surface="mobile"]) .astr-ambient',
    'body:has([data-route-surface="mobile"]) .astr-grain',
  ].sort();
  let witness = null;
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map(normalizeCssSelector).sort();
    if (selectors.length === 2 && selectors.every((selector, index) => selector === requiredSelectors[index])) {
      witness = match[0];
      const declarations = match[2];
      const onlyNone = (property) => {
        const values = [...declarations.matchAll(new RegExp(
          `(?:^|;)\\s*${property}\\s*:\\s*([^;}]+)`,
          "gi",
        ))].map((declaration) => declaration[1]
          .trim()
          .replace(/\s*!important\s*$/i, "")
          .toLowerCase());
        return values.length > 0 && values.every((value) => value === "none");
      };
      if (onlyNone("display") && onlyNone("animation") && onlyNone("background")) break;
      witness = null;
    }
  }

  const violations = [];
  if (witness === null) {
    violations.push(createViolation(
      "mobile-global-ambient-witness",
      GLOBALS_SOURCE,
      "Both Mobile ambient and grain selectors must share display:none, animation:none, and background:none.",
      "body:has([data-route-surface=\"mobile\"])",
    ));
  } else {
    for (const usage of findForbiddenGreenUsages(witness)) {
      violations.push(createViolation(
        "no-green-hardcode",
        GLOBALS_SOURCE,
        "The shared constitutional no-green scanner rejected the Mobile globals witness.",
        usage,
      ));
    }
  }
  return { filesScanned: 1, violations };
}

function normalizeCssSelector(selector) {
  return selector.trim().replace(/\s+/g, " ");
}

function inspectMobileRegistry(projectRoot, typescript) {
  const file = resolve(projectRoot, ...MOBILE_REGISTRY_SOURCE.split("/"));
  if (!existsSync(file)) {
    return {
      domains: [],
      violations: [createViolation(
        "mobile-domain-registry",
        MOBILE_REGISTRY_SOURCE,
        "The Mobile domain registry is missing.",
        "missing registry",
      )],
    };
  }

  const source = readFileSync(file, "utf8");
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  let array = null;
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) !== "domainDefinitions" || !declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer, typescript);
      if (typescript.isArrayLiteralExpression(initializer)) array = initializer;
    }
  }

  const definitions = [];
  if (array !== null) {
    for (const element of array.elements) {
      const candidate = unwrapExpression(element, typescript);
      if (!typescript.isObjectLiteralExpression(candidate)) continue;
      definitions.push({
        id: stringProperty(candidate, "id", typescript),
        href: stringProperty(candidate, "href", typescript),
      });
    }
  }
  const domains = definitions.flatMap(({ id }) => typeof id === "string" ? [id] : []);
  const valid = definitions.length === MOBILE_DOMAINS.length && definitions.every(
    ({ id, href }, index) => id === MOBILE_DOMAINS[index] && href === `/mobile/${MOBILE_DOMAINS[index]}`,
  );
  return {
    domains,
    violations: valid ? [] : [createViolation(
      "mobile-domain-registry",
      MOBILE_REGISTRY_SOURCE,
      "The registry must contain exactly presence, tasks, workbench, knowledge, and safety with exact hrefs in that order.",
      definitions.length > 0
        ? definitions.map(({ id, href }) => `${id ?? "?"}:${href ?? "?"}`).join(", ")
        : "unparseable registry",
    )],
  };
}

function unwrapExpression(expression, typescript) {
  let current = expression;
  while (
    typescript.isAsExpression(current) ||
    typescript.isSatisfiesExpression(current) ||
    typescript.isParenthesizedExpression(current) ||
    typescript.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(name, typescript) {
  if (typescript.isIdentifier(name) || typescript.isStringLiteralLike(name)) return name.text;
  return null;
}

function stringProperty(object, propertyName, typescript) {
  for (const property of object.properties) {
    if (!typescript.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name, typescript) !== propertyName) continue;
    const value = unwrapExpression(property.initializer, typescript);
    return typescript.isStringLiteralLike(value) ? value.text : null;
  }
  return null;
}

function inspectMobileBuildEvidence(projectRoot) {
  const buildStampPath = resolve(projectRoot, ".next/astr-e2e-build.json");
  const buildIdPath = resolve(projectRoot, ".next/BUILD_ID");
  const missingStampEvidence = [buildStampPath, buildIdPath].filter((file) => !existsSync(file));
  if (missingStampEvidence.length > 0) {
    return {
      status: "missing",
      routes: [],
      violations: [createViolation(
        "mobile-build-evidence-missing",
        relativePath(projectRoot, missingStampEvidence[0]),
        "A stamped production build is required before Mobile boundaries can pass.",
        missingStampEvidence.map((file) => relativePath(projectRoot, file)).join(", "),
      )],
    };
  }

  try {
    const stamp = JSON.parse(readFileSync(buildStampPath, "utf8"));
    const buildId = readFileSync(buildIdPath, "utf8").trim();
    if (
      stamp?.version !== 1 ||
      typeof stamp.buildId !== "string" ||
      stamp.buildId !== buildId ||
      typeof stamp.sourceHash !== "string" ||
      stamp.sourceHash !== hashBuildInputs(projectRoot)
    ) {
      throw new Error("The build identity does not match the current source fingerprint.");
    }
  } catch (error) {
    return {
      status: "stale",
      routes: [],
      violations: [createViolation(
        "mobile-build-evidence-stale",
        relativePath(projectRoot, buildStampPath),
        error instanceof Error ? error.message : String(error),
        "astr-e2e-build.json",
      )],
    };
  }

  const violations = [];
  let appPaths = null;
  const appPathsFile = resolve(projectRoot, ...APP_PATHS_MANIFEST.split("/"));
  if (existsSync(appPathsFile)) {
    try {
      appPaths = JSON.parse(readFileSync(appPathsFile, "utf8"));
      if (!appPaths || typeof appPaths !== "object" || Array.isArray(appPaths)) {
        throw new Error("Expected an object app-paths manifest.");
      }
    } catch (error) {
      violations.push(createViolation(
        "mobile-route-server-manifest-invalid",
        APP_PATHS_MANIFEST,
        error instanceof Error ? error.message : String(error),
        APP_PATHS_MANIFEST,
      ));
      appPaths = null;
    }
  } else {
    violations.push(createViolation(
      "mobile-route-server-manifest-invalid",
      APP_PATHS_MANIFEST,
      "The authoritative Next app-paths manifest is missing.",
      APP_PATHS_MANIFEST,
    ));
  }

  const routes = [];
  for (const descriptor of ROUTES) {
    const routeViolations = [];
    if (appPaths?.[descriptor.routeKey] !== descriptor.appPath) {
      routeViolations.push(createViolation(
        "mobile-route-server-entry-missing",
        APP_PATHS_MANIFEST,
        `The app-paths manifest must map ${descriptor.routeKey} to ${descriptor.appPath}.`,
        descriptor.routeKey,
      ));
    }
    const serverEntryFile = resolve(projectRoot, ...descriptor.serverEntry.split("/"));
    if (!existsSync(serverEntryFile)) {
      routeViolations.push(createViolation(
        "mobile-route-server-entry-missing",
        descriptor.serverEntry,
        "The explicit Mobile route server entry is missing.",
        descriptor.routeKey,
      ));
    }

    const manifestFile = resolve(projectRoot, ...descriptor.manifest.split("/"));
    let clientChunks = [];
    if (!existsSync(manifestFile)) {
      routeViolations.push(createViolation(
        "mobile-route-manifest-missing",
        descriptor.manifest,
        "The explicit Mobile route client-reference manifest is missing.",
        descriptor.routeKey,
      ));
    } else {
      try {
        const manifest = readRscManifest(manifestFile, descriptor.routeKey);
        if (manifest === null) {
          routeViolations.push(createViolation(
            "mobile-route-evidence-missing",
            descriptor.manifest,
            "The client-reference manifest has no assignment for its expected Mobile route.",
            descriptor.routeKey,
          ));
        } else {
          const entryEvidence = routeOwnedChunks(manifest, descriptor);
          if (!entryEvidence.ok) {
            routeViolations.push(createViolation(
              "mobile-route-evidence-missing",
              descriptor.manifest,
              entryEvidence.detail,
              descriptor.pageEntry,
            ));
          } else {
            clientChunks = entryEvidence.chunks;
          }
          routeViolations.push(...crossDomainManifestViolations(manifest, descriptor));
        }
      } catch (error) {
        routeViolations.push(createViolation(
          "mobile-route-manifest-invalid",
          descriptor.manifest,
          error instanceof Error ? error.message : String(error),
          descriptor.routeKey,
        ));
      }
    }

    for (const displayFile of clientChunks) {
      const chunkFile = resolve(projectRoot, ...displayFile.split("/"));
      if (!isWithin(projectRoot, chunkFile) || !existsSync(chunkFile)) {
        routeViolations.push(createViolation(
          "mobile-route-chunk-missing",
          displayFile,
          "The Mobile route manifest references a missing route-owned chunk.",
          displayFile,
        ));
        continue;
      }
      const bytes = readFileSync(chunkFile, "utf8");
      const heavy = bytes.match(HEAVY_BYTE_PATTERN);
      if (heavy) {
        routeViolations.push(createViolation(
          "mobile-route-heavy-bytes",
          displayFile,
          "A route-owned Mobile chunk contains Pixi, Live2D, Three, framer-motion, or 2048 texture bytes.",
          heavy[0],
        ));
      }
      if (descriptor.domain === "safety") {
        const mutation = bytes.match(SAFETY_MUTATION_CHUNK_PATTERN);
        if (mutation) {
          routeViolations.push(createViolation(
            "mobile-safety-mutation",
            displayFile,
            "A Safety-owned chunk contains mutation or Control-client bytes.",
            mutation[0],
          ));
        }
      }
    }

    violations.push(...routeViolations);
    routes.push(Object.freeze({
      route: descriptor.route,
      serverEntry: descriptor.serverEntry,
      clientChunks: Object.freeze(clientChunks),
    }));
  }

  return { status: "checked", routes, violations };
}

function readRscManifest(file, routeKey) {
  const source = readFileSync(file, "utf8");
  const assignment = `globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}]`;
  const assignmentIndex = source.indexOf(assignment);
  if (assignmentIndex < 0) return null;
  const objectStart = source.indexOf("{", assignmentIndex + assignment.length);
  if (objectStart < 0) throw new Error(`Missing ${routeKey} RSC manifest object.`);
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

function routeOwnedChunks(manifest, descriptor) {
  const entryFiles = manifest?.entryJSFiles;
  if (!entryFiles || typeof entryFiles !== "object" || Array.isArray(entryFiles)) {
    return { ok: false, detail: "The RSC manifest has no entryJSFiles object.", chunks: [] };
  }
  const layoutChunks = exactEntryChunks(entryFiles, descriptor.layoutEntry);
  const pageChunks = exactEntryChunks(entryFiles, descriptor.pageEntry);
  if (layoutChunks === null || pageChunks === null) {
    return {
      ok: false,
      detail: "The RSC manifest must contain real Mobile layout and page entry arrays.",
      chunks: [],
    };
  }
  const shared = new Set(layoutChunks);
  return {
    ok: true,
    detail: "",
    chunks: [...new Set(pageChunks.filter((chunk) => !shared.has(chunk)))].sort(),
  };
}

function exactEntryChunks(entryFiles, expectedEntry) {
  const matches = Object.entries(entryFiles).filter(([entry]) =>
    normalizeManifestModule(entry) === expectedEntry,
  );
  if (matches.length !== 1 || !Array.isArray(matches[0][1])) return null;
  const chunks = [];
  for (const value of matches[0][1]) {
    if (typeof value !== "string") return null;
    const normalized = normalizeChunk(value);
    if (normalized === null) return null;
    chunks.push(normalized);
  }
  return chunks;
}

function normalizeChunk(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/?_next\//, "").replace(/^\/+/, "");
  if (!normalized.startsWith("static/chunks/") || normalized.includes("..")) return null;
  return `.next/${normalized}`;
}

function crossDomainManifestViolations(manifest, descriptor) {
  const clientModules = manifest?.clientModules;
  if (!clientModules || typeof clientModules !== "object" || Array.isArray(clientModules)) {
    return [createViolation(
      "mobile-route-evidence-missing",
      descriptor.manifest,
      "The RSC manifest has no clientModules ownership evidence.",
      descriptor.routeKey,
    )];
  }
  const violations = [];
  for (const moduleKey of Object.keys(clientModules).sort()) {
    const evidence = clientModules[moduleKey];
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      !Array.isArray(evidence.chunks) ||
      evidence.chunks.some((chunk) => typeof chunk !== "string" || normalizeChunk(chunk) === null)
    ) {
      violations.push(createViolation(
        "mobile-route-evidence-missing",
        descriptor.manifest,
        "Each clientModules entry must provide a valid chunks array.",
        moduleKey,
      ));
    }
    const normalized = normalizeManifestModule(moduleKey);
    const owner = businessDomainForModule(normalized);
    if (owner !== null && owner !== descriptor.domain) {
      violations.push(createViolation(
        "mobile-route-cross-domain",
        descriptor.manifest,
        `The ${descriptor.domain} route owns a ${owner} business module.`,
        normalized,
      ));
    }
  }
  return violations;
}

function normalizeManifestModule(value) {
  return String(value)
    .replaceAll("\\", "/")
    .replace(/^\[project\]\/?/, "")
    .replace(/^\/+/, "")
    .replace(/\s+<module evaluation>$/, "")
    .replace(/\?.*$/, "")
    .replace(/\.(?:css|jsx?|mjs|mts|tsx?)$/, "");
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

function scriptKindFor(file, typescript) {
  if (file.endsWith(".tsx")) return typescript.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return typescript.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs")) return typescript.ScriptKind.JS;
  return typescript.ScriptKind.TS;
}

function createViolation(rule, file, detail, match) {
  return Object.freeze({ rule, file, detail, match: compact(String(match)) });
}

function dedupeViolations(violations) {
  const seen = new Set();
  return violations.filter((violation) => {
    const key = `${violation.file}\0${violation.rule}\0${violation.match}\0${violation.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareViolations(left, right) {
  return left.file.localeCompare(right.file) ||
    left.rule.localeCompare(right.rule) ||
    left.match.localeCompare(right.match) ||
    left.detail.localeCompare(right.detail);
}

function compact(value) {
  return value.replace(/\s+/g, " ").slice(0, 240);
}

function relativePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

function isWithin(root, file) {
  const fromRoot = relative(resolve(root), resolve(file));
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
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
  return "Usage: node scripts/check-mobile-boundaries.mjs [--root <webapp-root>]";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await checkMobileBoundaries({ root: options.root });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
