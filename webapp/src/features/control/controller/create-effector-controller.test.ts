import { describe, expect, it, vi } from "vitest";

import type {
  EffectorAudit,
  EffectorClient,
  EffectorPolicy,
  EffectorStatus,
} from "../data/effector-client";
import { createEffectorController } from "./create-effector-controller";

const POLICY: EffectorPolicy = {
  approval_mode: "ask",
  headless_scope: "cwd",
  headless_cwd: "D:/ASTR_System",
  headless_folders: ["D:/ASTR_System/astr"],
  app_whitelist: ["Code.exe"],
  login_sites_whitelist: ["example.test"],
  dangerous_categories: ["payment"],
  dangerous_keywords: ["delete"],
  max_steps_per_task: 25,
  sandbox_dir: "D:/ASTR_System/sandbox",
  core_dangerous_categories: ["payment"],
  core_dangerous_keywords: ["remove"],
  locked: ["sandbox_dir", "audit"],
  overlay_path: "D:/ASTR_System/data/guard_policy.local.yaml",
};

const UPDATED_POLICY: EffectorPolicy = {
  ...POLICY,
  approval_mode: "audited",
  headless_folders: ["D:/ASTR_System/astr", "D:/ASTR_System/docs"],
};

const AUDIT: EffectorAudit = {
  dates: ["2026-07-12", "2026-07-13"],
  date: "2026-07-13",
  entries: [
    {
      ts: "2026-07-13T08:00:00Z",
      trace_id: "trace-1",
      track: "headless",
      description: "List workspace",
      decision: "allow",
      dangerous: false,
      evidence: { sequence: [1, 2] },
    },
  ],
  total: 1,
  chain_valid: true,
};

const CLEAR_STATUS: EffectorStatus = {
  stopped: false,
  pending: {},
  audit_tail: [],
};

