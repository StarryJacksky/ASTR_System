import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-visual-motion");
    semanticStore.setState({
      ...initialSemanticState,
      announcement: null,
    });
  });

  it("provides one main target, one announcer, and a 44px visual-motion control", () => {
    render(
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
    expect(screen.getByRole("button", { name: "暂停视觉动态" })).toHaveStyle({
      minWidth: "var(--touch-target)",
      minHeight: "var(--touch-target)",
    });
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
    await user.click(screen.getByRole("button", { name: "暂停视觉动态" }));

    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");
    expect(localStorage.getItem("astr.visual-motion")).toBe("paused");
    expect(screen.getByRole("button", { name: "恢复视觉动态" })).toBeEnabled();
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

    const resume = await screen.findByRole("button", { name: "恢复视觉动态" });
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
    expect(screen.getByRole("button", { name: "暂停视觉动态" })).toBeEnabled();
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

    fireEvent.click(screen.getByRole("button", { name: "暂停视觉动态" }));

    expect(semanticStore.getState().motion).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-visual-motion", "paused");
    expect(screen.getByRole("button", { name: "恢复视觉动态" })).toBeEnabled();

    act(() => vi.runOnlyPendingTimers());
    expect(semanticStore.getState().motion).toBe("paused");
  });
});
