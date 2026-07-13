import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "http://127.0.0.1:18301";
let child: ChildProcess;

const DEFAULT_POLICY = {
  approval_mode: "ask",
  headless_scope: "cwd",
  headless_cwd: "D:/ASTR_System",
  headless_folders: ["D:/ASTR_System"],
  app_whitelist: ["notepad.exe"],
  login_sites_whitelist: ["arxiv.org"],
  dangerous_categories: ["credential", "destructive"],
  dangerous_keywords: ["format disk", "rm -rf"],
  max_steps_per_task: 25,
  sandbox_dir: "D:/ASTR/effector/sandbox",
  core_dangerous_categories: ["credential", "destructive"],
  core_dangerous_keywords: ["format disk", "rm -rf"],
  locked: ["untrusted_wrapping", "normalize_before_match", "sandbox_dir", "audit"],
  overlay_path: "D:/ASTR/data/effector/guard_policy.local.yaml",
} as const;

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

  it("serves the exact effective policy and cumulatively merges valid PUT patches", async () => {
    const initial = await fetch(`${ORIGIN}/v1/admin/effector/policy`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual(DEFAULT_POLICY);

    const firstPatch = await fetch(`${ORIGIN}/v1/admin/effector/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_mode: "audited" }),
    });
    expect(firstPatch.status).toBe(200);
    expect(await firstPatch.json()).toEqual({
      ...DEFAULT_POLICY,
      approval_mode: "audited",
    });

    const secondPatch = await fetch(`${ORIGIN}/v1/admin/effector/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headless_scope: "folders",
        headless_folders: ["D:/ASTR_System", "D:/ASTR_Work"],
      }),
    });
    expect(secondPatch.status).toBe(200);
    expect(await secondPatch.json()).toEqual({
      ...DEFAULT_POLICY,
      approval_mode: "audited",
      headless_scope: "folders",
      headless_folders: ["D:/ASTR_System", "D:/ASTR_Work"],
    });
  });

  it.each([
    ["approval_mode", "unattended"],
    ["headless_scope", "network"],
  ])("rejects invalid %s modes with 422 without mutating policy", async (field, value) => {
    const response = await fetch(`${ORIGIN}/v1/admin/effector/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });

    expect(response.status).toBe(422);
    expect(await fetch(`${ORIGIN}/v1/admin/effector/policy`).then((result) => result.json()))
      .toEqual(DEFAULT_POLICY);
  });

  it("supports audit date and limit queries using the current audit response shape", async () => {
    const response = await fetch(
      `${ORIGIN}/v1/admin/effector/audit?date=2026-07-12&limit=1`,
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      dates: ["2026-07-12", "2026-07-13"],
      date: "2026-07-12",
      total: 2,
      chain_valid: true,
    });
    expect(body.entries).toEqual([
      expect.objectContaining({
        ts: "2026-07-12T00:02:00.000Z",
        trace_id: "mock-audit-trace-2",
        track: "headless",
        description: "mock audited action 2",
        decision: "allow",
        dangerous: false,
      }),
    ]);
  });

  it("keeps stop and reset acknowledgements separate from authoritative status readback", async () => {
    const configure = await fetch(`${ORIGIN}/_test/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effector: {
          estopAck: false,
          estopReadback: true,
          resetAck: true,
          resetReadback: false,
        },
      }),
    });
    expect(configure.ok).toBe(true);

    const initial = await fetch(`${ORIGIN}/v1/effector/status`);
    expect(await initial.json()).toEqual({ stopped: false, pending: {}, audit_tail: [] });

    const stop = await fetch(`${ORIGIN}/v1/effector/estop`, { method: "POST" });
    expect(await stop.json()).toEqual({ stopped: false });
    const stoppedReadback = await fetch(`${ORIGIN}/v1/effector/status`);
    expect(await stoppedReadback.json()).toEqual({ stopped: true, pending: {}, audit_tail: [] });

    const reset = await fetch(`${ORIGIN}/v1/effector/estop/reset`, { method: "POST" });
    expect(await reset.json()).toEqual({ stopped: true });
    const resetReadback = await fetch(`${ORIGIN}/v1/effector/status`);
    expect(await resetReadback.json()).toEqual({ stopped: false, pending: {}, audit_tail: [] });
  });

  it.each([
    "/v1/tasks",
    "/v1/devices",
    "/v1/admin/model-router",
    "/v1/plugins",
    "/v1/memory",
    "/v1/training",
    "/v1/migration",
  ])("does not invent the unprovided product route %s", async (path) => {
    const response = await fetch(`${ORIGIN}${path}`);
    expect(response.status).toBe(404);
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
