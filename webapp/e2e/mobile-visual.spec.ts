import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { APP_ORIGIN } from "../playwright.config";
import {
  configureMockCore,
  resetMockCore,
} from "./support/mock-core-client";

const FIXED_NOW = "2026-07-14T08:00:00.000Z";
const PRESENCE_FIXED_NOW = "2026-07-12T23:59:00.000Z";
const PRESENCE_PROMPT = "星枢视觉基线：保持此刻";
const PRESENCE_FINAL = "我在这里，星枢链路已经抵达终稿。";
const TASK_DRAFT = "整理今日对话，并在获得明确授权后继续。";
const TASK_EDITOR_VIEWPORT_TOP_PX = 16;
const GEOMETRY_TOLERANCE_PX = 1;

const SNAPSHOT_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition: none !important;
  }
`;

const THEMES = ["dark", "light"] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;
const DOMAINS = [
  { id: "presence", path: "/mobile/presence" },
  { id: "tasks", path: "/mobile/tasks" },
  { id: "workbench", path: "/mobile/workbench" },
  { id: "knowledge", path: "/mobile/knowledge" },
  { id: "safety", path: "/mobile/safety" },
] as const;

type Theme = (typeof THEMES)[number];
type Domain = (typeof DOMAINS)[number];
type Viewport = (typeof VIEWPORTS)[number];
type LayoutRegion = "header" | "main" | "nav" | "primary";

interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type MobileLayout = Readonly<Record<LayoutRegion, LayoutRect>>;

interface LayoutEvidence {
  readonly layout: MobileLayout;
  readonly order: readonly string[];
  readonly horizontalOverflow: Readonly<{
    document: number;
    shell: number;
    main: number;
    primary: number;
  }>;
  readonly viewport: Readonly<{ width: number; height: number }>;
}

for (const domain of DOMAINS) {
  for (const viewport of VIEWPORTS) {
    test(`${domain.id} ${viewport.width}x${viewport.height} has deterministic theme-parity visuals`, async ({
      browser,
      request,
    }, testInfo) => {
      testInfo.setTimeout(60_000);
      const layouts = new Map<Theme, MobileLayout>();

      for (const theme of THEMES) {
        await seedMockState(request);
        const page = await createVisualPage(browser, viewport, theme, domain.id);

        try {
          await loadVisualState(page, domain, theme);
          const layout = await captureLayoutEvidence(page, domain, viewport, theme);
          layouts.set(theme, layout);

          await expect(page).toHaveScreenshot(
            `mobile-${domain.id}-${viewport.width}x${viewport.height}-${theme}.png`,
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
        `${domain.id} ${viewport.width}x${viewport.height}`,
      );
    });
  }
}

async function seedMockState(request: APIRequestContext): Promise<void> {
  await resetMockCore(request);
  await configureMockCore(request, {
    scenario: "happy",
    statusMode: "ready",
    policyMode: "ready",
    auditMode: "ready",
    effector: {
      stopped: false,
      statusMode: "ready",
      statusDelayMs: 0,
    },
  });
}

async function createVisualPage(
  browser: Browser,
  viewport: Viewport,
  theme: Theme,
  domain: Domain["id"],
): Promise<Page> {
  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 1,
    locale: "zh-CN",
    reducedMotion: "reduce",
    timezoneId: "Asia/Taipei",
    viewport,
  });

  await context.addInitScript(
    ({ fixedNow, selectedTheme }) => {
      const NativeDate = globalThis.Date;
      const fixedMilliseconds = NativeDate.parse(fixedNow);
      const FrozenDate = new Proxy(NativeDate, {
        apply() {
          return new NativeDate(fixedMilliseconds).toString();
        },
        construct(target, argumentsList) {
          return Reflect.construct(
            target,
            argumentsList.length === 0 ? [fixedMilliseconds] : argumentsList,
          );
        },
        get(target, property) {
          if (property === "now") return () => fixedMilliseconds;
          return Reflect.get(target, property);
        },
      });

      Object.defineProperty(globalThis, "Date", {
        configurable: true,
        value: FrozenDate,
        writable: true,
      });
      window.localStorage.setItem("theme", selectedTheme);
      window.localStorage.setItem("astr.visual-motion", "paused");
      document.documentElement.dataset.theme = selectedTheme;
      document.documentElement.dataset.visualMotion = "paused";
    },
    {
      fixedNow: domain === "presence" ? PRESENCE_FIXED_NOW : FIXED_NOW,
      selectedTheme: theme,
    },
  );

  return context.newPage();
}

async function loadVisualState(
  page: Page,
  domain: Domain,
  theme: Theme,
): Promise<void> {
  const response = await page.goto(`${APP_ORIGIN}${domain.path}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), `${domain.path} HTTP status`).toBe(200);

  const shell = page.locator('[data-route-surface="mobile"]');
  await expect(shell).toBeVisible();
  await expect(shell.locator(":scope > header").getByText("本机可信入口", {
    exact: true,
  })).toBeVisible();
  await expect(
    shell.locator(':scope > nav[aria-label="Mobile 五域"]'),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "paused",
  );

  await settleDomain(page, domain.id);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({ content: SNAPSHOT_STYLE });
  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  });
  await positionVisualFrame(page, domain.id);
}

