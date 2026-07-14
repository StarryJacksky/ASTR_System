import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getControlModule } from "../model/control-modules";
import { ModuleDossier } from "./ModuleDossier";

describe("planned module dossier", () => {
  it("turns each planned route into a module-specific readiness dossier", () => {
    const dossier = getControlModule("model-router")!;
    render(<main><ModuleDossier module={dossier} /></main>);

    expect(screen.getByRole("heading", { name: "Provider 与模型路由" })).toBeVisible();
    expect(screen.getByText("星门")).toBeVisible();
    expect(screen.getByText("规划中")).toBeVisible();
    expect(screen.getByText(dossier.summary)).toBeVisible();
    expect(screen.getByText("当前 Core 未提供此模块的网页合同")).toBeVisible();
    expect(screen.getByText(dossier.prerequisite)).toBeVisible();
    expect(screen.getByText("状态：规划中 · 无可执行操作")).toBeVisible();

    const questions = screen.getByRole("region", { name: "此档案必须回答" });
    expect(within(questions).getAllByRole("listitem")).toHaveLength(dossier.questions.length);
    for (const question of dossier.questions) {
      expect(within(questions).getByText(question)).toBeVisible();
    }

    const authority = screen.getByRole("region", { name: "尚未接入的权威证据" });
    expect(within(authority).getByText("此规划档案尚无网页合同。以下是解锁前必须接入的权威证据。"))
      .toBeVisible();
    expect(within(authority).getAllByRole("listitem"))
      .toHaveLength(dossier.authorityRequirements.length);
    for (const requirement of dossier.authorityRequirements) {
      expect(within(authority).getByText(requirement)).toBeVisible();
    }

    const related = screen.getByRole("navigation", { name: "相关档案" });
    expect(within(related).getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/admin/logs-trace", "/admin/settings"]);

    const domain = screen.getByRole("navigation", { name: "同域档案" });
    expect(within(domain).getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/admin/platform-gateway", "/admin/plugins-skills-mcp"]);
    expect(within(domain).getByRole("link", { name: /上一档.*平台与网关/ }))
      .toHaveAttribute("rel", "prev");
    expect(within(domain).getByRole("link", { name: /下一档.*插件、Skills 与 MCP/ }))
      .toHaveAttribute("rel", "next");

    const main = screen.getByRole("main");
    expect(main.querySelector("button, form, input, select, textarea, [contenteditable='true']"))
      .toBeNull();
    for (const role of ["button", "radio", "switch", "combobox"] as const) {
      expect(within(main).queryByRole(role)).toBeNull();
    }
  });

  it.each([
    ["dashboard", [], ["/admin/platform-gateway"]],
    ["setup", ["/admin/resources-knowledge"], []],
    ["soul", [], ["/admin/memory"]],
    ["migration", ["/admin/effector"], []],
  ] as const)(
    "keeps %s previous and next links inside a non-wrapping domain",
    (moduleId, previousHrefs, nextHrefs) => {
      render(<ModuleDossier module={getControlModule(moduleId)!} />);

      const navigation = screen.getByRole("navigation", { name: "同域档案" });
      expect(within(navigation).queryAllByRole("link", { name: /上一档/ })
        .map((link) => link.getAttribute("href"))).toEqual(previousHrefs);
      expect(within(navigation).queryAllByRole("link", { name: /下一档/ })
        .map((link) => link.getAttribute("href"))).toEqual(nextHrefs);
      expect(within(navigation).queryByText(/循环/)).toBeNull();
      expect(within(navigation).queryByRole("button")).toBeNull();
    },
  );

  it("shows the existing Effector contracts without exposing controls before migration", () => {
    render(<ModuleDossier module={getControlModule("effector")!} />);

    expect(screen.getByRole("heading", { name: "执行策略与审计" })).toBeVisible();
    expect(screen.getByText("合同已提供 · 工作面正在迁移")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("region", { name: "尚未接入的权威证据" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "同域档案" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
