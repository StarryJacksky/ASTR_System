import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runRealCoreSmoke } from "./real-core-smoke.mjs";

describe("runRealCoreSmoke", () => {
  it("records not-run without launching a browser when no real Core URL is configured", async () => {
    const run = vi.fn();
    const writeEvidence = vi.fn();

    const code = await runRealCoreSmoke({
      env: {},
      now: () => "2026-07-13T00:00:00.000Z",
      run,
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(writeEvidence).toHaveBeenCalledWith({
      schemaVersion: "1.0.0",
      capturedAt: "2026-07-13T00:00:00.000Z",
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
  });

  it("records incomplete when GET and SSE open but no named event was observed", async () => {
    const run = vi.fn(async () => 0);
    const writeEvidence = vi.fn();

    const code = await runRealCoreSmoke({
      env: { ASTR_REAL_CORE_URL: "http://127.0.0.1:8300" },
      now: () => "2026-07-13T00:00:00.000Z",
      run,
      readNamedEventEvidence: async () => null,
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        ASTR_E2E_CORE_MODE: "real",
        ASTR_REAL_CORE_URL: "http://127.0.0.1:8300",
      }),
      ["e2e/presence-real-smoke.spec.ts"],
    );
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "real-core-read-only-smoke",
        mode: "read-only",
        status: "incomplete",
        checks: [
          expect.objectContaining({ id: "read-only-get-sse-open", status: "passed" }),
          expect.objectContaining({ id: "named-sse-event", status: "not-run" }),
        ],
      }),
    );
  });

  it("records passed only when a real named SSE event was parsed", async () => {
    const writeEvidence = vi.fn();

    const code = await runRealCoreSmoke({
      env: { ASTR_REAL_CORE_URL: "http://127.0.0.1:8300" },
      now: () => "2026-07-13T00:00:00.000Z",
      run: async () => 0,
      readNamedEventEvidence: async () => ({
        status: "passed",
        eventName: "soul.decision",
        notes: "Observed and parsed soul.decision from the configured Core.",
      }),
      writeEvidence,
    });

    expect(code).toBe(0);
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "passed",
        checks: expect.arrayContaining([
          {
            id: "named-sse-event",
            status: "passed",
            eventName: "soul.decision",
            notes: "Observed and parsed soul.decision from the configured Core.",
          },
        ]),
      }),
    );
  });

  it("returns nonzero and records failed when the explicit real smoke fails", async () => {
    const writeEvidence = vi.fn();

    const code = await runRealCoreSmoke({
      env: { ASTR_REAL_CORE_URL: "https://core.example.test" },
      now: () => "2026-07-13T00:00:00.000Z",
      run: async () => 1,
      writeEvidence,
    });

    expect(code).toBe(1);
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("blocks every browser mutation before real Core smoke navigation", async () => {
    const source = await readFile(
      resolve(process.cwd(), "e2e/presence-real-smoke.spec.ts"),
      "utf8",
    );
    const routeAt = source.indexOf('page.route("**/*"');
    const navigationAt = source.indexOf('page.goto("/"');

    expect(routeAt).toBeGreaterThanOrEqual(0);
    expect(routeAt).toBeLessThan(navigationAt);
    expect(source).toMatch(/route\.abort\(/);
    expect(source).toMatch(/\["GET",\s*"HEAD",\s*"OPTIONS"\]/);
    expect(source).toMatch(/page\.addInitScript\(/);
    expect(source).toMatch(/agent\.thought/);
    expect(source).toMatch(/soul\.decision/);
    expect(source).toMatch(/JSON\.parse\(/);
    expect(source).toMatch(/parsed\.ts/);
    expect(source).toMatch(/ASTR_REAL_CORE_NAMED_EVENT_EVIDENCE_PATH/);
  });
});
