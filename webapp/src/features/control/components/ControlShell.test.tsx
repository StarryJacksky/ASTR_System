import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControlShell } from "./ControlShell";

const usePathname = vi.fn(() => "/admin/effector");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

describe("Control shell", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/admin/effector");
  });

  it("exposes the sovereign spine, current dossier, atlas, and main target", () => {
    render(
      <ControlShell>
        <p>Effector workspace</p>
      </ControlShell>,
    );

    expect(screen.getByRole("link", { name: "返回 Presence" })).toHaveAttribute("href", "/");
    expect(screen.getByLabelText("当前档案")).toHaveTextContent("执行策略与审计");
    expect(screen.getByText("SURFACE W2")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("link", { name: "跳到模块索引" })).toHaveAttribute(
      "href",
      "#module-index",
    );
    expect(screen.getByRole("link", { name: /执行策略与审计/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the complete module atlas through a native disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ControlShell>
        <p>Effector workspace</p>
      </ControlShell>,
    );

    const disclosure = screen.getByText("模块索引").closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(screen.getByText("模块索引"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/admin/")))
      .toHaveLength(18);
  });

  it("uses a neutral Control index label at the root route", () => {
    usePathname.mockReturnValue("/admin");
    render(
      <ControlShell>
        <p>Index</p>
      </ControlShell>,
    );

    expect(screen.getByLabelText("当前档案")).toHaveTextContent("主权档案索引");
    expect(screen.queryByText("状态：可用")).toBeNull();
  });
});
