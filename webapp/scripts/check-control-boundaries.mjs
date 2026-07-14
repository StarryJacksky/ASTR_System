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
const CONTROL_REGISTRY_SOURCE = "src/features/control/model/control-modules.ts";
const CONTROL_SOURCE_ROOTS = Object.freeze([
  "src/app/admin",
  "src/features/control",
]);
const EXPECTED_CONTROL_MODULES = Object.freeze([
  Object.freeze({ id: "dashboard", status: "planned" }),
  Object.freeze({ id: "platform-gateway", status: "planned" }),
  Object.freeze({ id: "model-router", status: "planned" }),
  Object.freeze({ id: "plugins-skills-mcp", status: "planned" }),
  Object.freeze({ id: "sessions-people", status: "planned" }),
  Object.freeze({ id: "schedule", status: "planned" }),
  Object.freeze({ id: "logs-trace", status: "planned" }),
  Object.freeze({ id: "settings", status: "planned" }),
  Object.freeze({ id: "resources-knowledge", status: "planned" }),
  Object.freeze({ id: "setup", status: "planned" }),
  Object.freeze({ id: "soul", status: "planned" }),
  Object.freeze({ id: "memory", status: "planned" }),
  Object.freeze({ id: "emotion", status: "planned" }),
  Object.freeze({ id: "moa-teaching", status: "planned" }),
  Object.freeze({ id: "training", status: "planned" }),
  Object.freeze({ id: "voice", status: "planned" }),
  Object.freeze({ id: "effector", status: "available" }),
  Object.freeze({ id: "migration", status: "planned" }),
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
const ADMIN_MANIFESTS = Object.freeze([
  Object.freeze({
    file: ".next/server/app/admin/page_client-reference-manifest.js",
    route: "/admin/page",
    entry: "src/app/admin/page",
  }),
  Object.freeze({
    file: ".next/server/app/admin/[module]/page_client-reference-manifest.js",
    route: "/admin/[module]/page",
    entry: "src/app/admin/[module]/page",
  }),
]);
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
const HEAVY_IMPORT_PATTERN = /(?:^|[/@.-])(?:pixi(?:\.js)?|live2d|soul[-_]lens)(?:$|[/@.-])/i;
const HEAVY_CHUNK_PATTERN = /pixi|live2d|soul[-_]lens|\.2048(?:[/\\.]|$)/i;
const RENDER_CHUNK_PATTERN = /\brequestAnimationFrame\b|(?:\.\s*getContext\b|\[\s*["']getContext["']\s*\])|\b(?:createElement|jsx|jsxs)\s*\(\s*["']canvas["']|\bTicker\s*\.\s*shared\b|\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)*Application\s*\(/i;
const VISUAL_RULES = Object.freeze([
  Object.freeze({
    rule: "control-visual-gradient",
    pattern: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi,
  }),
  Object.freeze({
    rule: "control-visual-animation",
    pattern: /\banimation(?:-[a-z-]+)?\s*:/gi,
  }),
  Object.freeze({
    rule: "control-visual-backdrop-filter",
    pattern: /\b(?:-webkit-)?backdrop-filter\s*:/gi,
  }),
]);

export async function checkControlBoundaries({ root = defaultProjectRoot } = {}) {
  const projectRoot = resolve(root);
  const typescript = await loadTypeScript();
  const findForbiddenGreenUsages = await loadNoGreenScanner(projectRoot, typescript);
  const boundaryEntryFiles = CONTROL_SOURCE_ROOTS
    .flatMap((sourceRoot) => listProductionSourceFiles(resolve(projectRoot, ...sourceRoot.split("/"))))
    .sort();
  const sourceGraph = collectControlSourceGraph(projectRoot, boundaryEntryFiles, typescript);
  const sourceFiles = sourceGraph.files;
  const violations = [...sourceGraph.violations];

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    const displayFile = relativePath(projectRoot, file);

    for (const usage of findForbiddenGreenUsages(source)) {
      violations.push(createViolation(
        "no-green-hardcode",
        displayFile,
        `Constitutional no-green scanner rejected ${usage}.`,
        usage,
      ));
    }

    for (const { rule, match } of forbiddenRendererUsages(source, file, typescript)) {
      violations.push(createViolation(
        rule,
        displayFile,
        "Control and Admin production source may not own rendering APIs.",
        match,
      ));
    }

    for (const { rule, pattern } of VISUAL_RULES) {
      for (const match of source.matchAll(pattern)) {
        violations.push(createViolation(
          rule,
          displayFile,
          "Control production source may not own gradients, CSS animation, or backdrop filters.",
          match[0],
        ));
      }
    }

    for (const specifier of importedModuleSpecifiers(source, file, typescript)) {
      if (!HEAVY_IMPORT_PATTERN.test(specifier)) continue;
      violations.push(createViolation(
        "control-heavy-visual-import",
        displayFile,
        "Control and Admin production source may not import Live2D, Pixi, or Soul Lens code.",
        specifier,
      ));
    }
  }

  const registry = inspectAvailableModules(projectRoot, typescript);
  violations.push(...registry.violations);
  const buildEvidence = inspectAdminBuildEvidence(projectRoot);
  violations.push(...buildEvidence.violations);
  violations.sort(compareViolations);

  return Object.freeze({
    schemaVersion: 1,
    check: "control-boundaries",
    passed: violations.length === 0,
    sourceFilesScanned: sourceFiles.length,
    availableModules: Object.freeze(registry.availableModules),
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
    const imported = await import(`${pathToFileURL(scannerPath).href}?control-boundary=1`);
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
      if (entry.name === "test" || entry.name === "__tests__") return [];
      return listProductionSourceFiles(file);
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) return [];
    if (/(?:^|\.)test\.|(?:^|\.)spec\.|\.d\.ts$/.test(entry.name)) return [];
    return [file];
  });
}

function importedModuleSpecifiers(source, file, typescript) {
  return importedModuleReferences(source, file, typescript)
    .flatMap(({ specifier }) => specifier === null ? [] : [specifier]);
}

function importedModuleReferences(source, file, typescript) {
  if (extname(file) === ".css") {
    return [
      ...source.matchAll(
        /@import\s+(?:url\(\s*)?(?:["']([^"']+)["']|([^"'\s;)]+))\s*\)?/gi,
      ),
    ].map((match) => ({ kind: "static", specifier: match[1] ?? match[2] }));
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
    if (
      typescript.isImportDeclaration(node) ||
      typescript.isExportDeclaration(node)
    ) {
      if (typeof node.moduleSpecifier?.text === "string") {
        references.push({ kind: "static", specifier: node.moduleSpecifier.text });
      }
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
      typescript.isIdentifier(node.expression) &&
      node.expression.text === "require"
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

function forbiddenRendererUsages(source, file, typescript) {
  if (extname(file).toLowerCase() === ".css") return [];
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKindFor(file, typescript),
  );
  const usages = [];
  const seen = new Set();
  const record = (rule, node) => {
    const key = rule + ":" + node.pos + ":" + node.end;
    if (seen.has(key)) return;
    seen.add(key);
    usages.push({ rule, match: node.getText(sourceFile) });
  };
  const visit = (node) => {
    if (typescript.isIdentifier(node) && node.text === "requestAnimationFrame") {
      record("control-render-request-animation-frame", node);
    }

    if (
      typescript.isPropertyAccessExpression(node) ||
      typescript.isElementAccessExpression(node)
    ) {
      const memberName = accessedMemberName(node, typescript);
      if (memberName === "requestAnimationFrame") {
        record("control-render-request-animation-frame", node);
      }
      if (memberName === "getContext") {
        record("control-render-get-context", node);
      }
      if (
        memberName === "shared" &&
        accessedMemberName(node.expression, typescript) === "Ticker"
      ) {
        record("control-render-shared-ticker", node);
      }
    }

    if (
      (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile).toLowerCase() === "canvas"
    ) {
      record("control-render-canvas", node);
    }

    if (typescript.isCallExpression(node)) {
      const calledName = accessedMemberName(node.expression, typescript);
      const firstArgument = node.arguments[0];
      if (
        calledName === "createElement" &&
        firstArgument &&
        typescript.isStringLiteralLike(firstArgument) &&
        firstArgument.text.toLowerCase() === "canvas"
      ) {
        record("control-render-canvas", node);
      }
    }

    if (
      typescript.isNewExpression(node) &&
      accessedMemberName(node.expression, typescript) === "Application"
    ) {
      record("control-render-application", node);
    }

    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return usages;
}

function accessedMemberName(expression, typescript) {
  if (typescript.isIdentifier(expression)) return expression.text;
  if (typescript.isPropertyAccessExpression(expression)) return expression.name.text;
  if (typescript.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    return argument && typescript.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
}

function collectControlSourceGraph(projectRoot, entryFiles, typescript) {
  const pending = [...entryFiles];
  const visited = new Set();
  const violations = [];

  while (pending.length > 0) {
    const file = resolve(pending.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");

    for (const reference of importedModuleReferences(source, file, typescript)) {
      if (reference.specifier === null) {
        violations.push(createViolation(
          "control-dynamic-import-nonliteral",
          relativePath(projectRoot, file),
          "Control's transitive source graph may not use computed import or require targets.",
          reference.kind,
        ));
        continue;
      }
      if (!isLocalModuleSpecifier(reference.specifier)) continue;
      const dependency = resolveLocalSourceModule(projectRoot, file, reference.specifier);
      if (dependency === null) {
        violations.push(createViolation(
          "control-local-import-unresolved",
          relativePath(projectRoot, file),
          "A local Control dependency could not be resolved for boundary inspection.",
          reference.specifier,
        ));
        continue;
      }
      if (!isWithin(projectRoot, dependency)) {
        violations.push(createViolation(
          "control-local-import-outside-project",
          relativePath(projectRoot, file),
          "A local Control dependency resolves outside the project boundary.",
          reference.specifier,
        ));
        continue;
      }
      const dependencyExtension = extname(dependency).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(dependencyExtension)) {
        violations.push(createViolation(
          "control-local-import-unscannable",
          relativePath(projectRoot, file),
          "A resolved local Control dependency has an unsupported source extension.",
          reference.specifier,
        ));
        continue;
      }
      pending.push(dependency);
    }
  }

  return {
    files: [...visited].sort(),
    violations,
  };
}

function isLocalModuleSpecifier(specifier) {
  return specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("@/");
}

function resolveLocalSourceModule(projectRoot, importer, rawSpecifier) {
  const specifier = rawSpecifier.replace(/[?#].*$/, "");
  const unresolved = specifier.startsWith("@/")
    ? resolve(projectRoot, "src", specifier.slice(2))
    : resolve(dirname(importer), specifier);
  const candidates = [unresolved];
  if (extname(unresolved) === "") {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${unresolved}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(resolve(unresolved, `index${extension}`));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
  }
  return null;
}

function inspectAvailableModules(projectRoot, typescript) {
  const registryPath = resolve(projectRoot, ...CONTROL_REGISTRY_SOURCE.split("/"));
  if (!existsSync(registryPath)) {
    return {
      availableModules: [],
      violations: [createViolation(
        "control-available-modules",
        CONTROL_REGISTRY_SOURCE,
        "The Control registry is missing; only Effector may be available.",
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
  let moduleArray;
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) !== "modules" || !declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer, typescript);
      if (typescript.isArrayLiteralExpression(initializer)) moduleArray = initializer;
    }
  }

  const modules = [];
  const violations = [];
  if (moduleArray) {
    for (const element of moduleArray.elements) {
      const candidate = unwrapModuleDefinition(element, typescript);
      if (candidate === null) {
        violations.push(createViolation(
          "control-module-registry-shape",
          CONTROL_REGISTRY_SOURCE,
          "Every Control module must be an inspectable object or defineControlModule(object).",
          element.getText(sourceFile),
        ));
        continue;
      }
      const id = stringProperty(candidate, "id", typescript);
      const href = stringProperty(candidate, "href", typescript);
      const status = stringProperty(candidate, "status", typescript);
      if (id === null || href === null || status === null) {
        violations.push(createViolation(
          "control-module-registry-shape",
          CONTROL_REGISTRY_SOURCE,
          "Every Control module requires literal id, href, and status fields.",
          element.getText(sourceFile),
        ));
        continue;
      }
      modules.push({ id, href, status });
    }
  } else {
    violations.push(createViolation(
      "control-module-registry-shape",
      CONTROL_REGISTRY_SOURCE,
      "The Control registry must declare a literal modules array.",
      "missing modules array",
    ));
  }

  const moduleIds = modules.map(({ id }) => id);
  const duplicateIds = [...new Set(moduleIds.filter((id, index) => moduleIds.indexOf(id) !== index))]
    .sort();
  if (duplicateIds.length > 0) {
    violations.push(createViolation(
      "control-module-registry-duplicate",
      CONTROL_REGISTRY_SOURCE,
      "Control module IDs must be unique.",
      duplicateIds.join(", "),
    ));
  }

  const expectedIds = EXPECTED_CONTROL_MODULES.map(({ id }) => id).sort();
  const actualIds = [...new Set(moduleIds)].sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    violations.push(createViolation(
      "control-module-registry-membership",
      CONTROL_REGISTRY_SOURCE,
      "The Control registry must expose the exact 18 approved route IDs.",
      actualIds.length > 0 ? actualIds.join(", ") : "none",
    ));
  }

  const expectedStatusById = new Map(
    EXPECTED_CONTROL_MODULES.map(({ id, status }) => [id, status]),
  );
  for (const moduleDefinition of modules) {
    const expectedStatus = expectedStatusById.get(moduleDefinition.id);
    if (expectedStatus !== undefined && moduleDefinition.status !== expectedStatus) {
      violations.push(createViolation(
        "control-module-registry-status",
        CONTROL_REGISTRY_SOURCE,
        "Exactly 17 modules must remain planned and only Effector may be available.",
        `${moduleDefinition.id}: ${moduleDefinition.status}`,
      ));
    }
    if (moduleDefinition.href !== `/admin/${moduleDefinition.id}`) {
      violations.push(createViolation(
        "control-module-registry-route",
        CONTROL_REGISTRY_SOURCE,
        "Every Control route must be the canonical /admin/{id} path.",
        `${moduleDefinition.id}: ${moduleDefinition.href}`,
      ));
    }
  }

  const availableModules = modules
    .filter(({ status }) => status === "available")
    .map(({ id }) => id);
  availableModules.sort();
  const valid = availableModules.length === 1 && availableModules[0] === "effector";
  if (!valid) {
    violations.push(createViolation(
      "control-available-modules",
      CONTROL_REGISTRY_SOURCE,
      "The Control registry must expose exactly Effector as available.",
      availableModules.length > 0 ? availableModules.join(", ") : "none",
    ));
  }
  return {
    availableModules,
    violations,
  };
}

function unwrapModuleDefinition(expression, typescript) {
  const candidate = unwrapExpression(expression, typescript);
  if (typescript.isObjectLiteralExpression(candidate)) return candidate;
  if (
    !typescript.isCallExpression(candidate) ||
    !typescript.isIdentifier(candidate.expression) ||
    candidate.expression.text !== "defineControlModule" ||
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

function inspectAdminBuildEvidence(projectRoot) {
  const buildStampPath = resolve(projectRoot, ".next/astr-e2e-build.json");
  const buildIdPath = resolve(projectRoot, ".next/BUILD_ID");
  const requiredPaths = [
    buildStampPath,
    buildIdPath,
    ...ADMIN_MANIFESTS.map(({ file }) => resolve(projectRoot, ...file.split("/"))),
  ];
  const missing = requiredPaths.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    return {
      status: "missing",
      chunks: [],
      violations: [createViolation(
        "admin-chunk-build-evidence-missing",
        relativePath(projectRoot, missing[0]),
        "Stamped Admin production build evidence is required.",
        missing.map((file) => relativePath(projectRoot, file)).join(", "),
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
      chunks: [],
      violations: [createViolation(
        "admin-chunk-build-evidence-stale",
        relativePath(projectRoot, buildStampPath),
        error instanceof Error ? error.message : String(error),
        "astr-e2e-build.json",
      )],
    };
  }

  const chunks = new Set();
  const violations = [];
  for (const manifestDescriptor of ADMIN_MANIFESTS) {
    const manifestPath = resolve(projectRoot, ...manifestDescriptor.file.split("/"));
    let manifest;
    try {
      manifest = readRscManifest(manifestPath, manifestDescriptor.route);
    } catch (error) {
      violations.push(createViolation(
        "admin-chunk-manifest-invalid",
        manifestDescriptor.file,
        error instanceof Error ? error.message : String(error),
        manifestDescriptor.route,
      ));
      continue;
    }

    const routeChunks = chunksForEntry(manifest, manifestDescriptor.entry);
    if (routeChunks.length === 0) {
      violations.push(createViolation(
        "admin-chunk-entry-missing",
        manifestDescriptor.file,
        `The built RSC manifest has no JavaScript chunks for ${manifestDescriptor.entry}.`,
        manifestDescriptor.entry,
      ));
    }
    for (const chunk of routeChunks) chunks.add(chunk);
  }

  const sortedChunks = [...chunks].sort();
  for (const displayFile of sortedChunks) {
    const file = resolve(projectRoot, ...displayFile.split("/"));
    if (!isWithin(projectRoot, file) || !existsSync(file)) {
      violations.push(createViolation(
        "admin-chunk-missing",
        displayFile,
        "The Admin build manifest references a missing chunk.",
        displayFile,
      ));
      continue;
    }
    const source = readFileSync(file, "utf8");
    const match = source.match(HEAVY_CHUNK_PATTERN);
    if (match) {
      violations.push(createViolation(
        "admin-chunk-heavy-visual",
        displayFile,
        "An Admin production chunk contains Pixi, Live2D, Soul Lens, or 2048 texture bytes.",
        match[0],
      ));
    }
    const rendererMatch = source.match(RENDER_CHUNK_PATTERN);
    if (rendererMatch) {
      violations.push(createViolation(
        "admin-chunk-renderer-api",
        displayFile,
        "An Admin production chunk contains a forbidden renderer API.",
        rendererMatch[0],
      ));
    }
  }

  return { status: "checked", chunks: sortedChunks, violations };
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
  if (!entryFiles || typeof entryFiles !== "object") return [];
  return [...new Set(Object.entries(entryFiles)
    .filter(([entry]) => entry.replace("[project]", "").replace(/^\/+/, "") === expectedEntry)
    .flatMap(([, files]) => Array.isArray(files) ? files : [])
    .filter((chunk) => typeof chunk === "string")
    .map((chunk) => chunk.replace(/^\/?_next\//, ""))
    .map((chunk) => `.next/${chunk.replace(/^\/+/, "")}`))]
    .sort();
}

function hashBuildInputs(projectRoot) {
  const hash = createHash("sha256");
  for (const relativePath of BUILD_FINGERPRINT_INPUTS) {
    appendBuildInput(hash, projectRoot, relativePath);
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
  return "Usage: node scripts/check-control-boundaries.mjs [--root <webapp-root>]";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await checkControlBoundaries({ root: options.root });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
