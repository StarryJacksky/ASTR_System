import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  installPresencePerformanceProbe,
  readPresencePerformanceProbe,
} from "./support/performance-evidence";
import {
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

const INACTIVE_SETTLE_MS = 250;
const LIVE2D_2048_TEXTURE = /\/live2d\/.*\.2048\/texture_\d+\.png(?:\?|$)/;

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test("reduced motion owns zero RAF after 250ms and never requests Live2D 2048 textures", async ({
  page,
}) => {
  const textureRequests: string[] = [];
  page.on("request", (request) => {
    if (LIVE2D_2048_TEXTURE.test(request.url())) textureRequests.push(request.url());
  });
  await page.addInitScript(installPresencePerformanceProbe);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
  await expect(page.locator("html")).toHaveAttribute("data-visual-motion", "reduced");
  await expect(page.locator("[data-presence-visual-host]"))
    .toHaveAttribute("data-visual-status", "reduced");
  await page.waitForTimeout(INACTIVE_SETTLE_MS);

  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
  expect(textureRequests).toEqual([]);
});

test("compact mobile owns zero RAF and never requests Live2D 2048 textures", async ({
  page,
}) => {
  const textureRequests: string[] = [];
  page.on("request", (request) => {
    if (LIVE2D_2048_TEXTURE.test(request.url())) textureRequests.push(request.url());
  });
  await page.addInitScript(installPresencePerformanceProbe);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
  await page.waitForTimeout(INACTIVE_SETTLE_MS);

  const probe = await readPresencePerformanceProbe(page);
  expect(probe.raf.active).toBe(0);
  expect(probe.support.raf).toMatchObject({ installed: true, observed: true });
  expect(probe.support.webgl).toMatchObject({ installed: true, observed: true });
  expect(probe.dom.canvasCount).toBe(0);
  expect(Math.max(...probe.webgl.contextCountSamples)).toBe(0);
  expect(probe.canvasBackingSizeSamples).toEqual([]);
  expect(probe.canvasDprSamples).toEqual([]);
  expect(textureRequests).toEqual([]);
});

test("pause and offscreen each release every app-owned RAF within 250ms", async ({
  page,
}) => {
  await page.addInitScript(installPresencePerformanceProbe);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
  await waitForVisualAttemptToSettle(page);

  await page.locator(".astr-motion-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-visual-motion", "paused");
  await page.waitForTimeout(INACTIVE_SETTLE_MS);
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);

  await page.locator(".astr-motion-toggle").click();
  await page.locator("main#main-content").evaluate((main) => {
    (main as HTMLElement).style.transform = "translateY(200vh)";
  });
  expect(await waitForOffscreenIntersection(page)).toBe(true);
  await page.waitForTimeout(INACTIVE_SETTLE_MS);
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
});

test("hidden page releases every app-owned RAF within 250ms", async ({
  context,
  page,
}, testInfo) => {
  await page.addInitScript(installPresencePerformanceProbe);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
  await waitForVisualAttemptToSettle(page);

  const foreground = await context.newPage();
  await foreground.goto("about:blank");
  await foreground.bringToFront();
  await foreground.waitForTimeout(INACTIVE_SETTLE_MS);
  const visibility = await page.evaluate(() => document.visibilityState);
  if (visibility !== "hidden") {
    testInfo.annotations.push({
      type: "unsupported",
      description:
        "Headless Chromium keeps every Page visible; no synthetic visibility override was used.",
    });
    await foreground.close();
    test.skip(true, "Real hidden-page lifecycle is unavailable in this headless browser.");
  }
  expect(visibility).toBe("hidden");
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
  await foreground.close();
});

test("runtime path caps total outstanding RAF and classifies observed scheduler stacks", async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(installPresencePerformanceProbe);
  const page = await context.newPage();

  try {
    await page.goto("http://127.0.0.1:3100/", { waitUntil: "domcontentloaded" });
    await waitForOpenStreams(page);
    await waitForVisualAttemptToSettle(page);
    const probe = await readPresencePerformanceProbe(page);

    expect(probe.support.raf).toMatchObject({
      supported: true,
      installed: true,
      observed: true,
    });
    expect(probe.support.webgl).toMatchObject({
      supported: true,
      installed: true,
      observed: true,
    });
    expect(Math.max(...probe.webgl.contextCountSamples)).toBeLessThanOrEqual(1);
    if (probe.dom.visualPhase === "ready") {
      expect(probe.dom.canvasCount).toBe(1);
      expect(probe.canvasBackingSizeSamples.length).toBeGreaterThan(0);
      for (const sample of probe.canvasBackingSizeSamples) {
        expect(sample.backingWidth / sample.clientWidth).toBeLessThanOrEqual(1.5);
        expect(sample.backingHeight / sample.clientHeight).toBeLessThanOrEqual(1.5);
        expect(sample.dpr).toBeLessThanOrEqual(1.5);
      }
      expect(probe.raf.scheduler).toEqual({
        renderPath: "dynamic",
        applicationRootCount: 1,
        sharedTickerListenerCount: 0,
        sharedTickerRafCount: 0,
        provenance: "source-verified-policy",
      });
    } else {
      expect(probe.dom.visualPhase).toBe("static");
      expect(probe.dom.canvasCount).toBe(0);
      expect(probe.webgl.contextCountSamples.at(-1)).toBe(0);
      for (const sample of probe.canvasBackingSizeSamples) {
        expect(sample.backingWidth / sample.clientWidth).toBeLessThanOrEqual(1.5);
        expect(sample.backingHeight / sample.clientHeight).toBeLessThanOrEqual(1.5);
        expect(sample.dpr).toBeLessThanOrEqual(1.5);
      }
      expect(probe.raf.scheduler).toEqual({
        renderPath: "static",
        applicationRootCount: 0,
        sharedTickerListenerCount: 0,
        sharedTickerRafCount: 0,
        provenance: "no-renderer",
      });
    }
    expect(probe.raf.maxActive).toBeLessThanOrEqual(1);
    for (const scheduler of probe.raf.schedulerStacks) {
      expect(scheduler.stack.length).toBeGreaterThan(0);
      expect(scheduler.classification).toMatch(
        /^(pixi-application|application|other)$/,
      );
    }
    expect(await page.locator("[data-dynamic-jewel='active']").count())
      .toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test("production runtime policy disables Pixi shared ticker ownership", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/features/presence/visual/presence-visual-runtime.ts"),
    "utf8",
  );

  expect(source).toMatch(/autoStart:\s*false/);
  expect(source).toMatch(/sharedTicker:\s*false/);
  expect(source).not.toMatch(/Ticker\.shared/);
});

async function waitForVisualAttemptToSettle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator("[data-presence-visual-host]").getAttribute("data-visual-phase"),
    )
    .toMatch(/^(loading|ready|static)$/);
  await expect
    .poll(() =>
      page.locator("[data-presence-visual-host]").getAttribute("data-visual-phase"),
    )
    .not.toBe("loading");
}

async function waitForOffscreenIntersection(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    new Promise<boolean>((resolve) => {
      const target = document.querySelector("main#main-content");
      if (target === null || typeof IntersectionObserver !== "function") {
        resolve(false);
        return;
      }
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 5_000);
      const observer = new IntersectionObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === target);
        if (entry === undefined || entry.isIntersecting) return;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(true);
      });
      observer.observe(target);
    }),
  );
}
