import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ControlModulePage from "../../../app/admin/[module]/page";
import type {
  EffectorActions,
  EffectorSnapshot,
} from "../controller/create-effector-controller";
import { useEffectorController } from "../controller/use-effector-controller";
import {
  createEffectorClient,
  type EffectorAudit,
  type EffectorClient,
  type EffectorPolicy,
  type EffectorStatus,
} from "../data/effector-client";
import { getControlModule } from "../model/control-modules";
import { EffectorWorkspace } from "./EffectorWorkspace";
import { ModuleDossier } from "./ModuleDossier";

vi.mock("../controller/use-effector-controller", () => ({
  useEffectorController: vi.fn(),
}));

vi.mock("../data/effector-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/effector-client")>();
  return { ...actual, createEffectorClient: vi.fn() };
});

const POLICY: EffectorPolicy = {
  approval_mode: "ask",
  headless_scope: "full",
  headless_cwd: "D:/ASTR_System/astr",
  headless_folders: [],
  app_whitelist: [],
  login_sites_whitelist: [],
  dangerous_categories: ["payment"],
  dangerous_keywords: ["删除"],
  max_steps_per_task: 25,
  sandbox_dir: "D:/ASTR_System/sandbox",
  core_dangerous_categories: ["payment"],
  core_dangerous_keywords: ["删除"],
  locked: ["sandbox_dir"],
  overlay_path: "D:/ASTR_System/data/guard_policy.local.yaml",
};

const AUDIT: EffectorAudit = {
  dates: ["2026-07-13"],
  date: "2026-07-13",
  entries: [
    {
      ts: "2026-07-13T08:09:10Z",
      trace_id: "trace-workspace-full",
      track: "headless",
      description: "已验证审计记录",
      decision: "allow",
      dangerous: false,
    },
  ],
  total: 1,
  chain_valid: true,
};

const STATUS: EffectorStatus = {
  stopped: false,
  pending: { first: {}, second: {} },
  audit_tail: [{ trace_id: "trace-workspace-full" }],
};

const BASE_SNAPSHOT: EffectorSnapshot = {
  policy: POLICY,
  audit: AUDIT,
  status: STATUS,
  channels: { policy: "ready", audit: "ready", status: "ready" },
  errors: {},
  selectedAuditDate: "2026-07-13",
  savingPolicy: false,
  safetyMutation: null,
  safetyEvidence: "clear",
};

function actions(): EffectorActions {
  return {
    refreshAll: vi.fn<EffectorActions["refreshAll"]>(),
    refreshPolicy: vi.fn<EffectorActions["refreshPolicy"]>(),
    refreshAudit: vi.fn<EffectorActions["refreshAudit"]>(),
    refreshStatus: vi.fn<EffectorActions["refreshStatus"]>(),
    patchPolicy: vi.fn<EffectorActions["patchPolicy"]>().mockResolvedValue(true),
    estop: vi.fn<EffectorActions["estop"]>().mockResolvedValue(true),
    reset: vi.fn<EffectorActions["reset"]>().mockResolvedValue(true),
  };
}

function renderWorkspace(snapshot: EffectorSnapshot, workspaceActions = actions()) {
  vi.mocked(useEffectorController).mockReturnValue({ snapshot, actions: workspaceActions });
  return {
    ...render(<EffectorWorkspace module={getControlModule("effector")!} />),
    actions: workspaceActions,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createEffectorClient).mockReturnValue({} as EffectorClient);
});

