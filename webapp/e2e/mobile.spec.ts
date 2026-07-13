import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { REMOTE_APP_ORIGIN } from "../playwright.config";
import {
  MOCK_CORE_ORIGIN,
  configureMockCore,
  readMockCoreState,
  resetMockCore,
} from "./support/mock-core-client";

const TASK_DRAFT_STORAGE_KEY = "astr.mobile.task-drafts.v1";
const TASK_DRAFT_LIMIT = 12;
const TASK_TEXT_LIMIT = 4_000;

const MOBILE_DOMAINS = [
  { href: "/mobile/presence", label: "露怀秋", heading: /与 Soul 对话/ },
  { href: "/mobile/tasks", label: "任务", heading: "任务 · 本地草稿" },
  { href: "/mobile/workbench", label: "AI 工作台", heading: "AI 工作台" },
  { href: "/mobile/knowledge", label: "知识", heading: "知识" },
  { href: "/mobile/safety", label: "设备与安全", heading: "设备与安全" },
] as const;

const TRACKED_OPERATION_KEYS = [
  "status",
  "ingest",
  "transcribe",
  "stream",
  "effector-status",
  "effector-policy",
  "effector-audit",
] as const;

type TrackedOperation = (typeof TRACKED_OPERATION_KEYS)[number];
type TrackedCounts = Readonly<Record<TrackedOperation, number>>;

const ZERO_TRACKED_COUNTS: TrackedCounts = Object.freeze({
  status: 0,
  ingest: 0,
  transcribe: 0,
  stream: 0,
  "effector-status": 0,
  "effector-policy": 0,
  "effector-audit": 0,
});

const SAFETY_CHANNELS = [
  {
    key: "status",
    heading: "执行状态",
    readyAction: "重新读取状态",
    retryAction: "重试读取状态",
    readyWitness: "停止状态：未闩锁",
    errorCopy: "本机状态读取失败",
    countKey: "effector-status",
    failPatch: { effector: { statusMode: "http-error" } },
    recoverPatch: { effector: { statusMode: "ready" } },
  },
  {
    key: "policy",
    heading: "执行策略",
    readyAction: "重新读取策略",
    retryAction: "重试读取策略",
    readyWitness: "确认方式：每次请求确认",
    errorCopy: "本机策略读取失败",
    countKey: "effector-policy",
    failPatch: { policyMode: "http-error" },
    recoverPatch: { policyMode: "ready" },
  },
  {
    key: "audit",
    heading: "审计证据",
    readyAction: "重新读取审计",
    retryAction: "重试读取审计",
    readyWitness: "当前审计文件 hash 链校验通过",
    errorCopy: "本机审计读取失败",
    countKey: "effector-audit",
    failPatch: { auditMode: "http-error" },
    recoverPatch: { auditMode: "ready" },
  },
] as const;

const runtimeIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);
  runtimeIssues.set(page, collectRuntimeIssues(page));
});

test.afterEach(async ({ page }) => {
  expect(runtimeIssues.get(page) ?? []).toEqual([]);
});

