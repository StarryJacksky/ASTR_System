import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { APP_ORIGIN } from "../playwright.config";
import { resetMockCore } from "./support/mock-core-client";

const INACTIVE_SETTLE_MS = 250;
const LCP_WINDOW_MS = 5_000;
const LCP_LIMIT_MS = 2_500;
const CLS_LIMIT = 0.1;
const CLS_SESSION_GAP_MS = 1_000;
const CLS_SESSION_LIMIT_MS = 5_000;
const TBT_LIMIT_MS = 200;
const EVENT_TIMING_LIMIT_MS = 200;
const LAB_INTERACTION_LIMIT_MS = 200;

const MOBILE_ROUTES = [
  "/mobile",
  "/mobile/presence",
  "/mobile/tasks",
  "/mobile/workbench",
  "/mobile/knowledge",
  "/mobile/safety",
] as const;

interface MobileRafProbeSnapshot {
  readonly installed: boolean;
  readonly applicationRequested: number;
  readonly applicationExecuted: number;
  readonly applicationCancelled: number;
  readonly activeApplicationRafs: number;
  readonly applicationStacks: readonly string[];
}

interface AmbientStyleSnapshot {
  readonly selector: ".astr-ambient" | ".astr-grain";
  readonly display: string;
  readonly animationName: string;
  readonly animationDuration: string;
  readonly backgroundImage: string;
  readonly backgroundColor: string;
}

interface InfiniteAnimationSnapshot {
  readonly target: string;
  readonly animationName: string;
  readonly playState: AnimationPlayState;
  readonly iterations: number;
}

interface MobileLabSnapshot {
  readonly supportedEntryTypes: readonly string[];
  readonly observers: Readonly<{
    lcp: boolean;
    layoutShift: boolean;
    longTask: boolean;
    event: boolean;
  }>;
  readonly lcp: readonly Readonly<{
    startTime: number;
    duration: number;
    renderTime: number;
    loadTime: number;
    size: number;
    element: string | null;
    url: string;
  }>[];
  readonly layoutShifts: readonly Readonly<{
    startTime: number;
    duration: number;
    value: number;
    hadRecentInput: boolean;
  }>[];
  readonly longTasks: readonly Readonly<{
    name: string;
    startTime: number;
    duration: number;
  }>[];
  readonly events: readonly Readonly<{
    name: string;
    startTime: number;
    duration: number;
    processingStart: number;
    processingEnd: number;
    interactionId: number;
  }>[];
  readonly labInteractions: readonly Readonly<{
    eventType: string;
    eventStartTime: number;
    firstFrameTime: number;
    nextPaintTime: number;
    duration: number;
  }>[];
  readonly probeRafCalls: number;
  readonly now: number;
  readonly interactionWindowStart: number | null;
}

function longTaskBlockingOverlapMs(
  entry: MobileLabSnapshot["longTasks"][number],
  windowStart: number,
  windowEnd: number,
): number {
  const blockingStart = entry.startTime + 50;
  const blockingEnd = entry.startTime + entry.duration;
  return Math.max(
    0,
    Math.min(blockingEnd, windowEnd) - Math.max(blockingStart, windowStart),
  );
}

function computeFixedWindowTbt(
  entries: MobileLabSnapshot["longTasks"],
  windowStart: number,
  windowEnd: number,
): number {
  return entries.reduce(
    (total, entry) =>
      total + longTaskBlockingOverlapMs(entry, windowStart, windowEnd),
    0,
  );
}

