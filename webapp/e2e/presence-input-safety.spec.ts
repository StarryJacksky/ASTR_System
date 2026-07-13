import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  configureMockCore,
  readMockCoreState,
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test("preserves the exact draft and selection after ingest returns HTTP 503", async ({
  page,
  request,
}) => {
  await configureMockCore(request, { scenario: "ack-failure-external-decision" });
  await loadPresence(page);
  const composer = page.getByRole("textbox", { name: "消息输入" });
  const draft = "失败后完整保留这段草稿";

  await composer.fill(draft);
  await composer.press("Home");
  for (let index = 0; index < 3; index += 1) await composer.press("ArrowRight");
  for (let index = 3; index < 10; index += 1) {
    await composer.press("Shift+ArrowRight");
  }
  expect(
    await composer.evaluate((textarea: HTMLTextAreaElement) => ({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    })),
  ).toEqual({ start: 3, end: 10 });
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(
    page.getByRole("region", { name: "对话输入" })
      .getByText("发送失败：ingest returned HTTP 503"),
  ).toBeVisible();
  await expect(composer).toHaveValue(draft);
  await expect(composer).toBeFocused();
  await expect
    .poll(() =>
      composer.evaluate((textarea: HTMLTextAreaElement) => ({
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      })),
    )
    .toEqual({ start: 3, end: 10 });
});

test("does not send during composition and sends exactly once after compositionend", async ({
  page,
  request,
}) => {
  await loadPresence(page);
  const composer = page.getByRole("textbox", { name: "消息输入" });

  await composer.fill("拼音输入只发送一次");
  await composer.focus();
  await composer.dispatchEvent("compositionstart");
  await composer.evaluate((textarea) => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await page.waitForTimeout(250);
  expect(await mockCount(request, "ingest")).toBeUndefined();

  await composer.dispatchEvent("compositionend");
  await composer.press("Enter");

  await expect.poll(() => mockCount(request, "ingest")).toBe(1);
});

test("reports a denied microphone permission", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
  });
  await loadPresence(page);
  const startVoice = page.getByRole("button", { name: "开始语音输入" });

  await expect(startVoice).toBeEnabled();
  await startVoice.click();

  await expect(page.getByText("麦克风权限被拒绝")).toBeVisible();
});

test("records and transcribes into the textarea without automatically ingesting", async ({
  page,
  request,
}) => {
  await installMinimalAudioFake(page);
  await configureMockCore(request, { transcription: "只回填，不自动发送" });
  await loadPresence(page);
  const composer = page.getByRole("textbox", { name: "消息输入" });
  const startVoice = page.getByRole("button", { name: "开始语音输入" });

  await expect(startVoice).toBeEnabled();
  await startVoice.click();
  await page.getByRole("button", { name: "停止并转写" }).click();

  await expect(composer).toHaveValue("只回填，不自动发送");
  await expect(page.getByText("转写已回填，请确认后发送")).toBeVisible();
  await expect.poll(() => mockCount(request, "transcribe")).toBe(1);
  await page.waitForTimeout(250);
  expect(await mockCount(request, "ingest")).toBeUndefined();
});

for (const testCase of [
  {
    label: "clear",
    effector: { stopped: false },
    expected: "执行层未闩锁",
  },
  {
    label: "latched",
    effector: { stopped: true },
    expected: "急停已闩锁",
  },
  {
    label: "HTTP failure as unknown",
    effector: { statusMode: "http-error" },
    expected: "安全操作结果未知，执行层状态可能不一致",
  },
] as const) {
  test(`maps startup safety ${testCase.label}`, async ({ page, request }) => {
    await configureMockCore(request, { effector: testCase.effector });
    await loadPresence(page);

    await expectSafety(page, testCase.expected);
    await expect.poll(() => mockCount(request, "effector-status")).toBe(1);
  });
}

test("shows startup safety checking until the authoritative status readback arrives", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    effector: { stopped: false, statusDelayMs: 3_000 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expectSafety(page, "安全状态核验中", { timeout: 1_000 });
  await waitForOpenStreams(page);
  await expectSafety(page, "执行层未闩锁", { timeout: 5_000 });
});

