import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PolicyChipEditor } from "./PolicyChipEditor";

describe("PolicyChipEditor", () => {
  it("ignores composing Enter, then trims additions and rejects duplicates", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(
      <PolicyChipEditor
        label="允许的应用"
        placeholder="输入应用名称"
        items={["现有应用"]}
        locked={[]}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: "允许的应用" });

    fireEvent.change(input, { target: { value: "  新应用  " } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["现有应用", "新应用"]);

    view.rerender(
      <PolicyChipEditor
        label="允许的应用"
        placeholder="输入应用名称"
        items={["现有应用", "新应用"]}
        locked={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "允许的应用" }), {
      target: { value: " 新应用 " },
    });
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("labels removals, preserves locked items, and visibly marks the Core floor", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PolicyChipEditor
        label="危险类别"
        placeholder="输入危险类别"
        items={["core-delete", "custom-network"]}
        locked={["core-delete"]}
        labelMap={{
          "core-delete": "核心删除",
          "custom-network": "自定义网络",
        }}
        onChange={onChange}
      />,
    );

    const group = screen.getByRole("group", { name: "危险类别" });
    expect(within(group).getByText("核心删除")).toBeVisible();
    expect(within(group).getByText("Core 锁定")).toBeVisible();
    expect(within(group).queryByRole("button", { name: "移除 核心删除" })).toBeNull();

    await user.click(within(group).getByRole("button", { name: "移除 自定义网络" }));
    expect(onChange).toHaveBeenCalledWith(["core-delete"]);
  });

  it("disables its named input and every mutation control", () => {
    render(
      <PolicyChipEditor
        label="允许登录的网站"
        placeholder="输入站点"
        items={["example.test"]}
        locked={[]}
        disabled
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "允许登录的网站" })).toBeDisabled();
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled")))
      .toBe(true);
  });
});
