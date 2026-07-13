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
} from "./support/mock-core-client";

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);
  pageErrors.set(page, collectPageErrors(page));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

for (const baseline of [
  { label: "Control index", path: "/admin", ready: false },
  { label: "planned dossier", path: "/admin/dashboard", ready: false },
  { label: "Effector ready", path: "/admin/effector", ready: true },
] as const) {
  test(`${baseline.label} has zero critical or serious axe violations`, async ({ page }) => {
    await prepareControlPage(page, { width: 1440, height: 1000 });
    const response = await page.goto(baseline.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    if (baseline.ready) await expectReadyEffector(page);
    else await expect(page.locator("main#main-content h1")).toBeVisible();
    await expectNoBlockingAxeViolations(page, baseline.label);
  });
}

test("Effector offline has zero critical or serious axe violations", async ({ page }) => {
  await routeOfflineEffector(page);
  await prepareControlPage(page, { width: 1440, height: 1000 });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("策略加载失败，请重试。")).toBeVisible();
  await expect(page.getByText("审计记录加载失败，请重试。")).toBeVisible();
  await expect(page.getByText("安全状态读取失败，请重试。")).toBeVisible();
  await expect(page.locator("[data-safety='unknown']")).toBeVisible();
  await expectNoBlockingAxeViolations(page, "Effector offline");
  acknowledgeExpectedHttpFailures(page, 3);
});

test("Effector latched has zero critical or serious axe violations", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { effector: { stopped: true } });
  await prepareControlPage(page, { width: 1440, height: 1000 });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });

  await expect(page.locator("[data-safety='latched']")).toBeVisible();
  await expect(page.getByRole("button", { name: /请求复位/ })).toBeEnabled();
  await expectNoBlockingAxeViolations(page, "Effector latched");
});

test("Effector unknown has zero critical or serious axe violations", async ({
  page,
  request,
}) => {
  await prepareControlPage(page, { width: 1440, height: 1000 });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  await expectReadyEffector(page);
  await configureMockCore(request, {
    effector: { estopAck: true, estopReadback: false },
  });

  await page.getByRole("button", { name: "触发急停" }).click();
  await expect(page.locator("[data-safety='unknown']")).toBeVisible();
  await expect(page.getByRole("alert").filter({
    hasText: "权威回读与操作目标不一致。",
  }))
    .toContainText("权威回读与操作目标不一致。");
  await expectNoBlockingAxeViolations(page, "Effector unknown");
});

test("keyboard users traverse local skips and operate both policy radiogroups", async ({
  page,
}) => {
  await prepareControlPage(page, { width: 1440, height: 1000 });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  await expectReadyEffector(page);

  const globalSkip = page.getByRole("link", { name: "跳到主要内容" });
  const atlasSkip = page.getByRole("link", { name: "跳到模块索引" });
  await page.keyboard.press("Tab");
  await expect(globalSkip).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(atlasSkip).toBeFocused();
  await page.keyboard.press("Enter");
  const atlasSummary = page.locator("summary#module-index");
  await expect(atlasSummary).toBeFocused();
  await expect(atlasSummary.locator("xpath=..")).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(atlasSummary).toBeFocused();

  const policySkip = page.getByRole("link", { name: "跳到策略表单" });
  await policySkip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("form", { name: "执行策略编辑" })).toBeFocused();

  const auditSkip = page.getByRole("link", { name: "跳到审计丁册" });
  await auditSkip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "审计丁册" })).toBeFocused();

  const approval = page.getByRole("radiogroup", { name: "审批模式" });
  const ask = approval.getByRole("radio", { name: /请求/ });
  await ask.focus();
  await page.keyboard.press("ArrowRight");
  const audited = approval.getByRole("radio", { name: /自审核/ });
  await expect(audited).toBeFocused();
  await expect(audited).toHaveAttribute("aria-checked", "true");

  const scope = page.getByRole("radiogroup", { name: "无头执行范围" });
  const cwd = scope.getByRole("radio", { name: "当前目录" });
  await cwd.focus();
  await page.keyboard.press("ArrowRight");
  const folders = scope.getByRole("radio", { name: "白名单目录" });
  await expect(folders).toBeFocused();
  await expect(folders).toHaveAttribute("aria-checked", "true");
});

for (const zoom of [
  { label: "200%", viewport: { width: 640, height: 450 } },
  { label: "400%", viewport: { width: 320, height: 225 } },
] as const) {
  test(`${zoom.label} zoom-equivalent viewport reflows without overflow and keeps controls reachable`, async ({
    page,
  }) => {
    await prepareControlPage(page, zoom.viewport);
    await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
    await expectReadyEffector(page);
    await expectNoHorizontalOverflow(page);

    const controls = [
      page.getByRole("button", { name: "切换昼夜主题" }),
      page.getByRole("button", { name: /视觉动效/ }),
      page.getByRole("button", { name: "触发急停" }),
      page.getByRole("radio", { name: /请求/ }),
      page.getByRole("combobox", { name: "审计日期" }),
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

async function prepareControlPage(
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

async function expectReadyEffector(page: Page): Promise<void> {
  await expect(page.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
  await expect(page.getByRole("region", { name: "审计丁册" })).toBeVisible();
  await expect(page.locator("[data-safety='clear']")).toBeVisible();
}

async function routeOfflineEffector(page: Page): Promise<void> {
  for (const endpoint of [
    "**/v1/admin/effector/policy",
    "**/v1/admin/effector/audit*",
    "**/v1/effector/status",
  ]) {
    await page.route(endpoint, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:3100" },
        body: JSON.stringify({ detail: "deterministic offline evidence" }),
      });
    });
  }
}

async function expectNoBlockingAxeViolations(page: Page, label: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  const blocking = scan.violations
    .filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
  expect(
    blocking,
    `axe critical/serious violations for ${label}: ${JSON.stringify(blocking, null, 2)}`,
  ).toEqual([]);
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    const hydration = /hydration|did not match|server rendered text/i.test(message.text());
    if (message.type() === "error" || hydration) {
      errors.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

function acknowledgeExpectedHttpFailures(page: Page, count: number): void {
  const errors = pageErrors.get(page) ?? [];
  expect(errors).toHaveLength(count);
  for (const error of errors) {
    expect(error).toMatch(
      /^console error: Failed to load resource: the server responded with a status of 503/,
    );
  }
  pageErrors.set(page, []);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    return {
      body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
      document: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      main: main instanceof HTMLElement
        ? Math.max(0, main.scrollWidth - main.clientWidth)
        : Number.POSITIVE_INFINITY,
    };
  })).toEqual({ body: 0, document: 0, main: 0 });
}

async function isInsideHorizontalViewport(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
  });
}
