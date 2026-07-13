import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTOMATED_METRIC_IDS,
  FIXED_HARDWARE_CERTIFICATION_IDS,
  INACTIVE_RAF_STATE_IDS,
  MANUAL_CERTIFICATION_IDS,
  type PresenceEvidence,
  type PresenceProfile,
} from "./budget-evaluator";
import { checkPresenceBudgetArtifacts } from "./check-presence-budgets";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("checkPresenceBudgetArtifacts", () => {
  it("passes measured static delivery while reporting incomplete dynamic certification", async () => {
    const paths = await writeArtifacts(validEvidence("desktop"), validEvidence("mobile"));

    const result = await checkPresenceBudgetArtifacts(paths);

    expect(result.passed).toBe(true);
    expect(result.certificationComplete).toBe(false);
    expect(result.profiles.map((profile) => profile.profile)).toEqual([
      "desktop",
      "mobile",
    ]);
  });

  it("fails when an environment-independent budget is exceeded", async () => {
    const mobile = validEvidence("mobile");
    mobile.automated["visual-transfer-bytes"] = {
      status: "measured",
      unit: "bytes",
      samples: [1_500_001],
    };
    const paths = await writeArtifacts(validEvidence("desktop"), mobile);

    await expect(checkPresenceBudgetArtifacts(paths)).rejects.toThrow(
      /mobile\.visual-transfer-bytes observed 1500001 > 1500000/,
    );
  });

  it("fails closed when either canonical profile artifact is missing", async () => {
    const paths = await writeArtifacts(validEvidence("desktop"), validEvidence("mobile"));
    await rm(paths.mobilePath);

    await expect(checkPresenceBudgetArtifacts(paths)).rejects.toThrow(/mobile\.json/);
  });
});

function validEvidence(profile: PresenceProfile): PresenceEvidence {
  const automated = Object.fromEntries(
    AUTOMATED_METRIC_IDS.map((id) => [
      id,
      id === "inactive-raf-count"
        ? {
            unit: "count" as const,
            states: Object.fromEntries(
              INACTIVE_RAF_STATE_IDS.map((state) => [
                state,
                { status: "measured" as const, unit: "count", samples: [0] },
              ]),
            ),
          }
        : id === "device-pixel-ratio"
          ? {
              status: "not-applicable" as const,
              unit: "ratio",
              notes: "The static fixture has no renderer.",
            }
          : {
              status: "measured" as const,
              unit:
                id === "stream-long-task-duration-ms"
                  ? "milliseconds"
                  : id.includes("bytes")
                    ? "bytes"
                    : "count",
              samples: [0],
            },
    ]),
  ) as unknown as PresenceEvidence["automated"];

  return {
    schemaVersion: "1.0.0",
    profile,
    renderPath: "static-fallback",
    dynamicCertification: {
      status: "failed",
      notes: "Static fallback is the measured delivery path.",
    },
    capturedAt: "2026-07-13T00:00:00.000Z",
    environment: {
      browser: "Chromium test",
      os: "test",
      viewport: profile === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      devicePixelRatio: 1,
      throttle: "none",
    },
    automated,
    fixedHardware: FIXED_HARDWARE_CERTIFICATION_IDS.map((id) => ({
      id,
      status: "not-run" as const,
    })),
    manual: MANUAL_CERTIFICATION_IDS.map((id) => ({
      id,
      status: "not-run" as const,
    })),
  };
}

async function writeArtifacts(
  desktop: PresenceEvidence,
  mobile: PresenceEvidence,
): Promise<{ readonly desktopPath: string; readonly mobilePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "astr-presence-budget-"));
  temporaryDirectories.push(directory);
  const desktopPath = join(directory, "desktop.json");
  const mobilePath = join(directory, "mobile.json");
  await Promise.all([
    writeFile(desktopPath, JSON.stringify(desktop), "utf8"),
    writeFile(mobilePath, JSON.stringify(mobile), "utf8"),
  ]);
  return { desktopPath, mobilePath };
}
