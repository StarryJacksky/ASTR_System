import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  APP_ORIGIN as BASE_URL,
  REMOTE_APP_ORIGIN,
} from "../playwright.config";
import {
  configureMockCore,
  resetMockCore,
} from "./support/mock-core-client";

type MobileDomain =
  | "presence"
  | "tasks"
  | "workbench"
  | "knowledge"
  | "safety";
type SafetyChannel = "status" | "policy" | "audit";

interface AxeScenario {
  readonly label: string;
  readonly path: `/mobile/${MobileDomain}`;
  readonly remote?: boolean;
  readonly storageFailure?: boolean;
  readonly configure?: Readonly<Record<string, unknown>>;
  readonly settle: (page: Page, request: APIRequestContext) => Promise<void>;
}

interface MobileRoute {
  readonly domain: MobileDomain;
  readonly label: string;
  readonly path: `/mobile/${MobileDomain}`;
  readonly settle: (page: Page) => Promise<void>;
}

const MOBILE_ROUTES: readonly MobileRoute[] = [
  {
    domain: "presence",
    label: "露怀秋",
    path: "/mobile/presence",
    settle: (page) => expectPresenceReady(page),
  },
  {
    domain: "tasks",
    label: "任务",
    path: "/mobile/tasks",
    settle: (page) => expectTasksReady(page),
  },
  {
    domain: "workbench",
    label: "AI 工作台",
    path: "/mobile/workbench",
    settle: (page) => expectWorkbenchUnavailable(page),
  },
  {
    domain: "knowledge",
    label: "知识",
    path: "/mobile/knowledge",
    settle: (page) => expectKnowledgeUnavailable(page),
  },
  {
    domain: "safety",
    label: "设备与安全",
    path: "/mobile/safety",
    settle: (page) => expectSafetyReady(page),
  },
];

const NAV_LABELS = MOBILE_ROUTES.map(({ label }) => label);

const SAFETY_CHANNELS = Object.freeze({
  status: {
    heading: "执行状态",
    refresh: "重新读取状态",
    retry: "重试读取状态",
    failureConfig: { effector: { statusMode: "http-error" } },
  },
  policy: {
    heading: "执行策略",
    refresh: "重新读取策略",
    retry: "重试读取策略",
    failureConfig: { policyMode: "http-error" },
  },
  audit: {
    heading: "审计证据",
    refresh: "重新读取审计",
    retry: "重试读取审计",
    failureConfig: { auditMode: "http-error" },
  },
} satisfies Readonly<
  Record<
    SafetyChannel,
    {
      readonly heading: string;
      readonly refresh: string;
      readonly retry: string;
      readonly failureConfig: Readonly<Record<string, unknown>>;
    }
  >
>);