function computeSessionWindowCls(
  entries: MobileLabSnapshot["layoutShifts"],
  sampledThrough: number,
): number {
  const eligible = entries
    .filter(
      (entry) =>
        !entry.hadRecentInput &&
        entry.startTime >= 0 &&
        entry.startTime <= sampledThrough,
    )
    .toSorted((left, right) => left.startTime - right.startTime);
  let sessionStart: number | null = null;
  let previousShiftAt: number | null = null;
  let sessionValue = 0;
  let maximum = 0;

  for (const entry of eligible) {
    const startsNewSession =
      sessionStart === null ||
      previousShiftAt === null ||
      entry.startTime - previousShiftAt >= CLS_SESSION_GAP_MS ||
      entry.startTime - sessionStart >= CLS_SESSION_LIMIT_MS;
    if (startsNewSession) {
      sessionStart = entry.startTime;
      sessionValue = entry.value;
    } else {
      sessionValue += entry.value;
    }
    previousShiftAt = entry.startTime;
    maximum = Math.max(maximum, sessionValue);
  }

  return maximum;
}

test("clips fixed-window TBT and computes session-window CLS", () => {
  expect(
    computeFixedWindowTbt(
      [
        { name: "before-window", startTime: -100, duration: 300 },
        { name: "inside-window", startTime: 20, duration: 100 },
        { name: "after-grace", startTime: 90, duration: 500 },
      ],
      0,
      100,
    ),
  ).toBe(130);
  expect(
    computeSessionWindowCls(
      [
        { startTime: 0, duration: 0, value: 0.06, hadRecentInput: false },
        { startTime: 1_500, duration: 0, value: 0.06, hadRecentInput: false },
        { startTime: 1_600, duration: 0, value: 1, hadRecentInput: true },
      ],
      5_000,
    ),
  ).toBe(0.06);
  expect(
    computeSessionWindowCls(
      [
        { startTime: 0, duration: 0, value: 0.04, hadRecentInput: false },
        { startTime: 500, duration: 0, value: 0.04, hadRecentInput: false },
        { startTime: 900, duration: 0, value: 0.03, hadRecentInput: false },
      ],
      5_000,
    ),
  ).toBeCloseTo(0.11);
  expect(
    computeSessionWindowCls(
      [
        { startTime: 0, duration: 0, value: 0.06, hadRecentInput: false },
        { startTime: 1_000, duration: 0, value: 0.06, hadRecentInput: false },
      ],
      5_000,
    ),
  ).toBe(0.06);
  expect(
    computeSessionWindowCls(
      [
        { startTime: 0, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 999, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 1_998, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 2_997, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 3_996, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 4_995, duration: 0, value: 0.01, hadRecentInput: false },
        { startTime: 5_000, duration: 0, value: 0.04, hadRecentInput: false },
      ],
      5_000,
    ),
  ).toBeCloseTo(0.06);
});

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test("suppresses ambient and grain in every JavaScript-disabled Mobile SSR route", async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(60_000);

  for (const route of MOBILE_ROUTES) {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const issues = collectRuntimeIssues(page);
    try {
      const response = await page.goto(`${APP_ORIGIN}${route}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status(), `${route} HTTP status`).toBe(200);
      await expect(page.locator('[data-route-surface="mobile"]')).toBeVisible();
      await expectSuppressedAmbient(page, route);
      expect(await runningInfiniteAnimations(page), route).toEqual([]);
      expect(issues, route).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("keeps ambient and grain suppressed after hydration on every Mobile route", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  const issues = collectRuntimeIssues(page);

  for (const route of MOBILE_ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} HTTP status`).toBe(200);
    await waitForMobileRouteReady(page, route);
    await expectSuppressedAmbient(page, route);
    expect(await runningInfiniteAnimations(page), route).toEqual([]);
  }
  expect(issues).toEqual([]);
});

