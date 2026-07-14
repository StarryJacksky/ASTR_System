import {
  expect,
  test,
  type Page,
  type Request,
} from "@playwright/test";

import {
  MOCK_CORE_ORIGIN,
  resetMockCore,
} from "./support/mock-core-client";
import {
  installPresencePerformanceProbe,
  readPresencePerformanceProbe,
} from "./support/performance-evidence";

const PROJECTION_LABELS = [
  "Workspace",
  "Run",
  "Tool",
  "Trace",
  "Source",
  "Artifact",
] as const;

const GATE_COPY = [
  "稳定 authority 与 ownership",
  "认证 principal 与 scopes",
  "通过安全评审的薄只读 endpoints",
] as const;

const EXPECTED_STUDIO_TEXT_NODES = [
  "STUDIO / CONTRACT HORIZON",
  "Studio 投影未启用",
  "缺少已授权 authority、认证 scopes 与只读 endpoints。",
  "没有可验证的 Run、模型路由、成本或产物数据。",
  "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
  "Studio 合同事实",
  "Authority",
  "稳定来源未建立",
  "Identity scope",
  "认证主体与 scopes 未提供",
  "Read contract",
  "只读合同未安装",
  "Request policy",
  "零 Studio 资源请求",
  "PROJECTION REGISTER",
  "Studio 投影分类目录",
  "分类目录，非流程或连接状态",
  "Workspace",
  "未来工作空间证据类型",
  "投影未启用",
  "Run",
  "未来运行证据类型",
  "投影未启用",
  "Tool",
  "未来工具证据类型",
  "投影未启用",
  "Trace",
  "未来轨迹证据类型",
  "投影未启用",
  "Source",
  "未来来源证据类型",
  "投影未启用",
  "Artifact",
  "未来产物证据类型",
  "投影未启用",
  "IMPLEMENTATION GATE",
  "Studio 实施门",
  ...GATE_COPY,
  "当前表面不提供 Run、Approve、Tool 或 Download 操作。",
] as const;

const pageErrors = new WeakMap<Page, string[]>();

interface StudioRuntimeProbeSnapshot {
  readonly canvas: {
    readonly htmlHookInstalled: boolean;
    readonly offscreenSupported: boolean;
    readonly offscreenHookInstalled: boolean;
    readonly calls: readonly {
      readonly surface: "html" | "offscreen";
      readonly kind: string;
      readonly successful: boolean;
    }[];
  };
  readonly webgpu: {
    readonly supported: boolean;
    readonly hookInstalled: boolean;
    readonly requestAdapterCalls: number;
    readonly successfulAdapters: number;
  };
}

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);
  pageErrors.set(page, collectPageErrors(page));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

