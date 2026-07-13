import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { EffectorPolicy } from "../data/effector-client";
import { EffectorPolicyEditor } from "./EffectorPolicyEditor";
import { SafetyControl } from "./SafetyControl";

const POLICY: EffectorPolicy = {
  approval_mode: "ask",
  headless_scope: "full",
  headless_cwd: "D:/ASTR_System/astr",
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

const LABELS = {
  checking: "触发急停 · 状态检查中",
  clear: "触发急停",
  latched: "急停已闩锁 · 请求复位",
  unknown: "安全状态未知 · 重新触发急停",
} as const;

function mutationControls(form: HTMLElement): HTMLElement[] {
  const scope = within(form);
  return [
    ...scope.queryAllByRole("button"),
    ...scope.queryAllByRole("radio"),
    ...scope.queryAllByRole("textbox"),
    ...scope.queryAllByRole("spinbutton"),
  ];
}

describe("SafetyControl", () => {
  it.each(Object.entries(LABELS))("renders %s as explicit controlled evidence", (evidence, label) => {
    render(
      <SafetyControl
        evidence={evidence as keyof typeof LABELS}
        mutation={null}
        onEstop={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("calls e-stop from clear/unknown and reset from latched without flipping local truth", async () => {
    const user = userEvent.setup();
    const onEstop = vi.fn(async () => true);
    const onReset = vi.fn(async () => true);
    const view = render(
      <SafetyControl
        evidence="clear"
        mutation={null}
        onEstop={onEstop}
        onReset={onReset}
      />,
    );

    await user.click(screen.getByRole("button", { name: LABELS.clear }));
    expect(onEstop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: LABELS.clear })).toBeVisible();

    view.rerender(
      <SafetyControl
        evidence="unknown"
        mutation={null}
        onEstop={onEstop}
        onReset={onReset}
      />,
    );
    await user.click(screen.getByRole("button", { name: LABELS.unknown }));
    expect(onEstop).toHaveBeenCalledTimes(2);

    view.rerender(
      <SafetyControl
        evidence="latched"
        mutation={null}
        onEstop={onEstop}
        onReset={onReset}
      />,
    );
    await user.click(screen.getByRole("button", { name: LABELS.latched }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: LABELS.latched })).toBeVisible();
  });

  it("remains independently callable while every ordinary policy control is saving-disabled", async () => {
    const user = userEvent.setup();
    const onEstop = vi.fn(async () => true);
    render(
      <>
        <EffectorPolicyEditor policy={POLICY} savingPolicy onPatch={vi.fn()} />
        <SafetyControl
          evidence="clear"
          mutation={null}
          onEstop={onEstop}
          onReset={vi.fn()}
        />
      </>,
    );

    const form = screen.getByRole("form", { name: "执行策略编辑" });
    expect(
      mutationControls(form)
        .every((control) => control.hasAttribute("disabled")),
    ).toBe(true);
    const safetyButton = screen.getByRole("button", { name: LABELS.clear });
    expect(safetyButton).toBeEnabled();
    await user.click(safetyButton);
    expect(onEstop).toHaveBeenCalledTimes(1);
  });

  it("keeps checking e-stop capable and disables only in-flight safety actions", async () => {
    const user = userEvent.setup();
    const onEstop = vi.fn();
    const view = render(
      <SafetyControl
        evidence="checking"
        mutation={null}
        onEstop={onEstop}
        onReset={vi.fn()}
      />,
    );
    const checkingButton = screen.getByRole("button", { name: LABELS.checking });
    expect(checkingButton).toBeEnabled();
    await user.click(checkingButton);
    expect(onEstop).toHaveBeenCalledTimes(1);

    view.rerender(
      <SafetyControl
        evidence="clear"
        mutation="estop"
        onEstop={onEstop}
        onReset={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: LABELS.clear });
    expect(button).toBeDisabled();
    expect(screen.getByText("等待 Core 权威回读")).toBeVisible();
    await user.click(button);
    expect(onEstop).toHaveBeenCalledTimes(1);
  });
});
