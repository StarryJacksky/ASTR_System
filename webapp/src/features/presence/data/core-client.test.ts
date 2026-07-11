import { describe, expect, it, vi } from "vitest";

import {
  CoreClientError,
  createCoreClient,
  type CoreClient,
  type CoreFetch,
} from "./core-client";

const validStatus = {
  soul_name: "astr",
  display_name: "秋秋",
  local_llm_model: "qwen-local",
  cost_today_usd: 1.25,
  daily_budget_usd: 8,
  emotion: {
    loneliness: 0.1,
    talkativeness: 0.8,
    irritation: 0.2,
    excitement: 0.6,
    updated_at: "2026-07-11T08:00:00Z",
  },
  activity: "在整理今天的记录",
};

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
    json: vi.fn().mockRejectedValue(new SyntaxError("invalid json")),
  } as unknown as Response;
}

async function capturedError(promise: Promise<unknown>): Promise<CoreClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CoreClientError);
    return error as CoreClientError;
  }
  throw new Error("Expected CoreClientError");
}

type OperationCase = readonly [
  operation: CoreClientError["operation"],
  invoke: (client: CoreClient) => Promise<unknown>,
];

const operations: readonly OperationCase[] = [
  ["status", (client) => client.status()],
  ["ingest", (client) => client.ingest({ text: "你好", platform: "web", lang: "zh" })],
  ["transcribe", (client) => client.transcribe("d2F2")],
  ["effector-status", (client) => client.effectorStatus()],
  ["estop", (client) => client.estop()],
  ["reset", (client) => client.reset()],
];

describe("Presence Core client", () => {
  it("uses the injected base URL and fetch while preserving only current response fields", async () => {
    const fetcher = vi.fn<CoreFetch>();
    fetcher
      .mockResolvedValueOnce(jsonResponse({ ...validStatus, future_field: "ignored" }))
      .mockResolvedValueOnce(jsonResponse({ event_id: "evt-1", trace_id: "trace-1", reply: "not-an-ack" }))
      .mockResolvedValueOnce(jsonResponse({ text: "" }))
      .mockResolvedValueOnce(
        jsonResponse({
          stopped: false,
          pending: { speaker: { summary: "待确认", tool: "shell" } },
          audit_tail: [{ id: "audit-1", ok: true }],
          future_field: "ignored",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ stopped: true, future_field: "ignored" }))
      .mockResolvedValueOnce(jsonResponse({ stopped: false, future_field: "ignored" }));
    const client = createCoreClient({ fetch: fetcher, baseUrl: "/gateway/" });
    const signal = new AbortController().signal;

    await expect(client.status(signal)).resolves.toEqual(validStatus);
    await expect(
      client.ingest({ text: "你好", platform: "web", lang: "zh" }, signal),
    ).resolves.toEqual({ event_id: "evt-1", trace_id: "trace-1" });
    await expect(client.transcribe("d2F2", signal)).resolves.toEqual({ text: "" });
    await expect(client.effectorStatus(signal)).resolves.toEqual({
      stopped: false,
      pending: { speaker: { summary: "待确认", tool: "shell" } },
      audit_tail: [{ id: "audit-1", ok: true }],
    });
    await expect(client.estop(signal)).resolves.toEqual({ stopped: true });
    await expect(client.reset(signal)).resolves.toEqual({ stopped: false });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/gateway/v1/status",
      "/gateway/v1/ingest",
      "/gateway/v1/voice/transcribe",
      "/gateway/v1/effector/status",
      "/gateway/v1/effector/estop",
      "/gateway/v1/effector/estop/reset",
    ]);
    expect(fetcher).toHaveBeenNthCalledWith(1, "/gateway/v1/status", {
      cache: "no-store",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/gateway/v1/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "你好", platform: "web", lang: "zh" }),
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, "/gateway/v1/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_b64: "d2F2" }),
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(4, "/gateway/v1/effector/status", {
      cache: "no-store",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(5, "/gateway/v1/effector/estop", {
      method: "POST",
      signal,
    });
    expect(fetcher).toHaveBeenNthCalledWith(6, "/gateway/v1/effector/estop/reset", {
      method: "POST",
      signal,
    });
  });

  it.each(operations)("reports HTTP failures for %s without parsing a body", async (operation, invoke) => {
    const response = jsonResponse({}, 503);
    const fetcher = vi.fn<CoreFetch>().mockResolvedValue(response);
    const error = await capturedError(invoke(createCoreClient({ fetch: fetcher })));

    expect(error).toMatchObject({ kind: "http", operation, status: 503 });
    expect(response.json).not.toHaveBeenCalled();
  });

  it.each(operations)("rejects malformed required response shapes for %s", async (operation, invoke) => {
    const fetcher = vi.fn<CoreFetch>().mockResolvedValue(jsonResponse({}));
    const error = await capturedError(invoke(createCoreClient({ fetch: fetcher })));

    expect(error).toMatchObject({ kind: "shape", operation });
  });

  it("distinguishes network and JSON failures with typed errors", async () => {
    const networkFetch = vi.fn<CoreFetch>().mockRejectedValue(new TypeError("offline"));
    const networkError = await capturedError(createCoreClient({ fetch: networkFetch }).status());
    expect(networkError).toMatchObject({ kind: "network", operation: "status" });
    expect(networkError.cause).toBeInstanceOf(TypeError);

    const jsonFetch = vi.fn<CoreFetch>().mockResolvedValue(brokenJsonResponse());
    const jsonError = await capturedError(createCoreClient({ fetch: jsonFetch }).status());
    expect(jsonError).toMatchObject({ kind: "json", operation: "status" });
    expect(jsonError.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    { ...validStatus, cost_today_usd: Number.NaN },
    { ...validStatus, daily_budget_usd: Number.POSITIVE_INFINITY },
    { ...validStatus, emotion: { ...validStatus.emotion, loneliness: Number.NaN } },
    { ...validStatus, emotion: { ...validStatus.emotion, talkativeness: Number.POSITIVE_INFINITY } },
    { ...validStatus, emotion: { ...validStatus.emotion, irritation: Number.NEGATIVE_INFINITY } },
    { ...validStatus, emotion: { ...validStatus.emotion, excitement: Number.NaN } },
  ])("rejects non-finite status and emotion numbers", async (body) => {
    const fetcher = vi.fn<CoreFetch>().mockResolvedValue(jsonResponse(body));
    const error = await capturedError(createCoreClient({ fetch: fetcher }).status());

    expect(error).toMatchObject({ kind: "shape", operation: "status" });
  });

  it.each([
    { event_id: "", trace_id: "trace-1" },
    { event_id: "evt-1", trace_id: "   " },
  ])("requires nonblank ingest receipt identifiers", async (body) => {
    const fetcher = vi.fn<CoreFetch>().mockResolvedValue(jsonResponse(body));
    const error = await capturedError(
      createCoreClient({ fetch: fetcher }).ingest({ text: "你好" }),
    );

    expect(error).toMatchObject({ kind: "shape", operation: "ingest" });
  });
});
