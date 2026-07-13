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
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");
const NO_GREEN_RULE_SOURCE = "src/test/no-green-scanner.ts";
const INITIAL_ROUTE_ENTRY = "src/app/page.tsx";

export const VISUAL_API_ALLOWLIST = Object.freeze([
  "src/features/presence/visual/presence-visual-runtime.ts",
]);

const visualApiRules = Object.freeze([
  {
    rule: "visual-api-request-animation-frame",
    pattern: /\brequestAnimationFrame\s*\(/g,
  },
  {
    rule: "visual-api-get-context",
    pattern: /\.\s*getContext\s*\(/g,
  },
  {
    rule: "visual-api-application-construction",
    pattern: /\bnew\s+(?:(?:PIXI|pixi)\s*\.\s*)?(?:[A-Za-z_$][\w$]*\s*\.\s*)?Application\s*\(/g,
  },
  {
    rule: "visual-api-independent-ticker",
    pattern: /\bnew\s+(?:(?:PIXI|pixi)\s*\.\s*)?(?:[A-Za-z_$][\w$]*\s*\.\s*)?Ticker\s*\(/g,
  },
  {
    rule: "visual-api-shared-ticker",
    pattern: /\bTicker\s*\.\s*shared\b/g,
  },
  {
    rule: "visual-api-register-ticker",
    pattern: /\.\s*registerTicker\s*\(/g,
  },
]);

const HEAVY_IMPORT_PATTERN = /^(?:pixi(?:\.js)?|pixi-live2d-display(?:-lipsyncpatch)?(?:\/.*)?|@pixi\/)|(?:^|\/)(?:live2d-assets|live2d-adapter|visual-scene|soul-lens-pass|pixi-runtime-loader)(?:\.[^/]*)?$|live2d-assets\.lock\.json$/i;
const HEAVY_BYTE_PATTERNS = Object.freeze([
  /pixi-live2d-display(?:-lipsyncpatch)?/i,
  /haru_greeter_t03\.2048/i,
  /live2d-assets\.lock\.json/i,
  /LIVE2D_ASSET_LOCK/,
  /verifyLive2DAssetInventory/,
  /live2dcubismcore\.min\.js/i,
]);
const REMOTE_CAPABILITY_PATTERN = /\b(?:task|tasks|artifact|artifacts|approval|approvals|device|devices|provenance)\b/i;
const REMOTE_UNAVAILABLE_EVIDENCE_PATTERN = /\b(?:not\s+(?:enabled|available|provided)|unavailable)\b|(?:尚未启用|未启用|不可用|未提供|能力边界)/i;
const BUILD_FINGERPRINT_INPUTS = Object.freeze([
  "src",
  "public",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "postcss.config.mjs",
  "tsconfig.json",
]);
const CORE_ENDPOINT_ALLOWLIST = Object.freeze([
  /^\/v1\/status$/,
  /^\/v1\/ingest$/,
  /^\/v1\/stream$/,
  /^\/v1\/voice\/transcribe$/,
  /^\/v1\/voiceprint\/status$/,
  /^\/v1\/voiceprint\/enroll$/,
  /^\/v1\/effector\/status$/,
  /^\/v1\/effector\/estop$/,
  /^\/v1\/effector\/estop\/reset$/,
]);
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const RESOLUTION_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".css", ".json"];

export async function checkPresenceBoundaries({ root = defaultProjectRoot } = {}) {
  const projectRoot = resolve(root);
  const typescript = await loadTypeScript();
  const findForbiddenGreenUsages = await loadNoGreenScanner(projectRoot, typescript);
  const sourceFiles = listProductionSourceFiles(join(projectRoot, "src"));
  const violations = [];

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

    if (!VISUAL_API_ALLOWLIST.includes(displayFile)) {
      for (const { rule, pattern } of visualApiRules) {
        for (const match of source.matchAll(pattern)) {
          violations.push(createViolation(
            rule,
            displayFile,
            "Forbidden visual ownership API appears outside the sole Presence runtime allowlist.",
            match[0],
          ));
        }
      }
    }

    if (isPresenceProductionFile(displayFile)) {
      violations.push(...findInventedRemoteCapabilities(source, displayFile, typescript));
    }
  }

  const initialRoute = inspectInitialRoute(projectRoot, typescript);
  violations.push(...initialRoute.violations);
  const buildEvidence = inspectBuiltInitialChunks(projectRoot);
  violations.push(...buildEvidence.violations);
  violations.sort(compareViolations);

  return Object.freeze({
    schemaVersion: 1,
    check: "presence-boundaries",
    passed: violations.length === 0,
    root: projectRoot,
    noGreenRuleSource: NO_GREEN_RULE_SOURCE,
    visualApiAllowlist: VISUAL_API_ALLOWLIST,
    sourceFilesScanned: sourceFiles.length,
    initialRouteModules: initialRoute.modules,
    buildEvidence: Object.freeze({
      status: buildEvidence.status,
      chunks: buildEvidence.chunks,
    }),
    violations,
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
    const imported = await import(`${pathToFileURL(scannerPath).href}?presence-boundary=1`);
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
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__") return [];
      return listProductionSourceFiles(path);
    }
    if (!entry.isFile()) return [];
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) return [];
    if (/(?:^|\.)test\.|(?:^|\.)spec\.|\.d\.ts$/.test(entry.name)) return [];
    return [path];
  }).sort();
}

function inspectInitialRoute(projectRoot, typescript) {
  const entry = resolve(projectRoot, ...INITIAL_ROUTE_ENTRY.split("/"));
  const modules = [];
  const violations = [];
  const visited = new Set();
  const queue = [entry];

  if (!existsSync(entry)) {
    return {
      modules,
      violations: [createViolation(
        "initial-route-entry-missing",
        INITIAL_ROUTE_ENTRY,
        "Presence production entry is missing.",
        INITIAL_ROUTE_ENTRY,
      )],
    };
  }

  while (queue.length > 0) {
    const file = queue.shift();
    const canonical = resolve(file);
    if (visited.has(canonical)) continue;
    visited.add(canonical);
    const displayFile = relativePath(projectRoot, canonical);
    modules.push(displayFile);
    const source = readFileSync(canonical, "utf8");

    for (const pattern of HEAVY_BYTE_PATTERNS) {
      const match = source.match(pattern);
      if (match) {
        violations.push(createViolation(
          "initial-route-heavy-bytes",
          displayFile,
          "The statically reachable initial route contains a Live2D/Pixi asset lock, verifier, or heavy asset path.",
          match[0],
        ));
      }
    }

    for (const specifier of staticImportSpecifiers(source, canonical, typescript)) {
      if (HEAVY_IMPORT_PATTERN.test(specifier)) {
        violations.push(createViolation(
          "initial-route-heavy-import",
          displayFile,
          "The production initial route statically imports a heavy Live2D/Pixi boundary.",
          specifier,
        ));
      }
      const resolvedImport = resolveProjectImport(projectRoot, canonical, specifier);
      if (resolvedImport !== null) queue.push(resolvedImport);
    }
  }

  modules.sort();
  return { modules, violations };
}

function staticImportSpecifiers(source, file, typescript) {
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKindFor(file, typescript),
  );
  const specifiers = [];

  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement)) {
      if (isTypeOnlyImport(statement.importClause, typescript)) continue;
      const value = statement.moduleSpecifier?.text;
      if (typeof value === "string") specifiers.push(value);
    } else if (
      typescript.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      typeof statement.moduleSpecifier?.text === "string"
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function isTypeOnlyImport(importClause, typescript) {
  if (importClause?.isTypeOnly) return true;
  if (!importClause || importClause.name || !importClause.namedBindings) return false;
  return typescript.isNamedImports(importClause.namedBindings) &&
    importClause.namedBindings.elements.length > 0 &&
    importClause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function scriptKindFor(file, typescript) {
  if (file.endsWith(".tsx")) return typescript.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return typescript.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs")) return typescript.ScriptKind.JS;
  if (file.endsWith(".json")) return typescript.ScriptKind.JSON;
  return typescript.ScriptKind.TS;
}

function resolveProjectImport(projectRoot, importer, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = resolve(projectRoot, "src", ...specifier.slice(2).split("/"));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(importer), specifier);
  } else {
    return null;
  }

  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (isFile(candidate) && isWithin(projectRoot, candidate)) return candidate;
  }
  for (const extension of RESOLUTION_EXTENSIONS.slice(1)) {
    const candidate = join(base, `index${extension}`);
    if (isFile(candidate) && isWithin(projectRoot, candidate)) return candidate;
  }
  return null;
}

