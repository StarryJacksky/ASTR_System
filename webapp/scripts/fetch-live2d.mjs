import { createHash } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const lockPath = join(projectRoot, "live2d-assets.lock.json");

function usage() {
  return [
    "Live2D asset preflight and content-addressed downloader",
    "",
    "  node scripts/fetch-live2d.mjs --check [--root <webapp-root>]",
    "  node scripts/fetch-live2d.mjs --download --accept-live2d-licenses [--root <webapp-root>]",
    "",
    "Downloading means you have reviewed and accepted all Live2D agreements and terms",
    "documented in docs/live2d-assets.md. Binary assets remain outside Git.",
  ].join("\n");
}

function parseArguments(argv) {
  let mode = "download";
  let root = projectRoot;
  let acceptsLicenses = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      mode = "check";
    } else if (argument === "--download") {
      mode = "download";
    } else if (argument === "--accept-live2d-licenses") {
      acceptsLicenses = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory path.");
      root = resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { mode, root, acceptsLicenses };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validateLock(lock) {
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.assets)) {
    throw new Error(`Unsupported Live2D asset lock at ${lockPath}.`);
  }
  if (!/^[a-f0-9]{40}$/.test(lock.modelSource?.commit ?? "")) {
    throw new Error("Live2D model source must use an immutable Git commit.");
  }
  if (lock.localRoot !== "public/live2d") {
    throw new Error("Live2D localRoot must remain confined to public/live2d.");
  }
  assertSafeAssetPath(lock.modelEntry);

  const paths = new Set();
  for (const asset of lock.assets) {
    assertSafeAssetPath(asset.path);
    if (paths.has(asset.path)) {
      throw new Error(`Duplicate Live2D asset path: ${asset.path}.`);
    }
    paths.add(asset.path);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
      throw new Error(`Invalid byte length for ${asset.path}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
      throw new Error(`Invalid SHA-256 for ${asset.path}.`);
    }
    if (typeof asset.url !== "string" || !asset.url.startsWith("https://")) {
      throw new Error(`Live2D asset URL must use HTTPS: ${asset.path}.`);
    }
    if (/\/(?:master|main|latest)\//.test(asset.url)) {
      throw new Error(`Floating Live2D asset URL is forbidden: ${asset.path}.`);
    }
    if (asset.kind === "core") {
      if (asset.url !== lock.coreSource?.url) {
        throw new Error(`Cubism Core URL differs from the reviewed source: ${asset.path}.`);
      }
    } else if (!asset.url.includes(lock.modelSource.commit)) {
      throw new Error(`Live2D model asset is not pinned to the reviewed commit: ${asset.path}.`);
    }
  }
  const modelAsset = lock.assets.find(
    (asset) => asset.kind === "model" && asset.path === lock.modelEntry,
  );
  if (!modelAsset) throw new Error("Live2D modelEntry is not a locked model asset.");
  for (const reference of lock.knownMissingOptionalReferences ?? []) {
    assertSafeAssetPath(reference.path);
    if (paths.has(reference.path)) {
      throw new Error(`A known-missing Live2D reference is also locked: ${reference.path}.`);
    }
  }
}

function assertSafeAssetPath(path) {
  if (
    typeof path !== "string" ||
    path.includes("\\") ||
    !/^(?:core|haru|shizuku)\/[A-Za-z0-9._/-]+$/.test(path) ||
    posix.normalize(path) !== path ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe Live2D asset path: ${String(path)}.`);
  }
}

function destinationFor(outputRoot, assetPath) {
  assertSafeAssetPath(assetPath);
  const destination = resolve(outputRoot, ...assetPath.split("/"));
  const fromRoot = relative(outputRoot, destination);
  if (fromRoot === "" || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error(`Live2D asset escapes output root: ${assetPath}.`);
  }
  return destination;
}

async function fingerprint(path) {
  try {
    const bytes = await readFile(path);
    return { bytes: bytes.byteLength, sha256: sha256(bytes) };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function inspect(lock, outputRoot, { quiet = false } = {}) {
  const failures = [];

  for (const asset of lock.assets) {
    const actual = await fingerprint(destinationFor(outputRoot, asset.path));
    if (!actual) {
      failures.push({ kind: "missing", path: asset.path });
      if (!quiet) console.error(`[missing] ${asset.path}`);
      continue;
    }

    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) {
      failures.push({ kind: "mismatch", path: asset.path });
      if (!quiet) {
        console.error(
          `[mismatch] ${asset.path} (bytes ${actual.bytes}/${asset.bytes}, sha256 ${actual.sha256}/${asset.sha256})`,
        );
      }
    } else if (!quiet) {
      console.log(`[verified] ${asset.path}`);
    }
  }

  return failures;
}

async function downloadAsset(asset, outputRoot) {
  const destination = destinationFor(outputRoot, asset.path);
  const existing = await fingerprint(destination);
  if (
    existing &&
    existing.bytes === asset.bytes &&
    existing.sha256 === asset.sha256
  ) {
    console.log(`[cached] ${asset.path}`);
    return;
  }

  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${asset.path}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new Error(
      `Integrity check failed for ${asset.path}: received ${bytes.byteLength} bytes / ${digest}.`,
    );
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.astr-${process.pid}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rm(destination, { force: true });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`[downloaded] ${asset.path}`);
}