test("stable and reduced Mobile contexts own zero application RAF on every route", async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(90_000);

  for (const motion of ["stable", "reduced"] as const) {
    const context = await browser.newContext({
      reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
    });
    await context.addInitScript(installMobileRafProbe);
    const page = await context.newPage();
    const issues = collectRuntimeIssues(page);
    try {
      for (const route of MOBILE_ROUTES) {
        await page.goto(`${APP_ORIGIN}${route}`, {
          waitUntil: "domcontentloaded",
        });
        await waitForMobileRouteReady(page, route);
        await expect(page.locator("html")).toHaveAttribute(
          "data-visual-motion",
          motion === "reduced" ? "reduced" : "full",
        );
        await page.waitForTimeout(INACTIVE_SETTLE_MS);

        const snapshot = await readMobileRafProbe(page);
        expect(snapshot.installed, `${motion} ${route} probe install`).toBe(true);
        expect(snapshot.applicationRequested, `${motion} ${route} requested RAF`).toBe(0);
        expect(snapshot.applicationExecuted, `${motion} ${route} executed RAF`).toBe(0);
        expect(snapshot.applicationCancelled, `${motion} ${route} cancelled RAF`).toBe(0);
        expect(snapshot.activeApplicationRafs, `${motion} ${route} active RAF`).toBe(0);
        expect(snapshot.applicationStacks, `${motion} ${route} RAF stacks`).toEqual([]);
        expect(await runningInfiniteAnimations(page), `${motion} ${route}`).toEqual([]);
      }
      expect(issues, motion).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("real hidden Mobile page retains zero application RAF without synthetic visibility", async ({
  context,
  page,
}, testInfo) => {
  await page.addInitScript(installMobileRafProbe);
  const issues = collectRuntimeIssues(page);
  await page.goto("/mobile/tasks", { waitUntil: "domcontentloaded" });
  await waitForMobileRouteReady(page, "/mobile/tasks");
  const initialSnapshot = await readMobileRafProbe(page);
  expect(initialSnapshot.installed).toBe(true);
  expect(initialSnapshot.applicationRequested).toBe(0);

  const foreground = await openRealForegroundTab(context, page);
  let restoreBrowserWindow: (() => Promise<void>) | null = null;
  try {
    await foreground.bringToFront();
    let visibility = await waitForRealHidden(page);
    const [sourceWindowId, foregroundWindowId] = await Promise.all([
      readBrowserWindowId(context, page),
      readBrowserWindowId(context, foreground),
    ]);
    const attempts: Array<Record<string, unknown>> = [
      {
        method: "foreground-tab",
        observedVisibility: visibility,
        sourceWindowId,
        foregroundWindowId,
        sameBrowserWindow: sourceWindowId === foregroundWindowId,
      },
    ];

    if (visibility !== "hidden") {
      const minimized = await minimizeRealBrowserWindow(context, page);
      visibility = minimized.observedVisibility;
      restoreBrowserWindow = minimized.restore;
      attempts.push({
        method: "browser-window-minimize",
        supported: minimized.supported,
        observedVisibility: minimized.observedVisibility,
        detail: minimized.detail,
      });
    }

    if (visibility !== "hidden") {
      const evidence = {
        route: "/mobile/tasks",
        observedVisibility: visibility,
        syntheticVisibilityUsed: false,
        configuredHeadless: testInfo.project.use.headless ?? null,
        attempts,
        rafWhileStillVisible: await readMobileRafProbe(page),
        blocker:
          "Chromium did not expose a real hidden Page after a foreground-tab switch and real browser-window minimization.",
      };
      testInfo.annotations.push({
        type: "environment-blocker",
        description: evidence.blocker,
      });
      await attachJson(testInfo, "mobile-hidden-environment-blocker.json", evidence);
      throw new Error(`ENVIRONMENT_BLOCKER: ${evidence.blocker}`);
    }

    await page.waitForTimeout(INACTIVE_SETTLE_MS);
    const hiddenSnapshot = await readMobileRafProbe(page);
    expect(hiddenSnapshot.installed).toBe(true);
    expect(hiddenSnapshot.applicationRequested).toBe(0);
    expect(hiddenSnapshot.applicationExecuted).toBe(0);
    expect(hiddenSnapshot.applicationCancelled).toBe(0);
    expect(hiddenSnapshot.activeApplicationRafs).toBe(0);
    expect(hiddenSnapshot.applicationStacks).toEqual([]);
    expect(issues).toEqual([]);
    await attachJson(testInfo, "mobile-hidden-evidence.json", {
      route: "/mobile/tasks",
      observedVisibility: visibility,
      syntheticVisibilityUsed: false,
      configuredHeadless: testInfo.project.use.headless ?? null,
      attempts,
      hiddenSnapshot,
    });
  } finally {
    await restoreBrowserWindow?.();
    await foreground.close();
  }
});

test("measures Mobile lab LCP CLS TBT Event Timing and next-paint proxy", async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  const context = await openLabContext(browser);
  const page = await context.newPage();
  const issues = collectRuntimeIssues(page);

  try {
    const response = await page.goto(`${APP_ORIGIN}/mobile/tasks`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await waitForMobileRouteReady(page, "/mobile/tasks");
    await expect.poll(async () => (await readMobileLabProbe(page)).lcp.length)
      .toBeGreaterThan(0);

    const interactionWindowStart = await page.evaluate(
      markMobileLabInteractionWindow,
    );
    const editor = page.getByRole("textbox", { name: "本地任务草稿" });
    await editor.click();
    await editor.pressSequentially("性能观测输入");
    await page.evaluate(armMobileLabNextPaint);
    await page.getByRole("button", { name: "保存到此浏览器" }).click();
    await expect.poll(async () =>
      (await readMobileLabProbe(page)).labInteractions.length,
    ).toBe(1);

    const afterInteraction = await readMobileLabProbe(page);
    const provisionalLcp = afterInteraction.lcp.at(-1);
    if (!provisionalLcp) throw new Error("LCP observer produced no entry");
    const remainingWindowMs = Math.max(
      0,
      provisionalLcp.startTime + LCP_WINDOW_MS - afterInteraction.now,
    );
    await page.waitForTimeout(remainingWindowMs);
    await page.waitForTimeout(100);

    const raw = await readMobileLabProbe(page);
    const finalLcp = raw.lcp.at(-1);
    if (!finalLcp) throw new Error("LCP observer produced no final entry");
    const windowEnd = finalLcp.startTime + LCP_WINDOW_MS;
    const measuredLongTasks = raw.longTasks
      .map((entry) => ({
        ...entry,
        blockingMs: longTaskBlockingOverlapMs(
          entry,
          finalLcp.startTime,
          windowEnd,
        ),
      }))
      .filter(({ blockingMs }) => blockingMs > 0);
    const tbt = computeFixedWindowTbt(
      raw.longTasks,
      finalLcp.startTime,
      windowEnd,
    );
    const cls = computeSessionWindowCls(raw.layoutShifts, windowEnd);
    const measuredEvents = raw.events.filter(
      (entry) =>
        entry.startTime >= interactionWindowStart && entry.startTime <= windowEnd,
    );
    const observedEventDuration = Math.max(
      0,
      ...measuredEvents.map(({ duration }) => duration),
    );
    const labInteraction = raw.labInteractions[0];
    if (!labInteraction) throw new Error("Click-to-next-paint probe produced no sample");

    const evidence = {
      schemaVersion: 1,
      profile: "mobile-lab",
      route: "/mobile/tasks",
      viewport: { width: 390, height: 844 },
      fixedWindow: {
        startTime: finalLcp.startTime,
        endTime: windowEnd,
        duration: LCP_WINDOW_MS,
        sampledAt: raw.now,
      },
      metrics: {
        lcpMs: finalLcp.startTime,
        cls,
        tbtMs: tbt,
        observedEventTimingMs: observedEventDuration,
        labClickToNextPaintMs: labInteraction.duration,
      },
      thresholds: {
        lcpMs: LCP_LIMIT_MS,
        cls: CLS_LIMIT,
        tbtMs: TBT_LIMIT_MS,
        observedEventTimingMs: EVENT_TIMING_LIMIT_MS,
        labClickToNextPaintMs: LAB_INTERACTION_LIMIT_MS,
      },
      support: {
        entryTypes: raw.supportedEntryTypes,
        observers: raw.observers,
        fieldInp: "pending-real-user-monitoring",
      },
      raw: {
        lcp: raw.lcp,
        layoutShifts: raw.layoutShifts,
        longTasks: raw.longTasks,
        measuredLongTasks,
        events: raw.events,
        measuredEvents,
        labInteractions: raw.labInteractions,
        probeRafCalls: raw.probeRafCalls,
      },
    };
    await attachJson(testInfo, "mobile-performance-raw.json", evidence);

    expect(raw.now, "the sample must span the fixed five-second post-LCP window")
      .toBeGreaterThanOrEqual(windowEnd);
    expect(raw.observers.lcp, "LCP PerformanceObserver must be installed").toBe(true);
    expect(raw.observers.layoutShift, "LayoutShift observer must be installed").toBe(true);
    expect(raw.observers.longTask, "LongTask observer must be installed").toBe(true);
    expect(raw.observers.event, "Event Timing observer must be installed").toBe(true);
    expect(
      measuredEvents.length,
      "Event Timing is required; no synthetic duration may replace a missing entry",
    ).toBeGreaterThan(0);
    expect(finalLcp.startTime).toBeLessThanOrEqual(LCP_LIMIT_MS);
    expect(cls).toBeLessThanOrEqual(CLS_LIMIT);
    expect(tbt).toBeLessThanOrEqual(TBT_LIMIT_MS);
    expect(observedEventDuration).toBeLessThanOrEqual(EVENT_TIMING_LIMIT_MS);
    expect(labInteraction.duration).toBeLessThanOrEqual(
      LAB_INTERACTION_LIMIT_MS,
    );
    expect(raw.probeRafCalls).toBe(2);
    expect(issues).toEqual([]);
  } finally {
    await context.close();
  }
});

async function waitForMobileRouteReady(page: Page, requestedRoute: string): Promise<void> {
  const route = requestedRoute === "/mobile" ? "/mobile/presence" : requestedRoute;
  await expect(page.locator('[data-route-surface="mobile"]')).toBeVisible();

  if (route === "/mobile/presence") {
    const facts = page.locator('dl[aria-label="Presence 连接事实"]');
    await expect(facts).toBeVisible();
    await expect(facts.locator("dd").filter({ hasText: /^可达$/ })).toHaveCount(1);
    await expect(facts.locator("dd").filter({ hasText: /^已连接$/ })).toHaveCount(2);
    return;
  }
  if (route === "/mobile/tasks") {
    await expect(page.locator('[data-storage-phase="ready"]')).toHaveText(
      "本地存储可用",
    );
    return;
  }
  if (route === "/mobile/safety") {
    await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);
    return;
  }
  const heading = route === "/mobile/workbench" ? "AI 工作台" : "知识";
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

async function expectSuppressedAmbient(page: Page, route: string): Promise<void> {
  const styles = await readAmbientStyles(page);
  expect(styles, `${route} ambient nodes`).toHaveLength(2);
  for (const style of styles) {
    expect(style.display, `${route} ${style.selector} display`).toBe("none");
    expect(style.animationName, `${route} ${style.selector} animation`).toBe("none");
    expect(style.animationDuration, `${route} ${style.selector} duration`).toBe("0s");
    expect(style.backgroundImage, `${route} ${style.selector} image`).toBe("none");
    expect(style.backgroundColor, `${route} ${style.selector} color`).toBe(
      "rgba(0, 0, 0, 0)",
    );
  }
}

async function readAmbientStyles(page: Page): Promise<AmbientStyleSnapshot[]> {
  return page.evaluate(() =>
    ([".astr-ambient", ".astr-grain"] as const).map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing ambient node: ${selector}`);
      }
      const style = getComputedStyle(element);
      return {
        selector,
        display: style.display,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
      };
    }),
  );
}

async function runningInfiniteAnimations(
  page: Page,
): Promise<InfiniteAnimationSnapshot[]> {
  return page.evaluate(() =>
    document.getAnimations().flatMap((animation) => {
      const timing = animation.effect?.getComputedTiming();
      if (animation.playState !== "running" || timing?.iterations !== Infinity) {
        return [];
      }
      const target = animation.effect instanceof KeyframeEffect
        ? animation.effect.target
        : null;
      const element = target instanceof Element ? target : null;
      return [{
        target: element
          ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
            element.classList.length > 0
              ? `.${[...element.classList].join(".")}`
              : ""
          }`
          : "unknown",
        animationName: element ? getComputedStyle(element).animationName : "unknown",
        playState: animation.playState,
        iterations: timing?.iterations ?? 0,
      }];
    }),
  );
}

