import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { EffectorActions } from "../controller/create-effector-controller";
import type { EffectorPolicy } from "../data/effector-client";
import { EffectorPolicyEditor } from "./EffectorPolicyEditor";

const POLICY: EffectorPolicy = {
  approval_mode: "ask",
  headless_scope: "cwd",
  headless_cwd: "D:/ASTR_System/astr",
  headless_folders: ["D:/ASTR_System/astr"],
  app_whitelist: ["Code.exe"],
  login_sites_whitelist: ["example.test"],
  dangerous_categories: ["payment", "network"],
  dangerous_keywords: ["删除", "上传"],
  max_steps_per_task: 25,
  sandbox_dir: "D:/ASTR_System/sandbox",
  core_dangerous_categories: ["payment"],
  core_dangerous_keywords: ["删除"],
  locked: ["sandbox_dir", "core_dangerous_categories"],
  overlay_path: "D:/ASTR_System/data/guard_policy.local.yaml",
};

function chipGroup(label: string) {
  return screen.getByRole("group", { name: label });
}

function addChip(label: string, value: string): void {
  const group = chipGroup(label);
  fireEvent.change(within(group).getByRole("textbox", { name: label }), {
    target: { value },
  });
  fireEvent.click(within(group).getByRole("button", { name: "添加" }));
}

function mutationControls(form: HTMLElement): HTMLElement[] {
  const scope = within(form);
  return [
    ...scope.queryAllByRole("button"),
    ...scope.queryAllByRole("radio"),
    ...scope.queryAllByRole("textbox"),
    ...scope.queryAllByRole("spinbutton"),
  ];
}

describe("EffectorPolicyEditor", () => {
  it("emits one complete writable policy key for each of the nine allowed fields", async () => {
    const user = userEvent.setup();
    const onPatch = vi
      .fn<EffectorActions["patchPolicy"]>()
      .mockResolvedValue(true);
    const view = render(
      <EffectorPolicyEditor policy={POLICY} savingPolicy={false} onPatch={onPatch} />,
    );

    await user.click(screen.getByRole("radio", { name: /^自审核/ }));
    await user.click(screen.getByRole("radio", { name: "白名单目录" }));
    const cwd = screen.getByRole("textbox", { name: "当前工作目录" });
    fireEvent.change(cwd, { target: { value: "D:/ASTR_System/next" } });
    fireEvent.blur(cwd);
    fireEvent.change(screen.getByRole("spinbutton", { name: "单任务最大步骤" }), {
      target: { value: "30" },
    });
    addChip("允许的应用", "Terminal.exe");
    addChip("允许登录的网站", "admin.example.test");
    addChip("危险类别", "filesystem");
    addChip("危险关键词", "覆盖");

    view.rerender(
      <EffectorPolicyEditor
        policy={{ ...POLICY, headless_scope: "folders" }}
        savingPolicy={false}
        onPatch={onPatch}
      />,
    );
    addChip("允许的文件夹", "D:/ASTR_System/docs");

    expect(onPatch.mock.calls.map(([patch]) => patch)).toEqual([
      { approval_mode: "audited" },
      { headless_scope: "folders" },
      { headless_cwd: "D:/ASTR_System/next" },
      { max_steps_per_task: 30 },
      { app_whitelist: ["Code.exe", "Terminal.exe"] },
      { login_sites_whitelist: ["example.test", "admin.example.test"] },
      { dangerous_categories: ["payment", "network", "filesystem"] },
      { dangerous_keywords: ["删除", "上传", "覆盖"] },
      { headless_folders: ["D:/ASTR_System/astr", "D:/ASTR_System/docs"] },
    ]);
    expect(onPatch.mock.calls.every(([patch]) => Object.keys(patch).length === 1)).toBe(true);
  });

  it("keeps Core floors non-removable and exposes immutable policy provenance", () => {
    render(<EffectorPolicyEditor policy={POLICY} savingPolicy={false} onPatch={vi.fn()} />);

    expect(screen.getByText(POLICY.sandbox_dir)).toBeVisible();
    expect(screen.getByText(POLICY.overlay_path)).toBeVisible();
    const source = screen.getByRole("region", { name: "只读来源证据" });
    expect(within(source).getByText(POLICY.headless_cwd)).toBeVisible();
    for (const field of POLICY.locked) expect(screen.getByText(field)).toBeVisible();

    const categories = chipGroup("危险类别");
    expect(within(categories).getByText("payment")).toBeVisible();
    expect(within(categories).queryByRole("button", { name: "移除 payment" })).toBeNull();
    const keywords = chipGroup("危险关键词");
    expect(within(keywords).getByText("删除")).toBeVisible();
    expect(within(keywords).queryByRole("button", { name: "移除 删除" })).toBeNull();
  });

  it("disables every ordinary policy mutation control only while saving", () => {
    const view = render(
      <EffectorPolicyEditor policy={POLICY} savingPolicy onPatch={vi.fn()} />,
    );
    const form = screen.getByRole("form", { name: "执行策略编辑" });
    const controls = mutationControls(form);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((control) => control.hasAttribute("disabled"))).toBe(true);

    view.rerender(
      <EffectorPolicyEditor policy={POLICY} savingPolicy={false} onPatch={vi.fn()} />,
    );
    expect(
      mutationControls(screen.getByRole("form", { name: "执行策略编辑" }))
        .some((control) => !control.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("keeps Task 5 styling static, rectangular, non-glass, and green-free", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/control/components/EffectorWorkspace.module.css"),
      "utf8",
    );

    expect(source).not.toMatch(/green|gradient\(|backdrop-filter|perspective|transform-style/i);
    expect(source).not.toMatch(/@keyframes|animation\s*:/i);
    expect(source).not.toMatch(/\b(?:card|bento)\b/i);
    expect(source).toMatch(/min-height:\s*var\(--touch-target\)/);
  });
});
