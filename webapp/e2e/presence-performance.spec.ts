import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  assertPresenceEvidenceSchema,
  beginPresenceInactiveRafWindow,
  buildPresenceEvidence,
  clearPresenceLongTaskSamples,
  collectLensProductionChunkPaths,
  collectVisualProductionChunkPaths,
  createCumulativeVisualTransferSamples,
  installPresencePerformanceProbe,
  measureLensGzipBytes,
  readPresencePerformanceProbe,
  readPresenceVisualManifestChunkPaths,
  writePresenceEvidenceArtifact,
  writePresenceRawDiagnosticsArtifact,
  writePresenceSoakArtifact,
  type PresencePerformanceProbeSnapshot,
} from "./support/performance-evidence";
import { evaluatePresenceBudgets } from "./support/budget-evaluator";
import {
  configureMockCore,
  resetMockCore,
  waitForOpenStreams,
} from "./support/mock-core-client";

const TEN_MEBIBYTES = 10 * 1024 * 1024;
const INACTIVE_SETTLE_MS = 250;
const TEN_SECOND_WINDOW_MS = 10_000;

test.beforeEach(async ({ request }) => {
  await resetMockCore(request);
});

test("captures raw desktop/mobile performance samples and writes strict evidence artifacts", async ({
  browser,
  request,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const mobile = await openInstrumentedPage(browser, { width: 390, height: 844 });
  const desktop = await openInstrumentedPage(browser, { width: 1440, height: 900 });

  try {
    await loadPresence(mobile.page);
    await configureMockCore(request, { scenario: "slow-stream" });
    await clearPresenceLongTaskSamples(mobile.page);
    await runTenSecondStream(mobile.page, "mobile stream evidence");
    const mobileStreamProbe = await readPresencePerformanceProbe(mobile.page);
    assertTenSecondStreamWindow(mobileStreamProbe);
    const mobileInactiveProbe = await captureInactiveRafStateWindows(mobile.page);
    const mobileProbe = withInactiveWindows(mobileStreamProbe, mobileInactiveProbe);
    expect(
      mobileProbe.resources.filter((resource) => resource.name.includes(".2048/texture_")),
    ).toEqual([]);
    expect(mobileProbe.dom.canvasCount).toBe(0);
    expect(Math.max(...mobileProbe.webgl.contextCountSamples)).toBe(0);

    await loadPresence(desktop.page);
    await waitForVisualAttemptToSettle(desktop.page);
    await configureMockCore(request, { scenario: "slow-stream" });
    await clearPresenceLongTaskSamples(desktop.page);
    await runTenSecondStream(desktop.page, "desktop stream evidence");
    const desktopStreamProbe = await readPresencePerformanceProbe(desktop.page);
    assertTenSecondStreamWindow(desktopStreamProbe);
    const desktopInactiveProbe = await captureInactiveRafStateWindows(desktop.page);
    const desktopProbe = withInactiveWindows(desktopStreamProbe, desktopInactiveProbe);

    const manifestVisualChunkPaths = await readPresenceVisualManifestChunkPaths();
    const visualProductionChunks = await collectVisualProductionChunkPaths(
      desktopProbe.resources,
      mobileProbe.resources,
      manifestVisualChunkPaths,
    );
    expect(visualProductionChunks.length).toBeGreaterThan(0);
    const lensProductionChunks = await collectLensProductionChunkPaths(
      desktopProbe.resources,
      mobileProbe.resources,
    );
    const lensGzipBytes = await measureLensGzipBytes(lensProductionChunks);
    const mobileEvidence = buildProfileEvidence(
      "mobile",
      mobileProbe,
      createCumulativeVisualTransferSamples(mobileProbe.resources, {
        manifestVisualChunkPaths,
      }),
      lensGzipBytes,
      {
        browser: await browser.version(),
        viewport: { width: 390, height: 844 },
        page: mobile.page,
      },
    );
    const desktopEvidence = buildProfileEvidence(
      "desktop",
      desktopProbe,
      createCumulativeVisualTransferSamples(desktopProbe.resources, {
        baselineResources: mobileProbe.resources,
        manifestVisualChunkPaths,
      }),
      lensGzipBytes,
      {
        browser: await browser.version(),
        viewport: { width: 1440, height: 900 },
        page: desktop.page,
      },
    );

    const mobileArtifact = await writePresenceEvidenceArtifact(mobileEvidence);
    const desktopArtifact = await writePresenceEvidenceArtifact(desktopEvidence);
    const mobileRaw = await writePresenceRawDiagnosticsArtifact(
      "mobile",
      mobileEvidence.renderPath,
      mobileProbe,
    );
    const desktopRaw = await writePresenceRawDiagnosticsArtifact(
      "desktop",
      desktopEvidence.renderPath,
      desktopProbe,
    );
    await testInfo.attach("presence-mobile-evidence", {
      path: mobileArtifact,
      contentType: "application/json",
    });
    await testInfo.attach("presence-desktop-evidence", {
      path: desktopArtifact,
      contentType: "application/json",
    });
    await testInfo.attach("presence-mobile-raw", {
      path: mobileRaw,
      contentType: "application/json",
    });
    await testInfo.attach("presence-desktop-raw", {
      path: desktopRaw,
      contentType: "application/json",
    });

    assertPresenceEvidenceSchema(mobileEvidence);
    assertPresenceEvidenceSchema(desktopEvidence);
    for (const evidence of [mobileEvidence, desktopEvidence]) {
      const evaluation = evaluatePresenceBudgets(evidence);
      expect(
        evaluation.results
          .filter((result) => result.gate === "automated")
          .every((result) =>
            result.status === "passed" || result.status === "not-applicable",
          ),
        evaluation.issues.join("\n"),
      ).toBe(true);
      expect(evaluation.passed, evaluation.issues.join("\n")).toBe(true);
      expect(evaluation.certificationComplete).toBe(false);
    }
    expect(desktopEvidence.renderPath).toBe("static-fallback");
    expect(desktopEvidence.dynamicCertification.status).toBe("failed");
  } finally {
    await desktop.context.close();
    await mobile.context.close();
  }
});

test("@soak records opt-in heap/GC raw samples and enforces post-GC growth below 10MiB", async ({
  context,
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env.ASTR_PRESENCE_SOAK_ENABLED !== "1",
    "30-minute Presence soak is opt-in.",
  );
  const durationMs = readPositiveInteger(
    process.env.ASTR_PRESENCE_SOAK_DURATION_MS,
    10_000,
  );
  testInfo.setTimeout(durationMs + 120_000);
  await page.addInitScript(installPresencePerformanceProbe);
  await configureMockCore(request, { scenario: "slow-stream" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);

  const heapSamples: number[] = [];
  let session: Awaited<ReturnType<typeof context.newCDPSession>> | null = null;
  let support: "measured" | "unsupported" = "measured";
  let notes: string | undefined;
  try {
    session = await context.newCDPSession(page);
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.collectGarbage");
    heapSamples.push((await session.send("Runtime.getHeapUsage")).usedSize);
  } catch (error) {
    support = "unsupported";
    notes = error instanceof Error ? error.message : String(error);
    session = null;
  }

  const deadline = Date.now() + durationMs;
  let submission = 0;
  while (Date.now() < deadline) {
    const send = page
      .locator("#presence-message-input")
      .locator("xpath=ancestor::section[1]")
      .locator("button")
      .last();
    if (await send.isEnabled()) {
      submission += 1;
      await page.locator("#presence-message-input").fill(`soak-${submission}`);
      await send.click();
    }
    if (session !== null) {
      heapSamples.push((await session.send("Runtime.getHeapUsage")).usedSize);
    }
    await page.waitForTimeout(Math.min(1_000, Math.max(1, deadline - Date.now())));
  }

  let postGcGrowthBytes: number | null = null;
  if (session !== null && heapSamples.length > 0) {
    await session.send("HeapProfiler.collectGarbage");
    const finalHeap = (await session.send("Runtime.getHeapUsage")).usedSize;
    heapSamples.push(finalHeap);
    postGcGrowthBytes = finalHeap - heapSamples[0];
  }
  const artifact = await writePresenceSoakArtifact({
    capturedAt: new Date().toISOString(),
    durationMs,
    heap: {
      status: support,
      unit: "bytes",
      samples: heapSamples,
      postGcGrowthBytes,
      limitBytes: TEN_MEBIBYTES,
      comparator: "less-than",
      ...(notes === undefined ? {} : { notes }),
    },
  });
  await testInfo.attach("presence-soak-evidence", {
    path: artifact,
    contentType: "application/json",
  });

  if (support === "unsupported") {
    testInfo.annotations.push({
      type: "unsupported",
      description: "CDP heap/explicit GC is unavailable; soak is not certified.",
    });
    expect(postGcGrowthBytes).toBeNull();
    return;
  }
  expect(postGcGrowthBytes).not.toBeNull();
  expect(postGcGrowthBytes as number).toBeLessThan(TEN_MEBIBYTES);
});

function buildProfileEvidence(
  profile: "desktop" | "mobile",
  probe: PresencePerformanceProbeSnapshot,
  transferSamples: readonly number[],
  lensGzipBytes: number,
  facts: {
    readonly browser: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly page: Page;
  },
) {
  const activeJewelCount = probe.dom.activeJewelCountSamples.length === 0
    ? [0]
    : probe.dom.activeJewelCountSamples;
  const dynamicCertified = probe.dom.visualPhase === "ready" && probe.dom.canvasCount === 1;
  const renderPath = dynamicCertified ? "dynamic" : "static-fallback";
  expect(probe.support.raf).toMatchObject({
    supported: true,
    installed: true,
    observed: true,
  });
  expect(probe.support.webgl).toMatchObject({
    supported: true,
    installed: true,
    observed: true,
  });
  expect(probe.support.canvas.installed).toBe(true);
  const backingDprSamples = probe.canvasBackingSizeSamples.map(({ dpr }) => dpr);
  if (dynamicCertified) {
    expect(probe.support.canvas.observed).toBe(true);
    expect(probe.canvasBackingSizeSamples.length).toBeGreaterThan(0);
    expect(backingDprSamples.length).toBeGreaterThan(0);
  } else {
    expect(probe.dom.canvasCount).toBe(0);
    expect(probe.webgl.contextCountSamples.at(-1)).toBe(0);
    for (const sample of probe.canvasBackingSizeSamples) {
      expect(sample.backingWidth / sample.clientWidth).toBeLessThanOrEqual(
        profile === "mobile" ? 1.25 : 1.5,
      );
      expect(sample.backingHeight / sample.clientHeight).toBeLessThanOrEqual(
        profile === "mobile" ? 1.25 : 1.5,
      );
    }
  }
  const longTaskObserved =
    probe.support.longTask.supported &&
    probe.support.longTask.installed &&
    probe.support.longTask.observed;
  const longTaskSamples = longTaskObserved
    ? probe.longTaskDurationMs.length === 0
      ? [0]
      : probe.longTaskDurationMs
    : undefined;
  const inactiveRafStates = Object.fromEntries(
    Object.entries(probe.raf.inactiveWindows).map(([state, window]) => [
      state,
      window.status === "measured"
        ? {
            status: "measured" as const,
            samples: window.samples,
          }
        : {
            status: window.status,
            notes: window.notes,
          },
    ]),
  ) as Parameters<typeof buildPresenceEvidence>[0]["inactiveRafStates"];
  const evidence = buildPresenceEvidence({
    profile,
    renderPath,
    environment: {
      browser: `Chromium ${facts.browser}`,
      os: probe.environment.platform,
      cpu: `${probe.environment.hardwareConcurrency} logical processors`,
      viewport: facts.viewport,
      devicePixelRatio: probe.environment.devicePixelRatio,
      throttle: "none",
    },
    samples: {
      "webgl-context-count": probe.webgl.contextCountSamples,
      "active-raf-count": probe.raf.samples,
      ...(dynamicCertified
        ? { "device-pixel-ratio": backingDprSamples }
        : {}),
      "draw-calls": probe.webgl.drawCallSamples,
      triangles: probe.webgl.triangleSamples,
      "texture-rt-bytes": probe.webgl.textureRtByteSamples,
      "visual-transfer-bytes": transferSamples,
      "active-jewel-count": activeJewelCount,
      "lens-gzip-bytes": [lensGzipBytes],
      ...(longTaskSamples === undefined
        ? {}
        : { "stream-long-task-duration-ms": longTaskSamples }),
    },
    inactiveRafStates,
    ...(!dynamicCertified || longTaskSamples === undefined
      ? {
          unavailable: {
            ...(!dynamicCertified
              ? {
                  "device-pixel-ratio": {
                    status: "not-applicable" as const,
                    notes:
                      "Static fallback created no renderer canvas or backing store; no DPR ratio was invented.",
                  },
                }
              : {}),
            ...(longTaskSamples === undefined
              ? {
            "stream-long-task-duration-ms": {
              status: "unsupported" as const,
              notes:
                "PerformanceObserver longtask support or observation was unavailable; no zero sample was manufactured.",
            },
                }
              : {}),
          },
        }
      : {}),
    dynamicCertification:
      profile === "mobile"
        ? {
            status: "not-run",
            notes: "Compact static path intentionally does not initialize Live2D.",
          }
        : dynamicCertified
          ? { status: "passed", notes: "Live2D and Lens reached the ready phase." }
          : {
              status: "failed",
              notes: `Dynamic visual did not certify: phase=${probe.dom.visualPhase}, canvas=${probe.dom.canvasCount}. Static-path measurements remain real.`,
            },
  });
  return evidence;
}

async function openInstrumentedPage(
  browser: Browser,
  viewport: { readonly width: number; readonly height: number },
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext({ locale: "zh-CN", viewport });
  await context.addInitScript(installPresencePerformanceProbe);
  return { context, page: await context.newPage() };
}

async function loadPresence(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:3100/", { waitUntil: "domcontentloaded" });
  await waitForOpenStreams(page);
}

async function waitForVisualAttemptToSettle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator("[data-presence-visual-host]").getAttribute("data-visual-phase"),
    )
    .toMatch(/^(loading|ready|static)$/);
  await expect
    .poll(() =>
      page.locator("[data-presence-visual-host]").getAttribute("data-visual-phase"),
    )
    .not.toBe("loading");
}