function installMobileRafProbe(): void {
  type ProbeWindow = Window & {
    __ASTR_MOBILE_RAF_PROBE__?: {
      readonly snapshot: () => MobileRafProbeSnapshot;
    };
  };
  const probeWindow = window as ProbeWindow;
  if (probeWindow.__ASTR_MOBILE_RAF_PROBE__) return;

  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const active = new Set<number>();
  const stacks: string[] = [];
  let requested = 0;
  let executed = 0;
  let cancelled = 0;

  const instrumentedRequest: typeof window.requestAnimationFrame = (callback) => {
    requested += 1;
    if (stacks.length < 32) stacks.push(new Error().stack ?? "RAF stack unavailable");
    let requestId = 0;
    requestId = nativeRequest((timestamp) => {
      active.delete(requestId);
      executed += 1;
      callback(timestamp);
    });
    active.add(requestId);
    return requestId;
  };
  const instrumentedCancel: typeof window.cancelAnimationFrame = (requestId) => {
    if (active.delete(requestId)) cancelled += 1;
    nativeCancel(requestId);
  };

  try {
    window.requestAnimationFrame = instrumentedRequest;
    window.cancelAnimationFrame = instrumentedCancel;
  } catch {
    // The immutable-hook state is exposed through installed=false and fails the gate.
  }

  probeWindow.__ASTR_MOBILE_RAF_PROBE__ = Object.freeze({
    snapshot: () => ({
      installed:
        window.requestAnimationFrame === instrumentedRequest &&
        window.cancelAnimationFrame === instrumentedCancel,
      applicationRequested: requested,
      applicationExecuted: executed,
      applicationCancelled: cancelled,
      activeApplicationRafs: active.size,
      applicationStacks: [...stacks],
    }),
  });
}

