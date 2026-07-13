/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://remote.example/mobile/presence"}
 */

import { act } from "react";

import { waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

it("keeps a server-trusted non-loopback browser outside Presence", async () => {
  expect(window.location.hostname).toBe("remote.example");
  const loopbackAuthority = await import("../authority/loopback-authority");
  const evaluator = vi.spyOn(
    loopbackAuthority,
    "isAllowedLoopbackHostname",
  );
  let releaseAll: (() => Promise<void>) | undefined;
  let restoreAddEventListener: (() => void) | undefined;

  try {
    const {
      createDomainHydrationHarness,
      createPoisonOwner,
    } = await import("./presence-hydration.test-support");
    const hydration = createDomainHydrationHarness();
    releaseAll = () => hydration.releaseAll();
    const addEventListener = vi.spyOn(window, "addEventListener");
    restoreAddEventListener = () => addEventListener.mockRestore();
    const poison = createPoisonOwner();
    const remote = await hydration.hydrate(true, poison.owner);

    expect(remote.serverHtml).toContain("正在核验本机 Presence");
    await waitFor(() => {
      expect(remote.host.textContent).toContain("未连接 Core");
    });
    expect(remote.recoverableError).not.toHaveBeenCalled();
    expect(evaluator).toHaveBeenCalledWith("remote.example");
    expect(addEventListener).toHaveBeenCalledWith(
      "pageshow",
      expect.any(Function),
    );
    expect(poison.touches).not.toHaveBeenCalled();

    const callsBeforePageshow = evaluator.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => {
      expect(evaluator.mock.calls.length).toBeGreaterThan(callsBeforePageshow);
    });
    expect(remote.host.textContent).toContain("未连接 Core");
    expect(poison.touches).not.toHaveBeenCalled();
    await remote.unmount();
  } finally {
    await releaseAll?.();
    restoreAddEventListener?.();
    evaluator.mockRestore();
  }
});