function inspectBuiltInitialChunks(projectRoot) {
  const manifestPath = resolve(
    projectRoot,
    ".next/server/app/page_client-reference-manifest.js",
  );
  const buildStampPath = resolve(projectRoot, ".next/astr-e2e-build.json");
  const buildIdPath = resolve(projectRoot, ".next/BUILD_ID");
  if (
    !existsSync(manifestPath) ||
    !existsSync(buildStampPath) ||
    !existsSync(buildIdPath)
  ) {
    const missing = [manifestPath, buildStampPath, buildIdPath]
      .filter((path) => !existsSync(path))
      .map((path) => relativePath(projectRoot, path));
    return {
      status: "missing",
      chunks: [],
      violations: [createViolation(
        "initial-chunk-build-evidence-missing",
        missing[0] ?? ".next",
        "Built initial-route evidence is required before the boundary command can pass.",
        missing.join(", "),
      )],
    };
  }

  let buildStamp;
  try {
    buildStamp = JSON.parse(readFileSync(buildStampPath, "utf8"));
    const buildId = readFileSync(buildIdPath, "utf8").trim();
    if (
      buildStamp?.version !== 1 ||
      typeof buildStamp.buildId !== "string" ||
      buildStamp.buildId !== buildId ||
      typeof buildStamp.sourceHash !== "string" ||
      buildStamp.sourceHash !== hashBuildInputs(projectRoot)
    ) {
      throw new Error("The build identity does not match the current source fingerprint.");
    }
  } catch (error) {
    return {
      status: "stale",
      chunks: [],
      violations: [createViolation(
        "initial-chunk-build-evidence-stale",
        relativePath(projectRoot, buildStampPath),
        error instanceof Error ? error.message : String(error),
        "astr-e2e-build.json",
      )],
    };
  }

  let manifest;
  try {
    const source = readFileSync(manifestPath, "utf8");
    const match = source.match(/globalThis\.__RSC_MANIFEST\["\/page"\]\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!match) throw new Error("Missing /page RSC manifest assignment.");
    manifest = JSON.parse(match[1]);
  } catch (error) {
    return {
      status: "checked",
      chunks: [],
      violations: [createViolation(
        "initial-chunk-manifest-invalid",
        relativePath(projectRoot, manifestPath),
        error instanceof Error ? error.message : String(error),
        "page_client-reference-manifest.js",
      )],
    };
  }

  const entryFiles = manifest?.entryJSFiles;
  const rawChunks = entryFiles && typeof entryFiles === "object"
    ? Object.entries(entryFiles)
      .filter(([entry]) => /(?:^|\/)src\/app\/page$/.test(entry.replace("[project]", "")))
      .flatMap(([, files]) => Array.isArray(files) ? files : [])
    : [];
  const chunks = [...new Set(rawChunks)]
    .filter((chunk) => typeof chunk === "string")
    .map((chunk) => chunk.replace(/^\/?_next\//, ""))
    .map((chunk) => `.next/${chunk.replace(/^\/+/, "")}`)
    .sort();
  const violations = [];

  if (chunks.length === 0) {
    violations.push(createViolation(
      "initial-chunk-entry-missing",
      relativePath(projectRoot, manifestPath),
      "The built RSC manifest does not provide any JavaScript chunks for src/app/page.",
      "src/app/page",
    ));
  }

  for (const displayFile of chunks) {
    const file = resolve(projectRoot, ...displayFile.split("/"));
    if (!isWithin(projectRoot, file) || !existsSync(file)) {
      violations.push(createViolation(
        "initial-chunk-missing",
        displayFile,
        "The built initial-route manifest references a missing chunk.",
        displayFile,
      ));
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const pattern of HEAVY_BYTE_PATTERNS) {
      const match = source.match(pattern);
      if (match) {
        violations.push(createViolation(
          "initial-chunk-heavy-asset",
          displayFile,
          "A built production initial-route chunk contains Live2D/Pixi heavy asset, lock, or verifier bytes.",
          match[0],
        ));
      }
    }
  }

  return { status: "checked", chunks, violations };
}

function hashBuildInputs(projectRoot) {
  const hash = createHash("sha256");
  for (const relativePath of BUILD_FINGERPRINT_INPUTS) {
    appendBuildInput(hash, projectRoot, relativePath);
  }
  return hash.digest("hex");
}

function appendBuildInput(hash, projectRoot, relativePath) {
  const absolutePath = resolve(projectRoot, ...relativePath.split("/"));
  if (statSync(absolutePath).isFile()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    return;
  }
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  if (!Array.isArray(entries)) throw new TypeError("Expected build input directory entries.");
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) appendBuildInput(hash, projectRoot, childPath);
    else {
      hash.update(childPath);
      hash.update("\0");
      hash.update(readFileSync(resolve(projectRoot, ...childPath.split("/"))));
    }
  }
}

