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

const DEFAULT_AUDIT_RESPONSE = {
  dates: ["2026-07-12", "2026-07-13"],
  date: "2026-07-13",
  entries: [
    {
      ts: "2026-07-13T00:01:00.000Z",
      trace_id: "mock-audit-trace-3",
      track: "desktop",
      description: "mock audited action 3",
      decision: "deny",
      dangerous: true,
    },
  ],
  total: 1,
  chain_valid: true,
} as const;

const EXPLICIT_REQUEST_COUNTS = {
  status: 0,
  ingest: 0,
  transcribe: 0,
  stream: 0,
  "effector-status": 0,
  "effector-policy": 0,
  "effector-audit": 0,
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
  it("exposes explicit zeroed request counters after reset", async () => {
    const state = await readState();

    expect(state.counts).toEqual(EXPLICIT_REQUEST_COUNTS);
  });

  it("counts tracked requests on arrival even when delayed requests fail", async () => {
    await configure({
      ingestDelayMs: 500,
      effector: { statusMode: "http-error", statusDelayMs: 500 },
      policyMode: "http-error",
      policyDelayMs: 500,
      auditMode: "http-error",
      auditDelayMs: 500,
    });

    const stream = await fetch(`${ORIGIN}/v1/stream`);
    await stream.body?.cancel();

    let ingestFinished = false;
    let effectorFinished = false;
    let policyFinished = false;
    let auditFinished = false;
    const statusRequest = fetch(`${ORIGIN}/v1/status`);
    const transcribeRequest = fetch(`${ORIGIN}/v1/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ingestRequest = fetch(`${ORIGIN}/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "count on arrival" }),
    }).finally(() => {
      ingestFinished = true;
    });
    const effectorRequest = fetch(`${ORIGIN}/v1/effector/status`).finally(() => {
      effectorFinished = true;
    });
    const policyRequest = fetch(`${ORIGIN}/v1/admin/effector/policy`).finally(() => {
      policyFinished = true;
    });
    const auditRequest = fetch(`${ORIGIN}/v1/admin/effector/audit`).finally(() => {
      auditFinished = true;
    });

    const observed = await waitForCounts({
      status: 1,
      ingest: 1,
      transcribe: 1,
      stream: 1,
      "effector-status": 1,
      "effector-policy": 1,
      "effector-audit": 1,
    });
    expect(observed.counts).toMatchObject({
      status: 1,
      ingest: 1,
      transcribe: 1,
      stream: 1,
      "effector-status": 1,
      "effector-policy": 1,
      "effector-audit": 1,
    });
    expect({ ingestFinished, effectorFinished, policyFinished, auditFinished }).toEqual({
      ingestFinished: false,
      effectorFinished: false,
      policyFinished: false,
      auditFinished: false,
    });

    const [status, transcribe, ingest, effector, policy, audit] = await Promise.all([
      statusRequest,
      transcribeRequest,
      ingestRequest,
      effectorRequest,
      policyRequest,
      auditRequest,
    ]);
    expect([
      status.status,
      transcribe.status,
      ingest.status,
      effector.status,
      policy.status,
      audit.status,
    ]).toEqual([200, 422, 200, 503, 503, 503]);
  });

  it("resets every explicit tracked request counter to zero", async () => {
    await Promise.all([
      fetch(`${ORIGIN}/v1/status`),
      fetch(`${ORIGIN}/v1/voice/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      fetch(`${ORIGIN}/v1/admin/effector/policy`),
      fetch(`${ORIGIN}/v1/admin/effector/audit`),
      fetch(`${ORIGIN}/v1/effector/status`),
    ]);

    const response = await fetch(`${ORIGIN}/_test/reset`, { method: "POST" });
    expect(response.ok).toBe(true);
    expect((await readState()).counts).toEqual(EXPLICIT_REQUEST_COUNTS);
  });

  it.each([
    ["policyMode", "/v1/admin/effector/policy"],
    ["auditMode", "/v1/admin/effector/audit"],
  ])("accepts only ready or http-error for %s", async (modeField, readPath) => {
    const configureResponse = await fetch(`${ORIGIN}/_test/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [modeField]: "malformed" }),
    });

    expect(configureResponse.status).toBe(400);
    expect((await fetch(`${ORIGIN}${readPath}`)).status).toBe(200);
  });

  it("fails and recovers policy reads independently without changing the success body", async () => {
    await configure({ policyMode: "http-error", policyDelayMs: 150 });

    const startedAt = performance.now();
    const failedPolicy = await fetch(`${ORIGIN}/v1/admin/effector/policy`);
    const elapsedMs = performance.now() - startedAt;
    const unaffectedAudit = await fetch(`${ORIGIN}/v1/admin/effector/audit`);

    expect(failedPolicy.status).toBe(503);
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
    expect(unaffectedAudit.status).toBe(200);
    expect(await unaffectedAudit.json()).toEqual(DEFAULT_AUDIT_RESPONSE);

    await configure({ policyMode: "ready", policyDelayMs: 0 });
    const recoveredPolicy = await fetch(`${ORIGIN}/v1/admin/effector/policy`);
    expect(recoveredPolicy.status).toBe(200);
    expect(await recoveredPolicy.json()).toEqual(DEFAULT_POLICY);
  });

  it("fails and recovers audit reads independently without changing the success body", async () => {
    await configure({ auditMode: "http-error", auditDelayMs: 150 });

    const startedAt = performance.now();
    const failedAudit = await fetch(`${ORIGIN}/v1/admin/effector/audit`);
    const elapsedMs = performance.now() - startedAt;
    const unaffectedPolicy = await fetch(`${ORIGIN}/v1/admin/effector/policy`);

    expect(failedAudit.status).toBe(503);
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
    expect(unaffectedPolicy.status).toBe(200);
    expect(await unaffectedPolicy.json()).toEqual(DEFAULT_POLICY);

    await configure({ auditMode: "ready", auditDelayMs: 0 });
    const recoveredAudit = await fetch(`${ORIGIN}/v1/admin/effector/audit`);
    expect(recoveredAudit.status).toBe(200);
    expect(await recoveredAudit.json()).toEqual(DEFAULT_AUDIT_RESPONSE);
  });

  it("does not let destroyed delayed responses crash or poison later reads", async () => {
    await configure({
      effector: { statusDelayMs: 200 },
      policyDelayMs: 200,
      auditDelayMs: 200,
    });

    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const requests = [
      fetch(`${ORIGIN}/v1/effector/status`, { signal: controllers[0].signal }),
      fetch(`${ORIGIN}/v1/admin/effector/policy`, { signal: controllers[1].signal }),
      fetch(`${ORIGIN}/v1/admin/effector/audit`, { signal: controllers[2].signal }),
    ].map((request) => request.then(
      () => "completed",
      (error: unknown) => error instanceof Error && error.name === "AbortError" ? "aborted" : "failed",
    ));

    await waitForCounts({
      "effector-status": 1,
      "effector-policy": 1,
      "effector-audit": 1,
    });
    for (const controller of controllers) controller.abort();
    expect(await Promise.all(requests)).toEqual(["aborted", "aborted", "aborted"]);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const health = await fetch(`${ORIGIN}/_test/health`);
    expect(health.status).toBe(200);

    await configure({
      effector: { statusDelayMs: 0 },
      policyDelayMs: 0,
      auditDelayMs: 0,
    });
    const recovered = await Promise.all([
      fetch(`${ORIGIN}/v1/effector/status`),
      fetch(`${ORIGIN}/v1/admin/effector/policy`),
      fetch(`${ORIGIN}/v1/admin/effector/audit`),
    ]);
    expect(recovered.map((response) => response.status)).toEqual([200, 200, 200]);
  });

  it("includes Studio and Mobile specs plus the remote authority host in mock Playwright config", async () => {
    const source = await readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(source).toContain(
      'const REMOTE_APP_ORIGIN = "http://astr-remote.test:3100";',
    );
    expect(source).toContain(
      '/(?:presence(?:-[\\w-]+)?|control(?:-a11y)?|studio(?:-[\\w-]+)?|mobile(?:-[\\w-]+)?)\\.spec\\.ts/',
    );
    expect(source).toContain(
      '"--host-resolver-rules=MAP astr-remote.test 127.0.0.1"',
    );
    expect(source).toContain(
      'process.env.ASTR_E2E_RUN_NONCE ?? `pid-${process.pid}`',
    );
    expect(source).toContain("outputDir: artifactOutputDir");
    expect(source).toContain('outputFolder: htmlReportDir');
    expect(source).toMatch(/export\s*\{[^}]*REMOTE_APP_ORIGIN[^}]*\}/);
  });

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

async function configure(patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${ORIGIN}/_test/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  expect(response.ok).toBe(true);
}

async function readState(): Promise<{
  counts: Record<string, number>;
}> {
  const response = await fetch(`${ORIGIN}/_test/state`);
  expect(response.ok).toBe(true);
  return await response.json() as { counts: Record<string, number> };
}

async function waitForCounts(
  expected: Record<string, number>,
): Promise<{ counts: Record<string, number> }> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const state = await readState();
    const matches = Object.entries(expected).every(
      ([key, value]) => state.counts[key] === value,
    );
    if (matches) return state;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`mock counters did not reach ${JSON.stringify(expected)}`);
}
