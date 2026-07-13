import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { EffectorActions } from "../controller/create-effector-controller";
import type { EffectorAudit } from "../data/effector-client";
import { AuditLedger } from "./AuditLedger";

const AUDIT: EffectorAudit = {
  dates: ["2026-07-12", "2026-07-13"],
  date: "2026-07-13",
  entries: [
    {
      ts: "2026-07-13T08:09:10Z",
      trace_id: "trace-full-0123456789abcdef",
      track: "headless",
      description: "列出工作目录并保留完整审计证据",
      decision: "allow",
      dangerous: false,
    },
  ],
  total: 1,
  chain_valid: true,
};

const INTEGRITY_COPY = [
  [true, "链完整 · 校验通过"],
  [false, "链断裂 · 证据可能被修改"],
  [null, "未提供链完整性证据"],
] as const;

describe("AuditLedger", () => {
  it.each(INTEGRITY_COPY)("renders chain_valid=%s with exact visible evidence", (chain, copy) => {
    render(
      <AuditLedger
        audit={{ ...AUDIT, chain_valid: chain }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(screen.getByText(copy)).toBeVisible();
    expect(screen.getByText(copy)).toHaveAttribute(
      "data-integrity",
      chain === true ? "complete" : chain === false ? "broken" : "unverified",
    );
  });

  it("selects a date and refreshes the retained selection", async () => {
    const user = userEvent.setup();
    const refreshAudit = vi.fn<EffectorActions["refreshAudit"]>();
    const view = render(
      <AuditLedger audit={AUDIT} selectedDate={null} refreshAudit={refreshAudit} />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "审计日期" }), "2026-07-12");
    expect(refreshAudit).toHaveBeenLastCalledWith("2026-07-12");

    view.rerender(
      <AuditLedger audit={AUDIT} selectedDate="2026-07-12" refreshAudit={refreshAudit} />,
    );
    await user.click(screen.getByRole("button", { name: "刷新所选日期" }));
    expect(refreshAudit).toHaveBeenLastCalledWith("2026-07-12");
    expect(refreshAudit).toHaveBeenCalledTimes(2);
  });

  it("labels retained entries with their verified date while another date is requested", () => {
    render(
      <AuditLedger
        audit={{ ...AUDIT, date: "2026-07-12" }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "审计日期" })).toHaveValue(
      "2026-07-13",
    );
    expect(screen.getByText("证据日期：2026-07-12")).toBeVisible();
    expect(screen.getByText("请求日期：2026-07-13 · 当前仍显示最近一次已验证记录"))
      .toBeVisible();
  });

  it("does not attribute retained empty evidence to an unverified requested date", () => {
    render(
      <AuditLedger
        audit={{ ...AUDIT, date: "2026-07-12", entries: [], total: 0 }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(screen.getByText(
      "已验证证据日期没有审计条目；请求日期尚未获得权威记录。",
    )).toBeVisible();
    expect(screen.queryByText("当前所选日期没有审计条目。")).toBeNull();
  });

  it("treats a retained null evidence date as distinct from a requested date", () => {
    render(
      <AuditLedger
        audit={{ ...AUDIT, date: null, entries: [], total: 0 }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(screen.getByText("证据日期：未提供")).toBeVisible();
    expect(screen.getByText(
      "请求日期：2026-07-13 · 当前仍显示最近一次已验证记录",
    )).toBeVisible();
    expect(screen.getByText(
      "已验证证据日期没有审计条目；请求日期尚未获得权威记录。",
    )).toBeVisible();
  });

  it("describes an empty selected date without claiming the system never ran", () => {
    render(
      <AuditLedger
        audit={{
          dates: ["2026-07-13"],
          date: "2026-07-13",
          entries: [],
          total: 0,
          chain_valid: null,
        }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(screen.getByText("当前所选日期没有审计条目。")).toBeVisible();
    expect(screen.queryByText(/从未|没有运行|无任何历史/)).toBeNull();
  });

  it("shows every audit fact directly with the full trace and localized time", () => {
    const view = render(
      <AuditLedger audit={AUDIT} selectedDate="2026-07-13" refreshAudit={vi.fn()} />,
    );
    const ledger = screen.getByRole("region", { name: "审计丁册" });

    expect(within(ledger).getByText("决策：allow")).toBeVisible();
    expect(within(ledger).getByText("轨道：headless")).toBeVisible();
    expect(within(ledger).getByText("危险：否")).toBeVisible();
    expect(within(ledger).getByText("trace-full-0123456789abcdef")).toBeVisible();
    expect(within(ledger).getByText("列出工作目录并保留完整审计证据")).toBeVisible();
    const time = view.container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-07-13T08:09:10Z");
    expect(time?.textContent).not.toBe("2026-07-13T08:09:10Z");
    expect(within(ledger).getByText("共 1 条")).toBeVisible();
  });

  it("maps the real Guard confirm decision to the warning role", () => {
    const view = render(
      <AuditLedger
        audit={{
          ...AUDIT,
          entries: [{ ...AUDIT.entries[0], decision: "confirm" }],
        }}
        selectedDate="2026-07-13"
        refreshAudit={vi.fn()}
      />,
    );

    expect(view.container.querySelector("li[data-decision='warning']")).not.toBeNull();
    expect(screen.getByText("决策：confirm")).toBeVisible();
  });

  it("contains server/client timezone drift at the localized time boundary", async () => {
    const props = {
      audit: AUDIT,
      selectedDate: "2026-07-13",
      refreshAudit: vi.fn(),
    } as const;
    const serverMarkup = renderToString(<AuditLedger {...props} />);
    expect(serverMarkup).toContain(">2026-07-13T08:09:10Z</time>");
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: Root | null = null;

    await act(async () => {
      root = hydrateRoot(container, <AuditLedger {...props} />);
      await Promise.resolve();
    });

    const localized = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "medium",
      hour12: false,
    }).format(new Date("2026-07-13T08:09:10Z"));
    await waitFor(() => {
      expect(container.querySelector("time")?.textContent).toBe(localized);
    });
    expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
      /hydration|did not match|server rendered text/i,
    );
    await act(async () => root?.unmount());
    consoleError.mockRestore();
    container.remove();
  });

  it("keeps ledger styling green-free and all evidence out of hover-only attributes", () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), "src/features/control/components/AuditLedger.tsx"),
      "utf8",
    );
    const styleSource = readFileSync(
      resolve(process.cwd(), "src/features/control/components/EffectorWorkspace.module.css"),
      "utf8",
    );

    expect(`${componentSource}\n${styleSource}`).not.toMatch(/green|--astr-success/i);
    expect(componentSource).not.toMatch(/\stitle=/i);
    expect(componentSource).toMatch(/<section[\s\S]*id="audit-ledger"/);
  });
});
