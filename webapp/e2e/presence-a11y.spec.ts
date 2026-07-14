import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  configureMockCore,
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

type Theme = "dark" | "light";

interface AccessibilityBaseline {
  readonly label: string;
  readonly visualStatus: "offscreen" | "reduced";
  readonly theme: Theme;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
}

const ACCESSIBILITY_BASELINES: readonly AccessibilityBaseline[] = [
  {
    label: "desktop dark",
    visualStatus: "reduced",
    theme: "dark",
    viewport: { width: 1440, height: 1000 },
  },
  {
    label: "desktop light",
    visualStatus: "reduced",
    theme: "light",
    viewport: { width: 1440, height: 1000 },
  },
  {
    label: "mobile dark",
    visualStatus: "offscreen",
    theme: "dark",
    viewport: { width: 390, height: 844 },
  },
  {
    label: "mobile light",
    visualStatus: "offscreen",
    theme: "light",
    viewport: { width: 390, height: 844 },
  },
];

const DESKTOP_DARK_BASELINE = ACCESSIBILITY_BASELINES[0];

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

for (const baseline of ACCESSIBILITY_BASELINES) {
  test(`${baseline.label} keeps a reduced-motion static baseline free of serious accessibility violations`, async ({
    page,
  }) => {
    await loadAccessibilityBaseline(page, baseline);
    await expectPresenceSemantics(page);
    await expect(page.getByRole("group", { name: "Core 状态" }))
      .toContainText("Core 可达");

    await expectNoBlockingAxeViolations(page, `${baseline.label} ready`);
  });
}

test("startup cold contract and connecting state have no serious accessibility violations", async ({
  page,
}) => {
  const releaseRequests = createReleaseGate();
  await page.route("**/v1/status", async (route) => {
    await releaseRequests.promise;
    await route.continue();
  });
  await page.route("**/v1/stream", async (route) => {
    await releaseRequests.promise;
    await route.continue();
  });

  try {
    await prepareAccessibilityPage(page, DESKTOP_DARK_BASELINE);
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    const initialHtml = await response?.text();
    expect(initialHtml).toContain("尚未启动");
    expect(initialHtml).toContain("回复流未连接");
    expect(initialHtml).toContain("生活流未连接");

    await expect(page.getByRole("group", { name: "Core 状态" }))
      .toContainText("读取中");
    await expect(page.getByRole("group", { name: "回复流状态" }))
      .toContainText("回复流连接中");
    await expect(page.getByRole("group", { name: "生活流状态" }))
      .toContainText("生活流连接中");
    await expect(page.locator("main#main-content")).toHaveAttribute(
      "data-sse-state",
      "reply:connecting|life:connecting",
    );

    await expectNoBlockingAxeViolations(page, "startup cold/connecting");
  } finally {
    releaseRequests.release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("offline status failure has no serious accessibility violations", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { statusMode: "http-error" });
  await loadAccessibilityBaseline(page, DESKTOP_DARK_BASELINE);

  await expect(page.getByRole("group", { name: "Core 状态" }))
    .toContainText("Core 不可达");
  await expect(page.getByText("Core 不可达；草稿仅保存在当前页面"))
    .toBeVisible();
  await expectNoBlockingAxeViolations(page, "offline status failure");
});

test("streaming and authoritative final states have no serious accessibility violations", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "slow-stream" });
  await loadAccessibilityBaseline(page, DESKTOP_DARK_BASELINE);

  const composer = page.getByRole("textbox", { name: "消息输入" });
  await composer.fill("请持续展示无障碍状态");
  await page.getByRole("button", { name: "发送消息" }).click();

  const reply = page
    .getByRole("list", { name: "对话消息" })
    .locator("[data-message-id^='reply:']");
  await expect(reply).toHaveAttribute("data-message-phase", "provisional");
  await expect(reply).toContainText("流1");
  await expectNoBlockingAxeViolations(page, "streaming reply");

  await expect(reply).toHaveAttribute("data-message-phase", "settled", {
    timeout: 15_000,
  });
  await expect(reply).toContainText("十秒流式终稿");
  await expect(page.getByText("回答完成；权威终稿已到达"))
    .toBeVisible();
  await expectNoBlockingAxeViolations(page, "authoritative final reply");
});

