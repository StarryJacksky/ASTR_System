/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://remote.example/mobile/safety"}
 */

import { act } from "react";

import { waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

it("keeps a server-trusted non-loopback browser outside Mobile Safety", async () => {
  expect(window.location.hostname).toBe("remote.example");
  const loopbackAuthority = await import("../authority/loopback-authority");
  const evaluator = vi.spyOn(
    loopbackAuthority,
    "isAllowedLoopbackHostname",
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  let releaseAll: (() => Promise<void>) | undefined;
  let restoreAddEventListener: (() => void) | undefined;

  try {
    const {
      createPoisonSafetyOwner,
      createSafetyHydrationHarness,
    } = await import("./safety-hydration.test-support");
    const hydration = createSafetyHydrationHarness();
    releaseAll = () => hydration.releaseAll();
    const addEventListener = vi.spyOn(window, "addEventListener");
    restoreAddEventListener = () => addEventListener.mockRestore();
    const poison = createPoisonSafetyOwner();
    const remote = await hydration.hydrate(true, poison.owner);

    expect(remote.serverHtml).toContain("设备与安全");
    expect(remote.serverHtml).toContain("正在核验本机来源");
    expect(remote.serverHtml).not.toMatch(/重试读取|重新读取|已验证/);
    await waitFor(() => {
      expect(remote.host.textContent).toContain(
        "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
      );
    });
    expect(remote.recoverableError).not.toHaveBeenCalled();
    expect(evaluator).toHaveBeenCalledWith("remote.example");
    expect(addEventListener).toHaveBeenCalledWith(
      "pageshow",
      expect.any(Function),
    );
    expect(poison.touches).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(remote.host.querySelector("a[href^='/admin']")).toBeNull();
    expect(remote.host.textContent).not.toMatch(
      /本机执行层|停止状态|待处理|审计尾部|已验证|重新读取|重试读取|我的电脑在线|远程设备/,
    );

    const callsBeforePageshow = evaluator.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => {
      expect(evaluator.mock.calls.length).toBeGreaterThan(callsBeforePageshow);
    });
    expect(remote.host.textContent).toContain(
      "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
    );
    expect(remote.host.querySelector("a[href^='/admin']")).toBeNull();
    expect(poison.touches).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await remote.unmount();
  } finally {
    await releaseAll?.();
    restoreAddEventListener?.();
    evaluator.mockRestore();
    vi.unstubAllGlobals();
  }
});