test("serves one truthful static Studio horizon without business or prefetch requests", async ({
  page,
}) => {
  const ledger = collectForbiddenRequests(page);
  await prepareStudioPage(page, { width: 1440, height: 1000 });

  const response = await page.goto("/studio", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Studio 投影未启用 · 星枢 ASTR");

  const surface = page.locator("[data-route-surface='studio']");
  const main = page.locator("main#main-content");
  await expect(surface).toHaveCount(1);
  await expect(main).toHaveAttribute("data-studio-state", "unavailable");
  await expect(
    page.getByRole("heading", { level: 1, name: "Studio 投影未启用" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("缺少已授权 authority、认证 scopes 与只读 endpoints。"),
  ).toBeVisible();
  await expect(
    page.getByText("没有可验证的 Run、模型路由、成本或产物数据。"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
    ),
  ).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "星枢四空间" });
  const exits = navigation.getByRole("link");
  await expect(exits).toHaveCount(3);
  expect(await exits.evaluateAll((links) =>
    links.map((link) => [link.textContent?.trim(), link.getAttribute("href")]),
  )).toEqual([
    ["Presence", "/"],
    ["Control", "/admin"],
    ["Mobile", "/mobile/presence"],
  ]);
  await expect(navigation.getByText("Studio", { exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(surface.getByRole("button")).toHaveCount(2);
  await expect(surface.getByRole("link")).toHaveCount(3);

  const projectionRegister = page.getByRole("region", {
    name: "Studio 投影分类目录",
  });
  await expect(projectionRegister.getByText("分类目录，非流程或连接状态"))
    .toBeVisible();
  const projectionItems = projectionRegister.getByRole("listitem");
  await expect(projectionItems).toHaveCount(6);
  expect(await projectionItems.evaluateAll((items) =>
    items.map((item) => item.querySelector("strong")?.textContent),
  )).toEqual(PROJECTION_LABELS);
  for (const item of await projectionItems.all()) {
    await expect(item).toContainText("投影未启用");
  }

  const gates = page.getByRole("region", { name: "Studio 实施门" });
  expect(await gates.getByRole("listitem").allTextContents()).toEqual(GATE_COPY);
  await expect(surface.locator("[data-studio-instrument-frame]")).toHaveCount(1);
  await expect(surface.locator("[data-studio-datum]")).toHaveCount(1);
  await expect(surface.locator("[data-studio-contract-gap]")).toHaveCount(1);
  await expect(surface.locator("[data-studio-registration-mark]")).toHaveCount(6);

  await expect(main.locator([
    "a",
    "area",
    "button",
    "form",
    "input",
    "textarea",
    "select",
    "option",
    "details",
    "summary",
    "progress",
    "meter",
    "dialog",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "canvas",
    "[contenteditable]",
    "[tabindex]",
    "[autofocus]",
    "[aria-live]",
    "[aria-busy]",
    "[disabled]",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='option']",
    "[role='switch']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='slider']",
    "[role='spinbutton']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='progressbar']",
  ].join(", "))).toHaveCount(0);
  await expect(main).not.toContainText(
    /暂无|无权读取|(?<!缺少)已授权|运行中|成功|已完成|\$0|示例|重试|下载/,
  );
  expect(await readTextNodes(main)).toEqual(EXPECTED_STUDIO_TEXT_NODES);

  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(ledger.business).toEqual([]);
  expect(ledger.crossSpacePrefetch).toEqual([]);
});

test("keeps the Studio reading order and controls reachable from 320 to 1440 CSS pixels", async ({
  page,
}) => {
  await prepareStudioPage(page, { width: 1440, height: 1000 });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    for (const control of [
      page.getByRole("link", { name: "Presence" }),
      page.getByRole("link", { name: "Control" }),
      page.getByRole("link", { name: "Mobile" }),
      page.getByRole("button", { name: "切换昼夜主题" }),
      page.getByRole("button", { name: /视觉动效/ }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      await expect.poll(() => isInsideHorizontalViewport(control)).toBe(true);
      await control.focus();
      await expect(control).toBeFocused();
    }
  }
});

for (const zoom of [
  { label: "200%", viewport: { width: 640, height: 450 } },
  { label: "400%", viewport: { width: 320, height: 225 } },
] as const) {
  test(`${zoom.label} equivalent remains a complete scrollable truth surface`, async ({
    page,
  }) => {
    await prepareStudioPage(page, zoom.viewport);
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(
      "当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。",
      { exact: true },
    )).toBeVisible();
    await expect(page.locator("[data-studio-registration-mark]")).toHaveCount(6);
    const implementationGate = page.getByRole("region", { name: "Studio 实施门" });
    await expect(implementationGate).toBeVisible();

    if (zoom.label === "400%") {
      expect(await page.evaluate(() =>
        document.documentElement.scrollHeight > document.documentElement.clientHeight
      )).toBe(true);
    }

    for (const control of [
      page.getByRole("link", { name: "Presence" }),
      page.getByRole("link", { name: "Control" }),
      page.getByRole("link", { name: "Mobile" }),
      page.getByRole("button", { name: "切换昼夜主题" }),
      page.getByRole("button", { name: /视觉动效/ }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect.poll(() => isInsideHorizontalViewport(control)).toBe(true);
      await control.focus();
      await expect(control).toBeFocused();
    }

    const finalGate = implementationGate.getByRole("listitem").last();
    await finalGate.scrollIntoViewIfNeeded();
    await expect.poll(() => isInsideVerticalViewport(finalGate)).toBe(true);
    await expect(finalGate).toHaveText("通过安全评审的薄只读 endpoints");
    await expectNoHorizontalOverflow(page);
  });
}

test("owns no renderer, continuous RAF, or active global ambience", async ({ page }) => {
  await page.addInitScript(installStudioRuntimeProbe);
  await page.addInitScript(installPresencePerformanceProbe);
  await prepareStudioPage(page, { width: 1440, height: 1000 });
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-route-surface='studio']")).toBeVisible();

  for (const selector of [".astr-ambient", ".astr-grain"]) {
    await expect.poll(() => page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        backgroundImage: style.backgroundImage,
        display: style.display,
      };
    })).toEqual({ animationName: "none", backgroundImage: "none", display: "none" });
  }

  await page.waitForTimeout(250);
  const studioRuntime = await readStudioRuntimeProbe(page);
  const probe = await readPresencePerformanceProbe(page);
  expect(studioRuntime.canvas.htmlHookInstalled).toBe(true);
  expect(studioRuntime.canvas.offscreenHookInstalled)
    .toBe(studioRuntime.canvas.offscreenSupported);
  expect(studioRuntime.canvas.calls).toEqual([]);
  expect(studioRuntime.webgpu.hookInstalled).toBe(studioRuntime.webgpu.supported);
  expect(studioRuntime.webgpu.requestAdapterCalls).toBe(0);
  expect(studioRuntime.webgpu.successfulAdapters).toBe(0);
  expect(probe.support.raf).toMatchObject({ installed: true, observed: true });
  expect(probe.support.webgl).toMatchObject({ installed: true, observed: true });
  expect(probe.raf.active).toBe(0);
  expect(probe.dom.canvasCount).toBe(0);
  expect(Math.max(...probe.webgl.contextCountSamples)).toBe(0);
  expect(Math.max(...probe.webgl.successfulContextCreationSamples)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === "running" && timing?.iterations === Number.POSITIVE_INFINITY;
  }).length)).toBe(0);
});

