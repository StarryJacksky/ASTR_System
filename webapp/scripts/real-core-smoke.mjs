import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webappRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEvidencePath = resolve(
  webappRoot,
  "test-results",
  "presence-evidence",
  "real-core-smoke.json",
);
const defaultNamedEventEvidencePath = resolve(
  webappRoot,
  "test-results",
  "presence-evidence",
  "real-core-named-sse-event.json",
);

export async function runRealCoreSmoke({
  env = process.env,
  now = () => new Date().toISOString(),
  run = runPlaywright,
  readNamedEventEvidence = readDefaultNamedEventEvidence,
  writeEvidence = writeDefaultEvidence,
} = {}) {
  const coreUrl = env.ASTR_REAL_CORE_URL?.trim();
  const capturedAt = now();

  if (!coreUrl) {
    await writeEvidence({
      schemaVersion: "1.0.0",
      capturedAt,
      id: "real-core-read-only-smoke",
      mode: "read-only",
      status: "not-run",
      notes: "ASTR_REAL_CORE_URL is not configured.",
      checks: [
        {
          id: "read-only-get-sse-open",
          status: "not-run",
          notes: "ASTR_REAL_CORE_URL is not configured.",
        },
        {
          id: "named-sse-event",
          status: "not-run",
          notes: "ASTR_REAL_CORE_URL is not configured.",
        },
      ],
    });
    return 0;
  }

  const namedEventEvidencePath = env.ASTR_REAL_CORE_NAMED_EVENT_EVIDENCE_PATH?.trim()
    ? resolve(env.ASTR_REAL_CORE_NAMED_EVENT_EVIDENCE_PATH)
    : defaultNamedEventEvidencePath;
  await rm(namedEventEvidencePath, { force: true });
  const childEnv = {
    ...env,
    ASTR_E2E_CORE_MODE: "real",
    ASTR_REAL_CORE_URL: coreUrl,
    ASTR_REAL_CORE_NAMED_EVENT_EVIDENCE_PATH: namedEventEvidencePath,
  };
  const code = await run(childEnv, ["e2e/presence-real-smoke.spec.ts"]);
  const namedEventCheck = normalizeNamedEventEvidence(
    await readNamedEventEvidence(namedEventEvidencePath),
  );
  const connectionCheck = {
    id: "read-only-get-sse-open",
    status: code === 0 ? "passed" : "failed",
    notes:
      code === 0
        ? "Read-only status GET and SSE open state were observed."
        : "The read-only GET/SSE browser check failed.",
  };
  const status =
    code !== 0 || namedEventCheck.status === "failed"
      ? "failed"
      : namedEventCheck.status === "passed"
        ? "passed"
        : "incomplete";
  await writeEvidence({
    schemaVersion: "1.0.0",
    capturedAt,
    id: "real-core-read-only-smoke",
    mode: "read-only",
    status,
    notes:
      status === "passed"
        ? "Read-only GET/SSE integration and a parsed named SSE event were observed against the explicitly configured Core."
        : status === "incomplete"
          ? "Read-only GET/SSE integration opened, but no named SSE event was observed during the passive window."
          : "The explicitly configured real Core smoke profile failed.",
    checks: [connectionCheck, { id: "named-sse-event", ...namedEventCheck }],
  });
  return code !== 0 || namedEventCheck.status === "failed" ? code || 1 : 0;
}

async function readDefaultNamedEventEvidence(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    return {
      status: "failed",
      notes: `Named SSE event evidence could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function normalizeNamedEventEvidence(value) {
  if (value === null || value === undefined) {
    return {
      status: "not-run",
      notes: "No named SSE event was observed during the passive read-only window.",
    };
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.status === "passed" &&
    typeof value.eventName === "string" &&
    value.eventName.length > 0 &&
    typeof value.notes === "string"
  ) {
    return { status: "passed", eventName: value.eventName, notes: value.notes };
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.status === "failed" || value.status === "not-run") &&
    typeof value.notes === "string"
  ) {
    return { status: value.status, notes: value.notes };
  }
  return {
    status: "failed",
    notes: "Named SSE event evidence had an invalid shape.",
  };
}

function runPlaywright(env, args) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/run-playwright.mjs", ...args],
      {
        cwd: webappRoot,
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`real Core smoke terminated by ${signal}`));
      else resolveCode(code ?? 1);
    });
  });
}

async function writeDefaultEvidence(evidence) {
  const evidencePath = process.env.ASTR_REAL_CORE_EVIDENCE_PATH
    ? resolve(process.env.ASTR_REAL_CORE_EVIDENCE_PATH)
    : defaultEvidencePath;
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runRealCoreSmoke();
}
