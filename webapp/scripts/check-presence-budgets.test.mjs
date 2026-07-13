import { describe, expect, it, vi } from "vitest";

import { runPresenceBudgetGate } from "./check-presence-budgets.mjs";

describe("runPresenceBudgetGate", () => {
  it("collects fresh browser evidence before evaluating the canonical artifacts", async () => {
    const runCommand = vi.fn(async () => 0);

    await runPresenceBudgetGate({ runCommand });

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [
        "scripts/run-playwright.mjs",
        "e2e/presence-performance.spec.ts",
        "--grep",
        "captures raw desktop/mobile performance samples",
      ],
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        "node_modules/vite-node/dist/cli.mjs",
        "e2e/support/check-presence-budgets.ts",
      ],
    );
  });

  it("fails closed and never evaluates stale artifacts when collection fails", async () => {
    const runCommand = vi.fn(async () => 1);

    await expect(runPresenceBudgetGate({ runCommand })).rejects.toThrow(
      /evidence collection exited with status 1/,
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
