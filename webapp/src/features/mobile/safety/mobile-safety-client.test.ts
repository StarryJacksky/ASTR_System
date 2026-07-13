import { describe, expect, it, vi } from "vitest";

import {
  createMobileSafetyClient,
  MobileSafetyClientError,
  type MobileSafetyFetch,
  type MobileSafetyOperation,
} from "./mobile-safety-client";
import type { MobileSafetyClient } from "./mobile-safety-types";

function validStatusBody(): Record<string, unknown> {
  return {
    stopped: false,
    pending: {
      speaker: {
        summary: "operator confirmation",
        tool: "shell",
        context: { attempt: 1 },
      },
      browser: { site: "private.example", action: "open" },
    },
    audit_tail: [
      {
        trace_id: "trace-secret",
        description: "private command",
        nested: { value: 1 },
      },
    ],
    cwd: "D:/private/workspace",
    folders: ["D:/private"],
    apps: ["Private.exe"],
    sites: ["private.example"],
    sandbox: "D:/private/sandbox",
    overlay: "D:/private/policy.yaml",
  };
}

function validPolicyBody(): Record<string, unknown> {
  return {
    approval_mode: "ask",
    headless_scope: "cwd",
    max_steps_per_task: 25,
    headless_cwd: "D:/private/workspace",
    headless_folders: ["D:/private"],
    app_whitelist: ["Private.exe"],
    login_sites_whitelist: ["private.example"],
    dangerous_categories: ["payment"],
    dangerous_keywords: ["secret"],
    sandbox_dir: "D:/private/sandbox",
    core_dangerous_categories: ["payment"],
    core_dangerous_keywords: ["delete"],
    locked: ["sandbox_dir"],
    overlay_path: "D:/private/policy.yaml",
  };
}

function validAuditBody(includeTotal = true): Record<string, unknown> {
  return {
    dates: ["2026-07-13", "2026-07-14"],
    date: "2026-07-14",
    entries: [
      {
        ts: "2026-07-14T08:00:00Z",
        trace_id: "trace-secret",
        track: "headless",
        description: "private command",
        decision: "allow",
        dangerous: false,
        speaker: "private operator",
        cwd: "D:/private/workspace",
        folders: ["D:/private"],
        apps: ["Private.exe"],
        sites: ["private.example"],
        sandbox: "D:/private/sandbox",
        overlay: "D:/private/policy.yaml",
      },
    ],
    ...(includeTotal ? { total: 1 } : {}),
    chain_valid: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function invalidJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockRejectedValue(new SyntaxError("D:/private/json-secret")),
  } as unknown as Response;
}

async function capturedError(promise: Promise<unknown>): Promise<MobileSafetyClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MobileSafetyClientError);
    return error as MobileSafetyClientError;
  }
  throw new Error("Expected MobileSafetyClientError");
}

interface OperationCase {
  readonly operation: MobileSafetyOperation;
  readonly invoke: (client: MobileSafetyClient) => Promise<unknown>;
  readonly validBody: () => Record<string, unknown>;
  readonly hostileField: string;
}

const operations: readonly OperationCase[] = [
  {
    operation: "status",
    invoke: (client) => client.status(),
    validBody: validStatusBody,
    hostileField: "stopped",
  },
  {
    operation: "policy",
    invoke: (client) => client.policy(),
    validBody: validPolicyBody,
    hostileField: "approval_mode",
  },
  {
    operation: "audit",
    invoke: (client) => client.audit(),
    validBody: validAuditBody,
    hostileField: "date",
  },
];

function expectSafeError(
  error: MobileSafetyClientError,
  expected: {
    readonly kind: MobileSafetyClientError["kind"];
    readonly operation: MobileSafetyOperation;
    readonly message: string;
    readonly status?: number;
  },
): void {
  expect(error).toMatchObject(expected);
  expect(error.message).toBe(expected.message);
  expect(Object.keys(error)).toEqual(
    expected.status === undefined
      ? ["kind", "operation"]
      : ["kind", "operation", "status"],
  );
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("body");
  expect(error).not.toHaveProperty("path");
  expect(JSON.stringify(error)).not.toContain("private");
  expect(JSON.stringify(error)).not.toContain("secret");
}

function throwingGetter(message: string): PropertyDescriptor {
  return {
    configurable: true,
    enumerable: true,
    get: () => {
      throw new Error(message);
    },
  };
}

