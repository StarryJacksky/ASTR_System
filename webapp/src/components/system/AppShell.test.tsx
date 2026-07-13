import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import { AppShell } from "./AppShell";
import {
  VisualMotionControlProvider,
  VisualMotionRouteSlot,
} from "./VisualMotionToggle";

const ORIGINAL_SEMANTIC_DISPATCH = semanticStore.getState().dispatch;

function reducedMotionMediaQuery(): MediaQueryList {
  return {
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
}

function RouteSlotHarness() {
  const [placement, setPlacement] = useState<"fallback" | "first" | "second">("fallback");

  return (
    <main id="main-content">
      <button type="button" onClick={() => setPlacement("first")}>
        注册页头插槽
      </button>
      <button type="button" onClick={() => setPlacement("second")}>
        替换页头插槽
      </button>
      <button type="button" onClick={() => setPlacement("fallback")}>
        移除页头插槽
      </button>
      {placement === "first" && (
        <div data-testid="first-motion-host">
          <VisualMotionRouteSlot />
        </div>
      )}
      {placement === "second" && (
        <div data-testid="second-motion-host">
          <VisualMotionRouteSlot />
        </div>
      )}
    </main>
  );
}

describe("AppShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-visual-motion");
    semanticStore.setState({
      ...initialSemanticState,
      announcement: null,
      dispatch: ORIGINAL_SEMANTIC_DISPATCH,
    });
  });

  it("suppresses global ambient and grain from the Mobile SSR witness", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = css.match(
      /body:has\(\[data-route-surface="mobile"\]\) \.astr-ambient,[\s\S]*?body:has\(\[data-route-surface="mobile"\]\) \.astr-grain\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*none/);
    expect(rule).toMatch(/animation:\s*none/);
    expect(rule).toMatch(/background:\s*none/);
  });

  it("provides one main target, one announcer, and a 44px fallback visual-motion control", () => {
    const { container } = render(
      <AppShell>
        <main id="main-content">内容</main>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "暂停视觉动效" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "暂停视觉动效" })).toHaveStyle({
      minWidth: "var(--touch-target)",
      minHeight: "var(--touch-target)",
    });
    expect(container.querySelector("[data-visual-motion-route-slot]")).toBeNull();
  });

  it("announces each semantic-store message through the single atomic live region", () => {
    const { container } = render(
      <AppShell>
        <main id="main-content">内容</main>
      </AppShell>,
    );

    act(() => semanticStore.getState().announce("Core 已接收 · trc_1"));

    expect(screen.getByRole("status")).toHaveTextContent("Core 已接收 · trc_1");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);

    act(() => semanticStore.getState().announce("执行已停止", "assertive"));

    expect(screen.getByRole("alert")).toHaveTextContent("执行已停止");
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("pauses visual motion persistently without disabling child content", async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <main id="main-content">
          <button type="button">继续操作</button>
        </main>
      </AppShell>,
    );

    await waitFor(() => expect(semanticStore.getState().motion).toBe("full"));
    await user.click(screen.getByRole("button", { name: "暂停视觉动效" }));

    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");
    expect(localStorage.getItem("astr.visual-motion")).toBe("paused");
    expect(screen.getByRole("button", { name: "恢复视觉动效" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "继续操作" })).toBeEnabled();
  });

  it("restores the persisted preference and can resume visual motion", async () => {
    const user = userEvent.setup();
    localStorage.setItem("astr.visual-motion", "paused");

    render(
      <AppShell>
        <main id="main-content">内容</main>
      </AppShell>,
    );

    const resume = await screen.findByRole("button", { name: "恢复视觉动效" });
    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");

    await user.click(resume);

    expect(semanticStore.getState().motion).toBe("full");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "full");
    expect(localStorage.getItem("astr.visual-motion")).toBe("full");
  });

  it("falls back safely when the persisted preference cannot be read", () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    render(
      <AppShell>
        <main id="main-content">内容</main>
      </AppShell>,
    );

    expect(() => act(() => vi.runOnlyPendingTimers())).not.toThrow();
    expect(semanticStore.getState().motion).toBe("full");
    expect(screen.getByRole("button", { name: "暂停视觉动效" })).toBeEnabled();
  });

  it("still pauses for the session when the preference cannot be written", () => {
    vi.useFakeTimers();
    render(
      <AppShell>
        <main id="main-content">内容</main>
      </AppShell>,
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    fireEvent.click(screen.getByRole("button", { name: "暂停视觉动效" }));

    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");
    expect(screen.getByRole("button", { name: "恢复视觉动效" })).toBeEnabled();

    act(() => vi.runOnlyPendingTimers());
    expect(semanticStore.getState().motion).toBe("paused");
  });

  it("does not overwrite a system reduced-motion preference during delayed restore", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotionMediaQuery());
    const realDispatch = semanticStore.getState().dispatch;
    const dispatch = vi.fn(realDispatch);
    semanticStore.setState({ motion: "reduced", dispatch });

    render(
      <VisualMotionControlProvider>
        <main id="main-content">内容</main>
      </VisualMotionControlProvider>,
    );

    act(() => vi.runOnlyPendingTimers());

    expect(semanticStore.getState().motion).toBe("reduced");
    expect(dispatch).not.toHaveBeenCalledWith({ type: "VISUAL_RESUME" });
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "reduced");
  });

  it("resumes from user pause into system reduced motion while persisting the user choice", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotionMediaQuery());
    localStorage.setItem("astr.visual-motion", "paused");
    semanticStore.setState({ motion: "paused" });

    render(
      <VisualMotionControlProvider>
        <main id="main-content">内容</main>
      </VisualMotionControlProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复视觉动效" }));

    expect(semanticStore.getState().motion).toBe("reduced");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "reduced");
    expect(localStorage.getItem("astr.visual-motion")).toBe("full");
    expect(screen.getByRole("button", { name: "暂停视觉动效" })).toBeEnabled();

    act(() => vi.runOnlyPendingTimers());
    expect(semanticStore.getState().motion).toBe("reduced");
  });

  it("portals the one owned motion control into a registered route slot", async () => {
    const { container } = render(
      <AppShell>
        <main id="main-content">
          <div data-testid="route-motion-host">
            <VisualMotionRouteSlot />
          </div>
        </main>
      </AppShell>,
    );

    const host = screen.getByTestId("route-motion-host");
    await waitFor(() =>
      expect(within(host).getByRole("button", { name: "暂停视觉动效" })).toBeEnabled(),
    );
    expect(screen.getAllByRole("button", { name: "暂停视觉动效" })).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("restores the fixed fallback when the route slot is removed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <RouteSlotHarness />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "注册页头插槽" }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("first-motion-host")).getByRole("button", {
          name: "暂停视觉动效",
        }),
      ).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "移除页头插槽" }));

    await waitFor(() => expect(screen.queryByTestId("first-motion-host")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "暂停视觉动效" })).toHaveLength(1);
    expect(container.querySelector("[data-visual-motion-route-slot]")).toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("preserves paused state and preference while moving the control", async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <RouteSlotHarness />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "暂停视觉动效" }));
    await user.click(screen.getByRole("button", { name: "注册页头插槽" }));

    await waitFor(() =>
      expect(
        within(screen.getByTestId("first-motion-host")).getByRole("button", {
          name: "恢复视觉动效",
        }),
      ).toBeEnabled(),
    );
    expect(screen.getAllByRole("button", { name: "恢复视觉动效" })).toHaveLength(1);
    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");
    expect(localStorage.getItem("astr.visual-motion")).toBe("paused");
  });

  it("keeps the newer route slot registered through Strict Mode replacement", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StrictMode>
        <AppShell>
          <RouteSlotHarness />
        </AppShell>
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "注册页头插槽" }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("first-motion-host")).getByRole("button", {
          name: "暂停视觉动效",
        }),
      ).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "替换页头插槽" }));

    await waitFor(() =>
      expect(
        within(screen.getByTestId("second-motion-host")).getByRole("button", {
          name: "暂停视觉动效",
        }),
      ).toBeEnabled(),
    );
    expect(screen.getAllByRole("button", { name: "暂停视觉动效" })).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});
