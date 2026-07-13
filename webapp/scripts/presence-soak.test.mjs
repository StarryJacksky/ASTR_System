import { describe, expect, it, vi } from "vitest";

import { runPresenceSoak } from "./presence-soak.mjs";

describe("runPresenceSoak", () => {
  it("runs a short harness validation without claiming fixed-hardware certification", async () => {
    const run = vi.fn(async () => 0);
    const writeEvidence = vi.fn();

    const code = await runPresenceSoak({
      env: {},
      now: () => "2026-07-13T00:00:00.000Z",
      run,
      readSoakEvidence: vi.fn(),
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        ASTR_PRESENCE_SOAK_DURATION_MS: "10000",
        ASTR_PRESENCE_SOAK_ENABLED: "1",
        ASTR_PRESENCE_SOAK_PROFILE: "short",
      }),
      ["e2e/presence-performance.spec.ts", "--grep", "@soak"],
    );
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "short",
        status: "passed",
        certificationStatus: "not-run",
      }),
    );
  });

  it("records not-run without launching when full soak is requested on an undeclared host", async () => {
    const run = vi.fn();
    const writeEvidence = vi.fn();

    const code = await runPresenceSoak({
      env: { ASTR_PRESENCE_SOAK_PROFILE: "full" },
      now: () => "2026-07-13T00:00:00.000Z",
      run,
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "full",
        status: "not-run",
        certificationStatus: "not-run",
      }),
    );
  });

  it("runs the 30-minute profile only on an explicitly declared capable host", async () => {
    const run = vi.fn(async () => 0);
    const writeEvidence = vi.fn();

    const code = await runPresenceSoak({
      env: {
        ASTR_PRESENCE_SOAK_CAPABLE: "1",
        ASTR_PRESENCE_SOAK_PROFILE: "full",
      },
      now: () => "2026-07-13T00:00:00.000Z",
      run,
      readSoakEvidence: async () => ({
        durationMs: 1_800_000,
        heap: {
          status: "measured",
          postGcGrowthBytes: 0,
          limitBytes: 10 * 1024 * 1024,
        },
      }),
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        ASTR_PRESENCE_SOAK_DURATION_MS: "1800000",
        ASTR_PRESENCE_SOAK_ENABLED: "1",
        ASTR_PRESENCE_SOAK_PROFILE: "full",
      }),
      ["e2e/presence-performance.spec.ts", "--grep", "@soak"],
    );
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ certificationStatus: "passed" }),
    );
  });

  it("keeps full certification unsupported when explicit GC evidence is unavailable", async () => {
    const writeEvidence = vi.fn();

    const code = await runPresenceSoak({
      env: {
        ASTR_PRESENCE_SOAK_CAPABLE: "1",
        ASTR_PRESENCE_SOAK_PROFILE: "full",
      },
      now: () => "2026-07-13T00:00:00.000Z",
      run: async () => 0,
      readSoakEvidence: async () => ({
        durationMs: 1_800_000,
        heap: {
          status: "unsupported",
          postGcGrowthBytes: null,
          limitBytes: 10 * 1024 * 1024,
        },
      }),
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "full",
        status: "unsupported",
        certificationStatus: "unsupported",
      }),
    );
  });
});
