import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlAtlas } from "./ControlAtlas";

describe("Control atlas", () => {
  it("renders the complete two-domain archive", () => {
    render(<ControlAtlas />);

    expect(within(screen.getByRole("region", { name: "系统域" })).getAllByRole("link"))
      .toHaveLength(10);
    expect(within(screen.getByRole("region", { name: "Soul 域" })).getAllByRole("link"))
      .toHaveLength(8);
    expect(screen.getByRole("link", { name: /执行策略与审计/ })).toHaveTextContent("可用");
  });

  it("labels every unavailable module as planned", () => {
    render(<ControlAtlas />);

    expect(screen.getAllByText("规划中")).toHaveLength(17);
    expect(screen.getAllByText("可用")).toHaveLength(1);
  });
});