const AXE_SCENARIOS: readonly AxeScenario[] = [
  {
    label: "Presence trusted-ready",
    path: "/mobile/presence",
    settle: (page) => expectPresenceReady(page),
  },
  {
    label: "Presence trusted Core error",
    path: "/mobile/presence",
    configure: { statusMode: "http-error" },
    settle: async (page) => {
      await expectTrustedAuthority(page);
      await expect(
        page.locator("dl[aria-label='Presence 连接事实']"),
      ).toContainText("离线");
      await expect(page.getByRole("textbox", { name: "消息输入" })).toBeVisible();
    },
  },
  {
    label: "Presence remote gate",
    path: "/mobile/presence",
    remote: true,
    settle: async (page) => {
      await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(REMOTE_APP_ORIGIN)}`));
      await expect(
        page.locator(
          "[data-mobile-presence-phase='unavailable-remote-context']",
        ),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "未连接 Core" }))
        .toBeVisible();
    },
  },
  {
    label: "Tasks default editor",
    path: "/mobile/tasks",
    settle: (page) => expectTasksReady(page),
  },
  {
    label: "Tasks storage error",
    path: "/mobile/tasks",
    storageFailure: true,
    settle: async (page) => {
      await expect(
        page.locator("[data-storage-phase='unavailable']"),
      ).toHaveText("本地存储不可用，未持久化");
      await expect(page.getByRole("textbox", { name: "本地任务草稿" }))
        .toBeVisible();
    },
  },
  {
    label: "Workbench unavailable",
    path: "/mobile/workbench",
    settle: (page) => expectWorkbenchUnavailable(page),
  },
  {
    label: "Knowledge unavailable",
    path: "/mobile/knowledge",
    settle: (page) => expectKnowledgeUnavailable(page),
  },
  {
    label: "Safety all-ready",
    path: "/mobile/safety",
    settle: (page) => expectSafetyReady(page),
  },
  {
    label: "Safety remote gate",
    path: "/mobile/safety",
    remote: true,
    settle: async (page) => {
      await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(REMOTE_APP_ORIGIN)}`));
      await expect(
        page.locator(
          "[data-mobile-safety-phase='unavailable-remote-context']",
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
          { exact: true },
        ),
      ).toBeVisible();
    },
  },
  ...(["status", "policy", "audit"] as const).map(
    (channel): AxeScenario => ({
      label: `Safety ${channel} error`,
      path: "/mobile/safety",
      configure: SAFETY_CHANNELS[channel].failureConfig,
      settle: async (page) => {
        await expectSafetyChannelPhase(page, channel, "读取失败");
        await expect(
          safetyChannel(page, channel).getByRole("button", {
            name: SAFETY_CHANNELS[channel].retry,
          }),
        ).toBeVisible();
      },
    }),
  ),
  ...(["status", "policy", "audit"] as const).map(
    (channel): AxeScenario => ({
      label: `Safety retained-stale ${channel}`,
      path: "/mobile/safety",
      settle: async (page, request) => {
        await expectSafetyReady(page);
        const section = safetyChannel(page, channel);
        await expect(section.locator("time[datetime]")).toHaveCount(1);
        await configureMockCore(
          request,
          SAFETY_CHANNELS[channel].failureConfig,
        );
        await section
          .getByRole("button", { name: SAFETY_CHANNELS[channel].refresh })
          .click();
        await expectSafetyChannelPhase(page, channel, "可能陈旧");
        await expect(section.locator("time[datetime]")).toHaveCount(1);
        await expect(
          section.getByRole("button", { name: SAFETY_CHANNELS[channel].retry }),
        ).toBeVisible();
      },
    }),
  ),
];

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test.describe("Mobile exact axe state matrix", () => {
  for (const scenario of AXE_SCENARIOS) {
    test(`${scenario.label} has zero critical or serious violations`, async ({
      page,
      request,
    }) => {
      await prepareMobilePage(page, { width: 1280, height: 900 });
      if (scenario.storageFailure) await installStorageFailure(page);
      if (scenario.configure) {
        await configureMockCore(request, scenario.configure);
      }

      const origin = scenario.remote ? REMOTE_APP_ORIGIN : BASE_URL;
      const response = await page.goto(`${origin}${scenario.path}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);
      await scenario.settle(page, request);

      await expectAriaLiveOwnership(page);
      await expectNoBlockingAxeViolations(page, scenario.label);
    });
  }
});

test.describe("Mobile responsive geometry", () => {
  for (const route of MOBILE_ROUTES) {
    test(`${route.label} has no document, shell, or main overflow at four narrow widths`, async ({
      page,
    }) => {
      await prepareMobilePage(page, { width: 320, height: 720 });

      for (const viewport of [
        { width: 320, height: 720 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 768, height: 1024 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(`${BASE_URL}${route.path}`, {
          waitUntil: "domcontentloaded",
        });
        await route.settle(page);
        await waitForFonts(page);

        await expect
          .poll(() => readHorizontalOverflow(page), {
            message: `${route.label} overflow at ${viewport.width}px`,
          })
          .toEqual({ body: 0, document: 0, main: 0, shell: 0 });
      }
    });

    test(`${route.label} preserves semantic read order, controlled width, and a full-viewport shell on desktop`, async ({
      page,
    }) => {
      await prepareMobilePage(page, { width: 1280, height: 900 });
      const geometries: DesktopGeometry[] = [];

      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 1440, height: 1000 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(`${BASE_URL}${route.path}`, {
          waitUntil: "domcontentloaded",
        });
        await route.settle(page);
        await waitForFonts(page);
        const geometry = await readDesktopGeometry(page);
        geometries.push(geometry);

        expect(geometry.directChildTags).toEqual([
          "header",
          "svg",
          "main",
          "nav",
        ]);
        expect(geometry.readOrder).toEqual({
          headerBeforeMain: true,
          mainBeforeNav: true,
        });
        expect(geometry.shell).toEqual({
          borderRadius: "0px",
          left: 0,
          right: viewport.width,
          width: viewport.width,
        });
        expect(geometry.headerWidth).toBeCloseTo(viewport.width, 0);
        expect(geometry.navWidth).toBeCloseTo(viewport.width, 0);
        expect(geometry.mainWidth).toBeLessThanOrEqual(
          geometry.rootFontSize * 76 + 0.5,
        );
        expect(geometry.mainWidth).toBeLessThan(viewport.width);
      }

      expect(geometries[1]?.directChildTags).toEqual(
        geometries[0]?.directChildTags,
      );
      expect(geometries[1]?.readOrder).toEqual(geometries[0]?.readOrder);
    });
  }
});

for (const zoom of [
  { label: "200%", viewport: { width: 640, height: 450 } },
  { label: "400%", viewport: { width: 320, height: 225 } },
] as const) {
  test(`${zoom.label} equivalent keeps every Mobile nav label and enabled control reachable`, async ({
    page,
  }) => {
    await prepareMobilePage(page, zoom.viewport);

    for (const route of MOBILE_ROUTES) {
      await page.goto(`${BASE_URL}${route.path}`, {
        waitUntil: "domcontentloaded",
      });
      await route.settle(page);

      const nav = page.getByRole("navigation", { name: "Mobile 五域" });
      for (const label of NAV_LABELS) {
        const link = nav.getByRole("link", { name: label, exact: true });
        await expect(link).toBeVisible();
        await expect.poll(() => isHorizontallyInsideViewport(link)).toBe(true);
      }

      const controls = page
        .locator("[data-route-surface='mobile']")
        .locator(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
      const controlCount = await controls.count();
      expect(controlCount, `${route.label} must expose reachable controls`).toBeGreaterThan(0);
      for (let index = 0; index < controlCount; index += 1) {
        const control = controls.nth(index);
        await control.focus();
        await control.evaluate((element) => {
          element.scrollIntoView({ block: "center", inline: "nearest" });
        });
        await expect(control).toBeFocused();
        await expect.poll(() => hasReachableViewportArea(control)).toBe(true);
      }
    }
  });
}

for (const contraction of [
  {
    label: "Tasks textarea",
    path: "/mobile/tasks" as const,
    control: (page: Page) =>
      page.getByRole("textbox", { name: "本地任务草稿" }),
    settle: (page: Page) => expectTasksReady(page),
  },
  {
    label: "Presence composer",
    path: "/mobile/presence" as const,
    control: (page: Page) => page.getByRole("textbox", { name: "消息输入" }),
    settle: (page: Page) => expectPresenceReady(page),
  },
] as const) {
  test(`${contraction.label} stays above fixed navigation in the desktop viewport-contraction proxy`, async ({
    page,
  }, testInfo) => {
    testInfo.annotations.push({
      type: "pending-real-device",
      description:
        "Real soft keyboard, Pixel 6a, and TalkBack verification remain pending.",
    });
    await prepareMobilePage(page, { width: 430, height: 932 });
    await page.goto(`${BASE_URL}${contraction.path}`, {
      waitUntil: "domcontentloaded",
    });
    await contraction.settle(page);

    const control = contraction.control(page);
    await control.focus();
    await expect(control).toBeFocused();
    await page.setViewportSize({ width: 430, height: 500 });
    await control.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });

    await expect.poll(() => focusedControlClearsFixedNav(page, control)).toEqual({
      focused: true,
      horizontallyInside: true,
      aboveFixedNav: true,
    });
  });
}

async function prepareMobilePage(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("astr.visual-motion", "paused");
  });
}

async function installStorageFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value: () => {
        throw new DOMException("deterministic storage denial", "SecurityError");
      },
    });
  });
}

async function expectTrustedAuthority(page: Page): Promise<void> {
  await expect(page.getByText("本机可信入口", { exact: true })).toBeVisible();
}

async function expectPresenceReady(page: Page): Promise<void> {
  await expectTrustedAuthority(page);
  const facts = page.locator("dl[aria-label='Presence 连接事实']");
  await expect(facts.getByText("可达", { exact: true })).toBeVisible();
  await expect(facts.getByText("已连接", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "消息输入" })).toBeVisible();
}

async function expectTasksReady(page: Page): Promise<void> {
  await expect(
    page.locator("[data-storage-phase='ready']"),
  ).toHaveText("本地存储可用");
  await expect(page.getByRole("textbox", { name: "本地任务草稿" }))
    .toBeVisible();
}

async function expectWorkbenchUnavailable(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "AI 工作台" }),
  ).toBeVisible();
  await expect(page.getByText("Studio 投影未启用", { exact: true })).toBeVisible();
}

async function expectKnowledgeUnavailable(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "知识" }),
  ).toBeVisible();
  await expect(
    page.getByText("安全只读知识投影未启用。", { exact: true }),
  ).toBeVisible();
}

async function expectSafetyReady(page: Page): Promise<void> {
  await expectTrustedAuthority(page);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "当前 Web 主机 · 本机可信入口",
    }),
  ).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);
}

function safetyChannel(page: Page, channel: SafetyChannel): Locator {
  return page
    .getByRole("heading", {
      level: 3,
      name: SAFETY_CHANNELS[channel].heading,
    })
    .locator("xpath=ancestor::section[1]");
}

async function expectSafetyChannelPhase(
  page: Page,
  channel: SafetyChannel,
  phase: "读取失败" | "可能陈旧",
): Promise<void> {
  await expectTrustedAuthority(page);
  await expect(
    safetyChannel(page, channel).getByText(phase, { exact: true }),
  ).toBeVisible();
}

async function expectAriaLiveOwnership(page: Page): Promise<void> {
  const appAnnouncer = page.locator(".sr-only[aria-live]");
  const nextAnnouncer = page.locator("#__next-route-announcer__");

  await expect(appAnnouncer).toHaveCount(1);
  await expect(appAnnouncer).toHaveAttribute("role", "status");
  await expect(appAnnouncer).toHaveAttribute("aria-live", "polite");
  await expect(
    page.locator("[data-route-surface='mobile'] [aria-live]"),
  ).toHaveCount(0);
  await expect(nextAnnouncer).toHaveCount(1);
  await expect(nextAnnouncer).not.toHaveAttribute("aria-live");
  await expect(nextAnnouncer).not.toHaveAttribute("role");
  await expect(nextAnnouncer).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("[aria-live]")).toHaveCount(1);
}

async function expectNoBlockingAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  const blocking = scan.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        target: node.target,
      })),
    }));

  expect(
    blocking,
    `axe critical/serious violations for ${label}: ${JSON.stringify(
      blocking,
      null,
      2,
    )}`,
  ).toEqual([]);
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function readHorizontalOverflow(page: Page): Promise<{
  readonly body: number;
  readonly document: number;
  readonly main: number;
  readonly shell: number;
}> {
  return page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    const shell = document.querySelector("[data-route-surface='mobile']");
    const excess = (element: Element | null): number =>
      element instanceof HTMLElement
        ? Math.max(0, element.scrollWidth - element.clientWidth)
        : Number.POSITIVE_INFINITY;
    return {
      body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
      document: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      main: excess(main),
      shell: excess(shell),
    };
  });
}

interface DesktopGeometry {
  readonly directChildTags: readonly string[];
  readonly headerWidth: number;
  readonly mainWidth: number;
  readonly navWidth: number;
  readonly readOrder: {
    readonly headerBeforeMain: boolean;
    readonly mainBeforeNav: boolean;
  };
  readonly rootFontSize: number;
  readonly shell: {
    readonly borderRadius: string;
    readonly left: number;
    readonly right: number;
    readonly width: number;
  };
}

async function readDesktopGeometry(page: Page): Promise<DesktopGeometry> {
  return page.evaluate(() => {
    const shell = document.querySelector("[data-route-surface='mobile']");
    const header = shell?.querySelector(":scope > header");
    const main = shell?.querySelector(":scope > main#main-content");
    const nav = shell?.querySelector(
      ":scope > nav[aria-label='Mobile 五域']",
    );
    if (
      !(shell instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(main instanceof HTMLElement) ||
      !(nav instanceof HTMLElement)
    ) {
      throw new Error("Mobile semantic shell geometry is incomplete");
    }

    const shellBounds = shell.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const mainBounds = main.getBoundingClientRect();
    const navBounds = nav.getBoundingClientRect();
    const follows = (left: Node, right: Node): boolean =>
      Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);

    return {
      directChildTags: Array.from(shell.children, (child) =>
        child.tagName.toLowerCase(),
      ),
      headerWidth: headerBounds.width,
      mainWidth: mainBounds.width,
      navWidth: navBounds.width,
      readOrder: {
        headerBeforeMain: follows(header, main),
        mainBeforeNav: follows(main, nav),
      },
      rootFontSize: Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      ),
      shell: {
        borderRadius: getComputedStyle(shell).borderRadius,
        left: shellBounds.left,
        right: shellBounds.right,
        width: shellBounds.width,
      },
    };
  });
}

async function isHorizontallyInsideViewport(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
  });
}

async function hasReachableViewportArea(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const nav = document.querySelector(
      "[data-route-surface='mobile'] > nav[aria-label='Mobile 五域']",
    );
    if (!(nav instanceof HTMLElement)) return false;
    const navBounds = nav.getBoundingClientRect();
    const insideNav = nav.contains(element);
    const visibleTop = Math.max(0, bounds.top);
    const visibleBottom = Math.min(
      insideNav ? window.innerHeight : navBounds.top,
      bounds.bottom,
    );
    const requiredVisibleHeight = Math.min(44, bounds.height);
    return (
      document.activeElement === element &&
      bounds.left >= -0.5 &&
      bounds.right <= window.innerWidth + 0.5 &&
      visibleBottom - visibleTop >= requiredVisibleHeight - 0.5
    );
  });
}

async function focusedControlClearsFixedNav(
  page: Page,
  control: Locator,
): Promise<{
  readonly aboveFixedNav: boolean;
  readonly focused: boolean;
  readonly horizontallyInside: boolean;
}> {
  const nav = page.getByRole("navigation", { name: "Mobile 五域" });
  const [controlBounds, navBounds, focused, navPosition] = await Promise.all([
    control.boundingBox(),
    nav.boundingBox(),
    control.evaluate((element) => document.activeElement === element),
    nav.evaluate((element) => getComputedStyle(element).position),
  ]);
  if (controlBounds === null || navBounds === null) {
    return {
      aboveFixedNav: false,
      focused,
      horizontallyInside: false,
    };
  }
  const viewport = page.viewportSize();
  return {
    aboveFixedNav:
      navPosition === "fixed" &&
      controlBounds.y + controlBounds.height <= navBounds.y + 0.5,
    focused,
    horizontallyInside:
      viewport !== null &&
      controlBounds.x >= -0.5 &&
      controlBounds.x + controlBounds.width <= viewport.width + 0.5,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