test("keeps the unavailable verdict in the server response without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto("/studio", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Studio 投影未启用" }))
      .toBeVisible();
    await expect(page.getByText("分类目录，非流程或连接状态")).toBeVisible();
    await expect(page.locator("[data-studio-registration-mark]")).toHaveCount(6);
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});

async function prepareStudioPage(
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

function collectForbiddenRequests(page: Page): {
  readonly business: string[];
  readonly crossSpacePrefetch: string[];
} {
  const business: string[] = [];
  const crossSpacePrefetch: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    const isCoreOrigin = url.origin === MOCK_CORE_ORIGIN;
    const isBusinessPath = /^\/(?:v1|api\/core)(?:\/|$)/.test(url.pathname);
    if (isCoreOrigin || isBusinessPath) business.push(formatRequest(request));

    const isPrefetch = headers["next-router-prefetch"] === "1" ||
      headers.purpose === "prefetch" ||
      headers["sec-purpose"]?.includes("prefetch") === true;
    const targetsAnotherSpace = url.pathname === "/" ||
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/mobile");
    if (isPrefetch && targetsAnotherSpace) {
      crossSpacePrefetch.push(formatRequest(request));
    }
  });
  return { business, crossSpacePrefetch };
}

function formatRequest(request: Request): string {
  return `${request.method()} ${request.url()}`;
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const surface = document.querySelector("[data-route-surface='studio']");
    const main = document.querySelector("main#main-content");
    return {
      document: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      main: main instanceof HTMLElement
        ? Math.max(0, main.scrollWidth - main.clientWidth)
        : Number.POSITIVE_INFINITY,
      surface: surface instanceof HTMLElement
        ? Math.max(0, surface.scrollWidth - surface.clientWidth)
        : Number.POSITIVE_INFINITY,
    };
  })).toEqual({ document: 0, main: 0, surface: 0 });
}

async function isInsideHorizontalViewport(control: ReturnType<Page["locator"]>): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
  });
}

async function isInsideVerticalViewport(control: ReturnType<Page["locator"]>): Promise<boolean> {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= -0.5 && bounds.bottom <= window.innerHeight + 0.5;
  });
}