async function runTenSecondStream(page: Page, message: string): Promise<void> {
  const composer = page.locator("#presence-message-input");
  await composer.fill(message);
  await composer.locator("xpath=ancestor::section[1]").locator("button").last().click();
  await expect(page.locator("[data-message-id^='reply:']"))
    .toHaveAttribute("data-message-phase", "settled", { timeout: 15_000 });
}

function assertTenSecondStreamWindow(
  probe: PresencePerformanceProbeSnapshot,
): void {
  expect(probe.longTaskWindow.startTime).not.toBeNull();
  if (probe.longTaskWindow.startTime === null) {
    throw new Error("The ten-second stream observation window was not started.");
  }
  expect(
    probe.longTaskWindow.endTime - probe.longTaskWindow.startTime,
  ).toBeGreaterThanOrEqual(TEN_SECOND_WINDOW_MS);
}

async function captureInactiveRafStateWindows(
  page: Page,
): Promise<PresencePerformanceProbeSnapshot> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "reduced",
  );
  await page.waitForTimeout(INACTIVE_SETTLE_MS);
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
  await beginPresenceInactiveRafWindow(page, "reduced-motion");
  await page.waitForTimeout(TEN_SECOND_WINDOW_MS);
  const reducedProbe = await readPresencePerformanceProbe(page);
  assertMeasuredInactiveWindow(reducedProbe, "reduced-motion");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "full",
  );
  await page.locator(".astr-motion-toggle").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "paused",
  );
  await page.waitForTimeout(INACTIVE_SETTLE_MS);
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
  await beginPresenceInactiveRafWindow(page, "paused");
  await page.waitForTimeout(TEN_SECOND_WINDOW_MS);
  const pausedProbe = await readPresencePerformanceProbe(page);
  assertMeasuredInactiveWindow(pausedProbe, "paused");

  await page.locator(".astr-motion-toggle").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-motion",
    "full",
  );
  await page.locator("main#main-content").evaluate((main) => {
    (main as HTMLElement).style.transform = "translateY(200vh)";
  });
  expect(await waitForOffscreenIntersection(page)).toBe(true);
  await page.waitForTimeout(INACTIVE_SETTLE_MS);
  expect((await readPresencePerformanceProbe(page)).raf.active).toBe(0);
  await beginPresenceInactiveRafWindow(page, "offscreen");
  await page.waitForTimeout(TEN_SECOND_WINDOW_MS);
  const offscreenProbe = await readPresencePerformanceProbe(page);
  assertMeasuredInactiveWindow(offscreenProbe, "offscreen");

  return {
    ...offscreenProbe,
    raf: {
      ...offscreenProbe.raf,
      inactiveWindows: {
        "reduced-motion": reducedProbe.raf.inactiveWindows["reduced-motion"],
        paused: pausedProbe.raf.inactiveWindows.paused,
        offscreen: offscreenProbe.raf.inactiveWindows.offscreen,
        hidden: {
          status: "unsupported",
          notes:
            "Headless Chromium cannot enter a genuine hidden-page lifecycle; runtime smoke records this as incomplete.",
        },
      },
    },
  };
}

