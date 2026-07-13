import http from "node:http";

const port = Number.parseInt(process.env.ASTR_MOCK_CORE_PORT ?? "18300", 10);
const host = process.env.ASTR_MOCK_CORE_HOST ?? "127.0.0.1";
const allowedOrigin =
  process.env.ASTR_MOCK_ALLOWED_ORIGIN ?? "http://127.0.0.1:3100";
const runNonce = process.env.ASTR_E2E_RUN_NONCE ?? "standalone";
const allowedEvents = new Set([
  "agent.thought",
  "soul.stream",
  "soul.decision",
  "presentation.express",
  "moa.report",
]);
const allowedScenarios = new Set([
  "happy",
  "silent",
  "early-decision",
  "missing-decision",
  "late-decision",
  "missing-done",
  "malformed-duplicate",
  "slow-stream",
  "delta-before-ack",
  "decision-before-ack",
  "ack-failure-external-decision",
]);
const clients = new Set();
const timers = new Set();
const pendingResponses = new Set();
let eventSequence = 0;
let requestSequence = 0;
let resetGeneration = 0;
let state = createDefaultState();

function createDefaultState() {
  return {
    scenario: "happy",
    statusMode: "ready",
    ingestDelayMs: 0,
    policyMode: "ready",
    policyDelayMs: 0,
    auditMode: "ready",
    auditDelayMs: 0,
    transcription: "语音回填文本",
    effector: {
      stopped: false,
      statusMode: "ready",
      statusDelayMs: 0,
      estopAck: true,
      estopReadback: true,
      resetAck: false,
      resetReadback: false,
    },
    policy: createDefaultPolicy(),
    audit: createDefaultAudit(),
    voiceprint: {
      enrolled: false,
      model_available: false,
      threshold: 0.72,
      require: false,
    },
    counts: Object.assign(Object.create(null), {
      status: 0,
      ingest: 0,
      transcribe: 0,
      stream: 0,
      "effector-status": 0,
      "effector-policy": 0,
      "effector-audit": 0,
    }),
    emitted: [],
  };
}

function createDefaultPolicy() {
  return {
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
  };
}

function createDefaultAudit() {
  return {
    dates: ["2026-07-12", "2026-07-13"],
    entriesByDate: {
      "2026-07-12": [
        {
          ts: "2026-07-12T00:01:00.000Z",
          trace_id: "mock-audit-trace-1",
          track: "desktop",
          description: "mock audited action 1",
          decision: "ask",
          dangerous: true,
        },
        {
          ts: "2026-07-12T00:02:00.000Z",
          trace_id: "mock-audit-trace-2",
          track: "headless",
          description: "mock audited action 2",
          decision: "allow",
          dangerous: false,
        },
      ],
      "2026-07-13": [
        {
          ts: "2026-07-13T00:01:00.000Z",
          trace_id: "mock-audit-trace-3",
          track: "desktop",
          description: "mock audited action 3",
          decision: "deny",
          dangerous: true,
        },
      ],
    },
  };
}

function count(key) {
  state.counts[key] = (state.counts[key] ?? 0) + 1;
}

function schedule(callback, delayMs) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, Math.max(0, delayMs));
  timers.add(timer);
  return timer;
}

function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