test("publishes exactly five Mobile links and marks the current domain on every route", async ({
  page,
}) => {
  for (const domain of MOBILE_DOMAINS) {
    const response = await page.goto(domain.href, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${domain.href} HTTP status`).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: domain.heading }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Mobile 五域" });
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(MOBILE_DOMAINS.length);
    expect(await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href")),
    )).toEqual(MOBILE_DOMAINS.map(({ href }) => href));

    for (const candidate of MOBILE_DOMAINS) {
      const link = nav.getByRole("link", { name: candidate.label, exact: true });
      await expect(link).toHaveAttribute("href", candidate.href);
      await expect(link).toHaveAttribute(
        "data-current",
        candidate.href === domain.href ? "true" : "false",
      );
      if (candidate.href === domain.href) {
        await expect(link).toHaveAttribute("aria-current", "page");
      } else {
        await expect(link).not.toHaveAttribute("aria-current", "page");
      }
    }
  }
});

test("redirects /mobile exactly to Presence", async ({ page }) => {
  const response = await page.goto("/mobile", { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/mobile\/presence$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /与 Soul 对话/ }),
  ).toBeVisible();
});

test("ships the real cover viewport without zoom locks", async ({ page }) => {
  await page.goto("/mobile/tasks", { waitUntil: "domcontentloaded" });

  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveCount(1);
  const content = (await viewport.getAttribute("content")) ?? "";
  expect(content).toMatch(/(?:^|,)\s*width=device-width(?:\s*,|$)/i);
  expect(content).toMatch(/(?:^|,)\s*initial-scale=1(?:\.0+)?(?:\s*,|$)/i);
  expect(content).toMatch(/(?:^|,)\s*viewport-fit=cover(?:\s*,|$)/i);
  expect(content).not.toMatch(/maximum-scale|user-scalable/i);
});

test("keeps Tasks local while saving, upserting, deleting, and never touching clipboard", async ({
  page,
  request,
}) => {
  const pageOperations = collectPageCoreOperations(page);
  await installClipboardProbe(page);
  await loadReadyTasks(page);

  await expect(
    page.getByText("本机浏览器存储，未加密，请勿写入凭据", { exact: true }),
  ).toBeVisible();
  const editor = taskEditor(page);
  await editor.fill("第一份本地草稿");
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(taskStorageNotice(page)).toHaveText("已保存到此浏览器");
  await expect(editor).toHaveValue("");

  const firstSave = await readStoredDrafts(page);
  expect(firstSave).toHaveLength(1);
  expect(firstSave[0]).toMatchObject({ text: "第一份本地草稿" });
  const firstIdentity = firstSave[0]?.draft_id;
  const firstCreatedAt = firstSave[0]?.created_at;

  await page.getByRole("button", { name: "继续编辑第 1 条草稿" }).click();
  await expect(editor).toHaveValue("第一份本地草稿");
  await editor.fill("更新后的本地草稿");
  await page.getByRole("button", { name: "保存到此浏览器" }).click();

  const upserted = await readStoredDrafts(page);
  expect(upserted).toHaveLength(1);
  expect(upserted[0]).toMatchObject({
    draft_id: firstIdentity,
    created_at: firstCreatedAt,
    text: "更新后的本地草稿",
  });
  await expect(page.getByText("更新后的本地草稿", { exact: true })).toBeVisible();
  await expect(page.getByText("第一份本地草稿", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "删除第 1 条本地草稿" }).click();
  await expect(taskStorageNotice(page)).toHaveText("已从此浏览器删除");
  await expect(page.getByText("此浏览器尚无已保存草稿", { exact: true })).toBeVisible();
  expect(await readStoredDrafts(page)).toEqual([]);
  expect(await readClipboardWrites(page)).toBe(0);
  expect(pageOperations).toEqual([]);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("enforces the 4000-character Tasks boundary before persistence", async ({
  page,
  request,
}) => {
  const pageOperations = collectPageCoreOperations(page);
  await loadReadyTasks(page);
  const editor = taskEditor(page);
  await expect(editor).toHaveAttribute("maxlength", String(TASK_TEXT_LIMIT));

  await setControlledTextareaValue(editor, "字".repeat(TASK_TEXT_LIMIT));
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(taskStorageNotice(page)).toHaveText("已保存到此浏览器");
  expect((await readStoredDrafts(page))[0]?.text).toHaveLength(TASK_TEXT_LIMIT);

  await setControlledTextareaValue(editor, "字".repeat(TASK_TEXT_LIMIT + 1));
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(taskStorageNotice(page)).toHaveText(
    "正文超过 4000 字，未持久化",
  );
  await expect(editor).toHaveValue("字".repeat(TASK_TEXT_LIMIT + 1));
  expect(await readStoredDrafts(page)).toHaveLength(1);
  expect(pageOperations).toEqual([]);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("rejects a thirteenth local Task draft without replacing the twelve saved records", async ({
  page,
  request,
}) => {
  const seeded = createStoredDrafts(TASK_DRAFT_LIMIT);
  await page.addInitScript(
    ({ key, drafts }) => window.localStorage.setItem(key, JSON.stringify(drafts)),
    { key: TASK_DRAFT_STORAGE_KEY, drafts: seeded },
  );
  const pageOperations = collectPageCoreOperations(page);
  await loadReadyTasks(page);

  await expect(page.locator("main#main-content ol > li")).toHaveCount(
    TASK_DRAFT_LIMIT,
  );
  const editor = taskEditor(page);
  await editor.fill("第十三条不得持久化");
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(taskStorageNotice(page)).toHaveText(
    "已达 12 条本地草稿上限，未持久化",
  );
  await expect(editor).toHaveValue("第十三条不得持久化");
  expect(await readStoredDrafts(page)).toEqual(seeded);
  expect(pageOperations).toEqual([]);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("fails closed when Tasks localStorage read and write are unavailable", async ({
  page,
  request,
}) => {
  await installFailingTaskStorage(page);
  const pageOperations = collectPageCoreOperations(page);
  await page.goto("/mobile/tasks", { waitUntil: "domcontentloaded" });

  const unavailable = page.locator('[data-storage-phase="unavailable"]');
  await expect(unavailable).toHaveText("本地存储不可用，未持久化");
  const editor = taskEditor(page);
  await editor.fill("不能伪装成已保存");
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(unavailable).toHaveText("本地存储不可用，未持久化");
  await expect(editor).toHaveValue("不能伪装成已保存");
  await expect(page.getByText("此浏览器尚无已保存草稿", { exact: true })).toBeVisible();
  expect(pageOperations).toEqual([]);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("fresh context clears unsaved Tasks text after a route switch", async ({
  page,
  request,
}) => {
  const unsaved = "route-switch-unsaved-sentinel";
  await beginUnsavedTask(page, unsaved);
  await mobileNav(page).getByRole("link", { name: "AI 工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/workbench$/);
  await mobileNav(page).getByRole("link", { name: "任务", exact: true }).click();
  await expectUnsavedTaskCleared(page, unsaved);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("fresh context clears unsaved Tasks text after history back", async ({
  page,
  request,
}) => {
  const unsaved = "history-back-unsaved-sentinel";
  await beginUnsavedTask(page, unsaved);
  await mobileNav(page).getByRole("link", { name: "知识", exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/knowledge$/);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expectUnsavedTaskCleared(page, unsaved);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("fresh context clears unsaved Tasks text after history forward", async ({
  page,
  request,
}) => {
  const unsaved = "history-forward-unsaved-sentinel";
  await page.goto("/mobile/knowledge", { waitUntil: "domcontentloaded" });
  await mobileNav(page).getByRole("link", { name: "任务", exact: true }).click();
  await expect(page).toHaveURL(/\/mobile\/tasks$/);
  await expect(page.locator('[data-storage-phase="ready"]')).toBeVisible();
  await taskEditor(page).fill(unsaved);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/mobile\/knowledge$/);
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expectUnsavedTaskCleared(page, unsaved);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("fresh context clears unsaved Tasks text after refresh", async ({
  page,
  request,
}) => {
  const unsaved = "refresh-unsaved-sentinel";
  await beginUnsavedTask(page, unsaved);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectUnsavedTaskCleared(page, unsaved);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("recovers an explicitly saved Task separately after remount", async ({
  page,
  request,
}) => {
  await loadReadyTasks(page);
  await taskEditor(page).fill("已显式保存并可恢复");
  await page.getByRole("button", { name: "保存到此浏览器" }).click();
  await expect(taskStorageNotice(page)).toHaveText("已保存到此浏览器");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-storage-phase="ready"]')).toBeVisible();
  await expect(taskEditor(page)).toHaveValue("");
  await expect(page.getByText("已显式保存并可恢复", { exact: true })).toBeVisible();
  expect((await readStoredDrafts(page))[0]).toMatchObject({
    text: "已显式保存并可恢复",
  });
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("keeps Workbench and Knowledge truthful and action-free inside main", async ({
  page,
  request,
}) => {
  const pageOperations = collectPageCoreOperations(page);
  for (const gate of [
    { path: "/mobile/workbench", copy: "Studio 投影未启用" },
    { path: "/mobile/knowledge", copy: "安全只读知识投影未启用。" },
  ] as const) {
    await page.goto(gate.path, { waitUntil: "domcontentloaded" });
    const shell = page.locator('[data-route-surface="mobile"]');
    const header = shell.locator(":scope > header");
    await expect(
      header.getByText("本机可信入口", { exact: true }),
    ).toBeVisible();
    await expect(
      header.getByText("核验本机来源", { exact: true }),
    ).toHaveCount(0);
    const main = page.locator("main#main-content");
    await expect(main.getByText(gate.copy, { exact: true })).toBeVisible();
    await expect(
      main.locator(
        "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
      ),
    ).toHaveCount(0);
    await page.evaluate(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
    );
    expect(pageOperations, `${gate.path} Core operations`).toEqual([]);
  }
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

test("runs the trusted Mobile Presence conversation and Composer to final truth", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "happy" });
  await page.goto("/mobile/presence", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { level: 1, name: "与 Soul 对话" }),
  ).toBeVisible();
  const facts = page.getByLabel("Presence 连接事实");
  expect(await facts.evaluate((element) => element.tagName)).toBe("DL");
  await expect(facts).not.toHaveAttribute("role");
  await expect(facts.getByText("可达", { exact: true })).toBeVisible();
  await expect(facts.getByText("已连接", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("region", { name: "对话记录" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mobile Presence 对话" })).toBeVisible();

  const composer = page.getByRole("textbox", { name: "消息输入" });
  const send = page.getByRole("button", { name: "发送消息" });
  await expect(composer).toBeEnabled();
  await composer.fill("从 Mobile 抵达星枢");
  await expect(send).toBeEnabled();
  await send.click();

  const timeline = page.getByRole("list", { name: "对话消息" });
  await expect(timeline.getByText("从 Mobile 抵达星枢", { exact: true })).toBeVisible();
  await expect(
    timeline.getByText("我在这里，星枢链路已经抵达终稿。", { exact: true }),
  ).toBeVisible();
  const state = await readMockCoreState(request);
  expect(readCount(state, "ingest")).toBe(1);
});

test("renders all three trusted Safety channels ready with exact local-host truth", async ({
  page,
  request,
}) => {
  await loadReadySafety(page);

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "当前 Web 主机 · 本机可信入口",
    }),
  ).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);
  for (const channel of SAFETY_CHANNELS) {
    const section = safetyChannel(page, channel.heading);
    await expect(section.getByText(channel.readyWitness, { exact: true })).toBeVisible();
    await expect(
      section.getByRole("button", { name: channel.readyAction }),
    ).toBeEnabled();
  }
  await expectNoOnlineComputerClaims(page);
  await expectSafetyCounts(request, {
    "effector-status": 1,
    "effector-policy": 1,
    "effector-audit": 1,
  });
});

for (const channel of SAFETY_CHANNELS) {
  test(`recovers the isolated ${channel.key} Safety startup error without touching peer channels`, async ({
    page,
    request,
  }) => {
    await configureMockCore(request, channel.failPatch);
    await page.goto("/mobile/safety", { waitUntil: "domcontentloaded" });

    const failed = safetyChannel(page, channel.heading);
    await expect(failed.getByText("读取失败", { exact: true })).toBeVisible();
    await expect(failed.getByText(channel.errorCopy, { exact: true })).toBeVisible();
    await expect(
      failed.getByRole("button", { name: channel.retryAction }),
    ).toBeEnabled();
    await expectPeerSafetyChannelsReady(page, channel.key);
    await acknowledgeExpectedHttpFailures(page, 1);
    await expectSafetyCounts(request, {
      "effector-status": 1,
      "effector-policy": 1,
      "effector-audit": 1,
    });

    await configureMockCore(request, channel.recoverPatch);
    await failed.getByRole("button", { name: channel.retryAction }).click();
    await expect(failed.getByText("已验证", { exact: true })).toBeVisible();
    await expect(failed.getByText(channel.readyWitness, { exact: true })).toBeVisible();
    await expect(failed.getByText(channel.errorCopy, { exact: true })).toHaveCount(0);
    await expectPeerSafetyChannelsReady(page, channel.key);
    await expectSafetyCounts(request, {
      "effector-status": channel.countKey === "effector-status" ? 2 : 1,
      "effector-policy": channel.countKey === "effector-policy" ? 2 : 1,
      "effector-audit": channel.countKey === "effector-audit" ? 2 : 1,
    });
  });

  test(`retains verified ${channel.key} Safety evidence as stale and retries only that channel`, async ({
    page,
    request,
  }) => {
    await loadReadySafety(page);
    const section = safetyChannel(page, channel.heading);
    const verifiedAt = await section.locator("time").getAttribute("datetime");
    expect(verifiedAt).not.toBeNull();

    await configureMockCore(request, channel.failPatch);
    await section.getByRole("button", { name: channel.readyAction }).click();
    await expect(section.getByText("可能陈旧", { exact: true })).toBeVisible();
    await expect(section.getByText(channel.errorCopy, { exact: true })).toBeVisible();
    await expect(section.getByText(channel.readyWitness, { exact: true })).toBeVisible();
    await expect(section.locator("time")).toHaveAttribute("datetime", verifiedAt ?? "");
    await expectPeerSafetyChannelsReady(page, channel.key);
    await acknowledgeExpectedHttpFailures(page, 1);
    await expectSafetyCounts(request, {
      "effector-status": channel.countKey === "effector-status" ? 2 : 1,
      "effector-policy": channel.countKey === "effector-policy" ? 2 : 1,
      "effector-audit": channel.countKey === "effector-audit" ? 2 : 1,
    });

    await configureMockCore(request, channel.recoverPatch);
    await section.getByRole("button", { name: channel.retryAction }).click();
    await expect(section.getByText("已验证", { exact: true })).toBeVisible();
    await expect(section.getByText(channel.errorCopy, { exact: true })).toHaveCount(0);
    await expect(section.getByText(channel.readyWitness, { exact: true })).toBeVisible();
    await expectPeerSafetyChannelsReady(page, channel.key);
    await expectSafetyCounts(request, {
      "effector-status": channel.countKey === "effector-status" ? 3 : 1,
      "effector-policy": channel.countKey === "effector-policy" ? 3 : 1,
      "effector-audit": channel.countKey === "effector-audit" ? 3 : 1,
    });
  });
}

test("keeps remote Safety gated without local-host or online-computer claims", async ({
  page,
  request,
}) => {
  await page.goto(`${REMOTE_APP_ORIGIN}/mobile/safety`, {
    waitUntil: "domcontentloaded",
  });

  expect(await page.evaluate(() => window.location.hostname)).toBe("astr-remote.test");
  await expect(
    page.locator('[data-mobile-safety-phase="unavailable-remote-context"]'),
  ).toBeVisible();
  await expect(
    page.getByText(
      "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "当前 Web 主机 · 本机可信入口",
    }),
  ).toHaveCount(0);
  await expectNoOnlineComputerClaims(page);
  await expectTrackedCounts(request, ZERO_TRACKED_COUNTS);
});

function mobileNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Mobile 五域" });
}

function taskEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "本地任务草稿" });
}

function taskStorageNotice(page: Page): Locator {
  return page.locator("[data-storage-phase]");
}

async function loadReadyTasks(page: Page): Promise<void> {
  const response = await page.goto("/mobile/tasks", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "任务 · 本地草稿" }),
  ).toBeVisible();
  await expect(page.locator('[data-storage-phase="ready"]')).toHaveText(
    "本地存储可用",
  );
}

async function beginUnsavedTask(page: Page, text: string): Promise<void> {
  await loadReadyTasks(page);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), TASK_DRAFT_STORAGE_KEY))
    .toBeNull();
  await taskEditor(page).fill(text);
  await expect(taskEditor(page)).toHaveValue(text);
  await expect(page.getByText("当前内容未保存", { exact: true })).toBeVisible();
}

async function expectUnsavedTaskCleared(page: Page, sentinel: string): Promise<void> {
  await expect(page).toHaveURL(/\/mobile\/tasks$/);
  await expect(page.locator('[data-storage-phase="ready"]')).toBeVisible();
  await expect(taskEditor(page)).toHaveValue("");
  const storageValues = await page.evaluate(() => ({
    local: Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key)),
    session: Object.keys(window.sessionStorage).map((key) => window.sessionStorage.getItem(key)),
  }));
  expect(JSON.stringify(storageValues)).not.toContain(sentinel);
}

async function readStoredDrafts(
  page: Page,
): Promise<readonly Record<string, unknown>[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Task storage is not an array");
    return parsed as Record<string, unknown>[];
  }, TASK_DRAFT_STORAGE_KEY);
}

function createStoredDrafts(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    schema_version: 1,
    draft_id: `local_draft_seed_${index + 1}`,
    text: `已保存草稿 ${index + 1}`,
    created_at: `2026-07-13T00:${String(index).padStart(2, "0")}:00.000Z`,
    updated_at: `2026-07-13T00:${String(index).padStart(2, "0")}:00.000Z`,
  }));
}

async function setControlledTextareaValue(
  textarea: Locator,
  value: string,
): Promise<void> {
  await textarea.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new Error("Expected a textarea");
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Textarea value setter is unavailable");
    setter.call(element, nextValue);
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, value);
  await expect(textarea).toHaveValue(value);
}

async function installClipboardProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as unknown as { __mobileClipboardWrites: number };
    probe.__mobileClipboardWrites = 0;
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({
        writeText: async () => {
          probe.__mobileClipboardWrites += 1;
        },
      }),
    });
  });
}

async function readClipboardWrites(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __mobileClipboardWrites: number })
      .__mobileClipboardWrites,
  );
}

async function installFailingTaskStorage(page: Page): Promise<void> {
  await page.addInitScript((taskKey) => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Object.defineProperties(Storage.prototype, {
      getItem: {
        configurable: true,
        value(this: Storage, key: string) {
          if (key === taskKey) throw new DOMException("blocked", "SecurityError");
          return originalGet.call(this, key);
        },
      },
      setItem: {
        configurable: true,
        value(this: Storage, key: string, value: string) {
          if (key === taskKey) throw new DOMException("blocked", "SecurityError");
          return originalSet.call(this, key, value);
        },
      },
    });
  }, TASK_DRAFT_STORAGE_KEY);
}

async function loadReadySafety(page: Page): Promise<void> {
  const response = await page.goto("/mobile/safety", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "当前 Web 主机 · 本机可信入口",
    }),
  ).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);
}

function safetyChannel(page: Page, heading: string): Locator {
  return page
    .getByRole("heading", { level: 3, name: heading })
    .locator("xpath=ancestor::section[1]");
}

async function expectPeerSafetyChannelsReady(
  page: Page,
  excluded: (typeof SAFETY_CHANNELS)[number]["key"],
): Promise<void> {
  for (const candidate of SAFETY_CHANNELS) {
    if (candidate.key === excluded) continue;
    const peer = safetyChannel(page, candidate.heading);
    await expect(peer.getByText("已验证", { exact: true })).toBeVisible();
    await expect(peer.getByText(candidate.readyWitness, { exact: true })).toBeVisible();
    await expect(
      peer.getByRole("button", { name: candidate.readyAction }),
    ).toBeEnabled();
  }
}

async function expectNoOnlineComputerClaims(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText("我的电脑在线");
  await expect(page.locator("body")).not.toContainText("远程设备");
}

async function expectSafetyCounts(
  request: import("@playwright/test").APIRequestContext,
  expected: Readonly<Record<"effector-status" | "effector-policy" | "effector-audit", number>>,
): Promise<void> {
  await expect.poll(async () => {
    const state = await readMockCoreState(request);
    return {
      "effector-status": readCount(state, "effector-status"),
      "effector-policy": readCount(state, "effector-policy"),
      "effector-audit": readCount(state, "effector-audit"),
    };
  }).toEqual(expected);
}

async function expectTrackedCounts(
  request: import("@playwright/test").APIRequestContext,
  expected: TrackedCounts,
): Promise<void> {
  const state = await readMockCoreState(request);
  const actual = Object.fromEntries(
    TRACKED_OPERATION_KEYS.map((key) => [key, readCount(state, key)]),
  ) as Record<TrackedOperation, number>;
  expect(actual).toEqual(expected);
}

function readCount(
  state: Readonly<Record<string, unknown>>,
  key: TrackedOperation,
): number {
  const counts = isRecord(state.counts) ? state.counts : {};
  return typeof counts[key] === "number" ? counts[key] : 0;
}

function collectPageCoreOperations(page: Page): string[] {
  const operations: string[] = [];
  page.on("request", (request) => {
    if (isCoreOperationRequest(request)) {
      operations.push(`${request.method()} ${request.url()}`);
    }
  });
  return operations;
}

function isCoreOperationRequest(request: Request): boolean {
  const url = new URL(request.url());
  return (
    url.pathname === "/api/core" ||
    url.pathname.startsWith("/api/core/") ||
    url.origin === MOCK_CORE_ORIGIN ||
    url.pathname === "/v1/status" ||
    url.pathname === "/v1/stream" ||
    url.pathname === "/v1/ingest" ||
    url.pathname.startsWith("/v1/voice/") ||
    url.pathname.startsWith("/v1/voiceprint/") ||
    url.pathname.startsWith("/v1/effector/") ||
    url.pathname.startsWith("/v1/admin/effector/")
  );
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
  page.on("pageerror", (error) => issues.push(`page: ${error.message}`));
  return issues;
}

async function acknowledgeExpectedHttpFailures(
  page: Page,
  count: number,
): Promise<void> {
  const issues = runtimeIssues.get(page) ?? [];
  await expect.poll(() => issues.length).toBe(count);
  const expected = issues.splice(0, count);
  for (const issue of expected) {
    expect(issue).toMatch(
      /^console error: Failed to load resource: the server responded with a status of 503/,
    );
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
