import { spawn } from "node:child_process";

export async function runPresenceBudgetGate({ runCommand = spawnCommand } = {}) {
  const collectionCode = await runCommand(process.execPath, [
    "scripts/run-playwright.mjs",
    "e2e/presence-performance.spec.ts",
    "--grep",
    "captures raw desktop/mobile performance samples",
  ]);
  if (collectionCode !== 0) {
    throw new Error(`Presence evidence collection exited with status ${collectionCode}.`);
  }

  const evaluationCode = await runCommand(process.execPath, [
    "node_modules/vite-node/dist/cli.mjs",
    "e2e/support/check-presence-budgets.ts",
  ]);
  if (evaluationCode !== 0) {
    throw new Error(`Presence budget evaluation exited with status ${evaluationCode}.`);
  }
}

function spawnCommand(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) => {
      if (signal) reject(new Error(`${args[0]} terminated by ${signal}.`));
      else resolveCode(status ?? 1);
    });
  });
}

if (!process.env.VITEST) {
  runPresenceBudgetGate().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