async function readMobileRafProbe(page: Page): Promise<MobileRafProbeSnapshot> {
  return page.evaluate(() => {
    const probe = (
      window as Window & {
        __ASTR_MOBILE_RAF_PROBE__?: {
          readonly snapshot: () => MobileRafProbeSnapshot;
        };
      }
    ).__ASTR_MOBILE_RAF_PROBE__;
    if (!probe) throw new Error("Mobile RAF probe is unavailable");
    return probe.snapshot();
  });
}

async function waitForRealHidden(page: Page): Promise<DocumentVisibilityState> {
  const deadline = Date.now() + 2_000;
  let visibility = await page.evaluate(() => document.visibilityState);
  while (visibility !== "hidden" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    visibility = await page.evaluate(() => document.visibilityState);
  }
  return visibility;
}

async function openRealForegroundTab(
  context: BrowserContext,
  page: Page,
): Promise<Page> {
  const triggerId = "astr-e2e-foreground-tab";
  await page.evaluate((id) => {
    const trigger = document.createElement("a");
    trigger.id = id;
    trigger.href = "about:blank";
    trigger.target = "_blank";
    trigger.rel = "noopener";
    trigger.textContent = "Open verification tab";
    Object.assign(trigger.style, {
      position: "fixed",
      inset: "0 auto auto 0",
      zIndex: "2147483647",
    });
    document.body.append(trigger);
  }, triggerId);
  const [foreground] = await Promise.all([
    context.waitForEvent("page"),
    page.locator(`#${triggerId}`).click(),
  ]);
  await page.evaluate((id) => document.getElementById(id)?.remove(), triggerId);
  await foreground.waitForLoadState("domcontentloaded");
  return foreground;
}

