import { once } from "node:events";
import { spawn } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { shutdownProcessTree } from "./e2e-process-supervisor.mjs";

describe("shutdownProcessTree", () => {
  it("falls back to the owned direct child when Windows tree termination is denied", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await once(child, "spawn");
    const runTaskkill = vi.fn(() => ({ status: 1 }));

    try {
      await shutdownProcessTree([child], {
        platform: "win32",
        runTaskkill,
        graceMs: 1_000,
      });

      expect(runTaskkill).toHaveBeenCalledWith(child.pid);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });
});