async function validateDownloadedModelReferences(lock, outputRoot) {
  const source = await readFile(destinationFor(outputRoot, lock.modelEntry), "utf8");
  let model;
  try {
    model = JSON.parse(source);
  } catch {
    throw new Error(`Live2D model settings are not valid JSON: ${lock.modelEntry}.`);
  }
  const references = model && typeof model === "object" ? model.FileReferences : null;
  if (!references || typeof references !== "object" || Array.isArray(references)) {
    throw new Error(`Live2D model settings have no FileReferences: ${lock.modelEntry}.`);
  }

  const required = new Set();
  const optional = new Set();
  const invalid = [];
  const add = (target, value, label, isRequired = false) => {
    if (value === undefined || value === null) {
      if (isRequired) invalid.push(`${label}: missing`);
      return;
    }
    if (typeof value !== "string" || value.length === 0) {
      invalid.push(`${label}: expected non-empty string`);
      return;
    }
    const resolved = resolveModelReference(lock.modelEntry, value);
    if (resolved === null) invalid.push(value);
    else target.add(resolved);
  };

  add(required, references.Moc, "Moc", true);
  for (const key of ["Physics", "Pose", "UserData"]) {
    add(required, references[key], key);
  }
  if (!Array.isArray(references.Textures) || references.Textures.length === 0) {
    invalid.push("Textures: expected non-empty array");
  }
  for (const [index, texture] of (
    Array.isArray(references.Textures) ? references.Textures : []
  ).entries()) {
    add(required, texture, `Textures[${index}]`, true);
  }
  if (references.Expressions !== undefined && !Array.isArray(references.Expressions)) {
    invalid.push("Expressions: expected array");
  }
  for (const [index, expression] of (
    Array.isArray(references.Expressions) ? references.Expressions : []
  ).entries()) {
    if (expression && typeof expression === "object") {
      add(required, expression.File, `Expressions[${index}].File`, true);
    } else invalid.push(`Expressions[${index}]: expected object`);
  }
  if (references.Motions && typeof references.Motions === "object") {
    for (const [groupName, group] of Object.entries(references.Motions)) {
      if (!Array.isArray(group)) {
        invalid.push(`Motions.${groupName}: expected array`);
        continue;
      }
      for (const [index, motion] of group.entries()) {
        if (!motion || typeof motion !== "object") {
          invalid.push(`Motions.${groupName}[${index}]: expected object`);
          continue;
        }
        add(required, motion.File, `Motions.${groupName}[${index}].File`, true);
        add(required, motion.Sound, `Motions.${groupName}[${index}].Sound`);
      }
    }
  } else if (references.Motions !== undefined) {
    invalid.push("Motions: expected object");
  }
  add(optional, references.DisplayInfo, "DisplayInfo");

  if (invalid.length > 0) {
    throw new Error(`Live2D model contains unsafe references: ${invalid.join(", ")}.`);
  }
  const available = new Set(lock.assets.map((asset) => asset.path));
  const knownMissing = new Set(
    (lock.knownMissingOptionalReferences ?? []).map((reference) => reference.path),
  );
  const missingRequired = [...required].filter((path) => !available.has(path));
  const missingOptional = [...optional].filter(
    (path) => !available.has(path) && !knownMissing.has(path),
  );
  if (missingRequired.length > 0 || missingOptional.length > 0) {
    throw new Error(
      `Live2D model references unlocked assets: ${[
        ...missingRequired,
        ...missingOptional,
      ].join(", ")}.`,
    );
  }
}

function resolveModelReference(modelEntry, reference) {
  if (
    reference.includes("\\") ||
    reference.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
  ) {
    return null;
  }
  const resolved = posix.normalize(posix.join(posix.dirname(modelEntry), reference));
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    !/^(?:core|haru|shizuku)\/[A-Za-z0-9._/-]+$/.test(resolved)
  ) {
    return null;
  }
  return resolved;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  validateLock(lock);

  const outputRoot = join(options.root, ...lock.localRoot.split("/"));
  if (options.mode === "check") {
    const failures = await inspect(lock, outputRoot);
    if (failures.length > 0) {
      throw new Error(
        `Live2D preflight failed: ${failures.length} asset(s) are missing or mismatched.`,
      );
    }
    await validateDownloadedModelReferences(lock, outputRoot);
    console.log(`Live2D preflight passed: ${lock.assets.length} immutable assets verified.`);
    return;
  }

  if (!options.acceptsLicenses) {
    throw new Error(
      "Refusing to download without --accept-live2d-licenses. Read docs/live2d-assets.md first.",
    );
  }

  for (const asset of lock.assets) {
    await downloadAsset(asset, outputRoot);
  }

  const failures = await inspect(lock, outputRoot, { quiet: true });
  if (failures.length > 0) {
    throw new Error(`Post-download verification failed for ${failures.length} asset(s).`);
  }
  await validateDownloadedModelReferences(lock, outputRoot);
  console.log(`Live2D assets ready: ${lock.assets.length} immutable files verified.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
