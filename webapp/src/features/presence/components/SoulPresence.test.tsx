import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SoulPresence } from "./SoulPresence";

describe("static Soul presence", () => {
  it("keeps a hidden nonfocusable lens adjacent to truthful fallback text", () => {
    const { container } = render(
      <SoulPresence visualRuntime="loading" />,
    );
    const lens = container.querySelector("[data-static-soul-lens]");
    const fallback = screen.getByText("动态视觉场尚未接入；静态 Soul 持续可用。");

    expect(lens?.tagName).toBe("svg");
    expect(lens).toHaveAttribute("aria-hidden", "true");
    expect(lens).toHaveAttribute("focusable", "false");
    expect(lens?.querySelector("[tabindex]")).toBeNull();
    expect(lens?.nextElementSibling).toBe(fallback);
    expect(fallback).toHaveAttribute("data-visual-runtime", "loading");
  });

  it("uses only a nonblank display name and otherwise preserves the generic Soul noun", () => {
    const view = render(
      <SoulPresence displayName="   " visualRuntime="ready" />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Soul" })).toBeVisible();
    expect(view.container).not.toHaveTextContent("显示名未提供：");

    view.rerender(
      <SoulPresence displayName="  澄月  " visualRuntime="ready" />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "澄月" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2, name: "Soul" })).not.toBeInTheDocument();
  });

  it("keeps static Soul present across runtime evidence and states provenance as unavailable", () => {
    const view = render(
      <SoulPresence
        activity="正在整理记忆"
        model="astr-local"
        visualConfigured
        visualRuntime="loading"
        visualSlot={<span data-testid="configured-slot" />}
      />,
    );

    expect(view.container.querySelector("[data-static-soul-lens]")).toBeInTheDocument();
    expect(screen.getByText("当前活动：正在整理记忆")).toBeVisible();
    expect(screen.getByText("模型外壳：astr-local")).toBeVisible();
    expect(screen.getByText(/provenance：未提供/i)).toBeVisible();
    expect(view.container).not.toHaveTextContent(/provenance[^\n]*\d+%/i);

    view.rerender(
      <SoulPresence
        activity="正在整理记忆"
        model="astr-local"
        visualConfigured
        visualRuntime="contextLost"
        visualSlot={<span data-testid="configured-slot" />}
      />,
    );
    expect(view.container.querySelector("[data-static-soul-lens]")).toBeInTheDocument();
    expect(screen.getByText("视觉呈现暂不可用；已保持静态 Soul。"))
      .toHaveAttribute("data-visual-runtime", "contextLost");

    view.rerender(
      <SoulPresence
        activity="正在整理记忆"
        model="astr-local"
        visualConfigured
        visualRuntime="ready"
        visualSlot={<span data-testid="configured-slot" />}
      />,
    );
    expect(view.container.querySelector("[data-static-soul-lens]")).toBeInTheDocument();
    expect(screen.getByText("视觉呈现已就绪；静态 Soul 仍作为连续性锚点。"))
      .toHaveAttribute("data-visual-runtime", "ready");
  });

  it("keeps the reserved visual slot inert beside the static fallback", () => {
    const { container } = render(
      <SoulPresence
        visualRuntime="ready"
        visualSlot={<div data-testid="reserved-visual-slot">reserved visual</div>}
      />,
    );

    expect(screen.getByTestId("reserved-visual-slot")).toBeVisible();
    expect(screen.getByTestId("reserved-visual-slot").parentElement)
      .not.toHaveAttribute("aria-hidden");
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("[data-static-soul-lens]")).toBeInTheDocument();
  });

  it("mounts the visual Host by default without replacing the static Soul or provenance", () => {
    const { container } = render(<SoulPresence visualRuntime="loading" />);

    expect(container.querySelector("[data-presence-visual-host]")).toBeInTheDocument();
    expect(container.querySelector("[data-presence-visual-surface]"))
      .toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-static-soul-lens]")).toBeInTheDocument();
    expect(screen.getByText(/provenance：未提供/i)).toBeVisible();
  });

  it("configures the production scene without removing the static fallback or license truth", async () => {
    const { container } = render(
      <SoulPresence visualConfigured visualRuntime="loading" />,
    );

    expect(container.querySelector("[data-static-soul-lens]"))
      .toHaveAttribute("data-soul-lens-fallback", "static");
    expect(
      screen.getByText(
        "This content uses sample data owned and copyrighted by Live2D Inc.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(container.querySelector("[data-presence-visual-host]"))
        .not.toHaveAttribute("data-visual-status", "notConfigured"),
    );
    expect(container.querySelector("[data-presence-visual-copy]"))
      .not.toHaveClass("sr-only");
  });

  it("declares a static token-only Soul material without continuous motion", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/SoulPresence.module.css"),
      "utf8",
    );
    const soulSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/SoulPresence.tsx"),
      "utf8",
    );
    const lensSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/StaticSoulLens.tsx"),
      "utf8",
    );

    expect(css).toMatch(/var\(--astr-(?:surface|soul|text|hairline)/);
    expect(css).not.toMatch(/\banimation(?:-\w+)?\s*:/);
    expect(css).not.toMatch(/\btransition(?:-\w+)?\s*:/);
    expect(css).toMatch(
      /\.visualSlot\s+:global\(\[data-presence-visual-copy\]\)\s*\{[^}]*position:\s*absolute[^}]*inset-block-end:\s*var\(--space-2\)/,
    );
    expect(`${soulSource}\n${lensSource}`).not.toMatch(
      /requestAnimationFrame|setTimeout|setInterval|getContext|PIXI|pixi|Live2D|Ticker\.shared|IntersectionObserver/,
    );
  });

  it("shapes the Soul shell with the one constitutional 14px eclipse notch", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/SoulPresence.module.css"),
      "utf8",
    );
    const shellRule = css.match(/\.soulPresence\s*\{([^}]*)\}/)?.[1];
    const eclipseRule = css.match(/\.soulPresence::before\s*\{([^}]*)\}/)?.[1];

    expect(shellRule).toContain("clip-path: polygon(");
    expect(shellRule).toContain("--soul-shell-cut: var(--corner-signature)");
    expect(shellRule).not.toContain("border-radius: var(--radius-large)");
    expect(eclipseRule).toContain("border-radius: 50%");
    expect(eclipseRule).toContain("border-inline-end-color: transparent");
    expect(eclipseRule).toContain("pointer-events: none");
    expect(shellRule?.match(/var\(--soul-shell-cut\)/g)).toHaveLength(2);
    expect(css).not.toMatch(/--soul-shell-cut:\s*(?:clamp|var\(--space-5\))/);
  });
});
