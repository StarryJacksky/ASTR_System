import { expect, test, type Page } from "@playwright/test";

import { resetMockCore } from "./support/mock-core-client";

const SURFACES = [
  {
    label: "Presence",
    path: "/",
    readySelector: "main#main-content[data-presence-layout]",
  },
  {
    label: "Control",
    path: "/admin",
    readySelector: "[data-route-surface='control']",
  },
] as const;

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("astr.visual-motion", "paused");
  });
});

for (const surface of SURFACES) {
  test(`${surface.label} does not idle-prefetch the Studio route`, async ({
    page,
  }) => {
    const studioPrefetches = collectStudioPrefetchRequests(page);

    await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(surface.readySelector)).toBeVisible();
    await expect(page.getByRole("link", { name: "Studio" })).toHaveAttribute(
      "href",
      "/studio",
    );

    await settleHydrationAndIdle(page);

    expect(studioPrefetches).toEqual([]);
  });
}

function collectStudioPrefetchRequests(page: Page): string[] {
  const requests: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    const pathname = decodeURIComponent(url.pathname);
    const targetsStudioRoute =
      pathname === "/studio" || pathname.startsWith("/studio/");
    const targetsNamedStudioChunk =
      pathname.startsWith("/_next/") &&
      /(?:^|[/._-])studio(?:[/._-]|$)/i.test(pathname);

    if (targetsStudioRoute || targetsNamedStudioChunk) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  });

  return requests;
}

async function settleHydrationAndIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset.visualMotion === "paused",
  );
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 500 });
        return;
      }
      window.setTimeout(resolve, 50);
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  await page.waitForTimeout(500);
}