async function readTextNodes(root: ReturnType<Page["locator"]>): Promise<string[]> {
  return root.evaluate((element) => {
    const values: string[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent?.replace(/\s+/g, " ").trim();
        if (value) values.push(value);
        return;
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return values;
  });
}

function installStudioRuntimeProbe(): void {
  const state: {
    canvas: {
      htmlHookInstalled: boolean;
      offscreenSupported: boolean;
      offscreenHookInstalled: boolean;
      calls: Array<{
        surface: "html" | "offscreen";
        kind: string;
        successful: boolean;
      }>;
    };
    webgpu: {
      supported: boolean;
      hookInstalled: boolean;
      requestAdapterCalls: number;
      successfulAdapters: number;
    };
  } = {
    canvas: {
      htmlHookInstalled: false,
      offscreenSupported: false,
      offscreenHookInstalled: false,
      calls: [],
    },
    webgpu: {
      supported: false,
      hookInstalled: false,
      requestAdapterCalls: 0,
      successfulAdapters: 0,
    },
  };

  Object.defineProperty(window, "__astrStudioRuntimeProbe", {
    configurable: false,
    enumerable: false,
    value: state,
    writable: false,
  });

  const patchGetContext = (
    prototype: object,
    surface: "html" | "offscreen",
  ): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "getContext");
    if (!descriptor || typeof descriptor.value !== "function") return false;
    const original = descriptor.value as (...args: unknown[]) => unknown;

    try {
      Object.defineProperty(prototype, "getContext", {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          const record = {
            surface,
            kind: typeof args[0] === "string" ? args[0].toLowerCase() : "",
            successful: false,
          };
          state.canvas.calls.push(record);
          const result = Reflect.apply(original, this, args);
          record.successful = result !== null && result !== undefined;
          return result;
        },
      });
      return true;
    } catch {
      return false;
    }
  };

  state.canvas.htmlHookInstalled = patchGetContext(
    HTMLCanvasElement.prototype,
    "html",
  );

  const offscreenConstructor = Reflect.get(globalThis, "OffscreenCanvas");
  if (typeof offscreenConstructor === "function") {
    state.canvas.offscreenSupported = true;
    const prototype = Reflect.get(offscreenConstructor, "prototype");
    if (prototype && typeof prototype === "object") {
      state.canvas.offscreenHookInstalled = patchGetContext(
        prototype,
        "offscreen",
      );
    }
  }

  let gpu: unknown;
  try {
    gpu = Reflect.get(navigator, "gpu");
  } catch {
    gpu = undefined;
  }
  if ((typeof gpu !== "object" || gpu === null) && typeof gpu !== "function") {
    return;
  }

  let owner: object | null = gpu;
  let descriptor: PropertyDescriptor | undefined;
  while (owner !== null && descriptor === undefined) {
    descriptor = Object.getOwnPropertyDescriptor(owner, "requestAdapter");
    if (descriptor === undefined) owner = Object.getPrototypeOf(owner);
  }
  if (!owner || !descriptor || typeof descriptor.value !== "function") return;

  state.webgpu.supported = true;
  const originalRequestAdapter = descriptor.value as (...args: unknown[]) => unknown;
  try {
    Object.defineProperty(owner, "requestAdapter", {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]) {
        state.webgpu.requestAdapterCalls += 1;
        const result = Reflect.apply(originalRequestAdapter, this, args);
        void Promise.resolve(result).then(
          (adapter) => {
            if (adapter !== null && adapter !== undefined) {
              state.webgpu.successfulAdapters += 1;
            }
          },
          () => undefined,
        );
        return result;
      },
    });
    state.webgpu.hookInstalled = true;
  } catch {
    state.webgpu.hookInstalled = false;
  }
}

async function readStudioRuntimeProbe(page: Page): Promise<StudioRuntimeProbeSnapshot> {
  return page.evaluate(() => {
    const snapshot = Reflect.get(window, "__astrStudioRuntimeProbe");
    if (!snapshot) throw new Error("Studio Canvas/WebGPU runtime probe is unavailable");
    return structuredClone(snapshot) as StudioRuntimeProbeSnapshot;
  });
}