async function positionVisualFrame(
  page: Page,
  domain: Domain["id"],
): Promise<void> {
  if (domain !== "tasks") return;

  const frame = await page
    .getByRole("textbox", { name: "本地任务草稿" })
    .evaluate((textarea, targetTop): {
      editorTop: number;
      navTop: number;
      textareaBottom: number;
      textareaTop: number;
    } => {
      const editor = textarea.closest<HTMLElement>(
        'section[aria-labelledby="local-draft-editor-title"]',
      );
      const shell = textarea.closest<HTMLElement>(
        '[data-route-surface="mobile"]',
      );
      if (editor === null || shell === null) {
        throw new Error("Missing Tasks visual framing element");
      }
      const nav = shell.querySelector<HTMLElement>(
        ':scope > nav[aria-label="Mobile 五域"]',
      );
      if (nav === null) throw new Error("Missing Tasks visual navigation");

      const shellTop = shell.getBoundingClientRect().top;
      const currentEditorTop = editor.getBoundingClientRect().top - shellTop;
      shell.scrollTop = Math.max(
        0,
        shell.scrollTop + currentEditorTop - targetTop,
      );

      const editorRect = editor.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const textareaRect = textarea.getBoundingClientRect();
      return {
        editorTop: editorRect.top - shell.getBoundingClientRect().top,
        navTop: navRect.top,
        textareaBottom: textareaRect.bottom,
        textareaTop: textareaRect.top,
      };
    }, TASK_EDITOR_VIEWPORT_TOP_PX);

  expect(
    Math.abs(frame.editorTop - TASK_EDITOR_VIEWPORT_TOP_PX),
    "Tasks editor semantic scroll anchor",
  ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(frame.textareaTop, "Tasks textarea top visibility").toBeGreaterThanOrEqual(
    TASK_EDITOR_VIEWPORT_TOP_PX,
  );
  expect(
    frame.textareaBottom,
    "Tasks textarea remains above the fixed Mobile navigation",
  ).toBeLessThanOrEqual(frame.navTop - GEOMETRY_TOLERANCE_PX);
}

async function settleDomain(page: Page, domain: Domain["id"]): Promise<void> {
  switch (domain) {
    case "presence": {
      const facts = page.locator('dl[aria-label="Presence 连接事实"]');
      await expect(facts).toBeVisible();
      await expect(facts.getByText("可达", { exact: true })).toBeVisible();
      await expect(facts.getByText("已连接", { exact: true })).toHaveCount(2);
      await expect(facts.getByText("Reply SSE", { exact: true })).toBeVisible();
      await expect(facts.getByText("Life SSE", { exact: true })).toBeVisible();

      const composer = page.getByRole("textbox", { name: "消息输入" });
      await expect(composer).toBeEnabled();
      await composer.fill(PRESENCE_PROMPT);
      await page.getByRole("button", { name: "发送消息" }).click();

      const timeline = page.getByRole("list", { name: "对话消息" });
      await expect(
        timeline.getByText(PRESENCE_PROMPT, { exact: true }),
      ).toBeVisible();
      await expect(
        timeline.getByText(PRESENCE_FINAL, { exact: true }),
      ).toBeVisible();
      const promptTime = await timeline
        .getByText(PRESENCE_PROMPT, { exact: true })
        .locator("xpath=ancestor::li[1]")
        .locator("time")
        .getAttribute("datetime");
      const finalTime = await timeline
        .getByText(PRESENCE_FINAL, { exact: true })
        .locator("xpath=ancestor::li[1]")
        .locator("time")
        .getAttribute("datetime");
      expect(promptTime, "Presence prompt timestamp").not.toBeNull();
      expect(finalTime, "Presence final timestamp").not.toBeNull();
      expect(
        Date.parse(promptTime ?? ""),
        "Presence final must not predate the prompt",
      ).toBeLessThanOrEqual(Date.parse(finalTime ?? ""));
      return;
    }
    case "tasks": {
      const editor = page.getByRole("textbox", { name: "本地任务草稿" });
      await expect(page.locator('[data-storage-phase="ready"]')).toBeVisible();
      await editor.fill(TASK_DRAFT);
      await expect(editor).toHaveValue(TASK_DRAFT);
      return;
    }
    case "workbench":
      await expect(
        page.getByRole("heading", { level: 1, name: "AI 工作台" }),
      ).toBeVisible();
      await expect(
        page.getByText("Studio 投影未启用", { exact: true }),
      ).toBeVisible();
      return;
    case "knowledge":
      await expect(
        page.getByRole("heading", { level: 1, name: "知识" }),
      ).toBeVisible();
      await expect(
        page.getByText("安全只读知识投影未启用。", { exact: true }),
      ).toBeVisible();
      return;
    case "safety":
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: "当前 Web 主机 · 本机可信入口",
        }),
      ).toBeVisible();
      await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);
      await expect(
        page.locator('section[aria-label="本机安全只读证据"]'),
      ).toBeVisible();
  }
}

