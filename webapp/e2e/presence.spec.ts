import { expect, test } from "@playwright/test";

import {
  configureMockCore,
  readMockCoreState,
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test("loads the canonical Presence route without hydration, console, or page errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);

  const main = page.locator("main#main-content");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute("data-presence-layout", "balanced");
  await expect(main).toHaveAttribute("data-orbit-state", "dialogue");
  await expect(page.getByRole("heading", { level: 1, name: /ASTR/ })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Soul" })).toBeVisible();
  await expect(page.locator("[data-static-soul-lens]"))
    .toHaveAttribute("data-soul-lens-fallback", "static");
  await expect(page.getByText("远程任务尚未启用")).toBeVisible();
  await expect(page.locator("[data-presence-life-island]"))
    .toHaveAttribute("data-expanded", "false");
  expect(errors).toEqual([]);
});

test("switches only material theme and preserves geometry and semantic state", async ({
  page,
}) => {
  await page.goto("/");
  await waitForOpenStreams(page);
  const main = page.locator("main#main-content");
  const orbitPaths = await page.locator("[data-orbit-path]").evaluateAll((paths) =>
    paths.map((path) => path.getAttribute("d")),
  );

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换昼夜主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(main).toHaveAttribute("data-presence-layout", "balanced");
  expect(
    await page.locator("[data-orbit-path]").evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("d")),
    ),
  ).toEqual(orbitPaths);
});

const PRESENCE_VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
] as const;

for (const viewport of PRESENCE_VIEWPORTS) {
  for (const theme of ["dark", "light"] as const) {
    test(`matches the approved ${theme} baseline without horizontal overflow at ${viewport.width}px`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("theme", selectedTheme);
        window.localStorage.setItem("astr.visual-motion", "reduced");
      }, theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForOpenStreams(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const overflow = await page.evaluate(() => ({
        document:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(0);
      expect(overflow.body).toBeLessThanOrEqual(0);
      await expect(page.locator("[data-presence-soul]")).toBeVisible();
      await expect(page).toHaveScreenshot(
        `presence-${viewport.width}x${viewport.height}-${theme}.png`,
        {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          scale: "css",
        },
      );
      expect(errors).toEqual([]);
    });
  }
}

test("keeps Soul mounted across deep chat and opens Life only from explicit intent", async ({
  page,
}) => {
  await page.goto("/");
  await waitForOpenStreams(page);
  const soul = page.locator("[data-presence-soul]");
  const soulId = await soul.evaluate((element) => {
    element.setAttribute("data-e2e-identity", "stable-soul");
    return element.getAttribute("data-e2e-identity");
  });

  await page.getByRole("button", { name: "切换深聊布局" }).click();
  await expect(page.locator("main#main-content")).toHaveAttribute(
    "data-presence-layout",
    "deep",
  );
  expect(await soul.getAttribute("data-e2e-identity")).toBe(soulId);

  await page.getByRole("button", { name: "前往 Life" }).click();
  await expect(page.locator("main#main-content")).toHaveAttribute(
    "data-orbit-state",
    "life",
  );
  await expect(page.locator("[data-presence-life-island]"))
    .toHaveAttribute("data-expanded", "true");
  await expect(page.getByRole("region", { name: "生活密度岛" })).toBeFocused();
});

test("sends once, keeps ACK provisional truth separate, then lands the authoritative decision", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "happy" });
  await page.goto("/");
  await waitForOpenStreams(page);
  const composer = page.getByRole("textbox", { name: "消息输入" });

  await composer.fill("今晚也请留在这里");
  await page.getByRole("button", { name: "发送消息" }).dblclick();

  const timeline = page.getByRole("list", { name: "对话消息" });
  await expect(timeline.getByText("今晚也请留在这里")).toBeVisible();
  const reply = timeline.locator("[data-message-id^='reply:']");
  await expect(reply).toHaveAttribute("data-message-phase", "provisional");
  await expect(reply).toContainText("我在这里，星枢链路正在形成。");
  await expect(reply).toHaveAttribute("data-message-phase", "settled");
  await expect(reply).toContainText("我在这里，星枢链路已经抵达终稿。");
  const observed = await readMockCoreState(request);
  expect((observed.counts as Record<string, number>).ingest).toBe(1);
});

function collectPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}
