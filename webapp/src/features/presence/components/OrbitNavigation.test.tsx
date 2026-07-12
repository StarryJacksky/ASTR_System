import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  COMPACT_ORBIT_PATH,
  DESKTOP_ORBIT_PATH,
  OrbitNavigation,
  type PresenceOrbitEndpoint,
} from "./OrbitNavigation";

const ENDPOINTS: readonly PresenceOrbitEndpoint[] = ["soul", "dialogue", "life", "task"];

describe("Presence fixed orbit navigation", () => {
  it("exports two distinct immutable S-shaped path declarations", () => {
    expect(DESKTOP_ORBIT_PATH.trim()).not.toBe("");
    expect(COMPACT_ORBIT_PATH.trim()).not.toBe("");
    expect(DESKTOP_ORBIT_PATH).not.toBe(COMPACT_ORBIT_PATH);

    const source = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/OrbitNavigation.tsx"),
      "utf8",
    );
    expect(source).toMatch(/export const DESKTOP_ORBIT_PATH\s*=\s*["'][^"']+["']/);
    expect(source).toMatch(/export const COMPACT_ORBIT_PATH\s*=\s*["'][^"']+["']/);
  });

  it("keeps both predeclared path bytes unchanged through every active endpoint", () => {
    const view = render(
      <OrbitNavigation activeEndpoint="soul" onNavigate={vi.fn()} />,
    );
    const initialPaths = Array.from(
      view.container.querySelectorAll<SVGPathElement>("[data-orbit-path]"),
      (path) => path.getAttribute("d"),
    );

    expect(initialPaths).toEqual([DESKTOP_ORBIT_PATH, COMPACT_ORBIT_PATH]);

    for (const endpoint of ENDPOINTS) {
      view.rerender(
        <OrbitNavigation activeEndpoint={endpoint} onNavigate={vi.fn()} />,
      );
      expect(
        Array.from(
          view.container.querySelectorAll<SVGPathElement>("[data-orbit-path]"),
          (path) => path.getAttribute("d"),
        ),
      ).toEqual(initialPaths);
    }
  });

  it("hides one nonfocusable SVG and keeps all controls in neighboring DOM", () => {
    const { container } = render(
      <OrbitNavigation activeEndpoint="dialogue" onNavigate={vi.fn()} />,
    );
    const svg = container.querySelector("svg");

    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg?.querySelector("button, a, [tabindex]")).toBeNull();
    expect(screen.getByText("当前轨道端点：对话")).toBeVisible();
  });

  it("orders Soul, dialogue, Life, and the unavailable Task capability in the DOM", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <OrbitNavigation activeEndpoint="dialogue" onNavigate={onNavigate} />,
    );
    const nav = screen.getByRole("navigation", { name: "Presence 引力轨道" });
    const endpointOrder = Array.from(
      nav.querySelectorAll<HTMLElement>("[data-orbit-endpoint]"),
      (endpoint) => endpoint.dataset.orbitEndpoint,
    );

    expect(endpointOrder).toEqual(ENDPOINTS);
    expect(screen.getByRole("button", { name: "前往 Soul" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: "前往对话" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "前往 Life" })).not.toHaveAttribute(
      "aria-current",
    );

    fireEvent.click(screen.getByRole("button", { name: "前往 Soul" }));
    fireEvent.click(screen.getByRole("button", { name: "前往对话" }));
    fireEvent.click(screen.getByRole("button", { name: "前往 Life" }));
    expect(onNavigate.mock.calls).toEqual([["soul"], ["dialogue"], ["life"]]);

    const taskBoundary = screen.getByText("远程任务尚未启用").closest(
      "[data-orbit-endpoint='task']",
    );
    expect(within(taskBoundary as HTMLElement).getByRole("group", { name: "Task 能力" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(taskBoundary).not.toHaveAttribute("aria-current");
    expect(within(taskBoundary as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(within(taskBoundary as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(taskBoundary).not.toHaveTextContent(/\d+|进度|trace|执行|发送|创建/);
    expect(container).not.toHaveTextContent("semantic.task");
  });

  it("never marks unavailable Task current even when it is the selected boundary", () => {
    render(<OrbitNavigation activeEndpoint="task" onNavigate={vi.fn()} />);

    expect(screen.getByText("Task 能力边界：远程任务尚未启用")).toBeVisible();
    expect(screen.queryByText(/当前轨道端点：.*Task/)).not.toBeInTheDocument();
    expect(
      screen.getByText("远程任务尚未启用").closest("[data-orbit-endpoint='task']"),
    ).not.toHaveAttribute("aria-current");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  it("uses token-sized controls, CSS breakpoint path selection, and requests no runtime work", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/OrbitNavigation.module.css"),
      "utf8",
    );
    const source = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/OrbitNavigation.tsx"),
      "utf8",
    );
    expect(css).toMatch(/\.endpointAction[\s\S]*?min-inline-size:\s*var\(--touch-target\)/);
    expect(css).toMatch(/\.endpointAction[\s\S]*?min-block-size:\s*var\(--touch-target\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*768px\)[\s\S]*?\.orbitNavigation\s*\{[^}]*min-block-size:\s*7\.25rem/,
    );
    expect(css).toMatch(/\.desktopPath[\s\S]*?\.compactPath/);
    expect(css).toMatch(/\.orbitNavigation[\s\S]*?min-block-size:\s*7\.5rem/);
    expect(css).toMatch(/\.endpointAction,[\s\S]*?\.taskBoundary[\s\S]*?border-radius:\s*0/);
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(source).not.toMatch(/eyebrow|endpointIndex|"01"|"02"|"03"/);
    expect(css).not.toContain("(2 * var(");
    expect(css).not.toMatch(/\banimation(?:-\w+)?\s*:/);
    expect(source).not.toMatch(
      /requestAnimationFrame|setTimeout|setInterval|ResizeObserver|IntersectionObserver/,
    );

    const originalRaf = window.requestAnimationFrame;
    const raf = vi.fn();
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: raf,
    });
    const timeout = vi.spyOn(window, "setTimeout");
    const interval = vi.spyOn(window, "setInterval");

    try {
      const view = render(
        <OrbitNavigation activeEndpoint="soul" onNavigate={vi.fn()} />,
      );
      view.rerender(
        <OrbitNavigation activeEndpoint="life" onNavigate={vi.fn()} />,
      );
      expect(raf).not.toHaveBeenCalled();
      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      interval.mockRestore();
      if (originalRaf) {
        Object.defineProperty(window, "requestAnimationFrame", {
          configurable: true,
          writable: true,
          value: originalRaf,
        });
      } else {
        Reflect.deleteProperty(window, "requestAnimationFrame");
      }
    }
  });
});
