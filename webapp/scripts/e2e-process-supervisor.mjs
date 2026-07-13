import { spawnSync } from "node:child_process";

export async function shutdownProcessTree(
  children,
  {
    platform = process.platform,
    runTaskkill = defaultTaskkill,
    graceMs = 2_000,
  } = {},
) {
  const ownedChildren = [...children].reverse();

  if (platform === "win32") {
    for (const child of ownedChildren) {
      if (!isRunning(child)) continue;
      const result = runTaskkill(child.pid);
      if (result?.status !== 0 && isRunning(child)) child.kill();
    }
  } else {
    for (const child of ownedChildren) {
      if (isRunning(child)) child.kill();
    }
  }

  await Promise.all(ownedChildren.map((child) => waitForExit(child, graceMs)));

  for (const child of ownedChildren) {
    if (!isRunning(child)) continue;
    child.kill("SIGKILL");
    await waitForExit(child, graceMs);
  }
}

function defaultTaskkill(pid) {
  return spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitForExit(child, timeoutMs) {
  if (!isRunning(child)) return Promise.resolve();
  return Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs)),
  ]);
}