const LATCHED_STATUS: EffectorStatus = {
  stopped: true,
  pending: { operation: { kind: "shell" } },
  audit_tail: [{ trace_id: "trace-1" }],
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createClient(overrides: Partial<EffectorClient> = {}): EffectorClient {
  return {
    policy: vi.fn<EffectorClient["policy"]>().mockResolvedValue(POLICY),
    patchPolicy: vi.fn<EffectorClient["patchPolicy"]>().mockResolvedValue(UPDATED_POLICY),
    audit: vi.fn<EffectorClient["audit"]>().mockResolvedValue(AUDIT),
    status: vi.fn<EffectorClient["status"]>().mockResolvedValue(CLEAR_STATUS),
    estop: vi.fn<EffectorClient["estop"]>().mockResolvedValue({ stopped: true }),
    reset: vi.fn<EffectorClient["reset"]>().mockResolvedValue({ stopped: false }),
    ...overrides,
  };
}

describe("Effector controller", () => {
  it("is inert before start or an action and exposes cached immutable snapshots", () => {
    const client = createClient();
    const controller = createEffectorController(client);
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);
    expect(controller.getServerSnapshot()).toBe(initial);
    expect(initial).toMatchObject({
      policy: null,
      audit: null,
      status: null,
      channels: { policy: "idle", audit: "idle", status: "idle" },
      selectedAuditDate: null,
      savingPolicy: false,
      safetyMutation: null,
      safetyEvidence: "checking",
    });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.channels)).toBe(true);
    expect(Object.isFrozen(initial.errors)).toBe(true);
    expect(Object.values(client).every((operation) => !vi.mocked(operation).mock.calls.length))
      .toBe(true);
  });

  it("publishes policy, audit, and status independently and isolates a rejected channel", async () => {
    const policyGate = deferred<EffectorPolicy>();
    const auditGate = deferred<EffectorAudit>();
    const statusGate = deferred<EffectorStatus>();
    const policy = vi.fn<EffectorClient["policy"]>(() => policyGate.promise);
    const audit = vi.fn<EffectorClient["audit"]>(() => auditGate.promise);
    const status = vi.fn<EffectorClient["status"]>(() => statusGate.promise);
    const controller = createEffectorController(createClient({ policy, audit, status }));

    controller.start();
    expect(controller.getSnapshot().channels).toEqual({
      policy: "loading",
      audit: "loading",
      status: "loading",
    });

    const mutablePolicy = structuredClone(POLICY);
    policyGate.resolve(mutablePolicy);
    await vi.waitFor(() => expect(controller.getSnapshot().channels.policy).toBe("ready"));
    expect(controller.getSnapshot().channels).toEqual({
      policy: "ready",
      audit: "loading",
      status: "loading",
    });

    auditGate.reject(new Error("D:/private/audit-secret"));
    statusGate.resolve(CLEAR_STATUS);
    await vi.waitFor(() => {
      expect(controller.getSnapshot().channels).toEqual({
        policy: "ready",
        audit: "error",
        status: "ready",
      });
    });

    (mutablePolicy.headless_folders as string[])[0] = "mutated-after-publication";
    const snapshot = controller.getSnapshot();
    expect(snapshot.policy?.headless_folders[0]).toBe("D:/ASTR_System/astr");
    expect(Object.isFrozen(snapshot.policy)).toBe(true);
    expect(Object.isFrozen(snapshot.policy?.headless_folders)).toBe(true);
    expect(snapshot.status).toEqual(CLEAR_STATUS);
    expect(snapshot.safetyEvidence).toBe("clear");
    expect(snapshot.errors).toEqual({ audit: expect.any(String) });
    expect(snapshot.errors.audit).not.toContain("private");
  });

  it("aborts and supersedes a same-channel refresh without stale publication", async () => {
    const first = deferred<EffectorPolicy>();
    const second = deferred<EffectorPolicy>();
    const policy = vi
      .fn<EffectorClient["policy"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const controller = createEffectorController(createClient({ policy }));

    controller.actions.refreshPolicy();
    const loading = controller.getSnapshot();
    controller.actions.refreshPolicy();

    expect(policy).toHaveBeenCalledTimes(2);
    expect(policy.mock.calls[0][0]?.aborted).toBe(true);
    expect(policy.mock.calls[1][0]?.aborted).toBe(false);
    expect(controller.getSnapshot()).toBe(loading);

    first.resolve(POLICY);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe(loading);
    expect(controller.getSnapshot().policy).toBeNull();

    second.resolve(UPDATED_POLICY);
    await vi.waitFor(() => {
      expect(controller.getSnapshot().policy?.approval_mode).toBe("audited");
    });
    expect(controller.getSnapshot().channels.policy).toBe("ready");
  });

  it("retains the selected audit date when refreshing without a new selection", async () => {
    const audit = vi.fn<EffectorClient["audit"]>().mockResolvedValue(AUDIT);
    const controller = createEffectorController(createClient({ audit }));

    controller.actions.refreshAudit("2026-07-13");
    await vi.waitFor(() => expect(controller.getSnapshot().channels.audit).toBe("ready"));
    controller.actions.refreshAudit();
    await vi.waitFor(() => expect(audit).toHaveBeenCalledTimes(2));

    expect(controller.getSnapshot().selectedAuditDate).toBe("2026-07-13");
    expect(audit.mock.calls.map(([date, limit]) => [date, limit])).toEqual([
      ["2026-07-13", undefined],
      ["2026-07-13", undefined],
    ]);
  });

  it("keeps the last verified audit while a different selected date is loading", async () => {
    const nextAudit = deferred<EffectorAudit>();
    const audit = vi
      .fn<EffectorClient["audit"]>()
      .mockResolvedValueOnce(AUDIT)
      .mockImplementationOnce(() => nextAudit.promise);
    const controller = createEffectorController(createClient({ audit }));

    controller.actions.refreshAudit("2026-07-13");
    await vi.waitFor(() => expect(controller.getSnapshot().channels.audit).toBe("ready"));
    controller.actions.refreshAudit("2026-07-12");

    expect(controller.getSnapshot()).toMatchObject({
      audit: AUDIT,
      selectedAuditDate: "2026-07-12",
      channels: { audit: "loading" },
    });
    expect(audit.mock.calls[1][0]).toBe("2026-07-12");
  });

  it("retains the last verified audit when a different selected date fails", async () => {
    const audit = vi
      .fn<EffectorClient["audit"]>()
      .mockResolvedValueOnce(AUDIT)
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createEffectorController(createClient({ audit }));

    controller.actions.refreshAudit("2026-07-13");
    await vi.waitFor(() => expect(controller.getSnapshot().channels.audit).toBe("ready"));
    controller.actions.refreshAudit("2026-07-12");
    await vi.waitFor(() => expect(controller.getSnapshot().channels.audit).toBe("error"));

    expect(controller.getSnapshot()).toMatchObject({
      audit: AUDIT,
      selectedAuditDate: "2026-07-12",
      channels: { audit: "error" },
      errors: { audit: expect.any(String) },
    });
  });

  it("rejects an audit response that contradicts the requested date", async () => {
    const audit = vi
      .fn<EffectorClient["audit"]>()
      .mockResolvedValueOnce(AUDIT)
      .mockResolvedValueOnce({ ...AUDIT, date: "2026-07-11" });
    const controller = createEffectorController(createClient({ audit }));

    controller.actions.refreshAudit("2026-07-13");
    await vi.waitFor(() => expect(controller.getSnapshot().channels.audit).toBe("ready"));
    controller.actions.refreshAudit("2026-07-12");
    await vi.waitFor(() => expect(audit).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(controller.getSnapshot()).toMatchObject({
      audit: AUDIT,
      selectedAuditDate: "2026-07-12",
      channels: { audit: "error" },
      errors: { audit: expect.any(String) },
    });
  });

  it("guards concurrent policy patches and preserves verified policy on failure", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const controller = createEffectorController(createClient({ patchPolicy }));
    controller.actions.refreshPolicy();
    await vi.waitFor(() => expect(controller.getSnapshot().policy).toEqual(POLICY));

    const first = controller.actions.patchPolicy({ approval_mode: "audited" });
    expect(controller.getSnapshot().savingPolicy).toBe(true);
    const second = controller.actions.patchPolicy({ max_steps_per_task: 30 });

    await expect(second).resolves.toBe(false);
    expect(patchPolicy).toHaveBeenCalledTimes(1);
    patchGate.reject(new Error("D:/private/patch-secret"));
    await expect(first).resolves.toBe(false);

    expect(controller.getSnapshot().policy).toEqual(POLICY);
    expect(controller.getSnapshot().channels.policy).toBe("ready");
    expect(controller.getSnapshot().savingPolicy).toBe(false);
    expect(controller.getSnapshot().errors.policyMutation).toEqual(expect.any(String));
    expect(controller.getSnapshot().errors.policyMutation).not.toContain("private");
  });

  it("does not leave a canceled policy load stuck after a patch failure", async () => {
    const policyGate = deferred<EffectorPolicy>();
    const policy = vi.fn<EffectorClient["policy"]>(() => policyGate.promise);
    const patchPolicy = vi
      .fn<EffectorClient["patchPolicy"]>()
      .mockRejectedValue(new Error("offline"));
    const controller = createEffectorController(createClient({ policy, patchPolicy }));

    controller.actions.refreshPolicy();
    const result = controller.actions.patchPolicy({ approval_mode: "audited" });

    expect(policy.mock.calls[0][0]?.aborted).toBe(true);
    await expect(result).resolves.toBe(false);
    expect(controller.getSnapshot().channels.policy).toBe("error");
    expect(controller.getSnapshot().errors.policy).toEqual(expect.any(String));
    expect(controller.getSnapshot().errors.policyMutation).toEqual(expect.any(String));
  });

  it("publishes only the authoritative policy returned by a successful patch", async () => {
    const patchPolicy = vi
      .fn<EffectorClient["patchPolicy"]>()
      .mockResolvedValue(UPDATED_POLICY);
    const controller = createEffectorController(createClient({ patchPolicy }));

    await expect(
      controller.actions.patchPolicy({ approval_mode: "audited" }),
    ).resolves.toBe(true);

    expect(controller.getSnapshot()).toMatchObject({
      policy: UPDATED_POLICY,
      savingPolicy: false,
      channels: { policy: "ready" },
    });
    expect(controller.getSnapshot().errors.policyMutation).toBeUndefined();
    expect(controller.getSnapshot().errors.mutation).toBeUndefined();
  });

  it("reuses semantically identical verified data across refreshes", async () => {
    const policy = vi.fn<EffectorClient["policy"]>().mockResolvedValue(POLICY);
    const controller = createEffectorController(createClient({ policy }));

    controller.actions.refreshPolicy();
    await vi.waitFor(() => expect(controller.getSnapshot().channels.policy).toBe("ready"));
    const verifiedPolicy = controller.getSnapshot().policy;

    controller.actions.refreshPolicy();
    await vi.waitFor(() => expect(policy).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.getSnapshot().channels.policy).toBe("ready"));

    expect(controller.getSnapshot().policy).toBe(verifiedPolicy);
  });

  it("confirms e-stop only after POST acknowledgement and a stopped status readback", async () => {
    const post = deferred<{ readonly stopped: boolean }>();
    const estop = vi.fn<EffectorClient["estop"]>(() => post.promise);
    const status = vi.fn<EffectorClient["status"]>().mockResolvedValue(LATCHED_STATUS);
    const controller = createEffectorController(createClient({ estop, status }));

    const result = controller.actions.estop();
    expect(controller.getSnapshot().safetyMutation).toBe("estop");
    expect(status).not.toHaveBeenCalled();
    post.resolve({ stopped: true });

    await expect(result).resolves.toBe(true);
    expect(status).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: LATCHED_STATUS,
      safetyMutation: null,
      safetyEvidence: "latched",
      channels: { status: "ready" },
    });
    expect(controller.getSnapshot().errors.safetyMutation).toBeUndefined();
    expect(controller.getSnapshot().errors.mutation).toBeUndefined();
  });

  it.each([
    {
      name: "contrary readback",
      status: vi.fn<EffectorClient["status"]>().mockResolvedValue(CLEAR_STATUS),
    },
    {
      name: "failed readback",
      status: vi
        .fn<EffectorClient["status"]>()
        .mockRejectedValue(new Error("D:/private/status-secret")),
    },
  ])("keeps e-stop unknown after $name", async ({ status }) => {
    const controller = createEffectorController(createClient({ status }));

    await expect(controller.actions.estop()).resolves.toBe(false);

    const snapshot = controller.getSnapshot();
    expect(snapshot.safetyMutation).toBeNull();
    expect(snapshot.safetyEvidence).toBe("unknown");
    expect(snapshot.errors.safetyMutation).toEqual(expect.any(String));
    expect(snapshot.errors.safetyMutation).not.toContain("private");
  });

  it("clears a stale status-channel error after a successful contrary readback", async () => {
    const status = vi
      .fn<EffectorClient["status"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(CLEAR_STATUS);
    const controller = createEffectorController(createClient({ status }));

    controller.actions.refreshStatus();
    await vi.waitFor(() => expect(controller.getSnapshot().channels.status).toBe("error"));
    expect(controller.getSnapshot().errors.status).toEqual(expect.any(String));

    await expect(controller.actions.estop()).resolves.toBe(false);

    expect(controller.getSnapshot().channels.status).toBe("ready");
    expect(controller.getSnapshot().errors.status).toBeUndefined();
    expect(controller.getSnapshot().errors.safetyMutation).toBe(
      "权威回读与操作目标不一致。",
    );
  });

  it("confirms reset only after an authoritative clear status readback", async () => {
    const reset = vi.fn<EffectorClient["reset"]>().mockResolvedValue({ stopped: false });
    const status = vi.fn<EffectorClient["status"]>().mockResolvedValue(CLEAR_STATUS);
    const controller = createEffectorController(createClient({ reset, status }));

    await expect(controller.actions.reset()).resolves.toBe(true);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: CLEAR_STATUS,
      safetyMutation: null,
      safetyEvidence: "clear",
      channels: { status: "ready" },
    });
  });

  it("does not leave a canceled status load stuck after a safety failure", async () => {
    const statusGate = deferred<EffectorStatus>();
    const status = vi.fn<EffectorClient["status"]>(() => statusGate.promise);
    const estop = vi
      .fn<EffectorClient["estop"]>()
      .mockRejectedValue(new Error("offline"));
    const controller = createEffectorController(createClient({ status, estop }));

    controller.actions.refreshStatus();
    const result = controller.actions.estop();

    expect(status.mock.calls[0][0]?.aborted).toBe(true);
    await expect(result).resolves.toBe(false);
    expect(controller.getSnapshot().channels.status).toBe("error");
    expect(controller.getSnapshot().errors.status).toEqual(expect.any(String));
    expect(controller.getSnapshot().errors.safetyMutation).toEqual(expect.any(String));
    expect(controller.getSnapshot().safetyEvidence).toBe("unknown");
  });

  it("allows e-stop while a policy patch remains pending", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const estop = vi.fn<EffectorClient["estop"]>().mockResolvedValue({ stopped: true });
    const status = vi.fn<EffectorClient["status"]>().mockResolvedValue(LATCHED_STATUS);
    const controller = createEffectorController(
      createClient({ patchPolicy, estop, status }),
    );

    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();

    await expect(stopResult).resolves.toBe(true);
    expect(estop).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().savingPolicy).toBe(true);
    expect(patchPolicy.mock.calls[0][1]?.aborted).toBe(false);

    patchGate.resolve(UPDATED_POLICY);
    await expect(patchResult).resolves.toBe(true);
  });

  it("keeps a concurrent policy failure after the safety mutation succeeds", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const stopGate = deferred<{ readonly stopped: boolean }>();
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const estop = vi.fn<EffectorClient["estop"]>(() => stopGate.promise);
    const controller = createEffectorController(
      createClient({ patchPolicy, estop, status: vi.fn().mockResolvedValue(LATCHED_STATUS) }),
    );

    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();
    patchGate.reject(new Error("policy offline"));
    await expect(patchResult).resolves.toBe(false);

    expect(controller.getSnapshot().errors.policyMutation).toBe(
      "策略保存失败，请重试。",
    );
    stopGate.resolve({ stopped: true });
    await expect(stopResult).resolves.toBe(true);

    expect(controller.getSnapshot().errors).toMatchObject({
      policyMutation: "策略保存失败，请重试。",
      mutation: "策略保存失败，请重试。",
    });
    expect(controller.getSnapshot().errors.safetyMutation).toBeUndefined();
  });

  it("keeps a concurrent safety failure after the policy mutation succeeds", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const controller = createEffectorController(
      createClient({ patchPolicy, status: vi.fn().mockResolvedValue(CLEAR_STATUS) }),
    );

    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();
    await expect(stopResult).resolves.toBe(false);

    expect(controller.getSnapshot().errors.safetyMutation).toBe(
      "权威回读与操作目标不一致。",
    );
    patchGate.resolve(UPDATED_POLICY);
    await expect(patchResult).resolves.toBe(true);

    expect(controller.getSnapshot().errors).toMatchObject({
      safetyMutation: "权威回读与操作目标不一致。",
      mutation: "权威回读与操作目标不一致。",
    });
    expect(controller.getSnapshot().errors.policyMutation).toBeUndefined();
  });

  it("preserves both concurrent mutation failures", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const statusGate = deferred<EffectorStatus>();
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const status = vi.fn<EffectorClient["status"]>(() => statusGate.promise);
    const controller = createEffectorController(createClient({ patchPolicy, status }));

    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    patchGate.reject(new Error("policy offline"));
    await expect(patchResult).resolves.toBe(false);
    statusGate.reject(new Error("status offline"));
    await expect(stopResult).resolves.toBe(false);

    expect(controller.getSnapshot().errors).toMatchObject({
      policyMutation: "策略保存失败，请重试。",
      safetyMutation: "安全操作未获权威确认，请重试。",
    });
    expect(controller.getSnapshot().errors.mutation).toContain("策略保存失败，请重试。");
    expect(controller.getSnapshot().errors.mutation).toContain(
      "安全操作未获权威确认，请重试。",
    );
  });

  it("dispose aborts every active operation and prevents all late publication", async () => {
    const policyGate = deferred<EffectorPolicy>();
    const auditGate = deferred<EffectorAudit>();
    const statusGate = deferred<EffectorStatus>();
    const patchGate = deferred<EffectorPolicy>();
    const stopGate = deferred<{ readonly stopped: boolean }>();
    const policy = vi.fn<EffectorClient["policy"]>(() => policyGate.promise);
    const audit = vi.fn<EffectorClient["audit"]>(() => auditGate.promise);
    const status = vi.fn<EffectorClient["status"]>(() => statusGate.promise);
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const estop = vi.fn<EffectorClient["estop"]>(() => stopGate.promise);
    const controller = createEffectorController(
      createClient({ policy, audit, status, patchPolicy, estop }),
    );
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.start();
    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();
    controller.dispose();
    const disposedSnapshot = controller.getSnapshot();
    const publicationCount = listener.mock.calls.length;

    expect(policy.mock.calls[0][0]?.aborted).toBe(true);
    expect(audit.mock.calls[0][2]?.aborted).toBe(true);
    expect(status.mock.calls[0][0]?.aborted).toBe(true);
    expect(patchPolicy.mock.calls[0][1]?.aborted).toBe(true);
    expect(estop.mock.calls[0][0]?.aborted).toBe(true);

    policyGate.resolve(POLICY);
    auditGate.resolve(AUDIT);
    statusGate.resolve(CLEAR_STATUS);
    patchGate.resolve(UPDATED_POLICY);
    stopGate.resolve({ stopped: true });
    await expect(patchResult).resolves.toBe(false);
    await expect(stopResult).resolves.toBe(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getSnapshot()).toBe(disposedSnapshot);
    expect(listener).toHaveBeenCalledTimes(publicationCount);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("clears abandoned mutation flags before restarting after dispose", async () => {
    const patchGate = deferred<EffectorPolicy>();
    const stopGate = deferred<{ readonly stopped: boolean }>();
    const policy = vi.fn<EffectorClient["policy"]>().mockResolvedValue(POLICY);
    const audit = vi.fn<EffectorClient["audit"]>().mockResolvedValue(AUDIT);
    const status = vi.fn<EffectorClient["status"]>().mockResolvedValue(CLEAR_STATUS);
    const patchPolicy = vi.fn<EffectorClient["patchPolicy"]>(() => patchGate.promise);
    const estop = vi.fn<EffectorClient["estop"]>(() => stopGate.promise);
    const controller = createEffectorController(
      createClient({ policy, audit, status, patchPolicy, estop }),
    );

    const patchResult = controller.actions.patchPolicy({ approval_mode: "audited" });
    const stopResult = controller.actions.estop();
    expect(controller.getSnapshot()).toMatchObject({
      savingPolicy: true,
      safetyMutation: "estop",
    });

    controller.dispose();
    controller.start();

    await vi.waitFor(() => {
      expect(controller.getSnapshot().channels).toEqual({
        policy: "ready",
        audit: "ready",
        status: "ready",
      });
    });
    expect(controller.getSnapshot()).toMatchObject({
      savingPolicy: false,
      safetyMutation: null,
      safetyEvidence: "clear",
    });
    expect(policy).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);

    patchGate.resolve(UPDATED_POLICY);
    stopGate.resolve({ stopped: true });
    await expect(patchResult).resolves.toBe(false);
    await expect(stopResult).resolves.toBe(false);
  });
});
