import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { semanticStore } from "@/lib/semantic-store";
import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import { MobileShell } from "./MobileShell";

let pathname = "/mobile/tasks";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly href: string;
    readonly prefetch?: boolean;
  }) => <a href={href} data-prefetch={String(prefetch)} {...props} />,
}));
vi.mock("@/components/astr/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">切换昼夜主题</button>,
}));
vi.mock("@/components/system/VisualMotionToggle", () => ({
  VisualMotionRouteSlot: ({ className }: { readonly className?: string }) => (
    <span className={className} data-visual-motion-route-slot="">
      <button className="astr-motion-toggle" type="button">暂停视觉动效</button>
    </span>
  ),
}));

function tree(serverAuthorityTrusted: boolean, children: ReactNode = <h1>任务</h1>) {
  return (
    <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
      <MobileShell>{children}</MobileShell>
    </MobileAuthorityProvider>
  );
}

describe("MobileShell", () => {
  beforeEach(() => {
    pathname = "/mobile/tasks";
    document.getElementById("__next-route-announcer__")?.remove();
    semanticStore.getState().clearAnnouncement();
  });

  afterEach(() => {
    document.getElementById("__next-route-announcer__")?.remove();
    vi.restoreAllMocks();
  });

  it("renders one semantic main and the exact current five-domain nav", () => {
    const { container } = render(tree(true));
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "Mobile 五域" });

    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).getByRole("link", { name: /任务/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: /任务/ })).toHaveAttribute(
      "href",
      "/mobile/tasks",
    );
    expect(container.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });

  it("shows local authority and cross-space controls only after trust", () => {
    render(tree(true));

    expect(screen.getByText("本机可信入口")).toBeVisible();
    expect(screen.getByRole("button", { name: "切换昼夜主题" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "暂停视觉动效" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "返回 Presence" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "返回 Presence" })).toHaveAttribute(
      "data-prefetch",
      "false",
    );
  });

  it("renders the remote phase without a Presence bypass", () => {
    render(tree(false));

    expect(screen.getByText("远程来源未授权")).toBeVisible();
    expect(screen.queryByRole("link", { name: "返回 Presence" })).toBeNull();
  });

  it("server-renders trusted evidence as checking without a Presence bypass", () => {
    const html = renderToString(tree(true));

    expect(html).toContain("核验本机来源");
    expect(html).not.toContain("返回 Presence");
  });

  it("retains the static aria-hidden relay curve", () => {
    const { container } = render(tree(true));
    const curve = container.querySelector("svg[data-mobile-relay-curve]");

    expect(curve).toHaveAttribute("aria-hidden", "true");
    expect(curve?.querySelectorAll("path")).toHaveLength(1);
  });

  it("owns one Mobile live region by silencing and restoring Next's route announcer", async () => {
    const nextAnnouncer = document.createElement("div");
    nextAnnouncer.id = "__next-route-announcer__";
    nextAnnouncer.setAttribute("aria-live", "assertive");
    nextAnnouncer.setAttribute("role", "alert");
    document.body.append(nextAnnouncer);

    const view = render(tree(true));

    await waitFor(() => {
      expect(nextAnnouncer).not.toHaveAttribute("aria-live");
      expect(nextAnnouncer).not.toHaveAttribute("role");
      expect(nextAnnouncer).toHaveAttribute("aria-hidden", "true");
    });

    view.unmount();
    expect(nextAnnouncer).toHaveAttribute("aria-live", "assertive");
    expect(nextAnnouncer).toHaveAttribute("role", "alert");
    expect(nextAnnouncer).not.toHaveAttribute("aria-hidden");
  });

  it("publishes Mobile route changes through the application announcer", async () => {
    const announce = vi.spyOn(semanticStore.getState(), "announce");
    const view = render(tree(true));
    announce.mockClear();

    pathname = "/mobile/knowledge";
    view.rerender(tree(true, <h1>知识</h1>));

    await waitFor(() => {
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith("已进入 知识");
    });
  });

  it("keeps Shell production files free of domain business imports", () => {
    const source = ["MobileShell.tsx", "MobileHeader.tsx", "FiveDomainNav.tsx"]
      .map((file) =>
        readFileSync(resolve(process.cwd(), `src/features/mobile/shell/${file}`), "utf8"),
      )
      .join("\n");

    expect(source).not.toMatch(
      /features\/(presence|control)|mobile\/(tasks|presence|workbench|knowledge|safety)|CoreClient|SafetyClient|fetch\s*\(|import\s*\(/,
    );
  });

  it("owns safe areas and rejects forbidden Mobile visual techniques", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/mobile/shell/MobileShell.module.css"),
      "utf8",
    );

    const rule = (selector: "shell" | "header" | "main") => {
      const match = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
      expect(match, `.${selector} rule`).not.toBeNull();
      return match?.[1] ?? "";
    };
    const shellRule = rule("shell");
    const headerRule = rule("header");
    const mainRule = rule("main");

    expect(shellRule).toMatch(/min-height:\s*100dvh/);
    expect(shellRule).toMatch(/block-size:\s*100dvh/);
    expect(shellRule).toMatch(/overflow-y:\s*auto/);
    expect(shellRule).toMatch(/scroll-padding-bottom:[^;]*safe-area-inset-bottom[^;]*;/);
    expect(headerRule).toMatch(/padding[^;]*safe-area-inset-top/);
    expect(headerRule).toMatch(/padding-inline-start:[^;]*safe-area-inset-left[^;]*;/);
    expect(headerRule).toMatch(/padding-inline-end:[^;]*safe-area-inset-right[^;]*;/);
    expect(mainRule).toMatch(/padding-inline-start:[^;]*safe-area-inset-left[^;]*;/);
    expect(mainRule).toMatch(/padding-inline-end:[^;]*safe-area-inset-right[^;]*;/);
    expect(mainRule).toMatch(/padding-bottom:[^;]*safe-area-inset-bottom[^;]*;/);
    expect(css).toMatch(/min-inline-size:\s*var\(--touch-target\)/);
    expect(css).toMatch(/gap:\s*8px/);
    expect(css).toMatch(/inline-size:\s*min\(100%,\s*76rem\)/);
    expect(css).toMatch(/\.motionSlot\s+:global\(\.astr-motion-toggle\)[\s\S]*position:\s*static/);
    expect(css).not.toMatch(
      /gradient|backdrop-filter|@keyframes|animation\s*:|requestAnimationFrame|canvas|webgl|pixi|live2d|three|framer-motion|\bgreen\b/i,
    );
  });
});
