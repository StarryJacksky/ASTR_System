import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
} from "@playwright/test";

const BASELINES = [
  { label: "desktop dark", theme: "dark", viewport: { width: 1440, height: 1000 } },
  { label: "desktop light", theme: "light", viewport: { width: 1440, height: 1000 } },
  { label: "mobile dark", theme: "dark", viewport: { width: 390, height: 844 } },
  { label: "mobile light", theme: "light", viewport: { width: 390, height: 844 } },
  { label: "400% equivalent", theme: "dark", viewport: { width: 320, height: 225 } },
] as const;

for (const baseline of BASELINES) {
  test(`${baseline.label} has no critical or serious accessibility violation`, async ({
    page,
  }) => {
    await prepareStudioPage(page, baseline);
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await expectStudioSemantics(page);
    await expectNoBlockingAxeViolations(page, baseline.label);
  });
}

test("keyboard users traverse only one skip, three exits, and two global controls in DOM order", async ({
  page,
}) => {
  await prepareStudioPage(page, BASELINES[0]);
  await page.goto("/studio", { waitUntil: "domcontentloaded" });

  const skip = page.getByRole("link", { name: "跳到主要内容" });
  const main = page.locator("main#main-content");
  const focusOrder = [
    page.getByRole("link", { name: "Presence" }),
    page.getByRole("link", { name: "Control" }),
    page.getByRole("link", { name: "Mobile" }),
    page.getByRole("button", { name: "切换昼夜主题" }),
    page.getByRole("button", { name: /视觉动效/ }),
  ];

  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main).toBeFocused();

  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  for (const control of focusOrder) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  await page.keyboard.press("Shift+Tab");
  await expect(focusOrder.at(-2)!).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusOrder.at(-1)!).toBeFocused();

  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
});

async function prepareStudioPage(
  page: Page,
  baseline: (typeof BASELINES)[number],
): Promise<void> {
  await page.setViewportSize(baseline.viewport);
  await page.emulateMedia({
    colorScheme: baseline.theme,
    reducedMotion: "reduce",
  });
  await page.addInitScript(({ theme }) => {
    window.localStorage.setItem("theme", theme);
    window.localStorage.setItem("astr.visual-motion", "paused");
  }, { theme: baseline.theme });
}

async function expectStudioSemantics(page: Page): Promise<void> {
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Studio 投影未启用" }))
    .toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "星枢四空间" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Studio 合同事实" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Studio 投影分类目录" }))
    .toHaveCount(1);
  await expect(page.getByRole("region", { name: "Studio 实施门" })).toHaveCount(1);
  await expect(page.locator("[data-studio-registration-mark]")).toHaveCount(6);
  await expect(page.locator("main#main-content a, main#main-content button"))
    .toHaveCount(0);
  await expect(page.locator("[aria-live]:not(#__next-route-announcer__)")).toHaveCount(1);
  await expect(page.locator("#__next-route-announcer__[aria-live]")).toHaveCount(1);
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
