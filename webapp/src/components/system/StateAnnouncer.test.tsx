import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import { StateAnnouncer } from "./StateAnnouncer";

describe("StateAnnouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
    semanticStore.setState({ ...initialSemanticState, announcement: null });
  });

  afterEach(() => {
    semanticStore.setState({ ...initialSemanticState, announcement: null });
    vi.useRealTimers();
  });

  it("publishes at most one polite update per second and coalesces to the latest message", () => {
    render(<StateAnnouncer />);

    act(() => semanticStore.getState().announce("Core 已连接"));
    expect(screen.getByRole("status")).toHaveTextContent("Core 已连接");

    act(() => semanticStore.getState().announce("流已建立"));
    act(() => semanticStore.getState().announce("最新普通状态"));
    expect(screen.getByRole("status")).toHaveTextContent("Core 已连接");

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole("status")).toHaveTextContent("Core 已连接");

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("最新普通状态");

    act(() => semanticStore.getState().announce("下一秒状态"));
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole("status")).toHaveTextContent("最新普通状态");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("下一秒状态");
  });

  it("announces assertive blocking errors immediately and drops queued routine status", () => {
    const { container } = render(<StateAnnouncer />);

    act(() => semanticStore.getState().announce("Core 已连接"));
    act(() => semanticStore.getState().announce("待合并普通状态"));
    act(() => semanticStore.getState().announce("执行状态未知", "assertive"));

    expect(screen.getByRole("alert")).toHaveTextContent("执行状态未知");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("alert")).toHaveTextContent("执行状态未知");
  });

  it("replaces the message node so repeated text remains an observable DOM mutation", () => {
    render(<StateAnnouncer />);

    act(() => semanticStore.getState().announce("状态未变化"));
    const firstMessageNode = screen.getByRole("status").firstElementChild;
    const firstSequence = firstMessageNode?.getAttribute("data-announcement-id");

    act(() => semanticStore.getState().announce("状态未变化"));
    act(() => vi.advanceTimersByTime(1000));

    const nextMessageNode = screen.getByRole("status").firstElementChild;
    expect(nextMessageNode).not.toBe(firstMessageNode);
    expect(nextMessageNode).toHaveTextContent("状态未变化");
    expect(nextMessageNode?.getAttribute("data-announcement-id")).not.toBe(firstSequence);
  });

  it("keeps one atomic live region and clears component-owned timers on unmount", () => {
    const { container, unmount } = render(<StateAnnouncer />);

    act(() => semanticStore.getState().announce("首条状态"));
    act(() => semanticStore.getState().announce("排队状态"));

    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
