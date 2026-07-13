import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
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

    const spaceLinks = screen.getByRole("navigation", { name: "跨空间" });
    expect(within(spaceLinks).getAllByRole("link")).toHaveLength(2);
    expect(within(spaceLinks).getByRole("link", { name: "返回 Presence" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(spaceLinks).getByRole("link", { name: "Mobile" })).toHaveAttribute(
      "href",
      "/mobile/presence",
    );
    expect(screen.getAllByRole("link", { name: "返回 Presence" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Mobile" })).toHaveLength(1);
    expect(screen.getByLabelText("当前档案")).toHaveTextContent("执行策略与审计");
    expect(screen.getByText("SURFACE W2")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("link", { name: "跳到模块索引" })).toHaveAttribute(
      "href",
      "#module-index",
    );
    expect(screen.getByRole("link", { name: /执行策略与审计/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const breadcrumb = screen.getByRole("navigation", { name: "模块面包屑" });
    expect(breadcrumb).toHaveTextContent("Control");
    expect(breadcrumb).toHaveTextContent("Soul 域");
    expect(breadcrumb).toHaveTextContent("执行策略与审计");
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

  it("opens and focuses the atlas disclosure from the local skip link", async () => {
    const user = userEvent.setup();
    render(
      <ControlShell>
        <p>Effector workspace</p>
      </ControlShell>,
    );

    const summary = screen.getByText("模块索引").closest("summary");
    const disclosure = summary?.closest("details");
    expect(summary).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(screen.getByRole("link", { name: "跳到模块索引" }));

    expect(disclosure).toHaveAttribute("open");
    expect(summary).toHaveFocus();
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

  it("keeps the two cross-space links in distinct desktop and compact spine slots", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/control/components/ControlShell.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/features/control/components/ControlShell.module.css"),
      "utf8",
    );
    const mobileLink =
      source.match(/<Link(?=[^>]*href="\/mobile\/presence")[^>]*>[\s\S]*?<\/Link>/)?.[0] ?? "";
    const desktopSpaceLinks = css.match(/\.spaceLinks\s*\{([^}]*)\}/)?.[1] ?? "";
    const spaceLink = css.match(/\.spaceLink\s*\{([^}]*)\}/)?.[1] ?? "";
    const compactCss = css.slice(css.indexOf("@media (max-width: 760px)"));
    const compactSpine = compactCss.match(/\.spine\s*\{([^}]*)\}/)?.[1] ?? "";
    const compactSpaceLinks = compactCss.match(/\.spaceLinks\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(source).toMatch(/<nav className=\{styles\.spaceLinks\} aria-label="跨空间">/);
    expect(source.match(/href="\/mobile\/presence"/g)).toHaveLength(1);
    expect(mobileLink).toMatch(/prefetch=\{false\}/);
    expect(source).not.toMatch(/styles\.presenceLink/);
    expect(css).not.toMatch(/\.presenceLink\b/);

    expect(desktopSpaceLinks).toMatch(/display:\s*grid/);
    expect(desktopSpaceLinks).toMatch(/margin-top:\s*auto/);
    expect(desktopSpaceLinks).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(desktopSpaceLinks).toMatch(
      /grid-auto-rows:\s*minmax\(var\(--touch-target\),\s*auto\)/,
    );
    expect(spaceLink).toMatch(/min-inline-size:\s*var\(--touch-target\)/);
    expect(spaceLink).toMatch(/min-block-size:\s*var\(--touch-target\)/);

    expect(compactSpine).toMatch(
      /grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(compactSpaceLinks).toMatch(/grid-column:\s*2\s*\/\s*-1/);
    expect(compactSpaceLinks).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(compactSpaceLinks).not.toMatch(/grid-column:\s*3\b/);
  });
});
