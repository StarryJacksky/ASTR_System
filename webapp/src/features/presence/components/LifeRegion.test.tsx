import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AstrEvent } from "@/lib/types";

import { LifeRegion, type LifeRegionProps } from "./LifeRegion";

function event(type: string, id: string, payload: Record<string, unknown>): AstrEvent {
  return {
    id,
    type,
    payload,
    source: "soul.orchestrator",
    trace_id: `trace-${id}`,
    ts: "2026-07-11T03:04:05.000Z",
  };
}

function ControlledLifeRegion(props: Omit<LifeRegionProps, "expanded" | "onExpandedChange">) {
  const [expanded, setExpanded] = useState(false);
  return <LifeRegion {...props} expanded={expanded} onExpandedChange={setExpanded} />;
}

describe("LifeRegion", () => {
  it("renders truthful activity and event summaries with source and UTC time", () => {
    const { container } = render(
      <ControlledLifeRegion
        activity="正在阅读"
        streamState="open"
        events={[
          event("agent.thought", "thought", { text: "正在整理上下文" }),
          event("soul.decision", "decision", { reply_text: "已经形成终稿" }),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "生活记录" })).toBeVisible();
    expect(screen.getByText("正在阅读")).toBeVisible();
    expect(screen.getByText(/Core status/)).toHaveTextContent("时间未提供");
    const list = screen.getByRole("list", { name: "生活与处理摘要" });
    expect(within(list).getByText("处理片段")).toBeVisible();
    expect(within(list).getByText("生活记录")).toBeVisible();
    expect(within(list).getAllByText(/soul\.orchestrator/)).toHaveLength(2);
    expect(within(list).getAllByText("2026-07-11 · 03:04 UTC")).toHaveLength(2);
    expect(container).not.toHaveTextContent("完整思维链");
    expect(container.querySelector("[aria-live], [role='status'], [role='alert'], [role='log']"))
      .toBeNull();
  });

  it("presents a missing current activity as necessary body copy", () => {
    const { container } = render(
      <ControlledLifeRegion events={[]} streamState="open" />,
    );
    const missing = screen.getByText("Core 未提供当前生活状态。");
    expect(missing.className).toMatch(/activityUnavailable/);

    const cssSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceTimelines.module.css"),
      "utf8",
    );
    const rule = cssSource.match(/\.activityUnavailable\s*\{([^}]*)\}/)?.[1];
    expect(rule).toContain("color: var(--astr-text-2)");
    expect(rule).toContain("font-size: var(--type-0)");
    expect(rule).toContain("line-height: var(--leading-body)");
    expect(container.querySelector("[aria-live], [role='alert']")).toBeNull();
  });

  it("keeps expansion as explicit UI intent", () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      event("agent.thought", `thought-${index}`, { text: `片段 ${index}` }),
    );
    const { rerender } = render(
      <ControlledLifeRegion events={events} streamState="open" />,
    );

    const toggle = screen.getByRole("button", { name: "展开生活记录" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起生活记录" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(5);

    rerender(
      <ControlledLifeRegion
        events={[...events, event("agent.thought", "thought-5", { text: "片段 5" })]}
        streamState="open"
      />,
    );
    expect(screen.getByRole("button", { name: "收起生活记录" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("changes controlled expansion only when the parent supplies the new prop", () => {
    const onExpandedChange = vi.fn();
    const events = Array.from({ length: 5 }, (_, index) =>
      event("agent.thought", `controlled-${index}`, { text: `片段 ${index}` }),
    );
    const { rerender } = render(
      <LifeRegion
        events={events}
        expanded={false}
        onExpandedChange={onExpandedChange}
        streamState="open"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开生活记录" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "展开生活记录" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    rerender(
      <LifeRegion
        events={[...events, event("agent.thought", "controlled-5", { text: "片段 5" })]}
        expanded={false}
        onExpandedChange={onExpandedChange}
        streamState="open"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    rerender(
      <LifeRegion
        events={[...events, event("agent.thought", "controlled-5", { text: "片段 5" })]}
        expanded
        onExpandedChange={onExpandedChange}
        streamState="open"
      />,
    );
    expect(screen.getByRole("button", { name: "收起生活记录" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("labels an invalid event timestamp as unavailable without rendering time", () => {
    render(
      <LifeRegion
        events={[
          {
            ...event("agent.thought", "invalid-time", { text: "无有效时间" }),
            ts: "2026-07-11T03:04:05",
          },
        ]}
        expanded
        onExpandedChange={vi.fn()}
        streamState="open"
      />,
    );

    expect(screen.queryByRole("time")).not.toBeInTheDocument();
    expect(screen.getByText(/soul\.orchestrator/)).toHaveTextContent("时间未提供");
  });

  it.each([
    ["connecting", "正在连接生活记录。"],
    ["retrying", "生活记录连接中断，正在重连；断线期间内容可能不完整。"],
    ["closed", "生活记录未连接。"],
    ["open", "连接已建立；暂无 Core 提供的处理片段或生活记录。"],
  ] as const)("shows the truthful %s connection state without inventing retry", (streamState, copy) => {
    const { container } = render(
      <ControlledLifeRegion events={[]} streamState={streamState} />,
    );

    expect(screen.getByText(copy)).toBeVisible();
    expect(screen.queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();
    expect(container.querySelector("[aria-live], [role='status'], [role='alert'], [role='log']"))
      .toBeNull();
  });

  it("reports malformed supported records without exposing fabricated content", () => {
    render(
      <ControlledLifeRegion
        events={[event("agent.thought", "bad", { text: " " })]}
        streamState="open"
      />,
    );

    expect(screen.getByText("有 1 条受支持事件因内容不可读而未显示。")).toBeVisible();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });

  it("reports the truthful malformed total when diagnostic details are capped", () => {
    render(
      <ControlledLifeRegion
        events={Array.from({ length: 40 }, (_, index) =>
          event("agent.thought", `bad-${index}`, { text: " " }),
        )}
        streamState="open"
      />,
    );

    expect(screen.getByText("有 40 条受支持事件因内容不可读而未显示。")).toBeVisible();
    expect(screen.queryByText("有 32 条受支持事件因内容不可读而未显示。")).not.toBeInTheDocument();
  });

  it("keeps essential connection and diagnostic copy at readable body scale", () => {
    const cssSource = readFileSync(
      resolve(process.cwd(), "src/features/presence/components/PresenceTimelines.module.css"),
      "utf8",
    );

    for (const selector of ["connectionCopy", "diagnosticCopy"]) {
      const declarationBlock = cssSource.match(
        new RegExp(`\\.${selector}[\\s\\S]*?\\{([^}]*)\\}`),
      )?.[1];
      expect(declarationBlock).toContain("color: var(--astr-text-2)");
      expect(declarationBlock).toContain("font-size: var(--type-0)");
      expect(declarationBlock).toContain("line-height: var(--leading-body)");
      expect(declarationBlock).not.toContain("var(--astr-text-3)");
      expect(declarationBlock).not.toContain("var(--type--1)");
    }
  });
});
