import {
  expect,
  test,
  type Page,
  type Request,
} from "@playwright/test";

import {
  configureMockCore,
  readMockCoreState,
  resetMockCore,
} from "./support/mock-core-client";

const MODULE_IDS = [
  "dashboard",
  "platform-gateway",
  "model-router",
  "plugins-skills-mcp",
  "sessions-people",
  "schedule",
  "logs-trace",
  "settings",
  "resources-knowledge",
  "setup",
  "soul",
  "memory",
  "emotion",
  "moa-teaching",
  "training",
  "voice",
  "effector",
  "migration",
] as const;

const MODULE_HREFS = MODULE_IDS.map((id) => `/admin/${id}`);
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);
  pageErrors.set(page, collectPageErrors(page));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

test("renders the exact truthful 18-module Control index", async ({ page }) => {
  const response = await page.goto("/admin", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const moduleLinks = page.locator("main#main-content a[href^='/admin/']");
  await expect(moduleLinks).toHaveCount(18);
  expect(await moduleLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  )).toEqual(MODULE_HREFS);
  await expect(moduleLinks.filter({ has: page.getByText("可用", { exact: true }) }))
    .toHaveCount(1);
  await expect(moduleLinks.filter({ has: page.getByText("规划中", { exact: true }) }))
    .toHaveCount(17);
  await expect(page.getByRole("heading", { level: 1, name: "主权档案索引" }))
    .toBeVisible();
});

test("serves all 18 registered routes and exposes policy controls only for Effector", async ({
  page,
}) => {
  for (const id of MODULE_IDS) {
    const response = await page.goto(`/admin/${id}`, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `/admin/${id} status`).toBe(200);
    await expect(page.locator("main#main-content h1")).toHaveCount(1);

    const policyForm = page.getByRole("form", { name: "执行策略编辑" });
    if (id === "effector") {
      await expect(policyForm).toBeVisible();
      await expect(policyForm.getByRole("radiogroup")).toHaveCount(2);
      await expect(page.getByRole("button", { name: "触发急停" })).toBeEnabled();
    } else {
      await expect(policyForm).toHaveCount(0);
      await expect(page.locator("main#main-content button")).toHaveCount(0);
      await expect(page.getByText("状态：规划中 · 无可执行操作")).toBeVisible();
    }
  }
});

test("opens and closes the native atlas without losing keyboard focus", async ({ page }) => {
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  const summary = page.locator("summary#module-index");
  const disclosure = summary.locator("xpath=..");

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  await expect(disclosure.locator("a[href^='/admin/']")).toHaveCount(18);

  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("switches only Control material while preserving module geometry and status", async ({
  page,
}) => {
  await prepareTheme(page, "dark", { width: 1440, height: 1000 });
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const links = page.locator("main#main-content a[href^='/admin/']");
  await expect(links).toHaveCount(18);
  const before = await readModuleGeometryAndStatus(links);

  await page.getByRole("button", { name: "切换昼夜主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await readModuleGeometryAndStatus(links)).toEqual(before);
});

for (const viewport of [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "mobile", width: 390, height: 844 },
] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`matches the approved ${viewport.label} ${theme} Control baseline`, async ({ page }) => {
      await prepareTheme(page, theme, viewport);
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("main#main-content a[href^='/admin/']")).toHaveCount(18);
      await expectNoHorizontalOverflow(page);
      await expect(page).toHaveScreenshot(
        `control-${viewport.width}x${viewport.height}-${theme}.png`,
        {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          scale: "css",
        },
      );
    });
  }
}

test("has no horizontal overflow at 1440, 980, 390, or 320 CSS pixels", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 980, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
    const controlHeader = page
      .getByRole("navigation", { name: "模块面包屑" })
      .locator("xpath=ancestor::header[1]");
    const headerMetrics = await controlHeader.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(headerMetrics.scrollHeight).toBeLessThanOrEqual(headerMetrics.clientHeight + 1);
    await expectNoHorizontalOverflow(page);
  }
});

test("sends one policy key and publishes the returned full effective policy", async ({
  page,
  request,
}) => {
  await loadReadyEffector(page);
  const updateRequest = page.waitForRequest(isPolicyPut);
  const updateResponse = page.waitForResponse((response) => isPolicyPut(response.request()));

  await page.getByRole("radio", { name: /自审核/ }).click();
  const sent = await updateRequest;
  const received = await updateResponse;

  expect(sent.postDataJSON()).toEqual({ approval_mode: "audited" });
  expect(await received.json()).toMatchObject({
    approval_mode: "audited",
    headless_scope: "cwd",
    max_steps_per_task: 25,
    sandbox_dir: "D:/ASTR/effector/sandbox",
    overlay_path: "D:/ASTR/data/effector/guard_policy.local.yaml",
  });
  await expect(page.getByRole("radio", { name: /自审核/ }))
    .toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("spinbutton", { name: "单任务最大步骤" }))
    .toHaveValue("25");
  const observed = await readMockCoreState(request);
  expect((observed.counts as Record<string, number>)["effector-policy-update"]).toBe(1);
});