describe("EffectorWorkspace", () => {
  it("binds the exact client/controller path and renders local skips plus six contract sources", () => {
    renderWorkspace(BASE_SNAPSHOT);

    expect(createEffectorClient).toHaveBeenCalledTimes(1);
    expect(useEffectorController).toHaveBeenCalledWith(expect.any(Object));
    expect(screen.getByRole("link", { name: "跳到策略表单" })).toHaveAttribute(
      "href",
      "#control-form",
    );
    expect(screen.getByRole("link", { name: "跳到审计丁册" })).toHaveAttribute(
      "href",
      "#audit-ledger",
    );
    const contracts = screen.getByRole("region", { name: "Core 合同来源" });
    expect(within(contracts).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("待处理 2")).toBeVisible();
    expect(screen.getByText("审计尾部 1")).toBeVisible();
  });

  it("keeps both local skip targets present and focusable with or without evidence", async () => {
    const user = userEvent.setup();
    const readyView = renderWorkspace(BASE_SNAPSHOT);

    await user.click(screen.getByRole("link", { name: "跳到策略表单" }));
    expect(screen.getByRole("form", { name: "执行策略编辑" })).toHaveFocus();
    await user.click(screen.getByRole("link", { name: "跳到审计丁册" }));
    expect(screen.getByRole("region", { name: "审计丁册" })).toHaveFocus();

    readyView.unmount();
    renderWorkspace({
      ...BASE_SNAPSHOT,
      policy: null,
      audit: null,
      channels: { ...BASE_SNAPSHOT.channels, policy: "error", audit: "error" },
      errors: {
        policy: "策略加载失败，请重试。",
        audit: "审计记录加载失败，请重试。",
      },
    });

    await user.click(screen.getByRole("link", { name: "跳到策略表单" }));
    expect(document.getElementById("control-form")).toHaveFocus();
    await user.click(screen.getByRole("link", { name: "跳到审计丁册" }));
    expect(document.getElementById("audit-ledger")).toHaveFocus();
  });

  it("keeps status safety and audit visible when policy alone fails", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      policy: null,
      channels: { ...BASE_SNAPSHOT.channels, policy: "error" },
      errors: { policy: "策略加载失败，请重试。" },
    });

    expect(screen.getByText("策略加载失败，请重试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "触发急停" })).toBeEnabled();
    expect(screen.getByText("已验证审计记录")).toBeVisible();
    expect(screen.queryByRole("form", { name: "执行策略编辑" })).toBeNull();
  });

  it("keeps verified policy visible when audit alone fails", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      audit: null,
      channels: { ...BASE_SNAPSHOT.channels, audit: "error" },
      errors: { audit: "审计记录加载失败，请重试。" },
    });

    expect(screen.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
    expect(screen.getByText("审计记录加载失败，请重试。")).toBeVisible();
    expect(screen.queryByRole("region", { name: "审计丁册" })).toBeNull();
  });

  it("retains failed-refresh policy and audit evidence with separate stale labels", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      channels: { ...BASE_SNAPSHOT.channels, policy: "error", audit: "error" },
      errors: {
        policy: "策略刷新失败，请重试。",
        audit: "审计刷新失败，请重试。",
      },
    });

    expect(screen.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
    expect(screen.getByRole("region", { name: "审计丁册" })).toBeVisible();
    expect(screen.getAllByText("可能陈旧")).toHaveLength(2);
    expect(screen.getByText("策略刷新失败，请重试。")).toBeVisible();
    expect(screen.getByText("审计刷新失败，请重试。")).toBeVisible();
  });

  it("places mutation failures in the shared operation seam, not inside safety evidence", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      errors: { mutation: "策略保存失败，请重试。" },
    });

    const status = screen.getByRole("region", { name: "执行层状态证据" });
    expect(within(status).queryByText("策略保存失败，请重试。")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("策略保存失败，请重试。");
  });

  it("marks retained status counts stale when status refresh fails", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      channels: { ...BASE_SNAPSHOT.channels, status: "error" },
      errors: { status: "安全状态读取失败，请重试。" },
      safetyEvidence: "unknown",
    });

    const status = screen.getByRole("region", { name: "执行层状态证据" });
    expect(within(status).getByText("可能陈旧")).toBeVisible();
    expect(within(status).getByText("待处理 2")).toBeVisible();
    expect(within(status).getByText("审计尾部 1")).toBeVisible();
  });

  it("does not manufacture pending or audit-tail counts without Core status", () => {
    renderWorkspace({
      ...BASE_SNAPSHOT,
      status: null,
      channels: { ...BASE_SNAPSHOT.channels, status: "error" },
      errors: { status: "安全状态读取失败，请重试。" },
      safetyEvidence: "unknown",
    });

    expect(screen.queryByText(/待处理 \d/)).toBeNull();
    expect(screen.queryByText(/审计尾部 \d/)).toBeNull();
    expect(screen.getByText("安全状态读取失败，请重试。")).toBeVisible();
  });

  it("routes only Effector to the interactive workspace", async () => {
    const effectorPage = await ControlModulePage({
      params: Promise.resolve({ module: "effector" }),
    });
    const plannedPage = await ControlModulePage({
      params: Promise.resolve({ module: "model-router" }),
    });

    expect(effectorPage.type).toBe(EffectorWorkspace);
    expect(plannedPage.type).toBe(ModuleDossier);
  });

  it("uses asymmetric roomy dossiers without KPI, green, glass, gradients, 3D, or generic tiles", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/control/components/EffectorWorkspace.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "src/features/control/components/EffectorWorkspace.module.css"),
      "utf8",
    );
    const shellStyles = readFileSync(
      resolve(process.cwd(), "src/features/control/components/ControlShell.module.css"),
      "utf8",
    );

    expect(source).toMatch(/useEffectorController\(createEffectorClient\(\)\)/);
    expect(source).not.toMatch(/fetch\(|KPI|dashboard|\b(?:card|bento)\b/i);
    expect(styles).not.toMatch(
      /green|--astr-success|gradient\(|backdrop-filter|perspective|transform-style|@keyframes|animation\s*:|\b(?:card|bento)\b/i,
    );
    expect(styles).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(0,\s*0\.8fr\)/,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*980px\)[\s\S]*grid-template-columns:\s*1fr/,
    );
    expect(styles).toMatch(
      /\.chip\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /\.chip\s*>\s*span:first-child\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*\}/,
    );
    expect(styles).toMatch(
      /\.entryDescription\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*\}/,
    );
    expect(shellStyles).toMatch(/\.effectorDossier\s*\{/);
  });
});
