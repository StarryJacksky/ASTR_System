import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MOCK_CORE_ORIGIN = "http://127.0.0.1:18300";

export async function resetMockCore(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${MOCK_CORE_ORIGIN}/_test/reset`);
  expect(response.ok()).toBe(true);
}

export async function configureMockCore(
  request: APIRequestContext,
  patch: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await request.post(`${MOCK_CORE_ORIGIN}/_test/configure`, {
    data: patch,
  });
  expect(response.ok()).toBe(true);
}

export async function readMockCoreState(
  request: APIRequestContext,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${MOCK_CORE_ORIGIN}/_test/state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function waitForOpenStreams(page: Page): Promise<void> {
  await expect(page.locator("main#main-content")).toHaveAttribute(
    "data-sse-state",
    "reply:open|life:open",
  );
}
