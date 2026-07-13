import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { renderToString } from "react-dom/server";

import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import { MOBILE_SAFETY_SERVER_SNAPSHOT } from "./create-mobile-safety-controller";
import { MobileLocalSafetyDomain } from "./MobileLocalSafetyDomain";
import {
  createPoisonSafetyOwner,
  createSafetyHydrationHarness,
  createSafetyOwnerFixture,
} from "./safety-hydration.test-support";

const hydration = createSafetyHydrationHarness();

afterEach(async () => {
  await hydration.releaseAll();
  vi.restoreAllMocks();
});

describe("MobileLocalSafetyDomain authority boundary", () => {
  it("does not mount trusted Safety during checking or server-rejected SSR", () => {
    const checkingPoison = createPoisonSafetyOwner();
    const checkingHtml = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted>
        <MobileLocalSafetyDomain owner={checkingPoison.owner} />
      </MobileAuthorityProvider>,
    );

    expect(checkingHtml).toContain("设备与安全");
    expect(checkingHtml).toContain("正在核验本机来源");
    expect(checkingHtml.match(/<h1/g)).toHaveLength(1);
    expect(checkingHtml).not.toContain("当前 Web 主机 · 本机可信入口");
    expect(checkingHtml).not.toMatch(
      /本机执行层|停止状态|待处理|审计尾部|已验证|重新读取|重试读取/,
    );
    expect(checkingHtml).not.toMatch(
      /aria-live=|role=["'](?:status|alert|log|marquee|timer)["']/i,
    );
    expect(checkingHtml).not.toContain('href="/admin');
    expect(checkingPoison.touches).not.toHaveBeenCalled();

    const remotePoison = createPoisonSafetyOwner();
    const remoteHtml = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted={false}>
        <MobileLocalSafetyDomain owner={remotePoison.owner} />
      </MobileAuthorityProvider>,
    );

    expect(remoteHtml).toContain("设备与安全");
    expect(remoteHtml).toContain(
      "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
    );
    expect(remoteHtml.match(/<h1/g)).toHaveLength(1);
    expect(remoteHtml).not.toMatch(
      /当前 Web 主机|本机执行层|停止状态|待处理|审计尾部|已验证|重新读取|重试读取/,
    );
    expect(remoteHtml).not.toMatch(
      /aria-live=|role=["'](?:status|alert|log|marquee|timer)["']/i,
    );
    expect(remoteHtml).not.toContain('href="/admin');
    expect(remoteHtml).not.toMatch(/Control|我的电脑在线|服务器安全$|远程设备/);
    expect(remotePoison.touches).not.toHaveBeenCalled();
  });

  it("hydrates localhost into one trusted subscription and preserves the sole h1", async () => {
    expect(window.location.hostname).toBe("localhost");
    const fixture = createSafetyOwnerFixture(MOBILE_SAFETY_SERVER_SNAPSHOT);
    const mounted = await hydration.hydrate(true, fixture.owner);

    expect(mounted.serverHtml).toContain("正在核验本机来源");
    await waitFor(() => {
      expect(mounted.host.querySelector("h2")?.textContent).toBe(
        "当前 Web 主机 · 本机可信入口",
      );
    });
    expect(mounted.host.querySelectorAll("h1")).toHaveLength(1);
    expect(mounted.host.querySelector("h1")?.textContent).toBe("设备与安全");
    expect(mounted.host.querySelectorAll("h2")).toHaveLength(1);
    expect(mounted.host.querySelectorAll("h3")).toHaveLength(3);
    expect(mounted.recoverableError).not.toHaveBeenCalled();
    expect(fixture.activeSubscribers()).toBe(1);
    expect(fixture.peakSubscribers()).toBe(1);

    await mounted.unmount();
    expect(fixture.activeSubscribers()).toBe(0);
  });

  it("keeps server-rejected hydration outside Safety across pageshow", async () => {
    const poison = createPoisonSafetyOwner();
    const mounted = await hydration.hydrate(false, poison.owner);

    await waitFor(() => {
      expect(mounted.host.textContent).toContain(
        "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
      );
    });
    expect(mounted.recoverableError).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(poison.touches).not.toHaveBeenCalled();
    expect(mounted.host.textContent).not.toMatch(/重试读取|重新读取|已验证/);
    expect(mounted.host.querySelector("a[href^='/admin']")).toBeNull();
    await mounted.unmount();
  });

  it("binds the asymmetric evidence surface and responsive rail to base selectors", () => {
    const outerSource = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/safety/MobileLocalSafetyDomain.tsx",
      ),
      "utf8",
    );
    const trustedSource = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/safety/TrustedMobileLocalSafetyDomain.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/safety/MobileLocalSafetyDomain.module.css",
      ),
      "utf8",
    );
    const baseCss = css.split(/@media\b/, 1)[0] ?? "";
    const domainRule = selectorBlock(baseCss, ".domain");
    const evidenceRule = selectorBlock(baseCss, ".evidenceSurface");
    const gridRule = selectorBlock(baseCss, ".channelGrid");
    const channelRule = selectorBlock(baseCss, ".channel");
    const statusRule = selectorBlock(baseCss, ".statusChannel");
    const actionRule = selectorBlock(baseCss, ".action");
    const controlLinkRule = selectorBlock(baseCss, ".controlRail a");
    const verifiedAtRule = selectorBlock(baseCss, ".verifiedAt");

    expect(outerSource.match(/<h1/g)).toHaveLength(1);
    expect(trustedSource).not.toMatch(/<h1/);
    expect(trustedSource).toContain("<h2");
    expect(trustedSource.match(/<h3/g)).toHaveLength(3);
    expect(trustedSource).toContain('href="/admin/effector"');
    expect(trustedSource).toContain("prefetch={false}");
    expect(trustedSource).not.toMatch(
      /setTimeout|setInterval|requestAnimationFrame|aria-live|role=["'](?:status|alert|log|marquee|timer)["']|<marquee/i,
    );
    expect(trustedSource).not.toMatch(
      /\b(?:speaker|path|sandbox|overlay)\b|audit_tail(?!_count)|pending(?!_count)/i,
    );

    expect(domainRule).toMatch(/min-inline-size:\s*0\s*;/);
    expect(domainRule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
    expect(evidenceRule).toMatch(/background:\s*var\(--astr-surface\)\s*;/);
    expect(evidenceRule).toMatch(
      /border-block:\s*1px solid var\(--astr-hairline-strong\)\s*;/,
    );
    expect(evidenceRule).toMatch(
      /border-inline-start:\s*3px solid var\(--astr-soul\)\s*;/,
    );
    expect(evidenceRule).not.toMatch(/border-radius|box-shadow/);
    expect(gridRule).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*;/,
    );
    expect(statusRule).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    expect(channelRule).toMatch(/min-inline-size:\s*0\s*;/);
    expect(channelRule).not.toMatch(
      /\bbackground\s*:|\bborder\s*:|border-radius|box-shadow/,
    );
    expect(actionRule).toMatch(
      /min-block-size:\s*var\(--touch-target\)\s*;/,
    );
    expect(actionRule).toMatch(
      /min-inline-size:\s*var\(--touch-target\)\s*;/,
    );
    expect(actionRule).toMatch(/cursor:\s*pointer\s*;/);
    expect(controlLinkRule).toMatch(
      /min-block-size:\s*var\(--touch-target\)\s*;/,
    );
    expect(controlLinkRule).toMatch(
      /min-inline-size:\s*var\(--touch-target\)\s*;/,
    );
    expect(verifiedAtRule).toMatch(/display:\s*block\s*;/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.channelGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
    );
    expect(css).not.toMatch(
      /gradient|backdrop-filter|filter\s*:|box-shadow|@keyframes|animation\s*:|transition\s*:|\bgreen\b|\blime\b|\bemerald\b|\bchartreuse\b/i,
    );
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});

function selectorBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "m"));
  if (!match?.[1]) throw new Error(`Missing base selector: ${selector}`);
  return match[1];
}
