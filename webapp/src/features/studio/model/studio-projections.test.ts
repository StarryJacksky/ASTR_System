import { describe, expect, it } from "vitest";

import { STUDIO_PROJECTIONS } from "./studio-projections";

const EXPECTED_TAXONOMY = [
  { id: "workspace", label: "Workspace" },
  { id: "run", label: "Run" },
  { id: "tool", label: "Tool" },
  { id: "trace", label: "Trace" },
  { id: "source", label: "Source" },
  { id: "artifact", label: "Artifact" },
] as const;

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;

  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen(Reflect.get(value, key));
  }
}

describe("Studio projection taxonomy", () => {
  it("defines the exact six future projection categories in contract order", () => {
    expect(STUDIO_PROJECTIONS.map(({ id, label }) => ({ id, label })))
      .toEqual(EXPECTED_TAXONOMY);
    expect(new Set(STUDIO_PROJECTIONS.map(({ id }) => id)).size).toBe(6);
    expect(new Set(STUDIO_PROJECTIONS.map(({ label }) => label)).size).toBe(6);
  });

  it("frames every purpose as a short future evidence type", () => {
    for (const projection of STUDIO_PROJECTIONS) {
      expect(projection.purpose).toMatch(/^未来.+证据类型$/);
      expect(projection.purpose.length).toBeLessThanOrEqual(12);
      expect(projection.purpose).not.toMatch(
        /当前|现有|真实|模型|Provider|成本|URI|文件名|示例|记录数|时间戳/i,
      );
    }
  });

  it("keeps every category statically unavailable without record-shaped fields", () => {
    expect(STUDIO_PROJECTIONS.map(({ state }) => state)).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);

    for (const projection of STUDIO_PROJECTIONS) {
      expect(Object.keys(projection).sort()).toEqual([
        "id",
        "label",
        "purpose",
        "state",
      ]);
    }
  });

  it("contains no invented runtime values or positive authority copy", () => {
    const serialized = JSON.stringify(STUDIO_PROJECTIONS);

    expect(serialized).not.toMatch(
      /暂无|无权读取|已授权|运行中|成功|已完成|\$\s*\d|https?:\/\/|[A-Z]:[\\/]/i,
    );
    expect(serialized).not.toMatch(
      /"(?:count|timestamp|model|provider|cost|uri|filename|record|example)"\s*:/i,
    );
  });

  it("publishes a deeply immutable registry", () => {
    expectDeepFrozen(STUDIO_PROJECTIONS);
  });
});
