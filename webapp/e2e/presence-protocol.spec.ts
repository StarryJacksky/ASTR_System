import { expect, test, type Page } from "@playwright/test";

import {
  configureMockCore,
  readMockCoreState,
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

for (const testCase of [
  {
    scenario: "delta-before-ack",
    finalText: "ACK 后收束的权威终稿。",
  },
  {
    scenario: "decision-before-ack",
    finalText: "ACK 前到达的权威终稿。",
  },
]) {
  test(`replays matching ${testCase.scenario} truth only after the ingest receipt binds its trace`, async ({
    page,
    request,
  }) => {
  await configureMockCore(request, {
    scenario: testCase.scenario,
    ingestDelayMs: 500,
  });
  await loadPresence(page);
  await sendMessage(page, `测试 ${testCase.scenario}`);

  const reply = replyBubbles(page);
  await page.waitForTimeout(100);
  await expect(reply).toHaveCount(0);
  await expect(page.getByText("发送中；等待 Core 回执或终稿")).toBeVisible();
  await expect(reply).toHaveCount(1);
  await expect(reply).toHaveAttribute("data-message-phase", "settled");
  await expect(reply).toContainText(testCase.finalText);
  const observed = await readMockCoreState(request);
  expect((observed.counts as Record<string, number>).ingest).toBe(1);
  });
}

test("keeps one external decision on ACK failure while preserving the draft", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "ack-failure-external-decision" });
  await loadPresence(page);
  await sendMessage(page, "失败后仍要保留这段草稿");

  const timeline = page.getByRole("list", { name: "对话消息" });
  await expect(timeline.getByText("未绑定 ACK 的外部权威终稿。")).toHaveCount(1);
  await expect(timeline.getByText("外部终稿")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息输入" }))
    .toHaveValue("失败后仍要保留这段草稿");
  await expect(page.getByText("发送失败：ingest returned HTTP 503")).toBeVisible();
  const diagnosticDisclosure = page.getByRole("button", { name: /诊断详情/ });
  await expect(diagnosticDisclosure).toHaveAttribute("aria-expanded", "false");
  await diagnosticDisclosure.click();
  await expect(diagnosticDisclosure).toHaveAttribute("aria-expanded", "true");
  const diagnostics = page.getByRole("list", { name: "最近相关诊断" });
  await expect(diagnostics).toContainText("UNBOUND_STREAM_DROPPED");
  await expect(diagnostics).toContainText("INGEST_FAILED");
  await expect(timeline.getByText("ACK 前无法绑定的临时增量。")).toHaveCount(0);
  const observed = await readMockCoreState(request);
  expect(observed.emitted).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "soul.stream" }),
      expect.objectContaining({ type: "soul.decision" }),
    ]),
  );
});

for (const testCase of [
  {
    scenario: "early-decision",
    finalText: "提前抵达的权威终稿。",
  },
  {
    scenario: "missing-done",
    finalText: "没有 done 的权威终稿。",
  },
]) {
  test(`accepts an authoritative decision for ${testCase.scenario} without fabricating stream completion`, async ({
    page,
    request,
  }) => {
  await configureMockCore(request, { scenario: testCase.scenario });
  await loadPresence(page);
  await sendMessage(page, `测试 ${testCase.scenario}`);

  const reply = replyBubbles(page);
  await expect(reply).toHaveCount(1);
  await expect(reply).toHaveAttribute("data-message-phase", "settled");
  await expect(reply).toContainText(testCase.finalText);
  await expect(page.getByText("回答完成；权威终稿已到达")).toBeVisible();
  });
}

test("keeps a completed provisional stream waiting when no decision exists", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "missing-decision" });
  await loadPresence(page);
  await sendMessage(page, "只收到临时流");

  const reply = replyBubbles(page);
  await expect(reply).toHaveAttribute("data-message-phase", "waitingForFinal");
  await expect(reply).toContainText("只有临时流，没有终稿。");
  await expect(reply.getByText("等待终稿")).toBeVisible();
  await expect(page.getByText("回答完成；权威终稿已到达")).toHaveCount(0);
});

test("times out when no reply frame arrives, then marks the late decision once", async ({
  page,
  request,
}) => {
  test.setTimeout(22_000);
  await configureMockCore(request, { scenario: "late-decision" });
  await loadPresence(page);
  await sendMessage(page, "等待迟到终稿");

  await expect(
    page.getByText("发送失败：No reply frame arrived before the request timeout."),
  ).toBeVisible({ timeout: 12_000 });
  const timeline = page.getByRole("list", { name: "对话消息" });
  await expect(timeline.getByText("迟到但仍具权威性的终稿。")).toHaveCount(1, {
    timeout: 4_000,
  });
  await expect(timeline.getByText("迟到终稿", { exact: true })).toHaveCount(1);
});

test("deduplicates repeated frames, discards malformed data, and lands one decision", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "malformed-duplicate" });
  await loadPresence(page);
  await sendMessage(page, "重复帧测试");

  const timeline = page.getByRole("list", { name: "对话消息" });
  const reply = timeline.locator("[data-message-id^='reply:']");
  await expect(reply).toHaveAttribute("data-message-phase", "provisional");
  await expect(reply).toContainText("唯一增量。");
  await expect(reply).toHaveCount(1);
  await expect(timeline.getByText("重复帧没有复制正文。")).toHaveCount(1);
  await expect(timeline.getByText("唯一增量。")).toHaveCount(0);
  await expect(reply).toHaveCount(1);
});

test("shows an explicit SSE gap while reconnecting and returns to open", async ({
  page,
  request,
}) => {
  await loadPresence(page);
  const beforeDisconnect = await readMockCoreState(request);
  const streamCountBefore = (beforeDisconnect.counts as Record<string, number>).stream ?? 0;

  const disconnected = await request.post("http://127.0.0.1:18300/_test/disconnect");
  expect(disconnected.ok()).toBe(true);
  await expect(page.getByText("回复流中断，正在重连；期间可能存在消息缺口"))
    .toBeVisible();
  await expect(page.locator("main#main-content"))
    .toHaveAttribute("data-sse-state", "reply:open|life:open", { timeout: 10_000 });
  await expect.poll(async () => {
    const reconnected = await readMockCoreState(request);
    return (reconnected.counts as Record<string, number>).stream ?? 0;
  }).toBeGreaterThan(streamCountBefore);
});

async function loadPresence(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "消息输入" });
  await composer.fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
}

function replyBubbles(page: Page) {
  return page.getByRole("list", { name: "对话消息" })
    .locator("[data-message-id^='reply:']");
}
