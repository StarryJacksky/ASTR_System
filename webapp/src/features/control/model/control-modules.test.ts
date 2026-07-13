import { describe, expect, it } from "vitest";

import {
  CONTROL_MODULES,
  getControlModule,
  getControlModulesByDomain,
} from "./control-modules";

const EXPECTED_IDS = [
  "dashboard",
  "platform-gateway",
  "model-router",
  "plugins-skills-mcp",
  "sessions-people",
  "schedule",
  "logs-trace",
  "settings",
  "resources-knowledge",
  "setup",
  "soul",
  "memory",
  "emotion",
  "moa-teaching",
  "training",
  "voice",
  "effector",
  "migration",
] as const;

describe("Control module registry", () => {
  it("defines the exact 18-route IA once", () => {
    expect(CONTROL_MODULES.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(new Set(CONTROL_MODULES.map(({ href }) => href)).size).toBe(18);
    expect(getControlModulesByDomain("system")).toHaveLength(10);
    expect(getControlModulesByDomain("soul")).toHaveLength(8);
  });

  it("exposes only the existing Effector web contract", () => {
    expect(
      CONTROL_MODULES.filter(({ status }) => status === "available").map(({ id }) => id),
    ).toEqual(["effector"]);
    expect(getControlModule("effector")?.contracts).toEqual([
      "GET /v1/admin/effector/policy",
      "PUT /v1/admin/effector/policy",
      "GET /v1/admin/effector/audit",
      "GET /v1/effector/status",
      "POST /v1/effector/estop",
      "POST /v1/effector/estop/reset",
    ]);
  });

  it("returns undefined for an unknown module", () => {
    expect(getControlModule("remote-task")).toBeUndefined();
  });
});
