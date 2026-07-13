import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SegmentedRadio } from "./SegmentedRadio";

const OPTIONS = [
  { value: "ask", label: "请求" },
  { value: "audited", label: "自审核" },
  { value: "auto", label: "全自动" },
] as const;

describe("SegmentedRadio", () => {
  it("exposes one named radiogroup with true, roving radios", () => {
    render(
      <SegmentedRadio
        label="审批模式"
        value="ask"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: "审批模式" })).toBeVisible();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it("supports wrapping arrows and Home/End with one change and focus move per key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<(typeof OPTIONS)[number]["value"]>("ask");
      return (
        <SegmentedRadio
          label="审批模式"
          value={value}
          options={OPTIONS}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);
    screen.getByRole("radio", { name: "请求" }).focus();

    for (const [key, expected] of [
      ["{ArrowRight}", "自审核"],
      ["{ArrowDown}", "全自动"],
      ["{ArrowRight}", "请求"],
      ["{ArrowLeft}", "全自动"],
      ["{ArrowUp}", "自审核"],
      ["{Home}", "请求"],
      ["{End}", "全自动"],
    ] as const) {
      await user.keyboard(key);
      const radio = screen.getByRole("radio", { name: expected });
      expect(radio).toHaveAttribute("aria-checked", "true");
      expect(radio).toHaveFocus();
    }

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      "audited",
      "auto",
      "ask",
      "auto",
      "audited",
      "ask",
      "auto",
    ]);
  });

  it("prevents pointer and keyboard changes while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedRadio
        label="审批模式"
        value="ask"
        options={OPTIONS}
        disabled
        onChange={onChange}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios.every((radio) => radio.hasAttribute("disabled"))).toBe(true);
    await user.click(radios[1]);
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
