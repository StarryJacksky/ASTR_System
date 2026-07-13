import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");
const LOCK_SOURCE = "live2d-assets.lock.json";
const VERIFIER_SOURCE = "scripts/fetch-live2d.mjs";
const STATIC_FALLBACK_SOURCE = "src/features/presence/components/StaticSoulLens.tsx";

export function checkPresenceAssets({
  root = defaultProjectRoot,
  requireDynamic = false,
} = {}) {
  const projectRoot = resolve(root);
  const lockPath = resolve(projectRoot, LOCK_SOURCE);
  const verifierPath = resolve(projectRoot, VERIFIER_SOURCE);
  const fallbackPath = resolve(projectRoot, STATIC_FALLBACK_SOURCE);
  const lockResult = readLock(lockPath);
  const verifierResult = runVerifier(verifierPath, projectRoot);
  const outcomes = parseVerifierOutcomes(verifierResult.output, lockResult.lock);
  const outcomePaths = new Set(outcomes.map(({ path }) => path));
  const expectedAssetCount = lockResult.lock?.assets.length ?? 0;
  const outputComplete = lockResult.valid &&
    outcomePaths.size === expectedAssetCount;
  const verifierExecuted = verifierResult.error === null &&
    verifierResult.exitCode !== null;
  const reportValid = lockResult.valid && verifierExecuted && outputComplete;
  const findings = outcomes
    .filter(({ kind }) => kind !== "verified")
    .map(({ kind, path, assetKind, detail }) => Object.freeze({
      kind,
      path,
      assetKind,
      detail,
    }));
  const verifierPassed = verifierResult.exitCode === 0;
  const dynamicCertified = reportValid &&
    verifierPassed &&
    findings.length === 0 &&
    outcomes.filter(({ kind }) => kind === "verified").length === expectedAssetCount;
  const staticFallbackAvailable = existsSync(fallbackPath);
  const passed = reportValid &&
    staticFallbackAvailable &&
    (!requireDynamic || dynamicCertified);

  return Object.freeze({
    schemaVersion: 1,
    check: "presence-assets",
    passed,
    dynamicCertified,
    staticFallbackAvailable,
    policy: Object.freeze({
      mode: requireDynamic ? "require-dynamic" : "fallback-capable",
      dynamicRequired: requireDynamic,
      explanation: requireDynamic
        ? "Dynamic Presence is required; any lock/verifier failure makes this command fail."
        : "The static fallback is the delivery gate. Dynamic certification remains false until every locked byte passes the existing verifier; use --require-dynamic to make that condition fail the command.",
    }),
    authoritativeSources: Object.freeze({
      lock: LOCK_SOURCE,
      verifier: `${VERIFIER_SOURCE} --check`,
    }),
    lock: Object.freeze({
      valid: lockResult.valid,
      schemaVersion: lockResult.lock?.schemaVersion ?? null,
      modelEntry: lockResult.lock?.modelEntry ?? null,
      assetCount: expectedAssetCount,
      error: lockResult.error,
    }),
    verifier: Object.freeze({
      command: `node ${VERIFIER_SOURCE} --check --root <webapp-root>`,
      exitCode: verifierResult.exitCode,
      passed: verifierPassed,
      reportComplete: outputComplete,
      error: verifierResult.error,
    }),
    inventory: Object.freeze({
      verifiedCount: outcomes.filter(({ kind }) => kind === "verified").length,
      missingCount: findings.filter(({ kind }) => kind === "missing").length,
      mismatchCount: findings.filter(({ kind }) => kind === "mismatch").length,
    }),
    findings,
  });
}

function readLock(lockPath) {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (
      lock?.schemaVersion !== 1 ||
      typeof lock.modelEntry !== "string" ||
      !Array.isArray(lock.assets) ||
      lock.assets.some((asset) =>
        !asset ||
        typeof asset.path !== "string" ||
        typeof asset.kind !== "string" ||
        typeof asset.sha256 !== "string" ||
        !Number.isSafeInteger(asset.bytes)
      )
    ) {
      throw new Error("Unsupported or malformed Live2D asset lock.");
    }
    return { valid: true, lock, error: null };
  } catch (error) {
    return {
      valid: false,
      lock: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runVerifier(verifierPath, projectRoot) {
  if (!existsSync(verifierPath)) {
    return {
      exitCode: null,
      output: "",
      error: `Missing authoritative verifier: ${VERIFIER_SOURCE}.`,
    };
  }
  const result = spawnSync(
    process.execPath,
    [verifierPath, "--check", "--root", projectRoot],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return {
    exitCode: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    error: result.error?.message ?? null,
  };
}

function parseVerifierOutcomes(output, lock) {
  const assetsByPath = new Map(
    (lock?.assets ?? []).map((asset) => [asset.path, asset]),
  );
  const outcomes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[(verified|missing|mismatch)\]\s+(\S+)(?:\s+(.+))?$/);
    if (!match) continue;
    const [, kind, path, detail = ""] = match;
    if (!assetsByPath.has(path) || outcomes.has(path)) continue;
    outcomes.set(path, Object.freeze({
      kind,
      path,
      assetKind: assetsByPath.get(path).kind,
      detail,
    }));
  }
  return [...outcomes.values()];
}

function parseArguments(argv) {
  let root = defaultProjectRoot;
  let requireDynamic = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory path.");
      root = resolve(value);
      index += 1;
    } else if (argument === "--require-dynamic") {
      requireDynamic = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true, root, requireDynamic };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { help: false, root, requireDynamic };
}

function usage() {
  return [
    "Usage: node scripts/check-presence-assets.mjs [--root <webapp-root>] [--require-dynamic]",
    "",
    "Default: require a usable static fallback and emit truthful dynamic certification evidence.",
    "--require-dynamic: also fail unless the existing Live2D lock verifier certifies every asset.",
  ].join("\n");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = checkPresenceAssets(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
