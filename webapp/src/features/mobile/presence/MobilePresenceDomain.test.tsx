import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { renderToString } from "react-dom/server";

import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRESENCE_CONTROLLER_SERVER_SNAPSHOT } from "@/features/presence/controller/create-presence-controller";

import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import {
  createDomainHydrationHarness,
  createPoisonOwner,
} from "./presence-hydration.test-support";
import { createPresenceOwnerFixture } from "./presence.test-support";
import { MobilePresenceDomain } from "./MobilePresenceDomain";

const hydration = createDomainHydrationHarness();

afterEach(async () => {
  await hydration.releaseAll();
  vi.restoreAllMocks();
});

describe("MobilePresenceDomain", () => {
  it("server-renders checking without touching any Presence owner method", () => {
    const poison = createPoisonOwner();
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted>
        <MobilePresenceDomain owner={poison.owner} />
      </MobileAuthorityProvider>,
    );

    expect(html).toContain("正在核验本机 Presence");
    expect(html).not.toContain("消息输入");
    expect(poison.touches).not.toHaveBeenCalled();
  });

  it("server-renders remote capability truth with zero owner access", () => {
    const poison = createPoisonOwner();
    const html = renderToString(
      <MobileAuthorityProvider serverAuthorityTrusted={false}>
        <MobilePresenceDomain owner={poison.owner} />
      </MobileAuthorityProvider>,
    );

    expect(html).toContain("未连接 Core");
    expect(html).toContain("当前来源或 Core 目标不是本机可信入口");
    expect(html).not.toContain("消息输入");
    expect(html).not.toContain('href="/"');
    expect(html).not.toContain('href="/admin');
    expect(poison.touches).not.toHaveBeenCalled();
  });

  it("hydrates a trusted loopback browser against one owner subscription", async () => {
    expect(window.location.hostname).toBe("localhost");
    const fixture = createPresenceOwnerFixture(
      PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    );
    const hydrated = await hydration.hydrate(true, fixture.owner);

    expect(hydrated.serverHtml).toContain("正在核验本机 Presence");
    await waitFor(() => {
      expect(
        hydrated.host.querySelector("[aria-label='消息输入']"),
      ).not.toBeNull();
    });
    expect(hydrated.recoverableError).not.toHaveBeenCalled();
    expect(fixture.activeSubscribers()).toBe(1);
    expect(fixture.peakSubscribers()).toBe(1);
    await hydrated.unmount();
    expect(fixture.activeSubscribers()).toBe(0);
  });

  it("keeps server-rejected hydration outside Presence across pageshow", async () => {
    const poison = createPoisonOwner();
    const remote = await hydration.hydrate(false, poison.owner);

    await waitFor(() => {
      expect(remote.host.textContent).toContain("未连接 Core");
    });
    expect(remote.recoverableError).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(poison.touches).not.toHaveBeenCalled();
    expect(remote.host.textContent).toContain("未连接 Core");
    await remote.unmount();
  });

  it("locks the authority gate and trusted Presence to the Mobile CSS constitution", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/presence/TrustedMobilePresenceDomain.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        "src/features/mobile/presence/MobilePresenceDomain.module.css",
      ),
      "utf8",
    );
    const composerCss = readFileSync(
      resolve(
        process.cwd(),
        "src/features/presence/components/Composer.module.css",
      ),
      "utf8",
    );
    const timelineCss = readFileSync(
      resolve(
        process.cwd(),
        "src/features/presence/components/PresenceTimelines.module.css",
      ),
      "utf8",
    );
    const gateRule = css.match(/\.gate\s*\{([^}]*)\}/)?.[1];
    const dialogueRule = css.match(/\.dialogueSurface\s*\{([^}]*)\}/)?.[1];
    const soulMarkRule = css.match(/\.soulMark\s*\{([^}]*)\}/)?.[1];

    expect(source).toContain(
      'from "@/features/presence/components/ConversationRegion"',
    );
    expect(source).toContain(
      'from "@/features/presence/components/Composer"',
    );
    expect(source).not.toMatch(/MessageTimeline|projectConversationTimeline/);
    expect(source).not.toMatch(
      /PresenceExperience|SoulPresence|PresenceVisualHost|PresenceVisibilityBridge|JewelRuntime|pixi|live2d|three|webgl|framer-motion|canvas|getContext|requestAnimationFrame/i,
    );
    expect(source).not.toMatch(
      /internalHandle|model|costTodayUsd|dailyBudgetUsd/,
    );
    expect(source).not.toMatch(/safety|guard|task|dispatch|device|approval/i);

    expect(gateRule).toBeDefined();
    expect(gateRule).toContain("min-inline-size: 0");
    expect(gateRule).toContain("max-inline-size: 52rem");
    expect(gateRule).toContain(
      "border-block: 1px solid var(--astr-hairline-strong)",
    );
    expect(gateRule).toContain(
      "border-inline-start: 3px solid var(--astr-soul)",
    );
    expect(gateRule).toContain("background: var(--astr-surface)");
    expect(gateRule).not.toMatch(/border-radius|box-shadow/);
    expect(dialogueRule).toBeDefined();
    expect(soulMarkRule).toBeDefined();
    expect(soulMarkRule).toContain("position: relative");
    expect(soulMarkRule).toContain("flex: none");
    expect(soulMarkRule).not.toMatch(/\binset(?:-|\s*:)|z-index|transform/);
    expect(dialogueRule).toMatch(/block-size:\s*clamp\([\s\S]*100dvh/);
    expect(dialogueRule).toMatch(
      /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(dialogueRule).toContain("min-block-size: 0");
    expect(dialogueRule).toContain("min-inline-size: 0");
    expect(dialogueRule).toContain("overflow: visible");
    expect(dialogueRule).toContain(
      "var(--mobile-nav-block-size, 5.25rem)",
    );
    expect(dialogueRule).toContain("env(safe-area-inset-bottom)");
    expect(dialogueRule).toContain(
      "--astr-composer-max-block-size: min(42%, 21rem)",
    );
    expect(dialogueRule).toContain("--astr-composer-overflow-y: auto");
    expect(css).toMatch(
      /\.lens\s+:global\(\.lensOuter\)[\s\S]*fill:\s*none/,
    );
    expect(css).toMatch(
      /\.lens\s+:global\(\.lensFacet\)[\s\S]*fill:\s*var\(--astr-surface-2\)/,
    );
    expect(css).toMatch(
      /\.lens\s+:global\(\.lensCore\)[\s\S]*fill:\s*var\(--astr-soul\)/,
    );
    expect(css).not.toMatch(
      /gradient|backdrop-filter|filter\s*:|box-shadow|@keyframes|animation\s*:|\bgreen\b|\blime\b|\bemerald\b|\bchartreuse\b/i,
    );
    expect(composerCss).not.toMatch(/gradient/i);
    expect(composerCss).toMatch(
      /box-shadow:\s*var\(\s*--astr-composer-shadow,\s*none\s*\)/,
    );
    expect(composerCss).toMatch(
      /max-block-size:\s*var\(\s*--astr-composer-max-block-size,\s*none\s*\)/,
    );
    expect(composerCss).toMatch(
      /overflow-y:\s*var\(\s*--astr-composer-overflow-y,\s*visible\s*\)/,
    );
    expect(timelineCss).toMatch(
      /box-shadow:\s*var\(\s*--astr-timeline-assistant-shadow,\s*none\s*\)/,
    );
    expect(timelineCss).toMatch(
      /box-shadow:\s*var\(\s*--astr-timeline-return-shadow,\s*none\s*\)/,
    );
    expect(css).toMatch(
      /\.statusRail\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).not.toMatch(
      /\.statusRail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/@media\s*\(max-width:\s*44rem\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*25rem\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});