function resetState() {
  clearTimers();
  for (const response of [...pendingResponses]) {
    if (!response.writableEnded) {
      sendJson(response, 503, { detail: "mock reset interrupted the pending request" });
    }
  }
  pendingResponses.clear();
  state = createDefaultState();
  eventSequence = 0;
  requestSequence = 0;
  resetGeneration += 1;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendEmpty(response, status = 204) {
  response.writeHead(status, { ...corsHeaders(), "Cache-Control": "no-store" });
  response.end();
}

function sendAfterDelay(response, delayMs, callback) {
  const send = () => {
    pendingResponses.delete(response);
    if (response.destroyed || response.writableEnded) return;
    callback();
  };
  if (delayMs > 0) {
    pendingResponses.add(response);
    response.once("close", () => pendingResponses.delete(response));
    schedule(send, delayMs);
  } else {
    send();
  }
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validatePolicyPatch(patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return "policy patch must be an object";
  }
  const allowedFields = new Set([
    "approval_mode",
    "headless_scope",
    "headless_cwd",
    "headless_folders",
    "app_whitelist",
    "login_sites_whitelist",
    "dangerous_categories",
    "dangerous_keywords",
    "max_steps_per_task",
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedFields.has(key)) return `unsupported policy field: ${key}`;
    if (value === null) continue;
    if (
      key === "approval_mode" &&
      !["ask", "audited", "auto"].includes(value)
    ) {
      return "invalid approval_mode";
    }
    if (
      key === "headless_scope" &&
      !["cwd", "folders", "full"].includes(value)
    ) {
      return "invalid headless_scope";
    }
    if (key === "headless_cwd" && typeof value !== "string") {
      return "headless_cwd must be a string";
    }
    if (
      [
        "headless_folders",
        "app_whitelist",
        "login_sites_whitelist",
        "dangerous_categories",
        "dangerous_keywords",
      ].includes(key) &&
      !validStringArray(value)
    ) {
      return `${key} must be a string array`;
    }
    if (
      key === "max_steps_per_task" &&
      (!Number.isInteger(value) || value < 1 || value > 100)
    ) {
      return "max_steps_per_task must be an integer from 1 through 100";
    }
  }
  return null;
}

function applyPolicyPatch(patch) {
  const nextPolicy = { ...state.policy };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) continue;
    if (key === "dangerous_categories") {
      nextPolicy[key] = [
        ...new Set([...value, ...state.policy.core_dangerous_categories]),
      ].sort();
    } else if (key === "dangerous_keywords") {
      nextPolicy[key] = [
        ...new Set([...value, ...state.policy.core_dangerous_keywords]),
      ].sort();
    } else {
      nextPolicy[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  state.policy = nextPolicy;
  return cloneJson(nextPolicy);
}

function parseAuditLimit(value) {
  if (value === null) return 100;
  if (!/^[+-]?\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.max(1, Math.min(500, parsed));
}

function auditPayload(url) {
  const date = url.searchParams.get("date") ?? state.audit.dates.at(-1) ?? null;
  const limit = parseAuditLimit(url.searchParams.get("limit"));
  if (limit === null) return null;
  const entries = date === null ? [] : state.audit.entriesByDate[date] ?? [];
  if (!Object.hasOwn(state.audit.entriesByDate, date)) {
    return {
      dates: [...state.audit.dates],
      date,
      entries: [],
      chain_valid: null,
    };
  }
  return {
    dates: [...state.audit.dates],
    date,
    entries: cloneJson(entries.slice(-limit)),
    total: entries.length,
    chain_valid: true,
  };
}

function createEvent(type, traceId, payload, source = "soul.orchestrator") {
  eventSequence += 1;
  return {
    id: `mock-g${resetGeneration}-event-${eventSequence}`,
    ts: new Date(Date.UTC(2026, 6, 13, 0, 0, eventSequence)).toISOString(),
    schema_version: "1.0",
    type,
    source,
    trace_id: traceId,
    auth: {
      astr_user_id: "jacksky",
      level: 3,
      verified_by: [],
    },
    payload,
  };
}

function emitEvent(type, event) {
  if (!allowedEvents.has(type)) throw new Error(`unsupported named SSE event: ${type}`);
  state.emitted.push({
    type,
    eventId: event.id,
    traceId: event.trace_id,
  });
  state.emitted = state.emitted.slice(-256);
  emitRaw(type, JSON.stringify(event));
}

function emitRaw(eventName, data) {
  if (!allowedEvents.has(eventName)) {
    throw new Error(`unsupported named SSE event: ${eventName}`);
  }
  const frame = `event: ${eventName}\ndata: ${data}\n\n`;
  for (const response of [...clients]) {
    try {
      response.write(frame);
    } catch {
      clients.delete(response);
    }
  }
}

function stage(traceId, name = "intent") {
  emitEvent(
    "agent.thought",
    createEvent("agent.thought", traceId, {
      text: `mock stage ${name}`,
      stage: name,
    }),
  );
}

function delta(traceId, text, seq, done = false) {
  emitEvent(
    "soul.stream",
    createEvent("soul.stream", traceId, {
      delta: text,
      seq,
      ...(done ? { done: true } : {}),
    }),
  );
}

function decision(traceId, text = "我在这里，星枢链路已经抵达终稿。") {
  emitEvent(
    "soul.decision",
    createEvent("soul.decision", traceId, {
      reply_text: text,
      emotion_tag: null,
      intent: "chat",
    }),
  );
}

function runPostAckScenario(name, traceId) {
  switch (name) {
    case "silent":
      return;
    case "early-decision":
      schedule(() => decision(traceId, "提前抵达的权威终稿。"), 25);
      return;
    case "missing-decision":
      schedule(() => stage(traceId, "intent"), 20);
      schedule(() => delta(traceId, "只有临时流，没有终稿。", 1), 45);
      schedule(() => delta(traceId, "", 2, true), 70);
      return;
    case "late-decision":
      schedule(() => decision(traceId, "迟到但仍具权威性的终稿。"), 11_000);
      return;
    case "missing-done":
      schedule(() => stage(traceId, "compose"), 15);
      schedule(() => delta(traceId, "没有 done 也会由 decision 收束。", 1), 35);
      schedule(() => decision(traceId, "没有 done 的权威终稿。"), 65);
      return;
    case "malformed-duplicate": {
      const repeated = createEvent("soul.stream", traceId, { delta: "唯一增量。", seq: 1 });
      schedule(() => emitRaw("soul.stream", "{not-json"), 10);
      schedule(() => emitEvent("soul.stream", repeated), 20);
      schedule(() => emitEvent("soul.stream", repeated), 25);
      schedule(() => decision(traceId, "重复帧没有复制正文。"), 750);
      return;
    }
    case "slow-stream":
      schedule(() => stage(traceId, "compose"), 10);
      for (let index = 1; index <= 100; index += 1) {
        schedule(() => delta(traceId, `流${index} `, index), index * 100);
      }
      schedule(() => delta(traceId, "", 101, true), 10_050);
      schedule(() => decision(traceId, "十秒流式终稿。"), 10_100);
      return;
    case "happy":
    default:
      schedule(() => stage(traceId, "intent"), 40);
      schedule(() => delta(traceId, "我在这里，", 1), 100);
      schedule(() => delta(traceId, "星枢链路正在形成。", 2), 200);
      schedule(() => delta(traceId, "", 3, true), 650);
      schedule(() => decision(traceId), 900);
  }
}

async function handleIngest(request, response) {
  count("ingest");
  const body = await readJson(request);
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    sendJson(response, 422, { detail: "text is required" });
    return;
  }
  const scenario = state.scenario;
  const ingestDelayMs = state.ingestDelayMs;
  requestSequence += 1;
  const traceId = `mock-g${resetGeneration}-trace-${requestSequence}`;
  const receipt = {
    event_id: `mock-g${resetGeneration}-ingest-${requestSequence}`,
    trace_id: traceId,
  };
  pendingResponses.add(response);
  response.once("close", () => pendingResponses.delete(response));

  if (scenario === "delta-before-ack") {
    delta(traceId, "ACK 前到达的真实增量。", 1);
  } else if (scenario === "decision-before-ack") {
    decision(traceId, "ACK 前到达的权威终稿。");
  } else if (scenario === "ack-failure-external-decision") {
    delta(traceId, "ACK 前无法绑定的临时增量。", 1);
    decision(traceId, "未绑定 ACK 的外部权威终稿。");
  }

  const delay =
    scenario === "delta-before-ack" ||
    scenario === "decision-before-ack" ||
    scenario === "ack-failure-external-decision"
      ? Math.max(80, ingestDelayMs)
      : ingestDelayMs;

  schedule(() => {
    if (scenario === "ack-failure-external-decision") {
      sendJson(response, 503, { detail: "mock ingest failure" });
      return;
    }
    sendJson(response, 200, receipt);
    if (scenario === "delta-before-ack") {
      schedule(() => decision(traceId, "ACK 后收束的权威终稿。"), 30);
    } else if (scenario !== "decision-before-ack") {
      runPostAckScenario(scenario, traceId);
    }
  }, delay);
}

function statusPayload() {
  return {
    soul_name: "justin",
    local_llm_model: "mock-local-shell",
    cost_today_usd: 0.125,
    daily_budget_usd: 8,
    emotion: {
      loneliness: 0.18,
      talkativeness: 0.62,
      irritation: 0.08,
      excitement: 0.41,
      updated_at: "2026-07-13T00:00:00.000Z",
    },
    activity: "正在整理星枢上下文",
  };
}

async function handleControl(request, response, pathname) {
  if (pathname === "/_test/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, nonce: runNonce });
    return true;
  }
  if (pathname === "/_test/state" && request.method === "GET") {
    sendJson(response, 200, {
      scenario: state.scenario,
      statusMode: state.statusMode,
      policyMode: state.policyMode,
      policyDelayMs: state.policyDelayMs,
      auditMode: state.auditMode,
      auditDelayMs: state.auditDelayMs,
      effector: state.effector,
      counts: state.counts,
      emitted: state.emitted,
      clients: clients.size,
    });
    return true;
  }
  if (pathname === "/_test/reset" && request.method === "POST") {
    resetState();
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname === "/_test/configure" && request.method === "POST") {
    const patch = await readJson(request);
    if (typeof patch.scenario === "string") {
      if (!allowedScenarios.has(patch.scenario)) {
        throw new Error(`unsupported scenario: ${patch.scenario}`);
      }
      state.scenario = patch.scenario;
    }
    if (typeof patch.statusMode === "string") state.statusMode = patch.statusMode;
    if (Number.isFinite(patch.ingestDelayMs)) state.ingestDelayMs = patch.ingestDelayMs;
    if (typeof patch.transcription === "string") state.transcription = patch.transcription;
    if (typeof patch.policyMode === "string") {
      if (!["ready", "http-error"].includes(patch.policyMode)) {
        throw new Error(`unsupported policy mode: ${patch.policyMode}`);
      }
      state.policyMode = patch.policyMode;
    }
    if (Number.isFinite(patch.policyDelayMs)) {
      state.policyDelayMs = patch.policyDelayMs;
    }
    if (typeof patch.auditMode === "string") {
      if (!["ready", "http-error"].includes(patch.auditMode)) {
        throw new Error(`unsupported audit mode: ${patch.auditMode}`);
      }
      state.auditMode = patch.auditMode;
    }
    if (Number.isFinite(patch.auditDelayMs)) {
      state.auditDelayMs = patch.auditDelayMs;
    }
    if (patch.effector && typeof patch.effector === "object") {
      state.effector = { ...state.effector, ...patch.effector };
    }
    if (patch.voiceprint && typeof patch.voiceprint === "object") {
      state.voiceprint = { ...state.voiceprint, ...patch.voiceprint };
    }
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname === "/_test/emit" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.eventName !== "string") throw new Error("eventName is required");
    if (typeof body.raw === "string") emitRaw(body.eventName, body.raw);
    else if (body.event && typeof body.event === "object") {
      emitEvent(body.eventName, body.event);
    } else {
      throw new Error("event or raw is required");
    }
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname === "/_test/disconnect" && request.method === "POST") {
    for (const client of [...clients]) client.end();
    clients.clear();
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  try {
    if (request.method === "OPTIONS") {
      sendEmpty(response);
      return;
    }
    if (await handleControl(request, response, url.pathname)) return;

    if (url.pathname === "/v1/stream" && request.method === "GET") {
      count("stream");
      response.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(": connected\n\n");
      clients.add(response);
      response.on("close", () => clients.delete(response));
      return;
    }
    if (url.pathname === "/v1/status" && request.method === "GET") {
      count("status");
      if (state.statusMode === "http-error") {
        sendJson(response, 503, { detail: "mock status unavailable" });
      } else if (state.statusMode === "malformed") {
        sendJson(response, 200, { soul_name: "justin" });
      } else {
        sendJson(response, 200, statusPayload());
      }
      return;
    }
    if (url.pathname === "/v1/ingest" && request.method === "POST") {
      await handleIngest(request, response);
      return;
    }
    if (
      url.pathname === "/v1/admin/effector/policy" &&
      request.method === "GET"
    ) {
      count("effector-policy");
      const policyMode = state.policyMode;
      const policy = cloneJson(state.policy);
      sendAfterDelay(response, state.policyDelayMs, () => {
        if (policyMode === "http-error") {
          sendJson(response, 503, { detail: "mock effector policy unavailable" });
        } else {
          sendJson(response, 200, policy);
        }
      });
      return;
    }
    if (
      url.pathname === "/v1/admin/effector/policy" &&
      request.method === "PUT"
    ) {
      count("effector-policy-update");
      const patch = await readJson(request);
      const detail = validatePolicyPatch(patch);
      if (detail !== null) {
        sendJson(response, 422, { detail });
        return;
      }
      sendJson(response, 200, applyPolicyPatch(patch));
      return;
    }
    if (
      url.pathname === "/v1/admin/effector/audit" &&
      request.method === "GET"
    ) {
      count("effector-audit");
      const auditMode = state.auditMode;
      const payload = auditPayload(url);
      sendAfterDelay(response, state.auditDelayMs, () => {
        if (auditMode === "http-error") {
          sendJson(response, 503, { detail: "mock effector audit unavailable" });
        } else if (payload === null) {
          sendJson(response, 422, { detail: "limit must be an integer" });
        } else {
          sendJson(response, 200, payload);
        }
      });
      return;
    }
    if (url.pathname === "/v1/voice/transcribe" && request.method === "POST") {
      count("transcribe");
      const body = await readJson(request);
      if (typeof body.wav_b64 !== "string") {
        sendJson(response, 422, { detail: "wav_b64 is required" });
        return;
      }
      sendJson(response, 200, { text: state.transcription });
      return;
    }
    if (url.pathname === "/v1/voiceprint/status" && request.method === "GET") {
      count("voiceprint-status");
      sendJson(response, 200, state.voiceprint);
      return;
    }
    if (url.pathname === "/v1/voiceprint/enroll" && request.method === "POST") {
      count("voiceprint-enroll");
      const body = await readJson(request);
      if (
        !Array.isArray(body.clips_wav_b64) ||
        body.clips_wav_b64.some((clip) => typeof clip !== "string")
      ) {
        sendJson(response, 422, { detail: "clips_wav_b64 must be a string array" });
        return;
      }
      const clips = body.clips_wav_b64.length;
      if (!state.voiceprint.model_available || clips === 0) {
        sendJson(response, 200, { ok: false, error: "声纹模型未就位" });
      } else {
        state.voiceprint.enrolled = true;
        sendJson(response, 200, { ok: true, clips, enrolled: true });
      }
      return;
    }
    if (url.pathname === "/v1/effector/status" && request.method === "GET") {
      count("effector-status");
      const effector = { ...state.effector };
      const sendStatus = () => {
        if (effector.statusMode === "http-error") {
          sendJson(response, 503, { detail: "mock effector unavailable" });
        } else {
          sendJson(response, 200, {
            stopped: effector.stopped,
            pending: {},
            audit_tail: [],
          });
        }
      };
      sendAfterDelay(response, effector.statusDelayMs, sendStatus);
      return;
    }
    if (url.pathname === "/v1/effector/estop" && request.method === "POST") {
      count("estop");
      state.effector.stopped = state.effector.estopReadback;
      sendJson(response, 200, { stopped: state.effector.estopAck });
      return;
    }
    if (
      url.pathname === "/v1/effector/estop/reset" &&
      request.method === "POST"
    ) {
      count("reset");
      state.effector.stopped = state.effector.resetReadback;
      sendJson(response, 200, { stopped: state.effector.resetAck });
      return;
    }
    sendJson(response, 404, { detail: "Not Found" });
  } catch (error) {
    sendJson(response, 400, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`ASTR mock Core listening on http://${host}:${port}\n`);
});

function shutdown() {
  clearTimers();
  for (const client of [...clients]) client.end();
  clients.clear();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