describe("GET-only Mobile safety client", () => {
  it("uses exactly three fixed GET requests and exposes exactly three frozen own methods", async () => {
    const fetcher = vi
      .fn<MobileSafetyFetch>()
      .mockResolvedValueOnce(jsonResponse(validStatusBody()))
      .mockResolvedValueOnce(jsonResponse(validPolicyBody()))
      .mockResolvedValueOnce(jsonResponse(validAuditBody()));
    const options = Object.defineProperty(
      { fetch: fetcher },
      "baseUrl",
      throwingGetter("D:/private/base-override"),
    );
    const client = createMobileSafetyClient(options);
    const signal = new AbortController().signal;

    await client.status(signal);
    await client.policy(signal);
    await client.audit(signal);

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/core/v1/effector/status", {
      method: "GET",
      cache: "no-store",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/core/v1/admin/effector/policy",
      { method: "GET", cache: "no-store", signal },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/core/v1/admin/effector/audit",
      { method: "GET", cache: "no-store", signal },
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(Object.getOwnPropertyNames(client)).toEqual(["status", "policy", "audit"]);
    expect(Object.getOwnPropertySymbols(client)).toEqual([]);
    expect(Object.isFrozen(client)).toBe(true);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).not.toHaveProperty("body");
      expect(Object.keys(init ?? {}).sort()).toEqual(["cache", "method", "signal"]);
    }
  });

  it("projects only minimal frozen status, policy, and audit facts", async () => {
    const fetcher = vi
      .fn<MobileSafetyFetch>()
      .mockResolvedValueOnce(jsonResponse(validStatusBody()))
      .mockResolvedValueOnce(jsonResponse(validPolicyBody()))
      .mockResolvedValueOnce(jsonResponse(validAuditBody()));
    const client = createMobileSafetyClient({ fetch: fetcher });

    const status = await client.status();
    const policy = await client.policy();
    const audit = await client.audit();

    expect(status).toEqual({ stopped: false, pending_count: 2, audit_tail_count: 1 });
    expect(policy).toEqual({
      approval_mode: "ask",
      headless_scope: "cwd",
      max_steps_per_task: 25,
    });
    expect(audit).toEqual({
      audit_date: "2026-07-14",
      audit_total: 1,
      chain_valid: true,
    });
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
  });

  it("counts status own keys and tail length without reading pending values, rows, or discarded fields", async () => {
    const pending = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(pending, "speaker", throwingGetter("pending speaker secret"));
    Object.defineProperty(pending, "browser", throwingGetter("pending browser secret"));
    Object.defineProperty(pending, "hidden", {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("non-enumerable pending secret");
      },
    });
    const auditTail: unknown[] = [];
    Object.defineProperty(auditTail, "0", throwingGetter("raw audit row secret"));
    const body: Record<string, unknown> = {
      stopped: true,
      pending,
      audit_tail: auditTail,
    };
    for (const field of ["speaker", "cwd", "folders", "apps", "sites", "sandbox", "overlay"]) {
      Object.defineProperty(body, field, throwingGetter(`discarded ${field} secret`));
    }

    const result = await createMobileSafetyClient({
      fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
    }).status();

    expect(result).toEqual({ stopped: true, pending_count: 2, audit_tail_count: 1 });
  });

  it("reads only the three policy projection fields", async () => {
    const body: Record<string, unknown> = {
      approval_mode: "audited",
      headless_scope: "folders",
      max_steps_per_task: 100,
    };
    for (const field of [
      "headless_cwd",
      "headless_folders",
      "app_whitelist",
      "login_sites_whitelist",
      "dangerous_categories",
      "dangerous_keywords",
      "sandbox_dir",
      "core_dangerous_categories",
      "core_dangerous_keywords",
      "locked",
      "overlay_path",
    ]) {
      Object.defineProperty(body, field, throwingGetter(`discarded ${field} secret`));
    }

    await expect(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).policy(),
    ).resolves.toEqual({
      approval_mode: "audited",
      headless_scope: "folders",
      max_steps_per_task: 100,
    });
  });

  it("does not read audit entries or other discarded fields", async () => {
    const body: Record<string, unknown> = {
      date: null,
      total: 0,
      chain_valid: null,
    };
    for (const field of [
      "entries",
      "dates",
      "speaker",
      "cwd",
      "folders",
      "apps",
      "sites",
      "sandbox",
      "overlay",
    ]) {
      Object.defineProperty(body, field, throwingGetter(`discarded ${field} secret`));
    }

    await expect(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).audit(),
    ).resolves.toEqual({ audit_date: null, audit_total: 0, chain_valid: null });
  });

  it("maps an omitted audit total to null instead of inferring it from entries", async () => {
    const body = validAuditBody(false);
    Object.defineProperty(body, "entries", throwingGetter("raw entries secret"));

    await expect(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).audit(),
    ).resolves.toEqual({
      audit_date: "2026-07-14",
      audit_total: null,
      chain_valid: true,
    });
  });

  it("uses the platform fetch when no fetch dependency is injected", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(validStatusBody()));
    try {
      await expect(createMobileSafetyClient().status()).resolves.toEqual({
        stopped: false,
        pending_count: 2,
        audit_tail_count: 1,
      });
      expect(fetcher).toHaveBeenCalledWith("/api/core/v1/effector/status", {
        method: "GET",
        cache: "no-store",
        signal: undefined,
      });
    } finally {
      fetcher.mockRestore();
    }
  });

  it.each(operations)("classifies $operation network failures without leaking causes", async ({
    operation,
    invoke,
  }) => {
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi
            .fn<MobileSafetyFetch>()
            .mockRejectedValue(new TypeError("D:/private/network-secret")),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "network",
      operation,
      message: `${operation} request failed`,
    });
  });

  it.each(operations)("classifies $operation HTTP failures without parsing the response", async ({
    operation,
    invoke,
  }) => {
    const response = jsonResponse({ error: "D:/private/http-secret" }, 503);
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(response),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "http",
      operation,
      status: 503,
      message: `${operation} returned HTTP 503`,
    });
    expect(response.json).not.toHaveBeenCalled();
  });

  it("contains hostile or invalid response metadata as a safe shape error", async () => {
    const hostileOk = Object.defineProperty(
      { status: 200, json: vi.fn() },
      "ok",
      throwingGetter("D:/private/ok-secret"),
    ) as unknown as Response;
    const hostileStatus = Object.defineProperty(
      { ok: false, json: vi.fn() },
      "status",
      throwingGetter("D:/private/status-secret"),
    ) as unknown as Response;
    const invalidResponses = [
      hostileOk,
      hostileStatus,
      { ok: "yes", status: 200, json: vi.fn() } as unknown as Response,
      { ok: false, status: Number.NaN, json: vi.fn() } as unknown as Response,
    ];

    for (const response of invalidResponses) {
      const error = await capturedError(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(response),
        }).status(),
      );
      expectSafeError(error, {
        kind: "shape",
        operation: "status",
        message: "status returned an invalid response shape",
      });
    }
  });

  it.each(operations)("classifies $operation invalid JSON without leaking parser details", async ({
    operation,
    invoke,
  }) => {
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(invalidJsonResponse()),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "json",
      operation,
      message: `${operation} returned invalid JSON`,
    });
  });

  it.each(operations)("classifies $operation error envelopes without reading remote text", async ({
    operation,
    invoke,
  }) => {
    const body = Object.defineProperty({}, "error", throwingGetter("remote error secret"));
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "remote",
      operation,
      message: `${operation} returned an error response`,
    });
  });

  it.each(operations)("rejects $operation top-level non-record responses", async ({
    operation,
    invoke,
  }) => {
    for (const body of [null, [], "secret", 1, true]) {
      const error = await capturedError(
        invoke(
          createMobileSafetyClient({
            fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
          }),
        ),
      );
      expectSafeError(error, {
        kind: "shape",
        operation,
        message: `${operation} returned an invalid response shape`,
      });
    }
  });

  it.each(operations)("rejects $operation non-plain or inherited records", async ({
    operation,
    invoke,
    validBody,
  }) => {
    const body = Object.assign(Object.create(validBody()), validBody());
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "shape",
      operation,
      message: `${operation} returned an invalid response shape`,
    });
  });

  it.each(operations)("contains hostile $operation property access as a safe shape error", async ({
    operation,
    invoke,
    validBody,
    hostileField,
  }) => {
    const body = validBody();
    Object.defineProperty(body, hostileField, throwingGetter("D:/private/getter-secret"));
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "shape",
      operation,
      message: `${operation} returned an invalid response shape`,
    });
  });

  it.each(operations)("contains hostile $operation proxy traps as a safe shape error", async ({
    operation,
    invoke,
  }) => {
    const body = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("D:/private/proxy-secret");
        },
      },
    );
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "shape",
      operation,
      message: `${operation} returned an invalid response shape`,
    });
  });

  it.each(operations)("rejects own symbol keys in $operation records", async ({
    operation,
    invoke,
    validBody,
  }) => {
    const body = validBody();
    Object.defineProperty(body, Symbol("private"), { value: "secret" });
    const error = await capturedError(
      invoke(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }),
      ),
    );

    expectSafeError(error, {
      kind: "shape",
      operation,
      message: `${operation} returned an invalid response shape`,
    });
  });

  it("requires plain symbol-free status collections without reading their contents", async () => {
    const invalidBodies: unknown[] = [];
    const customPending = Object.assign(Object.create({ inherited: true }), { own: 1 });
    invalidBodies.push({ ...validStatusBody(), pending: customPending });
    const symbolPending = { own: 1 } as Record<PropertyKey, unknown>;
    symbolPending[Symbol("private")] = "secret";
    invalidBodies.push({ ...validStatusBody(), pending: symbolPending });
    const symbolTail = [{}] as unknown[] & Record<PropertyKey, unknown>;
    symbolTail[Symbol("private")] = "secret";
    invalidBodies.push({ ...validStatusBody(), audit_tail: symbolTail });

    for (const body of invalidBodies) {
      const error = await capturedError(
        createMobileSafetyClient({
          fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
        }).status(),
      );
      expect(error).toMatchObject({ kind: "shape", operation: "status" });
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects a hostile audit tail length of %s", async (length) => {
    const auditTail = new Proxy([], {
      get: (target, key, receiver) =>
        key === "length" ? length : Reflect.get(target, key, receiver),
    });
    const error = await capturedError(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(
          jsonResponse({
            stopped: false,
            pending: {},
            audit_tail: auditTail,
          }),
        ),
      }).status(),
    );

    expectSafeError(error, {
      kind: "shape",
      operation: "status",
      message: "status returned an invalid response shape",
    });
  });

  it("contains a throwing audit tail length trap as a safe shape error", async () => {
    const auditTail = new Proxy([], {
      get: (target, key, receiver) => {
        if (key === "length") throw new Error("D:/private/length-secret");
        return Reflect.get(target, key, receiver);
      },
    });
    const error = await capturedError(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(
          jsonResponse({
            stopped: false,
            pending: {},
            audit_tail: auditTail,
          }),
        ),
      }).status(),
    );

    expectSafeError(error, {
      kind: "shape",
      operation: "status",
      message: "status returned an invalid response shape",
    });
  });

  it.each([
    { pending: {}, audit_tail: [] },
    { ...validStatusBody(), stopped: "false" },
    { ...validStatusBody(), pending: [] },
    { ...validStatusBody(), audit_tail: {} },
  ])("rejects malformed status projection fields", async (body) => {
    const error = await capturedError(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).status(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "status" });
  });

  it.each([
    {},
    { ...validPolicyBody(), approval_mode: "yolo" },
    { ...validPolicyBody(), approval_mode: 1 },
    { ...validPolicyBody(), headless_scope: "workspace" },
    { ...validPolicyBody(), headless_scope: false },
    { ...validPolicyBody(), max_steps_per_task: 0 },
    { ...validPolicyBody(), max_steps_per_task: 101 },
    { ...validPolicyBody(), max_steps_per_task: 1.5 },
    { ...validPolicyBody(), max_steps_per_task: Number.NaN },
    { ...validPolicyBody(), max_steps_per_task: Number.POSITIVE_INFINITY },
    { ...validPolicyBody(), max_steps_per_task: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed policy enums and finite safe-integer bounds", async (body) => {
    const error = await capturedError(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).policy(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "policy" });
  });

  it.each([
    {},
    { ...validAuditBody(), date: 20260714 },
    { ...validAuditBody(), total: -1 },
    { ...validAuditBody(), total: 1.5 },
    { ...validAuditBody(), total: Number.NaN },
    { ...validAuditBody(), total: Number.NEGATIVE_INFINITY },
    { ...validAuditBody(), total: Number.MAX_SAFE_INTEGER + 1 },
    { ...validAuditBody(), chain_valid: "true" },
  ])("rejects malformed audit tri-state and finite safe-integer counts", async (body) => {
    const error = await capturedError(
      createMobileSafetyClient({
        fetch: vi.fn<MobileSafetyFetch>().mockResolvedValue(jsonResponse(body)),
      }).audit(),
    );
    expect(error).toMatchObject({ kind: "shape", operation: "audit" });
  });
});
