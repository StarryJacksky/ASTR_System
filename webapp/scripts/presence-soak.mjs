import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webappRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEvidencePath = resolve(
  webappRoot,
  "test-results",
  "presence-evidence",
  "soak-run.json",
);

export async function runPresenceSoak({
  env = process.env,
  now = () => new Date().toISOString(),
  run = runPlaywright,
  readSoakEvidence = readDefaultSoakEvidence,
  writeEvidence = writeDefaultEvidence,
} = {}) {
  const profile = env.ASTR_PRESENCE_SOAK_PROFILE === "full" ? "full" : "short";
  const capturedAt = now();

  if (profile === "full" && env.ASTR_PRESENCE_SOAK_CAPABLE !== "1") {
    await writeEvidence({
      schemaVersion: "1.0.0",
      capturedAt,
      id: "presence-soak",
      profile,
      durationMs: 1_800_000,
      status: "not-run",
      certificationStatus: "not-run",
      notes: "Full soak requires ASTR_PRESENCE_SOAK_CAPABLE=1 on a declared capable host.",
    });
    return 0;
  }

  const durationMs = profile === "full" ? 1_800_000 : 10_000;
  const childEnv = {
    ...env,
    ASTR_PRESENCE_SOAK_DURATION_MS: String(durationMs),
    ASTR_PRESENCE_SOAK_ENABLED: "1",
    ASTR_PRESENCE_SOAK_PROFILE: profile,
  };
  const browserCode = await run(childEnv, [
    "e2e/presence-performance.spec.ts",
    "--grep",
    "@soak",
  ]);
  let code = browserCode;
  let certificationStatus = "not-run";
  let certificationNotes =
    "Short harness validation does not certify the fixed-hardware 30-minute budget.";
  if (profile === "full") {
    certificationStatus = "failed";
    certificationNotes = "The full soak browser profile failed before certification.";
    if (browserCode === 0) {
      try {
        const evidence = await readSoakEvidence();
        if (!evidence || evidence.durationMs < durationMs || !evidence.heap) {
          throw new Error("Full soak evidence is missing or shorter than the required duration.");
        }
        if (evidence.heap.status === "measured") {
          const growth = evidence.heap.postGcGrowthBytes;
          const limit = evidence.heap.limitBytes;
          if (!Number.isFinite(growth) || !Number.isFinite(limit)) {
            throw new Error("Measured full soak evidence has invalid heap values.");
          }
          certificationStatus = growth < limit ? "passed" : "failed";
          certificationNotes = `Post-GC growth ${growth} bytes; strict limit ${limit} bytes.`;
          if (certificationStatus === "failed") code = 1;
        } else if (
          evidence.heap.status === "unsupported" ||
          evidence.heap.status === "not-run"
        ) {
          certificationStatus = evidence.heap.status;
          certificationNotes =
            "The full browser run completed, but explicit GC/heap certification is unavailable.";
        } else {
          throw new Error(`Unsupported full soak heap status: ${evidence.heap.status}`);
        }
      } catch (error) {
        code = 1;
        certificationStatus = "failed";
        certificationNotes = error instanceof Error ? error.message : String(error);
      }
    }
  }
  const status =
    browserCode !== 0 || code !== 0
      ? "failed"
      : profile === "full" && certificationStatus !== "passed"
        ? certificationStatus
        : "passed";
  await writeEvidence({
    schemaVersion: "1.0.0",
    capturedAt,
    id: "presence-soak",
    profile,
    durationMs,
    status,
    certificationStatus,
    notes: certificationNotes,
  });
  return code;
}

async function readDefaultSoakEvidence() {
  const artifactPath = resolve(
    webappRoot,
    "test-results",
    "presence-evidence",
    "soak.json",
  );
  return JSON.parse(await readFile(artifactPath, "utf8"));
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
      if (signal) reject(new Error(`Presence soak terminated by ${signal}`));
      else resolveCode(code ?? 1);
    });
  });
}

async function writeDefaultEvidence(evidence) {
  const evidencePath = process.env.ASTR_PRESENCE_SOAK_EVIDENCE_PATH
    ? resolve(process.env.ASTR_PRESENCE_SOAK_EVIDENCE_PATH)
    : defaultEvidencePath;
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runPresenceSoak();
}