function findInventedRemoteCapabilities(source, file, typescript) {
  const violations = [];
  const sourceFile = typescript.createSourceFile(
    file,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKindFor(file, typescript),
  );

  const visit = (node) => {
    if (
      typescript.isStringLiteral(node) ||
      typescript.isNoSubstitutionTemplateLiteral(node)
    ) {
      const endpoint = unprovidedCoreEndpoint(node.text);
      if (endpoint !== null) {
        violations.push(createViolation(
          "invented-remote-capability",
          file,
          "Presence references a remote endpoint outside the current Core allowlist.",
          endpoint,
        ));
      }
    }

    if (typescript.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/^(?:fetch|EventSource|WebSocket)$/.test(callee)) {
        const call = node.getText(sourceFile);
        if (REMOTE_CAPABILITY_PATTERN.test(call)) {
          violations.push(createViolation(
            "invented-remote-capability",
            file,
            "Presence may not call an unprovided Task/artifact/approval/device/provenance remote capability.",
            compact(call),
          ));
        }
      }
    }

    if (typescript.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(sourceFile);
      const element = node.getText(sourceFile);
      if (REMOTE_CAPABILITY_PATTERN.test(element)) {
        if (/^(?:button|a|Link|form)$/.test(tag)) {
          violations.push(createViolation(
            "invented-remote-capability",
            file,
            "Presence exposes an interactive remote capability that the current Core does not provide.",
            compact(element),
          ));
        } else if (
          !REMOTE_UNAVAILABLE_EVIDENCE_PATTERN.test(element) &&
          !nearestJsxAncestorProvidesUnavailableEvidence(node, sourceFile, typescript)
        ) {
          violations.push(createViolation(
            "invented-remote-capability",
            file,
            "Presence claims remote capability state without unavailable or unprovided evidence.",
            compact(element),
          ));
        }
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function unprovidedCoreEndpoint(value) {
  const versionedMatch = value.match(/\/v1\/[A-Za-z0-9_./-]+/);
  if (versionedMatch) {
    const endpoint = versionedMatch[0].replace(/\/+$/, "");
    return CORE_ENDPOINT_ALLOWLIST.some((pattern) => pattern.test(endpoint))
      ? null
      : endpoint;
  }
  const apiMatch = value.match(/\/api\/[A-Za-z0-9_./-]+/);
  if (apiMatch && REMOTE_CAPABILITY_PATTERN.test(apiMatch[0])) return apiMatch[0];
  return null;
}

function nearestJsxAncestorProvidesUnavailableEvidence(node, sourceFile, typescript) {
  let parent = node.parent;
  while (parent && !typescript.isSourceFile(parent)) {
    if (typescript.isJsxElement(parent)) {
      const source = parent.getText(sourceFile);
      return REMOTE_CAPABILITY_PATTERN.test(source) &&
        REMOTE_UNAVAILABLE_EVIDENCE_PATTERN.test(source);
    }
    parent = parent.parent;
  }
  return false;
}

function isPresenceProductionFile(file) {
  return file === INITIAL_ROUTE_ENTRY || file.startsWith("src/features/presence/");
}

function compact(value) {
  return value.replace(/\s+/g, " ").slice(0, 240);
}

function createViolation(rule, file, detail, match) {
  return Object.freeze({ rule, file, detail, match: compact(String(match)) });
}

function compareViolations(left, right) {
  return left.file.localeCompare(right.file) ||
    left.rule.localeCompare(right.rule) ||
    left.match.localeCompare(right.match);
}

function relativePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

function isWithin(root, file) {
  const fromRoot = relative(resolve(root), resolve(file));
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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
  return "Usage: node scripts/check-presence-boundaries.mjs [--root <webapp-root>]";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await checkPresenceBoundaries({ root: options.root });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
