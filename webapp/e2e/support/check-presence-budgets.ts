import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluatePresenceBudgets,
  type PresenceProfile,
} from "./budget-evaluator";
import { assertPresenceEvidenceSchema } from "./performance-evidence";

export interface PresenceBudgetArtifactPaths {
  readonly desktopPath: string;
  readonly mobilePath: string;
}

export interface PresenceBudgetCheckSummary {
  readonly passed: boolean;
  readonly certificationComplete: boolean;
  readonly profiles: readonly {
    readonly profile: PresenceProfile;
    readonly renderPath: "dynamic" | "static-fallback";
    readonly dynamicCertification: string;
    readonly passed: boolean;
    readonly certificationComplete: boolean;
  }[];
}

export async function checkPresenceBudgetArtifacts(
  paths: PresenceBudgetArtifactPaths,
): Promise<PresenceBudgetCheckSummary> {
  const profiles = await Promise.all([
    readAndEvaluate(paths.desktopPath, "desktop"),
    readAndEvaluate(paths.mobilePath, "mobile"),
  ]);
  const issues = profiles.flatMap((entry) => entry.issues);
  if (issues.length > 0) {
    throw new Error(`Presence budget check failed:\n${issues.join("\n")}`);
  }

  return {
    passed: true,
    certificationComplete: profiles.every(
      (entry) => entry.evaluation.certificationComplete,
    ),
    profiles: profiles.map((entry) => ({
      profile: entry.evidence.profile,
      renderPath: entry.evidence.renderPath,
      dynamicCertification: entry.evidence.dynamicCertification.status,
      passed: entry.evaluation.passed,
      certificationComplete: entry.evaluation.certificationComplete,
    })),
  };
}

async function readAndEvaluate(path: string, expectedProfile: PresenceProfile) {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${expectedProfile} Presence evidence at ${path}: ${errorMessage(error)}`,
    );
  }

  try {
    assertPresenceEvidenceSchema(raw);
  } catch (error) {
    throw new Error(
      `Invalid ${expectedProfile} Presence evidence at ${path}: ${errorMessage(error)}`,
    );
  }
  if (raw.profile !== expectedProfile) {
    throw new Error(
      `Expected ${expectedProfile} Presence evidence at ${path}; received ${raw.profile}.`,
    );
  }

  const evaluation = evaluatePresenceBudgets(raw);
  return {
    evidence: raw,
    evaluation,
    issues: evaluation.issues,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const evidenceDirectory = resolve(process.cwd(), "test-results", "presence-evidence");
  const summary = await checkPresenceBudgetArtifacts({
    desktopPath: resolve(evidenceDirectory, "desktop.json"),
    mobilePath: resolve(evidenceDirectory, "mobile.json"),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (!process.env.VITEST) {
  main().catch((error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