async function readBrowserWindowId(
  context: BrowserContext,
  page: Page,
): Promise<number> {
  const session = await context.newCDPSession(page);
  try {
    const browserWindow = (await session.send("Browser.getWindowForTarget")) as {
      windowId: number;
    };
    return browserWindow.windowId;
  } finally {
    await session.detach();
  }
}

async function minimizeRealBrowserWindow(
  context: BrowserContext,
  page: Page,
): Promise<{
  readonly supported: boolean;
  readonly observedVisibility: DocumentVisibilityState;
  readonly detail: string;
  readonly restore: () => Promise<void>;
}> {
  const session = await context.newCDPSession(page);
  try {
    const browserWindow = (await session.send("Browser.getWindowForTarget")) as {
      windowId: number;
      bounds: {
        left?: number;
        top?: number;
        width?: number;
        height?: number;
        windowState?: "normal" | "minimized" | "maximized" | "fullscreen";
      };
    };
    await session.send("Browser.setWindowBounds", {
      windowId: browserWindow.windowId,
      bounds: { windowState: "minimized" },
    });
    const observedVisibility = await waitForRealHidden(page);

    return {
      supported: true,
      observedVisibility,
      detail: `window ${browserWindow.windowId} entered the Chromium minimized state`,
      restore: async () => {
        const originalState = browserWindow.bounds.windowState ?? "normal";
        const normalBounds = Object.fromEntries(
          Object.entries(browserWindow.bounds).filter(
            ([key, value]) => key !== "windowState" && value !== undefined,
          ),
        );
        await session.send("Browser.setWindowBounds", {
          windowId: browserWindow.windowId,
          bounds:
            originalState === "normal"
              ? { ...normalBounds, windowState: "normal" }
              : { windowState: originalState },
        });
        await session.detach();
      },
    };
  } catch (error) {
    await session.detach();
    return {
      supported: false,
      observedVisibility: await page.evaluate(() => document.visibilityState),
      detail: error instanceof Error ? error.message : String(error),
      restore: async () => undefined,
    };
  }
}

