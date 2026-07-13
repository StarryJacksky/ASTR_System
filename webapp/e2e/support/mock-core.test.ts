import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "http://127.0.0.1:18301";
let child: ChildProcess;

beforeAll(async () => {
  child = spawn(process.execPath, ["e2e/support/mock-core.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASTR_E2E_RUN_NONCE: "mock-contract-test",
      ASTR_MOCK_CORE_HOST: "127.0.0.1",
      ASTR_MOCK_CORE_PORT: "18301",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForHealth();
});

afterAll(() => {
  if (child?.exitCode === null && child.signalCode === null) child.kill();
});

beforeEach(async () => {
  const response = await fetch(`${ORIGIN}/_test/reset`, { method: "POST" });
  expect(response.ok).toBe(true);
});

describe("mock Core contract fidelity", () => {
  it("uses the real integer AuthContext level and never emits the old owner string", async () => {
    const source = await readFile(
      resolve(process.cwd(), "e2e/support/mock-core.mjs"),
      "utf8",
    );

    expect(source).toMatch(/level:\s*3[,\n]/);
    expect(source).not.toMatch(/level:\s*["']owner["']/);
  });

  it("does not add display_name to the current status shape through test controls", async () => {
    await fetch(`${ORIGIN}/_test/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "mock-only-name" }),
    });

    const response = await fetch(`${ORIGIN}/v1/status`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("display_name");
  });

  it("rejects a transcribe request without the required wav_b64 string", async () => {
    const response = await fetch(`${ORIGIN}/v1/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  it("rejects voiceprint enrollment when clips_wav_b64 is not a string array", async () => {
    const response = await fetch(`${ORIGIN}/v1/voiceprint/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clips_wav_b64: [123] }),
    });

    expect(response.status).toBe(422);
  });

  it("can hold the authoritative effector status response for startup checking tests", async () => {
    const configure = await fetch(`${ORIGIN}/_test/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effector: { statusDelayMs: 250 } }),
    });
    expect(configure.ok).toBe(true);

    const startedAt = performance.now();
    const response = await fetch(`${ORIGIN}/v1/effector/status`);
    const elapsedMs = performance.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(200);
  });
});

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`mock Core exited before health: ${child.exitCode ?? child.signalCode}`);
    }
    try {
      const response = await fetch(`${ORIGIN}/_test/health`);
      if (response.ok) return;
    } catch {
      // The owned mock may still be binding its loopback port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error("mock Core did not become healthy");
}
