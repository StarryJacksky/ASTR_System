import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VisualMotionControlProvider } from "@/components/system/VisualMotionToggle";

import { StudioShell } from "./StudioShell";
import { StudioUnavailableWorkplane } from "./StudioUnavailableWorkplane";

function renderShell() {
  return render(
    <VisualMotionControlProvider>
      <StudioShell>
        <StudioUnavailableWorkplane />
      </StudioShell>
    </VisualMotionControlProvider>,
  );
}

describe("StudioShell", () => {
  it("marks the Studio surface and exposes only three real cross-space exits", () => {
    const { container } = renderShell();
    const surface = container.querySelector("[data-route-surface='studio']");
    const navigation = screen.getByRole("navigation", { name: "星枢四空间" });

    expect(surface).not.toBeNull();
    expect(container.querySelectorAll("[data-route-surface='studio']")).toHaveLength(1);
    expect(within(navigation).getAllByRole("link")).toHaveLength(3);
    expect(within(navigation).getByRole("link", { name: "Presence" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(navigation).getByRole("link", { name: "Control" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(within(navigation).getByRole("link", { name: "Mobile" })).toHaveAttribute(
      "href",
      "/mobile/presence",
    );
    expect(within(navigation).getByText("Studio")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(navigation).getByText("Studio").closest("a")).toBeNull();
    expect(within(surface as HTMLElement).getAllByRole("link")).toHaveLength(3);
    expect(within(surface as HTMLElement).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "切换昼夜主题" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /视觉动效/ })).toBeEnabled();
  });

  it("keeps the shared controls touch-safe and suppresses only Studio ambient layers", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/studio/components/StudioSurface.module.css"),
      "utf8",
    );
    const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toMatch(/\.spaceLink\s*\{[\s\S]*?min-inline-size:\s*var\(--touch-target\)/);
    expect(css).toMatch(/\.spaceLink\s*\{[\s\S]*?min-block-size:\s*var\(--touch-target\)/);
    expect(css).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.spaceLink:nth-child\(3\)\s*\{[\s\S]*?border-inline-start:\s*0/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.spaceNavigation\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    const narrowCss = css.split("@media (max-width: 360px)")[1] ?? "";
    expect(narrowCss).not.toMatch(/\.spaceNavigation\s*\{/);
    expect(globals).toContain(
      'body:has([data-route-surface="studio"]) .astr-ambient',
    );
    expect(globals).toContain(
      'body:has([data-route-surface="studio"]) .astr-grain',
    );
  });

  it("stays server-owned apart from the two existing shared controls", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/studio/components/StudioShell.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^['\"]use client['\"];|\buseEffect\b|\buseState\b/m);
    expect(source).not.toMatch(
      /\b(?:window|document|fetch|XMLHttpRequest|EventSource|WebSocket|sendBeacon)\b|process\.env|import\s*\(/,
    );
    expect(source.match(/<Link\b/g)).toHaveLength(3);
    expect(source.match(/prefetch=\{false\}/g)).toHaveLength(3);
    expect(source).toContain("<ThemeToggle />");
    expect(source).toContain("<VisualMotionRouteSlot");
  });
});
