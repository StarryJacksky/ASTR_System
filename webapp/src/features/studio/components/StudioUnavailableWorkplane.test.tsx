import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StudioUnavailableWorkplane } from "./StudioUnavailableWorkplane";

const PROJECTION_LABELS = [
  "Workspace",
  "Run",
  "Tool",
  "Trace",
  "Source",
  "Artifact",
] as const;

const IMPLEMENTATION_GATES = [
  "稳定 authority 与 ownership",
  "认证 principal 与 scopes",
  "通过安全评审的薄只读 endpoints",
] as const;

const EXPECTED_STUDIO_TEXT_NODES = [
  "STUDIO / CONTRACT HORIZON",
  "Studio 投影未启用",
  "缺少已授权 authority、认证 scopes 与只读 endpoints。",
  "没有可验证的 Run、模型路由、成本或产物数据。",
  "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
  "Studio 合同事实",
  "Authority",
  "稳定来源未建立",
  "Identity scope",
  "认证主体与 scopes 未提供",
  "Read contract",
  "只读合同未安装",
  "Request policy",
  "零 Studio 资源请求",
  "PROJECTION REGISTER",
  "Studio 投影分类目录",
  "分类目录，非流程或连接状态",
  "Workspace",
  "未来工作空间证据类型",
  "投影未启用",
  "Run",
  "未来运行证据类型",
  "投影未启用",
  "Tool",
  "未来工具证据类型",
  "投影未启用",
  "Trace",
  "未来轨迹证据类型",
  "投影未启用",
  "Source",
  "未来来源证据类型",
  "投影未启用",
  "Artifact",
  "未来产物证据类型",
  "投影未启用",
  "IMPLEMENTATION GATE",
  "Studio 实施门",
  ...IMPLEMENTATION_GATES,
  "当前表面不提供 Run、Approve、Tool 或 Download 操作。",
] as const;

describe("StudioUnavailableWorkplane", () => {
  it("renders one truthful unavailable main without simulated Studio work", () => {
    render(<StudioUnavailableWorkplane />);
    const main = screen.getByRole("main");

    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveAttribute("data-studio-state", "unavailable");
    expect(
      main.querySelectorAll("[data-studio-truth-field]"),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 1, name: "Studio 投影未启用" }),
    ).toHaveLength(1);
    expect(
      screen.getByText("缺少已授权 authority、认证 scopes 与只读 endpoints。"),
    ).toBeVisible();
    expect(
      screen.getByText("没有可验证的 Run、模型路由、成本或产物数据。"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
      ),
    ).toBeVisible();

    const facts = screen.getByRole("region", { name: "Studio 合同事实" });
    expect(within(facts).getByText("Authority")).toBeVisible();
    expect(within(facts).getByText("稳定来源未建立")).toBeVisible();
    expect(within(facts).getByText("Identity scope")).toBeVisible();
    expect(within(facts).getByText("认证主体与 scopes 未提供")).toBeVisible();
    expect(within(facts).getByText("Read contract")).toBeVisible();
    expect(within(facts).getByText("只读合同未安装")).toBeVisible();
    expect(within(facts).getByText("Request policy")).toBeVisible();
    expect(within(facts).getByText("零 Studio 资源请求")).toBeVisible();

    expect(within(main).queryAllByRole("link")).toHaveLength(0);
    expect(within(main).queryAllByRole("button")).toHaveLength(0);
    expect(within(main).queryAllByRole("status")).toHaveLength(0);
    expect(within(main).queryAllByRole("alert")).toHaveLength(0);
    expect(within(main).queryAllByRole("progressbar")).toHaveLength(0);
    expect(
      main.querySelector(
        "form, input, textarea, select, [contenteditable], [aria-live], [aria-busy], [disabled], canvas",
      ),
    ).toBeNull();
    expect(main).not.toHaveTextContent(
      /暂无|无权读取|运行中|成功|已完成|(?<!缺少)已授权|\$0|示例|重试|下载/,
    );
    expect(readTextNodes(main)).toEqual(EXPECTED_STUDIO_TEXT_NODES);
  });

  it("presents six isolated unavailable categories and three implementation gates", () => {
    render(<StudioUnavailableWorkplane />);

    const register = screen.getByRole("region", { name: "Studio 投影分类目录" });
    expect(
      within(register).getByText("分类目录，非流程或连接状态"),
    ).toBeVisible();
    const items = within(register).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.querySelector("strong")?.textContent)).toEqual(
      PROJECTION_LABELS,
    );
    for (const item of items) expect(item).toHaveTextContent("投影未启用");

    const gates = screen.getByRole("region", { name: "Studio 实施门" });
    expect(
      within(gates)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(IMPLEMENTATION_GATES);
  });

  it("keeps the contract horizon static, singular, and detached from its registrations", () => {
    const { container } = render(<StudioUnavailableWorkplane />);

    expect(container.querySelectorAll("[data-studio-instrument-frame]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-studio-datum]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-studio-contract-gap]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-studio-registration-mark]")).toHaveLength(6);
    expect(container.querySelector("[data-studio-datum]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector("svg, canvas")).toBeNull();
  });

  it("is a server-safe static component with a bounded non-HUD stylesheet", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/studio/components/StudioUnavailableWorkplane.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/features/studio/components/StudioSurface.module.css"),
      "utf8",
    );

    expect(source).not.toMatch(/^['\"]use client['\"];|\buseEffect\b|\buseState\b/m);
    expect(source).not.toMatch(
      /\b(?:window|document|fetch|XMLHttpRequest|EventSource|WebSocket|sendBeacon)\b|\bDate\b|Math\.random|process\.env|import\s*\(/,
    );
    expect(source).toContain(
      "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
    );
    expect(css).not.toMatch(
      /gradient|backdrop-filter|filter\s*:\s*blur|@keyframes|\banimation(?:-[a-z-]+)?\s*:|\btransition(?:-[a-z-]+)?\s*:|box-shadow|#[\da-f]{3,8}|\brgba?\(|\bhsla?\(|\b(?:green|lime|emerald|chartreuse)\b/i,
    );
    expect(css).not.toMatch(/\b(?:card|tile|glass|bento|crosshair|radar|scanline)\b/i);
    expect(css).toMatch(/\.instrumentFrame\s*\{[\s\S]*?clip-path:/);
    expect(css.match(/clip-path\s*:/g)).toHaveLength(1);
    expect(css).toMatch(/max-width:\s*var\(--layout-container-max\)/);
    expect(css).toMatch(/\.datum\s*\{[\s\S]*?grid-template-columns:/);
    expect(css).toMatch(/--studio-contract-gap\s*:/);
    expect(css).toMatch(/\.factRail\s*\{[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/\.truthField\s*\{[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/\.projectionRegister\s*\{[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/\.gateRail\s*\{[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.datum/);
    expect(css).toMatch(/min-height:\s*100dvh/);
    expect(css.match(/safe-area-inset-(?:top|right|bottom|left)/g)).toEqual(
      expect.arrayContaining([
        "safe-area-inset-top",
        "safe-area-inset-right",
        "safe-area-inset-bottom",
        "safe-area-inset-left",
      ]),
    );
  });
});

function readTextNodes(root: Node): string[] {
  const values: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.replace(/\s+/g, " ").trim();
      if (value) values.push(value);
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return values;
}