test("latches only after an e-stop acknowledgement and authoritative true readback", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    effector: { stopped: false, estopAck: true, estopReadback: true },
  });
  await loadPresence(page);
  await expectSafety(page, "执行层未闩锁");

  await page.getByRole("button", { name: "触发急停" }).click();

  await expect.poll(() => mockCount(request, "estop")).toBe(1);
  await expect.poll(() => mockCount(request, "effector-status")).toBe(2);
  await expectSafety(page, "急停已闩锁");
});

test("lets an authoritative true readback override a contrary e-stop acknowledgement", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    effector: { stopped: false, estopAck: false, estopReadback: true },
  });
  await loadPresence(page);

  await page.getByRole("button", { name: "触发急停" }).click();

  await expectSafety(page, "急停已闩锁");
});

test("marks an e-stop contrary false readback as unknown", async ({ page, request }) => {
  await configureMockCore(request, {
    effector: { stopped: false, estopAck: true, estopReadback: false },
  });
  await loadPresence(page);
  await expectSafety(page, "执行层未闩锁");

  await page.getByRole("button", { name: "触发急停" }).click();

  await expect.poll(() => mockCount(request, "estop")).toBe(1);
  await expect.poll(() => mockCount(request, "effector-status")).toBe(2);
  await expectSafety(page, "安全操作结果未知，执行层状态可能不一致");
});

test("marks an e-stop readback HTTP failure as unknown", async ({ page, request }) => {
  await loadPresence(page);
  await expectSafety(page, "执行层未闩锁");
  await configureMockCore(request, { effector: { statusMode: "http-error" } });

  await page.getByRole("button", { name: "触发急停" }).click();

  await expect.poll(() => mockCount(request, "estop")).toBe(1);
  await expect.poll(() => mockCount(request, "effector-status")).toBe(2);
  await expectSafety(page, "安全操作结果未知，执行层状态可能不一致");
});

test("clears a latched stop only after reset reads back false", async ({ page, request }) => {
  await configureMockCore(request, {
    effector: { stopped: true, resetAck: false, resetReadback: false },
  });
  await loadPresence(page);
  await expectSafety(page, "急停已闩锁");

  await page.getByRole("button", { name: "复位急停" }).click();

  await expect.poll(() => mockCount(request, "reset")).toBe(1);
  await expect.poll(() => mockCount(request, "effector-status")).toBe(2);
  await expectSafety(page, "执行层未闩锁");
  await expect(page.getByRole("button", { name: "复位急停" })).toHaveCount(0);
});

test("lets an authoritative clear readback override a contrary reset acknowledgement", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    effector: { stopped: true, resetAck: true, resetReadback: false },
  });
  await loadPresence(page);

  await page.getByRole("button", { name: "复位急停" }).click();

  await expectSafety(page, "执行层未闩锁");
});

test("keeps reset latched when the authoritative readback remains true", async ({
  page,
  request,
}) => {
  await configureMockCore(request, {
    effector: { stopped: true, resetAck: false, resetReadback: true },
  });
  await loadPresence(page);
  await expectSafety(page, "急停已闩锁");

  await page.getByRole("button", { name: "复位急停" }).click();

  await expect.poll(() => mockCount(request, "reset")).toBe(1);
  await expect.poll(() => mockCount(request, "effector-status")).toBe(2);
  await expectSafety(page, "急停已闩锁");
  await expect(page.getByRole("button", { name: "复位急停" })).toBeVisible();
});

async function loadPresence(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
}

async function expectSafety(
  page: Page,
  text: string,
  options?: { readonly timeout?: number },
): Promise<void> {
  await expect(page.getByRole("group", { name: "执行安全状态" }))
    .toContainText(text, options);
}

async function mockCount(
  request: APIRequestContext,
  key: string,
): Promise<number | undefined> {
  const state = await readMockCoreState(request);
  return (state.counts as Record<string, number>)[key];
}

async function installMinimalAudioFake(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const track = { stop() {} };
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });

    class FakeAudioContext {
      readonly sampleRate: number;
      readonly destination = {};

      constructor(options?: AudioContextOptions) {
        this.sampleRate = options?.sampleRate ?? 16_000;
      }

      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }

      createScriptProcessor() {
        return { onaudioprocess: null, connect() {}, disconnect() {} };
      }

      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }

      async close() {}
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
  });
}