function assertMeasuredInactiveWindow(
  probe: PresencePerformanceProbeSnapshot,
  state: "reduced-motion" | "paused" | "offscreen",
): void {
  const window = probe.raf.inactiveWindows[state];
  expect(window.status).toBe("measured");
  if (window.status !== "measured") {
    throw new Error(`${state} inactive RAF observation window was not started.`);
  }
  expect(window.endTime - window.startTime).toBeGreaterThanOrEqual(
    TEN_SECOND_WINDOW_MS,
  );
  expect(window.samples.length).toBeGreaterThan(0);
  expect(Math.max(...window.samples)).toBe(0);
}

function withInactiveWindows(
  streamProbe: PresencePerformanceProbeSnapshot,
  inactiveProbe: PresencePerformanceProbeSnapshot,
): PresencePerformanceProbeSnapshot {
  return {
    ...streamProbe,
    raf: {
      ...streamProbe.raf,
      inactiveWindows: inactiveProbe.raf.inactiveWindows,
    },
  };
}

async function waitForOffscreenIntersection(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    new Promise<boolean>((resolve) => {
      const target = document.querySelector("main#main-content");
      if (target === null || typeof IntersectionObserver !== "function") {
        resolve(false);
        return;
      }
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 5_000);
      const observer = new IntersectionObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === target);
        if (entry === undefined || entry.isIntersecting) return;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(true);
      });
      observer.observe(target);
    }),
  );
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("ASTR_PRESENCE_SOAK_DURATION_MS must be a positive integer.");
  }
  return parsed;
}