async function openLabContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(installMobileLabProbe);
  return context;
}

function installMobileLabProbe(): void {
  type LabApi = {
    readonly snapshot: () => MobileLabSnapshot;
    readonly markInteractionWindow: () => number;
    readonly armNextPaint: (eventType: string) => void;
  };
  type LabWindow = Window & { __ASTR_MOBILE_LAB_PROBE__?: LabApi };
  const probeWindow = window as LabWindow;
  if (probeWindow.__ASTR_MOBILE_LAB_PROBE__) return;

  const supportedEntryTypes = new Set(
    typeof PerformanceObserver === "function"
      ? PerformanceObserver.supportedEntryTypes ?? []
      : [],
  );
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const lcp: MobileLabSnapshot["lcp"][number][] = [];
  const layoutShifts: MobileLabSnapshot["layoutShifts"][number][] = [];
  const longTasks: MobileLabSnapshot["longTasks"][number][] = [];
  const events: MobileLabSnapshot["events"][number][] = [];
  const labInteractions: MobileLabSnapshot["labInteractions"][number][] = [];
  let probeRafCalls = 0;
  let interactionWindowStart: number | null = null;

  const observe = (
    type: string,
    listener: (entry: PerformanceEntry) => void,
    options: PerformanceObserverInit = { type, buffered: true },
  ): boolean => {
    if (!supportedEntryTypes.has(type)) return false;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) listener(entry);
      });
      observer.observe(options);
      return true;
    } catch {
      return false;
    }
  };

  const observers = {
    lcp: observe("largest-contentful-paint", (entry) => {
      const value = entry as PerformanceEntry & {
        readonly renderTime?: number;
        readonly loadTime?: number;
        readonly size?: number;
        readonly element?: Element | null;
        readonly url?: string;
      };
      lcp.push({
        startTime: entry.startTime,
        duration: entry.duration,
        renderTime: value.renderTime ?? 0,
        loadTime: value.loadTime ?? 0,
        size: value.size ?? 0,
        element: value.element?.tagName.toLowerCase() ?? null,
        url: value.url ?? "",
      });
    }),
    layoutShift: observe("layout-shift", (entry) => {
      const value = entry as PerformanceEntry & {
        readonly value?: number;
        readonly hadRecentInput?: boolean;
      };
      layoutShifts.push({
        startTime: entry.startTime,
        duration: entry.duration,
        value: value.value ?? 0,
        hadRecentInput: value.hadRecentInput ?? false,
      });
    }),
    longTask: observe("longtask", (entry) => {
      longTasks.push({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
      });
    }),
    event: observe(
      "event",
      (entry) => {
        const value = entry as PerformanceEntry & {
          readonly processingStart?: number;
          readonly processingEnd?: number;
          readonly interactionId?: number;
        };
        events.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
          processingStart: value.processingStart ?? 0,
          processingEnd: value.processingEnd ?? 0,
          interactionId: value.interactionId ?? 0,
        });
      },
      {
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit & { readonly durationThreshold: number },
    ),
  };

  probeWindow.__ASTR_MOBILE_LAB_PROBE__ = Object.freeze({
    markInteractionWindow: () => {
      interactionWindowStart = performance.now();
      return interactionWindowStart;
    },
    armNextPaint: (eventType) => {
      document.addEventListener(
        eventType,
        () => {
          const eventStartTime = performance.now();
          probeRafCalls += 1;
          nativeRequestAnimationFrame((firstFrameTime) => {
            probeRafCalls += 1;
            nativeRequestAnimationFrame((nextPaintTime) => {
              labInteractions.push({
                eventType,
                eventStartTime,
                firstFrameTime,
                nextPaintTime,
                duration: Math.max(0, nextPaintTime - eventStartTime),
              });
            });
          });
        },
        { capture: true, once: true },
      );
    },
    snapshot: () => ({
      supportedEntryTypes: [...supportedEntryTypes].sort(),
      observers: { ...observers },
      lcp: lcp.map((entry) => ({ ...entry })),
      layoutShifts: layoutShifts.map((entry) => ({ ...entry })),
      longTasks: longTasks.map((entry) => ({ ...entry })),
      events: events.map((entry) => ({ ...entry })),
      labInteractions: labInteractions.map((entry) => ({ ...entry })),
      probeRafCalls,
      now: performance.now(),
      interactionWindowStart,
    }),
  });
}

