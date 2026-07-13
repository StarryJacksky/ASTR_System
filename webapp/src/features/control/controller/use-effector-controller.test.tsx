import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  EffectorAudit,
  EffectorClient,
  EffectorPolicy,
  EffectorStatus,
} from "../data/effector-client";
import { useEffectorController } from "./use-effector-controller";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("useEffectorController", () => {
  it("restarts cleanly after the Strict Mode effect replay", async () => {
    const policyValue: EffectorPolicy = {
      approval_mode: "ask",
      headless_scope: "cwd",
      headless_cwd: "D:/ASTR_System",
      headless_folders: [],
      app_whitelist: [],
      login_sites_whitelist: [],
      dangerous_categories: [],
      dangerous_keywords: [],
      max_steps_per_task: 25,
      sandbox_dir: "D:/ASTR_System/sandbox",
      core_dangerous_categories: [],
      core_dangerous_keywords: [],
      locked: [],
      overlay_path: "D:/ASTR_System/data/guard_policy.local.yaml",
    };
    const auditValue: EffectorAudit = {
      dates: [],
      date: null,
      entries: [],
      chain_valid: null,
    };
    const statusValue: EffectorStatus = {
      stopped: false,
      pending: {},
      audit_tail: [],
    };
    const firstPolicy = deferred<EffectorPolicy>();
    const secondPolicy = deferred<EffectorPolicy>();
    const firstAudit = deferred<EffectorAudit>();
    const secondAudit = deferred<EffectorAudit>();
    const firstStatus = deferred<EffectorStatus>();
    const secondStatus = deferred<EffectorStatus>();
    const policy = vi
      .fn<EffectorClient["policy"]>()
      .mockImplementationOnce(() => firstPolicy.promise)
      .mockImplementationOnce(() => secondPolicy.promise);
    const audit = vi
      .fn<EffectorClient["audit"]>()
      .mockImplementationOnce(() => firstAudit.promise)
      .mockImplementationOnce(() => secondAudit.promise);
    const status = vi
      .fn<EffectorClient["status"]>()
      .mockImplementationOnce(() => firstStatus.promise)
      .mockImplementationOnce(() => secondStatus.promise);
    const client: EffectorClient = {
      policy,
      patchPolicy: vi.fn<EffectorClient["patchPolicy"]>(),
      audit,
      status,
      estop: vi.fn<EffectorClient["estop"]>(),
      reset: vi.fn<EffectorClient["reset"]>(),
    };
    const view = renderHook(() => useEffectorController(client), {
      reactStrictMode: true,
    });

    await waitFor(() => {
      expect(policy).toHaveBeenCalledTimes(2);
      expect(audit).toHaveBeenCalledTimes(2);
      expect(status).toHaveBeenCalledTimes(2);
    });
    expect(policy.mock.calls[0][0]?.aborted).toBe(true);
    expect(audit.mock.calls[0][2]?.aborted).toBe(true);
    expect(status.mock.calls[0][0]?.aborted).toBe(true);

    secondPolicy.resolve(policyValue);
    secondAudit.resolve(auditValue);
    secondStatus.resolve(statusValue);
    await waitFor(() => {
      expect(view.result.current.snapshot.channels).toEqual({
        policy: "ready",
        audit: "ready",
        status: "ready",
      });
    });
  });

  it("creates one lazy controller, starts it in an effect, and disposes pending work", () => {
    const policyGate = deferred<EffectorPolicy>();
    const auditGate = deferred<EffectorAudit>();
    const statusGate = deferred<EffectorStatus>();
    const policy = vi.fn<EffectorClient["policy"]>(() => policyGate.promise);
    const audit = vi.fn<EffectorClient["audit"]>(() => auditGate.promise);
    const status = vi.fn<EffectorClient["status"]>(() => statusGate.promise);
    const client: EffectorClient = {
      policy,
      patchPolicy: vi.fn<EffectorClient["patchPolicy"]>(),
      audit,
      status,
      estop: vi.fn<EffectorClient["estop"]>(),
      reset: vi.fn<EffectorClient["reset"]>(),
    };

    const view = renderHook(() => useEffectorController(client));
    const firstActions = view.result.current.actions;
    view.rerender();

    expect(policy).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(view.result.current.actions).toBe(firstActions);
    expect(view.result.current.snapshot.channels).toEqual({
      policy: "loading",
      audit: "loading",
      status: "loading",
    });

    view.unmount();
    expect(policy.mock.calls[0][0]?.aborted).toBe(true);
    expect(audit.mock.calls[0][2]?.aborted).toBe(true);
    expect(status.mock.calls[0][0]?.aborted).toBe(true);
  });

  it("uses lazy state and the three-argument external-store API without mirror state", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/control/controller/use-effector-controller.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(
      /useState\(\(\)\s*=>\s*createEffectorController\(client\)\)/,
    );
    expect(source).toMatch(
      /useSyncExternalStore\([\s\S]*controller\.subscribe,[\s\S]*controller\.getSnapshot,[\s\S]*controller\.getServerSnapshot,?\s*\)/,
    );
    expect(source).not.toMatch(/setSnapshot|useState<\s*EffectorSnapshot/);
  });
});