async function captureLayoutEvidence(
  page: Page,
  domain: Domain,
  viewport: Viewport,
  theme: Theme,
): Promise<MobileLayout> {
  const primary = primaryRegion(page);
  await expect(primary).toBeVisible();

  const evidence = await page.evaluate((): LayoutEvidence => {
    const shell = requireElement<HTMLElement>(
      document.querySelector('[data-route-surface="mobile"]'),
      "mobile shell",
    );
    const header = requireElement<HTMLElement>(
      shell.querySelector(":scope > header"),
      "mobile header",
    );
    const main = requireElement<HTMLElement>(
      shell.querySelector(":scope > main#main-content"),
      "mobile main",
    );
    const nav = requireElement<HTMLElement>(
      shell.querySelector(':scope > nav[aria-label="Mobile 五域"]'),
      "mobile navigation",
    );
    const primaryElement = requireElement<HTMLElement>(
      main.querySelector(":scope > section"),
      "mobile primary region",
    );

    const order = [...shell.children]
      .filter((element) => element === header || element === main || element === nav)
      .map((element) => element.tagName);

    return {
      layout: {
        header: toLayoutRect(header.getBoundingClientRect()),
        main: toLayoutRect(main.getBoundingClientRect()),
        nav: toLayoutRect(nav.getBoundingClientRect()),
        primary: toLayoutRect(primaryElement.getBoundingClientRect()),
      },
      order,
      horizontalOverflow: {
        document: document.documentElement.scrollWidth - window.innerWidth,
        shell: shell.scrollWidth - shell.clientWidth,
        main: main.scrollWidth - main.clientWidth,
        primary: primaryElement.scrollWidth - primaryElement.clientWidth,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };

    function requireElement<T extends Element>(
      element: Element | null,
      label: string,
    ): T {
      if (element === null) throw new Error(`Missing ${label}`);
      return element as T;
    }

    function toLayoutRect(rect: DOMRect): LayoutRect {
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
  });

  const label = `${domain.id} ${viewport.width}x${viewport.height} ${theme}`;
  expect(evidence.viewport, `${label} viewport`).toEqual(viewport);
  expect(evidence.order, `${label} read order`).toEqual([
    "HEADER",
    "MAIN",
    "NAV",
  ]);
  for (const [region, overflow] of Object.entries(evidence.horizontalOverflow)) {
    expect(overflow, `${label} ${region} horizontal clipping`).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX,
    );
  }

  for (const region of ["header", "main", "nav", "primary"] as const) {
    const rect = evidence.layout[region];
    expect(rect.x, `${label} ${region} left edge`).toBeGreaterThanOrEqual(
      -GEOMETRY_TOLERANCE_PX,
    );
    expect(
      rect.x + rect.width,
      `${label} ${region} right edge`,
    ).toBeLessThanOrEqual(viewport.width + GEOMETRY_TOLERANCE_PX);
  }
  expect(evidence.layout.nav.y, `${label} nav top edge`).toBeGreaterThanOrEqual(
    -GEOMETRY_TOLERANCE_PX,
  );
  expect(
    evidence.layout.nav.y + evidence.layout.nav.height,
    `${label} nav bottom edge`,
  ).toBeLessThanOrEqual(viewport.height + GEOMETRY_TOLERANCE_PX);

  return evidence.layout;
}

function primaryRegion(page: Page): Locator {
  return page.locator("main#main-content > section");
}

function requireLayout(
  layouts: ReadonlyMap<Theme, MobileLayout>,
  theme: Theme,
): MobileLayout {
  const layout = layouts.get(theme);
  if (layout === undefined) throw new Error(`Missing ${theme} layout evidence`);
  return layout;
}

function expectThemeGeometryParity(
  dark: MobileLayout,
  light: MobileLayout,
  label: string,
): void {
  for (const region of ["header", "main", "nav", "primary"] as const) {
    for (const property of ["x", "y", "width", "height"] as const) {
      const delta = Math.abs(dark[region][property] - light[region][property]);
      expect(
        delta,
        `${label} ${region}.${property} dark/light delta`,
      ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    }
  }
}
