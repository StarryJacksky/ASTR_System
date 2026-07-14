import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ControlAtlas } from "./ControlAtlas";

describe("Control atlas", () => {
  it("renders the complete two-domain archive", () => {
    render(<ControlAtlas variant="page" />);

    expect(screen.getByRole("heading", { level: 1, name: "主权档案索引" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "系统域" })).getAllByRole("link"))
      .toHaveLength(10);
    expect(within(screen.getByRole("region", { name: "Soul 域" })).getAllByRole("link"))
      .toHaveLength(8);
    expect(screen.getByRole("link", { name: /执行策略与审计/ })).toHaveTextContent("可用");
  });

  it("labels every unavailable module as planned", () => {
    render(<ControlAtlas variant="page" />);

    expect(screen.getAllByText("规划中")).toHaveLength(17);
    expect(screen.getAllByText("可用")).toHaveLength(1);
  });

  it("filters locally by index, title, and subtitle without changing route truth", async () => {
    const user = userEvent.setup();
    render(<ControlAtlas variant="page" activeId="model-router" />);
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });

    for (const query of ["a03", "星门", "PROVIDER"]) {
      await user.clear(search);
      await user.type(search, query);
      const link = screen.getByRole("link", { name: /Provider 与模型路由/ });
      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(link).toHaveAttribute("href", "/admin/model-router");
      expect(link).toHaveAttribute("data-status", "planned");
      expect(link).toHaveAttribute("data-domain", "system");
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  it("announces an exact truthful no-result status", async () => {
    const user = userEvent.setup();
    render(<ControlAtlas variant="page" />);

    await user.type(screen.getByRole("searchbox", { name: "检索 18 个模块" }), "不存在的模块");

    expect(screen.getByRole("status")).toHaveTextContent(
      "未找到匹配档案 · 18 条真实路由保持不变",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("moves through only visible native links with wrapped Arrow navigation", async () => {
    const user = userEvent.setup();
    render(<ControlAtlas variant="page" />);
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });
    await user.type(search, "A0");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);

    await user.keyboard("{ArrowDown}");
    expect(links[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(links[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(links[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(links.at(-1)).toHaveFocus();

    search.focus();
    await user.keyboard("{ArrowUp}");
    expect(links.at(-1)).toHaveFocus();
    expect(fireEvent.keyDown(links.at(-1)!, { key: "Enter" })).toBe(true);
  });

  it("keeps focus in search when Arrow navigation has no results", async () => {
    const user = userEvent.setup();
    render(<ControlAtlas variant="page" />);
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });
    await user.type(search, "void");
    await user.keyboard("{ArrowDown}");
    expect(search).toHaveFocus();
  });

  it("clears root search on Escape and ignores composing or modified keys", async () => {
    const user = userEvent.setup();
    render(<ControlAtlas variant="page" />);
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });
    await user.type(search, "A03");

    fireEvent.keyDown(search, { key: "ArrowDown", isComposing: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown", keyCode: 229 });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown", altKey: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown", shiftKey: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "Escape", shiftKey: true });
    expect(search).toHaveValue("A03");

    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("link")).toHaveLength(18);
  });

  it("focuses disclosure search only on a closed-to-open transition", () => {
    const onDismiss = vi.fn();
    const view = render(
      <ControlAtlas
        variant="disclosure"
        open={false}
        onDismiss={onDismiss}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });
    expect(screen.getByRole("heading", { level: 2, name: "主权档案索引" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(search).not.toHaveFocus();

    view.rerender(
      <ControlAtlas
        variant="disclosure"
        open
        onDismiss={onDismiss}
      />,
    );
    expect(search).toHaveFocus();
  });

  it("clears disclosure state and reports distinct Escape and navigation dismissals", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ControlAtlas
        variant="disclosure"
        open
        onDismiss={onDismiss}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "检索 18 个模块" });
    await user.type(search, "A03");
    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(search).toHaveValue("A03");

    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenLastCalledWith("escape");
    expect(search).toHaveValue("");

    await user.type(search, "A03");
    const route = screen.getByRole("link", { name: /Provider 与模型路由/ });
    route.addEventListener("click", (event) => event.preventDefault());
    onDismiss.mockClear();
    fireEvent.click(route, { ctrlKey: true });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(search).toHaveValue("A03");

    await user.click(route);
    expect(onDismiss).toHaveBeenLastCalledWith("navigate");
    expect(search).toHaveValue("");
  });
});
