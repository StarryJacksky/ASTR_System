import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";

import {
  APP_ORIGIN as BASE_URL,
  REMOTE_APP_ORIGIN,
} from "../playwright.config";
import {
  MOCK_CORE_ORIGIN,
  readMockCoreState,
  resetMockCore,
} from "./support/mock-core-client";

const REMOTE_HOSTNAME = "astr-remote.test";
const OPERATION_COUNTERS = [
  "status",
  "ingest",
  "transcribe",
  "stream",
  "effector-status",
  "effector-policy",
  "effector-audit",
] as const;

type OperationCounter = (typeof OPERATION_COUNTERS)[number];
type OperationCounts = Readonly<Record<OperationCounter, number>>;

const ZERO_OPERATION_COUNTS: OperationCounts = Object.freeze({
  status: 0,
  ingest: 0,
  transcribe: 0,
  stream: 0,
  "effector-status": 0,
  "effector-policy": 0,
  "effector-audit": 0,
});

const requestLedger = new WeakMap<Page, Request[]>();
const runtimeIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  await resetMockCore(request);

  const requests: Request[] = [];
  requestLedger.set(page, requests);
  page.on("request", (observed) => requests.push(observed));
  runtimeIssues.set(page, collectRuntimeIssues(page));
});

test.afterEach(async ({ page }) => {
  expect(runtimeIssues.get(page) ?? []).toEqual([]);
});

for (const remoteCase of [
  {
    label: "Presence",
    path: "/mobile/presence",
    phaseSelector:
      "[data-mobile-presence-phase='unavailable-remote-context']",
    gateCopy: "未连接 Core",
  },
  {
    label: "Safety",
    path: "/mobile/safety",
    phaseSelector:
      "[data-mobile-safety-phase='unavailable-remote-context']",
    gateCopy: "当前来源或 Core 目标不是本机可信入口，未读取服务器安全状态",
  },
] as const) {
  test(`fails closed on the absolute remote ${remoteCase.label} route`, async ({
    page,
    request,
  }) => {
    await page.goto(`${REMOTE_APP_ORIGIN}${remoteCase.path}`, {
      waitUntil: "domcontentloaded",
    });

    expect(await page.evaluate(() => window.location.hostname)).toBe(
      REMOTE_HOSTNAME,
    );
    await expect(page.locator(remoteCase.phaseSelector)).toBeVisible();
    await expect(page.getByText(remoteCase.gateCopy, { exact: true })).toBeVisible();

    await expectNoForbiddenAuthorityLinks(page);
    expect(operationRequestsFor(page)).toEqual([]);
    await expectOperationCounts(request, ZERO_OPERATION_COUNTS);
  });
}

test("allows only the documented Presence startup reads and one SSE", async ({
  page,
  request,
}) => {
  await page.goto(`${BASE_URL}/mobile/presence`, {
    waitUntil: "domcontentloaded",
  });

  const connectionFacts = page.getByLabel("Presence 连接事实");
  expect(await connectionFacts.evaluate((element) => element.tagName)).toBe("DL");
  await expect(connectionFacts).not.toHaveAttribute("role");
  await expect(connectionFacts.getByText("可达", { exact: true })).toBeVisible();
  await expect(connectionFacts.getByText("已连接", { exact: true })).toHaveCount(2);

  expect(operationRequestsFor(page)).toEqual([
    "GET direct /v1/stream",
    "GET proxy /v1/effector/status",
    "GET proxy /v1/status",
  ]);
  await expectOperationCounts(request, {
    ...ZERO_OPERATION_COUNTS,
    status: 1,
    stream: 1,
    "effector-status": 1,
  });
});

test("allows only the three documented GET-only Safety reads", async ({
  page,
  request,
}) => {
  await page.goto(`${BASE_URL}/mobile/safety`, {
    waitUntil: "domcontentloaded",
  });

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "当前 Web 主机 · 本机可信入口",
    }),
  ).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(3);

  expect(operationRequestsFor(page)).toEqual([
    "GET proxy /v1/admin/effector/audit",
    "GET proxy /v1/admin/effector/policy",
    "GET proxy /v1/effector/status",
  ]);
  await expectOperationCounts(request, {
    ...ZERO_OPERATION_COUNTS,
    "effector-status": 1,
    "effector-policy": 1,
    "effector-audit": 1,
  });
});

async function expectNoForbiddenAuthorityLinks(page: Page): Promise<void> {
  const forbidden = await page.locator("a[href]").evaluateAll((links) =>
    links
      .map((link) => link.getAttribute("href"))
      .flatMap((href) => {
        if (href === null) return [];
        const pathname = new URL(href, document.baseURI).pathname;
        return pathname === "/" ||
          pathname === "/admin" ||
          pathname.startsWith("/admin/")
          ? [href]
          : [];
      }),
  );
  expect(forbidden).toEqual([]);
}

function operationRequestsFor(page: Page): readonly string[] {
  return (requestLedger.get(page) ?? [])
    .flatMap((request) => {
      const url = new URL(request.url());
      const proxyPrefix = "/api/core";
      if (url.pathname === proxyPrefix || url.pathname.startsWith(`${proxyPrefix}/`)) {
        const path = url.pathname.slice(proxyPrefix.length) || "/";
        return [`${request.method()} proxy ${path}`];
      }
      if (
        url.origin === MOCK_CORE_ORIGIN ||
        isDirectCoreOperationPath(url.pathname)
      ) {
        return [`${request.method()} direct ${url.pathname}`];
      }
      return [];
    })
    .sort();
}

function isDirectCoreOperationPath(pathname: string): boolean {
  return (
    pathname === "/v1/status" ||
    pathname === "/v1/stream" ||
    pathname === "/v1/ingest" ||
    pathname.startsWith("/v1/voice/") ||
    pathname.startsWith("/v1/voiceprint/") ||
    pathname.startsWith("/v1/effector/") ||
    pathname.startsWith("/v1/admin/effector/")
  );
}

async function expectOperationCounts(
  request: APIRequestContext,
  expected: OperationCounts,
): Promise<void> {
  const state = await readMockCoreState(request);
  const rawCounts = isRecord(state.counts) ? state.counts : {};
  const counts = Object.fromEntries(
    OPERATION_COUNTERS.map((key) => [
      key,
      typeof rawCounts[key] === "number" ? rawCounts[key] : 0,
    ]),
  ) as Record<OperationCounter, number>;
  expect(counts).toEqual(expected);
}

function collectRuntimeIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      issues.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  return issues;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
