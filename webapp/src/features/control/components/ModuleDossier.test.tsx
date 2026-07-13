import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getControlModule } from "../model/control-modules";
import { ModuleDossier } from "./ModuleDossier";

describe("planned module dossier", () => {
  it("states the missing contract without inventing an operation", () => {
    render(<ModuleDossier module={getControlModule("model-router")!} />);

    expect(screen.getByRole("heading", { name: "Provider 与模型路由" })).toBeVisible();
    expect(screen.getByText("当前 Core 未提供此模块的网页合同")).toBeVisible();
    expect(screen.getByText("状态：规划中 · 无可执行操作")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the existing Effector contracts without exposing controls before migration", () => {
    render(<ModuleDossier module={getControlModule("effector")!} />);

    expect(screen.getByRole("heading", { name: "执行策略与审计" })).toBeVisible();
    expect(screen.getByText("合同已提供 · 工作面正在迁移")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