test("commits a multi-digit max-step draft only once after editing finishes", async ({
  page,
}) => {
  await loadReadyEffector(page);
  const updates: Request[] = [];
  page.on("request", (request) => {
    if (isPolicyPut(request)) updates.push(request);
  });
  const input = page.getByRole("spinbutton", { name: "单任务最大步骤" });

  await input.clear();
  await input.pressSequentially("30");
  expect(updates).toHaveLength(0);

  const response = page.waitForResponse((value) => isPolicyPut(value.request()));
  await page.keyboard.press("Tab");
  await response;
  expect(updates).toHaveLength(1);
  expect(updates[0].postDataJSON()).toEqual({ max_steps_per_task: 30 });
  await expect(input).toHaveValue("30");
});

test("restores the authoritative cwd after a failed save", async ({ page }) => {
  await loadReadyEffector(page);
  await page.route("**/v1/admin/effector/policy", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:3100" },
      body: JSON.stringify({ detail: "deterministic cwd failure" }),
    });
  });
  const cwd = page.getByRole("textbox", { name: "当前工作目录" });

  await cwd.fill("D:/unverified-draft");
  await page.keyboard.press("Tab");
  await expect(mutationAlert(page, "策略保存失败，请重试。"))
    .toContainText("策略保存失败，请重试。");
  await expect(cwd).toHaveValue("D:/ASTR_System");
  acknowledgeExpectedHttpFailures(page, 1);
});

test("retains verified policy and exposes an error when a policy save fails", async ({ page }) => {
  await loadReadyEffector(page);
  await page.route("**/v1/admin/effector/policy", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:3100" },
      body: JSON.stringify({ detail: "deterministic policy failure" }),
    });
  });

  await page.getByRole("radio", { name: /全自动/ }).click();
  await expect(mutationAlert(page, "策略保存失败，请重试。"))
    .toContainText("策略保存失败，请重试。");
  await expect(page.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /请求/ }))
    .toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /全自动/ }))
    .toHaveAttribute("aria-checked", "false");
  acknowledgeExpectedHttpFailures(page, 1);
});

test("orders stop and reset POSTs before authoritative status GET readbacks", async ({
  page,
  request,
}) => {
  await loadReadyEffector(page);
  const operations: string[] = [];
  page.on("request", (value) => recordSafetyOperation(value, operations));

  await page.getByRole("button", { name: "触发急停" }).click();
  await expect(page.locator("[data-safety='latched']")).toBeVisible();
  await page.getByRole("button", { name: /请求复位/ }).click();
  await expect(page.locator("[data-safety='clear']")).toBeVisible();

  expect(operations).toEqual([
    "POST /v1/effector/estop",
    "GET /v1/effector/status",
    "POST /v1/effector/estop/reset",
    "GET /v1/effector/status",
  ]);
  const observed = await readMockCoreState(request);
  expect(observed.counts).toMatchObject({ estop: 1, reset: 1, "effector-status": 3 });
});

test("keeps e-stop operable while the initial status readback is pending", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { effector: { statusDelayMs: 1_000 } });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: "触发急停 · 状态检查中" });
  await expect(button).toBeEnabled();

  const stopRequest = page.waitForRequest((value) =>
    value.method() === "POST" && corePath(value) === "/v1/effector/estop");
  await button.click();
  await stopRequest;
  await expect(page.locator("[data-safety='latched']")).toBeVisible();
});

test("treats a contrary stop readback as unknown", async ({ page, request }) => {
  await loadReadyEffector(page);
  await configureMockCore(request, {
    effector: { estopAck: true, estopReadback: false },
  });
  const operations: string[] = [];
  page.on("request", (value) => recordSafetyOperation(value, operations));

  await page.getByRole("button", { name: "触发急停" }).click();
  await expect(page.locator("[data-safety='unknown']")).toBeVisible();
  await expect(mutationAlert(page, "权威回读与操作目标不一致。"))
    .toContainText("权威回读与操作目标不一致。");
  expect(operations).toEqual([
    "POST /v1/effector/estop",
    "GET /v1/effector/status",
  ]);
});

test("treats a failed stop readback as unknown", async ({ page, request }) => {
  await loadReadyEffector(page);
  await configureMockCore(request, { effector: { statusMode: "http-error" } });
  const operations: string[] = [];
  page.on("request", (value) => recordSafetyOperation(value, operations));

  await page.getByRole("button", { name: "触发急停" }).click();
  await expect(page.locator("[data-safety='unknown']")).toBeVisible();
  await expect(mutationAlert(page, "安全操作未获权威确认，请重试。"))
    .toContainText("安全操作未获权威确认，请重试。");
  await expect(page.getByText("安全状态读取失败，请重试。")).toBeVisible();
  expect(operations).toEqual([
    "POST /v1/effector/estop",
    "GET /v1/effector/status",
  ]);
  acknowledgeExpectedHttpFailures(page, 1);
});