function markMobileLabInteractionWindow(): number {
  const probe = (
    window as Window & {
      __ASTR_MOBILE_LAB_PROBE__?: {
        readonly markInteractionWindow: () => number;
      };
    }
  ).__ASTR_MOBILE_LAB_PROBE__;
  if (!probe) throw new Error("Mobile lab probe is unavailable");
  return probe.markInteractionWindow();
}

function armMobileLabNextPaint(): void {
  const probe = (
    window as Window & {
      __ASTR_MOBILE_LAB_PROBE__?: {
        readonly armNextPaint: (eventType: string) => void;
      };
    }
  ).__ASTR_MOBILE_LAB_PROBE__;
  if (!probe) throw new Error("Mobile lab probe is unavailable");
  probe.armNextPaint("click");
}

async function readMobileLabProbe(page: Page): Promise<MobileLabSnapshot> {
  return page.evaluate(() => {
    const probe = (
      window as Window & {
        __ASTR_MOBILE_LAB_PROBE__?: {
          readonly snapshot: () => MobileLabSnapshot;
        };
      }
    ).__ASTR_MOBILE_LAB_PROBE__;
    if (!probe) throw new Error("Mobile lab probe is unavailable");
    return probe.snapshot();
  });
}

function collectRuntimeIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (message) => {
    const hydration = /hydration|did not match|server rendered text/i.test(
      message.text(),
    );
    if (message.type() === "error" || hydration) {
      issues.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  return issues;
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}
