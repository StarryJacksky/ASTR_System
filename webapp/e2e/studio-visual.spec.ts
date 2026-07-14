import {
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";

import { APP_ORIGIN } from "../playwright.config";

const THEMES = ["dark", "light"] as const;
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
] as const;
const GEOMETRY_TOLERANCE_PX = 1;
const SNAPSHOT_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition: none !important;
  }
`;

type Theme = (typeof THEMES)[number];
type Viewport = (typeof VIEWPORTS)[number];
type Region = "surface" | "header" | "main" | "facts" | "truth" | "datum" | "register" | "gates";

interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type StudioLayout = Readonly<Record<Region, LayoutRect>>;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}x${viewport.height} has deterministic Studio theme-parity visuals`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const layouts = new Map<Theme, StudioLayout>();

    for (const theme of THEMES) {
      const page = await createVisualPage(browser, viewport, theme);
      try {
        await loadVisualState(page, theme);
        layouts.set(theme, await captureLayout(page, viewport, theme));
        await expect(page).toHaveScreenshot(
          `studio-${viewport.width}x${viewport.height}-${theme}.png`,
          {
            animations: "disabled",
            caret: "hide",
            scale: "css",
          },
        );
      } finally {
        await page.context().close();
      }
    }

    expectThemeGeometryParity(
      requireLayout(layouts, "dark"),
      requireLayout(layouts, "light"),
      `${viewport.width}x${viewport.height}`,
    );
  });
}

async function createVisualPage(
  browser: Browser,
  viewport: Viewport,
  theme: Theme,
): Promise<Page> {
  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 1,
    locale: "zh-CN",
    reducedMotion: "reduce",
    timezoneId: "Asia/Taipei",
    viewport,
  });
  await context.addInitScript(({ selectedTheme }) => {
    window.localStorage.setItem("theme", selectedTheme);
    window.localStorage.setItem("astr.visual-motion", "paused");
    document.documentElement.dataset.theme = selectedTheme;
    document.documentElement.dataset.visualMotion = "paused";
  }, { selectedTheme: theme });
  return context.newPage();
}

async function loadVisualState(page: Page, theme: Theme): Promise<void> {
  const response = await page.goto(`${APP_ORIGIN}/studio`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-route-surface='studio']")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Studio 投影未启用" }))
    .toBeVisible();
  await expect(page.locator("[data-studio-registration-mark]")).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-visual-motion", "paused");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({ content: SNAPSHOT_STYLE });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

async function captureLayout(
  page: Page,
  viewport: Viewport,
  theme: Theme,
): Promise<StudioLayout> {
  const evidence = await page.evaluate(() => {
    const requireElement = (selector: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error(`Missing Studio visual region: ${selector}`);
      return element;
    };
    const rect = (element: HTMLElement): LayoutRect => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };

    const surface = requireElement("[data-route-surface='studio']");
    const main = requireElement("main#main-content");
    const heading = requireElement("main#main-content h1");
    const truth = heading.closest<HTMLElement>("[data-studio-truth-field]") ??
      heading.parentElement;
    if (truth === null) throw new Error("Missing Studio truth field");

    return {
      layout: {
        surface: rect(surface),
        header: rect(requireElement("[data-route-surface='studio'] > header")),
        main: rect(main),
        facts: rect(requireElement("[aria-labelledby='studio-fact-heading']")),
        truth: rect(truth),
        datum: rect(requireElement("[data-studio-datum]")),
        register: rect(requireElement("[aria-labelledby='studio-projection-heading']")),
        gates: rect(requireElement("[aria-labelledby='studio-gate-heading']")),
      },
      overflow: {
        document: document.documentElement.scrollWidth - window.innerWidth,
        main: main.scrollWidth - main.clientWidth,
        surface: surface.scrollWidth - surface.clientWidth,
      },
    };
  });

  const label = `${viewport.width}x${viewport.height} ${theme}`;
  expect(evidence.overflow, `${label} horizontal overflow`).toEqual({
    document: 0,
    main: 0,
    surface: 0,
  });
  for (const [region, bounds] of Object.entries(evidence.layout)) {
    expect(bounds.x, `${label} ${region} left edge`).toBeGreaterThanOrEqual(
      -GEOMETRY_TOLERANCE_PX,
    );
    expect(bounds.x + bounds.width, `${label} ${region} right edge`).toBeLessThanOrEqual(
      viewport.width + GEOMETRY_TOLERANCE_PX,
    );
  }
  return evidence.layout;
}

function requireLayout(
  layouts: ReadonlyMap<Theme, StudioLayout>,
  theme: Theme,
): StudioLayout {
  const layout = layouts.get(theme);
  if (layout === undefined) throw new Error(`Missing Studio ${theme} layout`);
  return layout;
}

function expectThemeGeometryParity(
  dark: StudioLayout,
  light: StudioLayout,
  label: string,
): void {
  for (const region of Object.keys(dark) as Region[]) {
    for (const property of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(dark[region][property] - light[region][property]),
        `${label} ${region}.${property} dark/light delta`,
      ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    }
  }
}
