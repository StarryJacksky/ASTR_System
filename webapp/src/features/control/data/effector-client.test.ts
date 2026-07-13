import { describe, expect, it, vi } from "vitest";

import {
  EffectorClientError,
  createEffectorClient,
  type EffectorClient,
  type EffectorFetch,
} from "./effector-client";

const validPolicy = {
  approval_mode: "ask",
  headless_scope: "cwd",
  headless_cwd: "D:/ASTR_System",
  headless_folders: ["D:/ASTR_System/astr"],
  app_whitelist: ["Code.exe"],
  login_sites_whitelist: ["example.test"],
  dangerous_categories: ["payment"],
  dangerous_keywords: ["付款"],
  max_steps_per_task: 25,
  sandbox_dir: "D:/ASTR_System/sandbox",
  core_dangerous_categories: ["payment"],
  core_dangerous_keywords: ["删除"],
  locked: ["sandbox_dir", "audit"],
  overlay_path: "D:/ASTR_System/data/guard_policy.local.yaml",
} as const;

const validAudit = {
  dates: ["2026-07-12", "2026-07-13"],
  date: "2026-07-13",
  entries: [
    {
      ts: "2026-07-13T08:00:00Z",
      trace_id: "trace-1",
      track: "headless",
      description: "列出目录",
      decision: "allow",
      dangerous: false,
      reason: "verified",
      evidence: { source: "guard", sequence: [1, 2] },
    },
  ],
  total: 1,
  chain_valid: true,
} as const;

const validStatus = {
  stopped: false,
  pending: {
    speaker: {
      summary: "待确认",
      tool: "shell",
      context: { attempt: 1 },
    },
  },
  audit_tail: [{ trace_id: "trace-1", nested: { value: 1 } }],
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function brokenJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockRejectedValue(new SyntaxError("secret parser detail")),
  } as unknown as Response;
}

async function capturedError(promise: Promise<unknown>): Promise<EffectorClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EffectorClientError);
    return error as EffectorClientError;
  }
  throw new Error("Expected EffectorClientError");
}

type OperationCase = readonly [
  operation: EffectorClientError["operation"],
  invoke: (client: EffectorClient) => Promise<unknown>,
];

const operations: readonly OperationCase[] = [
  ["policy", (client) => client.policy()],
  ["patch-policy", (client) => client.patchPolicy({ approval_mode: "audited" })],
  ["audit", (client) => client.audit()],
  ["status", (client) => client.status()],
  ["estop", (client) => client.estop()],
  ["reset", (client) => client.reset()],
];