test("ingest error has no serious accessibility violations", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    scenario: "ack-failure-external-decision",
  });
  await loadAccessibilityBaseline(page, DESKTOP_DARK_BASELINE);

  await page.getByRole("textbox", { name: "消息输入" }).fill("保留失败草稿");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(
    page.getByRole("region", { name: "对话输入" })
      .getByText("发送失败：ingest returned HTTP 503"),
  )
    .toBeVisible();
  await expectNoBlockingAxeViolations(page, "ingest error");
});

test("runtime WebGL context-loss event exposes the real accessible static fallback", async ({
  page,
}) => {
  const releaseAssets = createReleaseGate();
  const assetRequestStarted = createReleaseGate();
  await page.route("**/live2d/**", async (route) => {
    assetRequestStarted.release();
    await releaseAssets.promise;
    await route.abort();
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "dark");
      window.localStorage.removeItem("astr.visual-motion");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForOpenStreams(page);

    const host = page.locator("[data-presence-visual-host]");
    const canvas = host.locator("[data-presence-visual-surface] canvas");
    await expect(canvas).toHaveCount(1);
    await assetRequestStarted.promise;
    await canvas.evaluate((element) =>
      element.dispatchEvent(
        new Event("webglcontextlost", { bubbles: false, cancelable: true }),
      ),
    );

    await expect(host).toHaveAttribute("data-visual-status", "contextLost");
    await expect(host.locator("[data-presence-visual-copy]"))
      .toContainText("动态视觉连接已中断，当前显示静态代表帧");
    await expect(page.locator("[data-static-soul-lens]"))
      .toHaveAttribute("data-soul-lens-fallback", "static");
    await expectNoBlockingAxeViolations(page, "WebGL context-lost fallback");

    releaseAssets.release();
    await expect(host).toHaveAttribute("data-visual-status", "retryRequired");
    await expect(page.getByRole("button", { name: "重试视觉" })).toBeVisible();
    await expect(host.locator("[data-presence-visual-copy]"))
      .toContainText("动态视觉恢复失败，当前显示静态代表帧");
    await expectNoBlockingAxeViolations(page, "visual initialization error fallback");
  } finally {
    releaseAssets.release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

for (const safetyState of [
  {
    label: "latched",
    effector: { stopped: true },
    copy: "急停已闩锁",
    resetVisible: true,
  },
  {
    label: "unknown",
    effector: { statusMode: "http-error" },
    copy: "安全操作结果未知，执行层状态可能不一致",
    resetVisible: false,
  },
] as const) {
  test(`safety ${safetyState.label} state has no serious accessibility violations`, async ({
    page,
    request,
  }) => {
    await configureMockCore(request, { effector: safetyState.effector });
    await loadAccessibilityBaseline(page, DESKTOP_DARK_BASELINE);

    await expect(page.getByRole("group", { name: "执行安全状态" }))
      .toContainText(safetyState.copy);
    await expect(page.getByRole("button", { name: "复位急停" }))
      .toHaveCount(safetyState.resetVisible ? 1 : 0);
    await expectNoBlockingAxeViolations(page, `safety ${safetyState.label}`);
  });
}

for (const zoom of [
  { label: "200%", viewport: { width: 640, height: 450 } },
  { label: "400%", viewport: { width: 320, height: 225 } },
] as const) {
  test(`${zoom.label} zoom-equivalent viewport reflows without horizontal overflow and keeps primary controls reachable`, async ({
    page,
  }) => {
    await loadReducedPresenceAt(page, zoom.viewport);

    await expect.poll(() => readHorizontalOverflow(page)).toEqual({
      body: 0,
      document: 0,
      main: 0,
    });

    const composer = page.getByRole("textbox", { name: "消息输入" });
    await composer.fill("缩放后仍可操作");
    const controls = [
      page.getByRole("button", { name: "切换昼夜主题" }),
      page.getByRole("button", { name: /视觉动效/ }),
      page.getByRole("button", { name: "打开设置" }),
      page.getByRole("button", { name: "切换深聊布局" }),
      page.getByRole("button", { name: "前往 Life" }),
      composer,
      page.getByRole("button", { name: "发送消息" }),
    ];

    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      await expect.poll(() => isInsideHorizontalViewport(control)).toBe(true);
      await control.focus();
      await expect(control).toBeFocused();
    }
  });
}

test("settings dialog traps focus and returns it after Escape and explicit close", async ({
  page,
}) => {
  await loadAccessibilityBaseline(page, DESKTOP_DARK_BASELINE);

  const trigger = page.getByRole("button", { name: "打开设置" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "星枢设置" });
  const close = dialog.getByRole("button", { name: "关闭设置" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(close).toBeFocused();

  const focusable = dialog.locator(
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  );
  const last = focusable.last();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const reopenedClose = page
    .getByRole("dialog", { name: "星枢设置" })
    .getByRole("button", { name: "关闭设置" });
  await expect(reopenedClose).toBeFocused();
  await reopenedClose.click();
  await expect(page.getByRole("dialog", { name: "星枢设置" }))
    .toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("keyboard users can skip, compose, switch theme, deepen dialogue, and explicitly enter and leave Life", async ({
  page,
}) => {
  await loadAccessibilityBaseline(page, ACCESSIBILITY_BASELINES[0]);

  const main = page.locator("main#main-content");
  const mainSkip = page.getByRole("link", { name: "跳到主要内容" });
  const composerSkip = page.getByRole("link", { name: "跳到消息输入" });
  const theme = page.getByRole("button", { name: "切换昼夜主题" });
  const visualMotion = page.getByRole("button", { name: /视觉动效/ });
  const settings = page.getByRole("button", { name: "打开设置" });
  const studio = page.getByRole("link", { name: "Studio" });
  const controlCenter = page.getByRole("link", { name: "Control" });
  const mobilePresence = page.getByRole("link", { name: "Mobile" });
  const systemDetails = page.locator("summary").filter({ hasText: "系统细节" });
  const estop = page.getByRole("button", { name: "触发急停" });
  const soulIntent = page.getByRole("button", { name: "前往 Soul" });
  const dialogueIntent = page.getByRole("button", { name: "前往对话" });
  const deepLayout = page.getByRole("button", { name: "切换深聊布局" });
  const lifeIntent = page.getByRole("button", { name: "前往 Life" });
  const lifeIsland = page.getByRole("region", { name: "生活密度岛" });

  await page.keyboard.press("Tab");
  await expect(mainSkip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(theme).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  for (const nextControl of [
    visualMotion,
    settings,
    studio,
    controlCenter,
    mobilePresence,
    systemDetails,
    estop,
    soulIntent,
    dialogueIntent,
    lifeIntent,
    deepLayout,
  ]) {
    await page.keyboard.press("Tab");
    await expect(nextControl).toBeFocused();
  }

  await page.keyboard.press("Space");
  await expect(deepLayout).toHaveAttribute("aria-pressed", "true");
  await expect(main).toHaveAttribute("data-presence-layout", "deep");

  await expect(lifeIsland).toHaveAttribute("data-expanded", "false");
  await page.keyboard.press("Shift+Tab");
  await expect(lifeIntent).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main).toHaveAttribute("data-orbit-state", "life");
  await expect(lifeIsland).toHaveAttribute("data-expanded", "true");
  await expect(lifeIsland).toBeFocused();

  const closeLife = page.getByRole("button", { name: "收起生活记录" });
  await page.keyboard.press("Tab");
  await expect(closeLife).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lifeIsland).toHaveAttribute("data-expanded", "false");
  await expect(main).toHaveAttribute("data-orbit-state", "dialogue");
  await expect(lifeIntent).toBeFocused();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
  await page.keyboard.press("Tab");
  await expect(mainSkip).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(composerSkip).toBeFocused();
  await page.keyboard.press("Enter");

  const composer = page.getByRole("textbox", { name: "消息输入" });
  await expect(composer).toBeFocused();
  await page.keyboard.type("键盘路径保持连贯");
  await expect(composer).toHaveValue("键盘路径保持连贯");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
});

async function loadAccessibilityBaseline(
  page: Page,
  baseline: AccessibilityBaseline,
): Promise<void> {
  await prepareAccessibilityPage(page, baseline);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    baseline.theme,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "reduced",
  );
  await expect(page.locator("[data-static-soul-lens]"))
    .toHaveAttribute("data-soul-lens-fallback", "static");
  await expect(page.locator("[data-presence-visual-host]"))
    .toHaveAttribute("data-visual-status", baseline.visualStatus);
}

async function prepareAccessibilityPage(
  page: Page,
  baseline: AccessibilityBaseline,
): Promise<void> {
  await page.setViewportSize(baseline.viewport);
  await page.emulateMedia({
    colorScheme: baseline.theme,
    reducedMotion: "reduce",
  });
  await page.addInitScript(({ theme }: { readonly theme: Theme }) => {
    window.localStorage.setItem("theme", theme);
    window.localStorage.removeItem("astr.visual-motion");
  }, { theme: baseline.theme });
}

async function loadReducedPresenceAt(
  page: Page,
  viewport: AccessibilityBaseline["viewport"],
): Promise<void> {
  await prepareAccessibilityPage(page, {
    label: "zoom reflow",
    theme: "dark",
    viewport,
    visualStatus: viewport.width <= 390 ? "offscreen" : "reduced",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
}

async function expectNoBlockingAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  const blockingViolations = scan.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
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
    blockingViolations,
    `axe serious/critical violations for ${label}: ${JSON.stringify(
      blockingViolations,
      null,
      2,
    )}`,
  ).toEqual([]);
}

function createReleaseGate(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

async function readHorizontalOverflow(page: Page): Promise<{
  readonly body: number;
  readonly document: number;
  readonly main: number;
}> {
  return page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    return {
      body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
      document: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      main:
        main instanceof HTMLElement
          ? Math.max(0, main.scrollWidth - main.clientWidth)
          : Number.POSITIVE_INFINITY,
    };
  });
}

async function isInsideHorizontalViewport(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
  });
}

async function expectPresenceSemantics(page: Page): Promise<void> {
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "全局控制" })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Presence 引力轨道" }))
    .toHaveCount(1);

  await expect(page.getByRole("heading", { level: 1, name: "星枢 ASTR" }))
    .toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "对话" }))
    .toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Soul" }))
    .toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "生活记录" }))
    .toHaveCount(1);

  await expect(page.getByRole("region", { name: "Presence 对话场" }))
    .toHaveCount(1);
  await expect(page.getByRole("region", { name: "对话记录" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "生活密度岛" })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息输入" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "发送消息" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "切换昼夜主题" }))
    .toHaveCount(1);
  await expect(page.getByRole("button", { name: "切换深聊布局" }))
    .toHaveCount(1);
  await expect(page.getByRole("button", { name: "前往 Life" })).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Task 能力" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect(
    page.locator("[aria-live]:not(#__next-route-announcer__)"),
  ).toHaveCount(1);
  await expect(page.locator("#__next-route-announcer__[aria-live]")).toHaveCount(1);
  await expect(page.locator(".astr-motion-toggle")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "跳到消息输入" }))
    .toHaveAttribute("href", "#presence-message-input");
  await expect(page.locator("#presence-message-input")).toHaveCount(1);
}
