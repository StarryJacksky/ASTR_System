import { describe, expect, it, vi } from "vitest";

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));

import ControlModulePage, { generateMetadata, generateStaticParams } from "./page";

describe("Control module routes", () => {
  it("generates the exact 18 target paths", () => {
    expect(generateStaticParams()).toEqual([
      { module: "dashboard" },
      { module: "platform-gateway" },
      { module: "model-router" },
      { module: "plugins-skills-mcp" },
      { module: "sessions-people" },
      { module: "schedule" },
      { module: "logs-trace" },
      { module: "settings" },
      { module: "resources-knowledge" },
      { module: "setup" },
      { module: "soul" },
      { module: "memory" },
      { module: "emotion" },
      { module: "moa-teaching" },
      { module: "training" },
      { module: "voice" },
      { module: "effector" },
      { module: "migration" },
    ]);
  });

  it("fails closed through notFound for an unknown module", async () => {
    await expect(
      ControlModulePage({ params: Promise.resolve({ module: "remote-task" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("publishes a distinct route title for assistive route announcements", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({ module: "model-router" }),
    })).resolves.toEqual({
      title: "Provider 与模型路由 · ASTR Control",
    });
  });
});