describe("Effector client", () => {
  it("uses only the six existing Core endpoints with exact methods, bodies, and signals", async () => {
    const fetcher = vi.fn<EffectorFetch>();
    fetcher
      .mockResolvedValueOnce(jsonResponse(validPolicy))
      .mockResolvedValueOnce(jsonResponse({ ...validPolicy, approval_mode: "audited" }))
      .mockResolvedValueOnce(jsonResponse(validAudit))
      .mockResolvedValueOnce(jsonResponse(validStatus))
      .mockResolvedValueOnce(jsonResponse({ stopped: true }))
      .mockResolvedValueOnce(jsonResponse({ stopped: false }));
    const client = createEffectorClient({ fetch: fetcher });
    const signal = new AbortController().signal;

    await expect(client.policy(signal)).resolves.toEqual(validPolicy);
    await expect(client.patchPolicy({ approval_mode: "audited" }, signal)).resolves.toMatchObject({
      approval_mode: "audited",
    });
    await expect(client.audit("2026-07-13", 100, signal)).resolves.toEqual(validAudit);
    await expect(client.status(signal)).resolves.toEqual(validStatus);
    await expect(client.estop(signal)).resolves.toEqual({ stopped: true });
    await expect(client.reset(signal)).resolves.toEqual({ stopped: false });

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/core/v1/admin/effector/policy", {
      cache: "no-store",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/core/v1/admin/effector/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_mode: "audited" }),
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/core/v1/admin/effector/audit?date=2026-07-13&limit=100",
      { cache: "no-store", signal },
    );
    expect(fetcher).toHaveBeenNthCalledWith(4, "/api/core/v1/effector/status", {
      cache: "no-store",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(5, "/api/core/v1/effector/estop", {
      method: "POST",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(6, "/api/core/v1/effector/estop/reset", {
      method: "POST",
      signal,
    });
  });

  it("encodes audit dates, clamps finite limits, and uses 100 for non-finite limits", async () => {
    const fetcher = vi.fn<EffectorFetch>().mockResolvedValue(jsonResponse(validAudit));
    const client = createEffectorClient({ fetch: fetcher, baseUrl: "/gateway/" });

    await client.audit("2026/07 13?", 900);
    await client.audit(undefined, -4);
    await client.audit(undefined, Number.NaN);

    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      "/gateway/v1/admin/effector/audit?date=2026%2F07+13%3F&limit=500",
      "/gateway/v1/admin/effector/audit?limit=1",
      "/gateway/v1/admin/effector/audit?limit=100",
    ]);
  });

  it("rejects an empty or runtime-invalid policy patch before network I/O", async () => {
    const fetcher = vi.fn<EffectorFetch>();
    const client = createEffectorClient({ fetch: fetcher });

    const emptyError = await capturedError(client.patchPolicy({}));
    expect(emptyError).toMatchObject({ kind: "input", operation: "patch-policy" });
    expect(emptyError.message).toBe("patch-policy received an invalid patch");

    const readOnlyError = await capturedError(
      client.patchPolicy({ sandbox_dir: "outside" } as never),
    );
    expect(readOnlyError).toMatchObject({ kind: "input", operation: "patch-policy" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(operations)("rejects non-2xx %s responses without parsing or exposing the body", async (
    operation,
    invoke,
  ) => {
    const response = jsonResponse({ error: "D:/private/operator-secret" }, 503);
    const error = await capturedError(
      invoke(createEffectorClient({ fetch: vi.fn<EffectorFetch>().mockResolvedValue(response) })),
    );

    expect(error).toMatchObject({ kind: "http", operation, status: 503 });
    expect(error.message).toBe(`${operation} returned HTTP 503`);
    expect(error.message).not.toContain("private");
    expect(response.json).not.toHaveBeenCalled();
  });

  it.each(operations)("rejects HTTP-200 error envelopes for %s with a safe message", async (
    operation,
    invoke,
  ) => {
    const client = createEffectorClient({
      fetch: vi
        .fn<EffectorFetch>()
        .mockResolvedValue(jsonResponse({ error: "D:/private/operator-secret" })),
    });
    const error = await capturedError(invoke(client));

    expect(error).toMatchObject({ kind: "remote", operation });
    expect(error.message).toBe(`${operation} returned an error response`);
    expect(error.message).not.toContain("operator-secret");
  });

  it("distinguishes network and JSON failures without leaking underlying messages", async () => {
    const networkError = await capturedError(
      createEffectorClient({
        fetch: vi.fn<EffectorFetch>().mockRejectedValue(new TypeError("secret network detail")),
      }).status(),
    );
    expect(networkError).toMatchObject({ kind: "network", operation: "status" });
    expect(networkError.message).toBe("status request failed");
    expect(networkError.message).not.toContain("secret");

    const jsonError = await capturedError(
      createEffectorClient({ fetch: vi.fn<EffectorFetch>().mockResolvedValue(brokenJsonResponse()) })
        .audit(),
    );
    expect(jsonError).toMatchObject({ kind: "json", operation: "audit" });
    expect(jsonError.message).toBe("audit returned invalid JSON");
    expect(jsonError.message).not.toContain("secret");
  });

  it.each([
    {},
    { ...validPolicy, approval_mode: "yolo" },
    { ...validPolicy, headless_scope: "workspace" },
    { ...validPolicy, dangerous_keywords: ["safe", 1] },
    { ...validPolicy, max_steps_per_task: Number.NaN },
    { ...validPolicy, max_steps_per_task: 101 },
  ])("rejects malformed policy shapes", async (body) => {
    const error = await capturedError(
      createEffectorClient({ fetch: vi.fn<EffectorFetch>().mockResolvedValue(jsonResponse(body)) })
        .policy(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "policy" });
  });

  it.each([
    {},
    { ...validAudit, chain_valid: "true" },
    { ...validAudit, total: Number.NaN },
    { ...validAudit, entries: [{ ...validAudit.entries[0], dangerous: "false" }] },
    { ...validAudit, entries: [{ ...validAudit.entries[0], evidence: { score: Number.NaN } }] },
  ])("rejects malformed audit shapes", async (body) => {
    const error = await capturedError(
      createEffectorClient({ fetch: vi.fn<EffectorFetch>().mockResolvedValue(jsonResponse(body)) })
        .audit(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "audit" });
  });

  it("accepts the Core empty-audit shape where total is absent", async () => {
    const fetcher = vi.fn<EffectorFetch>().mockResolvedValue(
      jsonResponse({ dates: [], date: null, entries: [], chain_valid: null }),
    );

    await expect(createEffectorClient({ fetch: fetcher }).audit()).resolves.toEqual({
      dates: [],
      date: null,
      entries: [],
      chain_valid: null,
    });
  });

  it.each([
    {},
    { ...validStatus, stopped: "false" },
    { ...validStatus, pending: [] },
    { ...validStatus, pending: { entry: { count: Number.POSITIVE_INFINITY } } },
    { ...validStatus, audit_tail: ["not-a-record"] },
  ])("rejects malformed status shapes", async (body) => {
    const error = await capturedError(
      createEffectorClient({ fetch: vi.fn<EffectorFetch>().mockResolvedValue(jsonResponse(body)) })
        .status(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "status" });
  });

  it.each([
    ["estop", (client: EffectorClient) => client.estop()],
    ["reset", (client: EffectorClient) => client.reset()],
  ] as const)("requires a boolean stopped result from %s", async (operation, invoke) => {
    const error = await capturedError(
      invoke(
        createEffectorClient({
          fetch: vi.fn<EffectorFetch>().mockResolvedValue(jsonResponse({ stopped: "true" })),
        }),
      ),
    );
    expect(error).toMatchObject({ kind: "shape", operation });
  });

  it("deep-clones and freezes every returned policy, audit, and status collection", async () => {
    const policyBody = structuredClone(validPolicy);
    const auditBody = structuredClone(validAudit);
    const statusBody = structuredClone(validStatus);
    const fetcher = vi
      .fn<EffectorFetch>()
      .mockResolvedValueOnce(jsonResponse(policyBody))
      .mockResolvedValueOnce(jsonResponse(auditBody))
      .mockResolvedValueOnce(jsonResponse(statusBody));
    const client = createEffectorClient({ fetch: fetcher });

    const policy = await client.policy();
    const audit = await client.audit();
    const status = await client.status();

    (policyBody.headless_folders as unknown as string[])[0] = "mutated";
    (auditBody.entries[0].evidence.sequence as unknown as number[])[0] = 99;
    (statusBody.pending.speaker.context as { attempt: number }).attempt = 99;

    expect(policy.headless_folders[0]).toBe("D:/ASTR_System/astr");
    expect((audit.entries[0].evidence as { sequence: readonly number[] }).sequence[0]).toBe(1);
    expect(
      (status.pending.speaker as { context: { attempt: number } }).context.attempt,
    ).toBe(1);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.headless_folders)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
    expect(Object.isFrozen(audit.entries)).toBe(true);
    expect(Object.isFrozen(audit.entries[0])).toBe(true);
    expect(Object.isFrozen(audit.entries[0].evidence)).toBe(true);
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(status.pending)).toBe(true);
    expect(Object.isFrozen(status.pending.speaker)).toBe(true);
    expect(Object.isFrozen(status.audit_tail)).toBe(true);
    expect(Object.isFrozen(status.audit_tail[0])).toBe(true);
  });
});