test("renders audit date, empty/full evidence, full trace IDs, and all chain states", async ({
  page,
}) => {
  await loadReadyEffector(page);
  const audit = page.getByRole("region", { name: "审计丁册" });
  await expect(audit.getByText("链完整 · 校验通过")).toBeVisible();

  await audit.getByRole("combobox", { name: "审计日期" }).selectOption("2026-07-12");
  await expect(audit.getByText("mock-audit-trace-1", { exact: true })).toBeVisible();
  await expect(audit.getByText("mock-audit-trace-2", { exact: true })).toBeVisible();
  await expect(audit.getByText("共 2 条")).toBeVisible();

  await page.route("**/v1/admin/effector/audit*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    await fulfillAudit(route, {
      dates: ["2026-07-12", "2026-07-13"],
      date,
      entries: [],
      total: 0,
      chain_valid: null,
    });
  });
  await audit.getByRole("combobox", { name: "审计日期" }).selectOption("2026-07-13");
  await expect(audit.getByText("未提供链完整性证据")).toBeVisible();
  await expect(audit.getByText("当前所选日期没有审计条目。")).toBeVisible();

  await page.unroute("**/v1/admin/effector/audit*");
  await page.route("**/v1/admin/effector/audit*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    await fulfillAudit(route, {
      dates: ["2026-07-12", "2026-07-13"],
      date,
      entries: [{
        ts: "2026-07-12T00:03:00.000Z",
        trace_id: "trace-id-preserved-in-full-0123456789abcdef",
        track: "headless",
        description: "deterministic broken-chain evidence",
        decision: "deny",
        dangerous: true,
      }],
      total: 1,
      chain_valid: false,
    });
  });
  await audit.getByRole("combobox", { name: "审计日期" }).selectOption("2026-07-12");
  await expect(audit.getByText("链断裂 · 证据可能被修改")).toBeVisible();
  await expect(audit.getByText("trace-id-preserved-in-full-0123456789abcdef", { exact: true }))
    .toBeVisible();
});

test("does not attribute null-dated evidence to a failed requested date", async ({ page }) => {
  await page.route("**/v1/admin/effector/audit*", async (route) => {
    await fulfillAudit(route, {
      dates: ["2026-07-12", "2026-07-13"],
      date: null,
      entries: [],
      total: 0,
      chain_valid: null,
    });
  });
  await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  const audit = page.getByRole("region", { name: "审计丁册" });
  await expect(audit.getByText("证据日期：未提供")).toBeVisible();

  await page.unroute("**/v1/admin/effector/audit*");
  await page.route("**/v1/admin/effector/audit*", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:3100" },
      body: JSON.stringify({ detail: "deterministic audit failure" }),
    });
  });
  await audit.getByRole("combobox", { name: "审计日期" }).selectOption("2026-07-13");
  await expect(audit.getByText(
    "请求日期：2026-07-13 · 当前仍显示最近一次已验证记录",
  )).toBeVisible();
  await expect(audit.getByText(
    "已验证证据日期没有审计条目；请求日期尚未获得权威记录。",
  )).toBeVisible();
  acknowledgeExpectedHttpFailures(page, 1);
});

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

function mutationAlert(page: Page, text: string) {
  return page.getByRole("alert").filter({ hasText: text });
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

async function prepareTheme(
  page: Page,
  theme: "dark" | "light",
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("theme", selectedTheme);
    window.localStorage.setItem("astr.visual-motion", "paused");
  }, theme);
}

async function loadReadyEffector(page: Page): Promise<void> {
  const response = await page.goto("/admin/effector", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("form", { name: "执行策略编辑" })).toBeVisible();
  await expect(page.getByRole("region", { name: "审计丁册" })).toBeVisible();
  await expect(page.locator("[data-safety='clear']")).toBeVisible();
}

function isPolicyPut(request: Request): boolean {
  return request.method() === "PUT" &&
    corePath(request) === "/v1/admin/effector/policy";
}

function recordSafetyOperation(request: Request, operations: string[]): void {
  const pathname = corePath(request);
  if (
    (request.method() === "POST" && (
      pathname === "/v1/effector/estop" ||
      pathname === "/v1/effector/estop/reset"
    )) ||
    (request.method() === "GET" && pathname === "/v1/effector/status")
  ) {
    operations.push(`${request.method()} ${pathname}`);
  }
}

function corePath(request: Request): string {
  return new URL(request.url()).pathname.replace(/^\/api\/core/, "");
}

async function fulfillAudit(
  route: import("@playwright/test").Route,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "http://127.0.0.1:3100" },
    body: JSON.stringify(body),
  });
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

async function readModuleGeometryAndStatus(
  links: import("@playwright/test").Locator,
): Promise<readonly unknown[]> {
  return links.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      href: element.getAttribute("href"),
      status: element.getAttribute("data-status"),
      x: Math.round(bounds.x * 100) / 100,
      y: Math.round(bounds.y * 100) / 100,
      width: Math.round(bounds.width * 100) / 100,
      height: Math.round(bounds.height * 100) / 100,
    };
  }));
}
