import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { shutdownProcessTree } from "./e2e-process-supervisor.mjs";
import { matchesBuildStamp } from "./e2e-build-stamp.mjs";

const webappRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(webappRoot, "..", "..");
const coreMode = process.env.ASTR_E2E_CORE_MODE === "real" ? "real" : "mock";
const coreOrigin =
  coreMode === "real"
    ? process.env.ASTR_REAL_CORE_URL ?? "http://127.0.0.1:8300"
    : "http://127.0.0.1:18300";
const forwardedArgs = process.argv.slice(2);
const noBuildIndex = forwardedArgs.indexOf("--no-build");
const skipBuild = noBuildIndex >= 0;
if (skipBuild) forwardedArgs.splice(noBuildIndex, 1);
const runNonce = randomUUID();

const env = {
  ...process.env,
  NODE_ENV: "production",
  ASTR_E2E_CORE_MODE: coreMode,
  ASTR_CORE_URL: coreOrigin,
  NEXT_PUBLIC_ASTR_CORE: coreOrigin,
  ASTR_E2E_EXTERNAL_SERVERS: "1",
  ASTR_E2E_RUN_NONCE: runNonce,
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(workspaceRoot, ".playwright-browsers"),
};
const buildStampPath = resolve(webappRoot, ".next", "astr-e2e-build.json");

const managedChildren = new Set();
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal === "SIGINT" ? 130 : 143);
  });
}

let exitCode = 1;
try {
  if (!skipBuild) {
    await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], env);
    await writeBuildStamp();
  } else {
    await assertBuildStamp();
  }

  await assertPortFree("127.0.0.1", 3100, "ASTR E2E app");

  if (coreMode === "mock") {
    await assertPortFree("127.0.0.1", 18300, "ASTR mock Core");
    const mock = start(
      process.execPath,
      ["e2e/support/mock-core.mjs"],
      {
        ...env,
        ASTR_MOCK_CORE_HOST: "127.0.0.1",
        ASTR_MOCK_CORE_PORT: "18300",
        ASTR_MOCK_ALLOWED_ORIGIN: "http://127.0.0.1:3100",
      },
    );
    await waitForUrl(
      "http://127.0.0.1:18300/_test/health",
      mock,
      30_000,
      async (response) => (await response.json()).nonce === runNonce,
    );
  }

  const app = start(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3100"],
    env,
  );
  await waitForUrl("http://127.0.0.1:3100", app, 120_000);

  exitCode = await run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...forwardedArgs],
    env,
    false,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
} finally {
  await shutdown(exitCode);
}

function start(command, args, childEnv) {
  if (shuttingDown) throw new Error("ASTR E2E shutdown already started");
  const child = spawn(command, args, {
    cwd: webappRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  managedChildren.add(child);
  child.once("exit", () => managedChildren.delete(child));
  return child;
}

async function run(command, args, childEnv, failOnNonzero = true) {
  const child = start(command, args, childEnv);
  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) => {
      if (signal) reject(new Error(`${args[0]} terminated by ${signal}`));
      else resolveCode(status ?? 1);
    });
  });
  if (failOnNonzero && code !== 0) {
    throw new Error(`${args[0]} exited with status ${code}`);
  }
  return code;
}

async function waitForUrl(url, child, timeoutMs, validate = () => true) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error(`Stopped while waiting for ${url}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${url} server exited with status ${child.exitCode ?? child.signalCode}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await validate(response))) return;
      lastError = response.ok ? "identity mismatch" : `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  const children = [...managedChildren].reverse();
  await shutdownProcessTree(children);
  process.exitCode = code;
}

function assertPortFree(host, port, label) {
  return new Promise((resolveFree, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`${label} refused to start because ${host}:${port} is already in use.`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${label} port preflight timed out for ${host}:${port}.`));
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error && typeof error === "object" && error.code === "ECONNREFUSED") {
        resolveFree();
      } else {
        reject(error);
      }
    });
  });
}

async function writeBuildStamp() {
  const buildId = (await readFile(resolve(webappRoot, ".next", "BUILD_ID"), "utf8")).trim();
  const sourceHash = await hashBuildInputs();
  await writeFile(
    buildStampPath,
    `${JSON.stringify({ version: 1, buildId, coreMode, coreOrigin, sourceHash }, null, 2)}\n`,
    "utf8",
  );
}

async function assertBuildStamp() {
  let stamp;
  try {
    stamp = JSON.parse(await readFile(buildStampPath, "utf8"));
  } catch {
    throw new Error(
      "--no-build refused: this .next output has no verified ASTR E2E build identity; run test:e2e once first.",
    );
  }
  const expected = {
    version: 1,
    buildId: (await readFile(resolve(webappRoot, ".next", "BUILD_ID"), "utf8")).trim(),
    coreMode,
    coreOrigin,
    sourceHash: await hashBuildInputs(),
  };
  if (!matchesBuildStamp(stamp, expected)) {
    throw new Error(
      `--no-build refused: expected ${JSON.stringify(expected)}, received ${JSON.stringify(stamp)}.`,
    );
  }
}

async function hashBuildInputs() {
  const hash = createHash("sha256");
  for (const relativePath of [
    "src",
    "public",
    "next.config.ts",
    "package.json",
    "package-lock.json",
    "postcss.config.mjs",
    "tsconfig.json",
  ]) {
    await appendPath(hash, relativePath);
  }
  return hash.digest("hex");
}

async function appendPath(hash, relativePath) {
  const absolutePath = resolve(webappRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOTDIR") return null;
    throw error;
  });
  if (entries === null) {
    hash.update(relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(absolutePath));
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await appendPath(hash, `${relativePath}/${entry.name}`);
  }
}
