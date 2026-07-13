import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertPresenceEvidenceSchema,
  assertPresenceRawDiagnosticsSchema,
  buildPresenceEvidence,
  collectLensProductionChunkPaths,
  collectVisualProductionChunkPaths,
  createCumulativeVisualTransferSamples,
  measureLensGzipBytes,
  readPresenceVisualManifestChunkPaths,
  writePresenceEvidenceArtifact,
  writePresenceRawDiagnosticsArtifact,
  writePresenceSoakArtifact,
  type PresenceMetricSamples,
  type PresencePerformanceProbeSnapshot,
} from "./performance-evidence";
import {
  AUTOMATED_METRIC_IDS,
  evaluatePresenceBudgets,
} from "./budget-evaluator";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function zeroSamples(): PresenceMetricSamples {
  return {
    "webgl-context-count": [0, 1],
    "active-raf-count": [0, 1, 0],
    "device-pixel-ratio": [1, 1.5],
    "draw-calls": [0, 1],
    triangles: [0, 2],
    "texture-rt-bytes": [0, 1024],
    "visual-transfer-bytes": [0, 2048],
    "active-jewel-count": [0, 1],
    "lens-gzip-bytes": [4096],
    "stream-long-task-duration-ms": [0, 12],
  };
}

function measuredInactiveRafStates() {
  return {
    "reduced-motion": { status: "measured" as const, samples: [0, 0] },
    paused: { status: "measured" as const, samples: [0, 0] },
    offscreen: { status: "measured" as const, samples: [0, 0] },
    hidden: { status: "measured" as const, samples: [0, 0] },
  };
}

describe("Presence performance evidence", () => {
  it("builds strict schema evidence without converting failed dynamic certification into a pass", () => {
    const evidence = buildPresenceEvidence({
      profile: "desktop",
      renderPath: "static-fallback",
      capturedAt: "2026-07-13T00:00:00.000Z",
      environment: {
        browser: "Chromium 139",
        os: "Windows 11",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
        throttle: "none",
      },
      samples: zeroSamples(),
      inactiveRafStates: {
        "reduced-motion": { status: "measured", samples: [0, 0] },
        paused: { status: "measured", samples: [0, 0] },
        offscreen: { status: "measured", samples: [0, 0] },
        hidden: {
          status: "unsupported",
          notes: "Real visibility lifecycle unavailable in headless Chromium.",
        },
      },
      dynamicCertification: {
        status: "failed",
        notes: "Pinned Live2D inventory failed integrity preflight.",
      },
    });

    expect(() => assertPresenceEvidenceSchema(evidence)).not.toThrow();
    expect(Object.keys(evidence.automated)).toEqual([...AUTOMATED_METRIC_IDS]);
    expect(evidence.dynamicCertification).toEqual({
      status: "failed",
      notes: "Pinned Live2D inventory failed integrity preflight.",
    });
    expect(evidence.renderPath).toBe("static-fallback");
    expect(evidence.fixedHardware).not.toContainEqual(
      expect.objectContaining({ id: "dynamic-visual-certification" }),
    );
    expect(evidence.fixedHardware.map((entry) => entry.id)).toEqual([
      "visual-js-frame-p95",
      "visual-cadence",
      "cwv-fixed-profile",
      "gpu-timing",
      "thirty-minute-soak",
    ]);
    expect(evidence.fixedHardware).toContainEqual(
      expect.objectContaining({ id: "thirty-minute-soak", status: "not-run" }),
    );
    expect(evidence.manual.map((entry) => entry.id)).toEqual([
      "real-soft-keyboard",
      "microsoft-ime",
      "macos-ime",
      "japanese-ime",
      "gboard-ime",
      "nvda",
      "voiceover",
      "talkback",
    ]);
    expect(() =>
      assertPresenceEvidenceSchema({
        ...evidence,
        fixedHardware: evidence.fixedHardware.slice(1),
      }),
    ).toThrow(/fixedHardware.*missing/i);
    expect(() =>
      assertPresenceEvidenceSchema({
        ...evidence,
        manual: [evidence.manual[0], evidence.manual[0], ...evidence.manual.slice(2)],
      }),
    ).toThrow(/manual.*duplicated/i);

    const evaluation = evaluatePresenceBudgets(evidence);
    expect(
      evaluation.results
        .filter((result) => result.gate === "automated")
        .every((result) =>
          result.status === "passed" || result.status === "not-applicable",
        ),
    ).toBe(true);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.certificationComplete).toBe(false);
    expect(evaluation.issues).toEqual([]);
  });

  it.each([
    { label: "an absent metric", mutate: (samples: Partial<PresenceMetricSamples>) => delete samples.triangles },
    { label: "an empty sample set", mutate: (samples: Partial<PresenceMetricSamples>) => { samples["draw-calls"] = []; } },
    { label: "a negative sample", mutate: (samples: Partial<PresenceMetricSamples>) => { samples["texture-rt-bytes"] = [-1]; } },
    { label: "a non-finite sample", mutate: (samples: Partial<PresenceMetricSamples>) => { samples["active-raf-count"] = [Number.NaN]; } },
  ])("rejects $label instead of inventing a measured automated value", ({ mutate }) => {
    const samples: Partial<PresenceMetricSamples> = zeroSamples();
    mutate(samples);

    expect(() =>
      buildPresenceEvidence({
        profile: "mobile",
        renderPath: "static-fallback",
        capturedAt: "2026-07-13T00:00:00.000Z",
        environment: {
          browser: "Chromium 139",
          os: "Windows 11",
          viewport: { width: 390, height: 844 },
          devicePixelRatio: 1,
          throttle: "none",
        },
        samples: samples as PresenceMetricSamples,
        inactiveRafStates: measuredInactiveRafStates(),
        dynamicCertification: {
          status: "not-run",
          notes: "Compact static path intentionally does not initialize Live2D.",
        },
      }),
    ).toThrow(/raw samples/i);
  });

  it("preserves unsupported long-task observation instead of manufacturing a zero sample", () => {
    const samples: Partial<PresenceMetricSamples> = zeroSamples();
    delete samples["stream-long-task-duration-ms"];

    const evidence = buildPresenceEvidence({
      profile: "desktop",
      renderPath: "static-fallback",
      capturedAt: "2026-07-13T00:00:00.000Z",
      environment: {
        browser: "Chromium 139",
        os: "Windows 11",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
        throttle: "none",
      },
      samples,
      inactiveRafStates: measuredInactiveRafStates(),
      unavailable: {
        "stream-long-task-duration-ms": {
          status: "unsupported",
          notes: "PerformanceObserver longtask entries are unavailable.",
        },
      },
      dynamicCertification: { status: "failed" },
    });

    expect(evidence.automated["stream-long-task-duration-ms"]).toEqual({
      status: "unsupported",
      unit: "milliseconds",
      notes: "PerformanceObserver longtask entries are unavailable.",
    });
    expect(evaluatePresenceBudgets(evidence).passed).toBe(false);
  });

  it("counts Live2D plus visual-only production chunks from manifest/request delta", () => {
    const baseline = [
      { name: "http://astr.test/_next/static/chunks/base.js", transferSize: 1_000 },
      { name: "http://astr.test/_next/static/chunks/unrelated.js", transferSize: 900 },
    ];
    const samples = createCumulativeVisualTransferSamples(
      [
        ...baseline,
        { name: "http://astr.test/_next/static/chunks/visual.js", transferSize: 1_500 },
        { name: "http://astr.test/_next/static/chunks/unrelated.js", transferSize: 900 },
        { name: "http://astr.test/live2d/model.json", transferSize: 2_000 },
        { name: "http://astr.test/api/core/v1/status", transferSize: 4_000 },
      ],
      {
        baselineResources: baseline,
        manifestVisualChunkPaths: ["static/chunks/visual.js"],
      },
    );

    expect(samples).toEqual([0, 1_500, 3_500]);
  });

  it("counts manifest visual chunks already present in the baseline", () => {
    const baseline = [
      { name: "http://astr.test/_next/static/chunks/base.js", transferSize: 1_000 },
      { name: "http://astr.test/_next/static/chunks/visual.js", transferSize: 1_500 },
      { name: "http://astr.test/_next/static/chunks/unrelated.js", transferSize: 900 },
    ];
    const samples = createCumulativeVisualTransferSamples(
      [
        ...baseline,
        { name: "http://astr.test/_next/static/chunks/visual-dependency.js", transferSize: 700 },
        { name: "http://astr.test/live2d/model.json", transferSize: 2_000 },
      ],
      {
        baselineResources: baseline,
        manifestVisualChunkPaths: ["static/chunks/visual.js"],
      },
    );

    expect(samples).toEqual([0, 1_500, 2_200, 4_200]);
  });

  it("resolves requested visual chunks to actual production build files", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-visual-chunks-"));
    temporaryDirectories.push(root);
    const chunkDirectory = join(root, ".next", "static", "chunks");
    await mkdir(chunkDirectory, { recursive: true });
    const visualPath = join(chunkDirectory, "visual.js");
    await writeFile(visualPath, "(()=>{'production visual'})();", "utf8");

    await expect(
      collectVisualProductionChunkPaths(
        [
          { name: "http://astr.test/_next/static/chunks/base.js", transferSize: 10 },
          { name: "http://astr.test/_next/static/chunks/visual.js", transferSize: 20 },
        ],
        [{ name: "http://astr.test/_next/static/chunks/base.js", transferSize: 10 }],
        ["static/chunks/visual.js"],
        root,
      ),
    ).resolves.toEqual([visualPath]);
  });

  it("resolves a preloaded manifest visual chunk plus its request delta dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-preloaded-visual-chunks-"));
    temporaryDirectories.push(root);
    const chunkDirectory = join(root, ".next", "static", "chunks");
    await mkdir(chunkDirectory, { recursive: true });
    const visualPath = join(chunkDirectory, "visual.js");
    const dependencyPath = join(chunkDirectory, "visual-dependency.js");
    await writeFile(visualPath, "(()=>{'production visual'})();", "utf8");
    await writeFile(dependencyPath, "(()=>{'visual dependency'})();", "utf8");
    const baseline = [
      { name: "http://astr.test/_next/static/chunks/base.js", transferSize: 10 },
      { name: "http://astr.test/_next/static/chunks/visual.js", transferSize: 20 },
    ];

    await expect(
      collectVisualProductionChunkPaths(
        [
          ...baseline,
          {
            name: "http://astr.test/_next/static/chunks/visual-dependency.js",
            transferSize: 30,
          },
        ],
        baseline,
        ["static/chunks/visual.js"],
        root,
      ),
    ).resolves.toEqual([dependencyPath, visualPath].sort());
  });

  it("reads visual dynamic chunk paths from the production route manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-visual-manifest-"));
    temporaryDirectories.push(root);
    const manifestDirectory = join(root, ".next", "server", "app", "page");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      join(manifestDirectory, "react-loadable-manifest.json"),
      JSON.stringify({
        visualMount: { id: 1, files: ["static/chunks/visual.js", "static/chunks/visual.css"] },
        duplicate: { id: 2, files: ["static/chunks/visual.js"] },
      }),
      "utf8",
    );

    await expect(readPresenceVisualManifestChunkPaths(root)).resolves.toEqual([
      "static/chunks/visual.js",
    ]);
  });

  it("measures gzip bytes from the production chunk increment, never TS sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-lens-build-gzip-"));
    temporaryDirectories.push(root);
    const builtChunk = join(root, "visual-production.js");
    const source = join(root, "soul-lens-pass.ts");
    await writeFile(builtChunk, "(()=>{'minified production lens'})();", "utf8");
    await writeFile(source, `export const ignored = '${"source-only".repeat(256)}';`, "utf8");
    const expected = gzipSync(await readFile(builtChunk)).byteLength;

    await expect(measureLensGzipBytes([builtChunk])).resolves.toBe(expected);
  });

  it("selects Lens production chunks from the visual request delta by built module markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-lens-production-chunks-"));
    temporaryDirectories.push(root);
    const chunkDirectory = join(root, ".next", "static", "chunks");
    await mkdir(chunkDirectory, { recursive: true });
    await writeFile(join(chunkDirectory, "base.js"), "base", "utf8");
    await writeFile(
      join(chunkDirectory, "lens.js"),
      "const uProvenanceState=0;throw Error('Soul Lens pass initialization failed')",
      "utf8",
    );
    await writeFile(
      join(chunkDirectory, "static-lens.js"),
      "const marker='data-soul-lens-fallback';class SoulLens{}",
      "utf8",
    );
    await writeFile(join(chunkDirectory, "pixi.js"), "vendor pixi", "utf8");

    await expect(
      collectLensProductionChunkPaths(
        [
          { name: "http://astr.test/_next/static/chunks/base.js", transferSize: 1 },
          { name: "http://astr.test/_next/static/chunks/lens.js", transferSize: 2 },
          { name: "http://astr.test/_next/static/chunks/pixi.js", transferSize: 3 },
          { name: "http://astr.test/_next/static/chunks/static-lens.js", transferSize: 4 },
        ],
        [{ name: "http://astr.test/_next/static/chunks/base.js", transferSize: 1 }],
        root,
      ),
    ).resolves.toEqual([join(chunkDirectory, "lens.js")]);
  });

  it("measures built Lens chunks even when the static baseline preloads the visual module", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-lens-preloaded-chunks-"));
    temporaryDirectories.push(root);
    const chunkDirectory = join(root, ".next", "static", "chunks");
    await mkdir(chunkDirectory, { recursive: true });
    const lensPath = join(chunkDirectory, "lens.js");
    await writeFile(
      lensPath,
      "const uProvenanceState=0;throw Error('Soul Lens pass initialization failed')",
      "utf8",
    );
    const preloaded = [
      { name: "http://astr.test/_next/static/chunks/lens.js", transferSize: 2 },
    ];

    await expect(
      collectLensProductionChunkPaths(preloaded, preloaded, root),
    ).resolves.toEqual([lensPath]);
  });

  it("writes a schema-checked profile artifact to the canonical test-results directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-presence-evidence-"));
    temporaryDirectories.push(root);
    const evidence = buildPresenceEvidence({
      profile: "mobile",
      renderPath: "static-fallback",
      capturedAt: "2026-07-13T00:00:00.000Z",
      environment: {
        browser: "Chromium 139",
        os: "Windows 11",
        viewport: { width: 390, height: 844 },
        devicePixelRatio: 1,
        throttle: "none",
      },
      samples: zeroSamples(),
      inactiveRafStates: measuredInactiveRafStates(),
      dynamicCertification: {
        status: "not-run",
        notes: "Static compact path.",
      },
    });

    const artifactPath = await writePresenceEvidenceArtifact(evidence, root);

    expect(artifactPath).toBe(
      join(root, "test-results", "presence-evidence", "mobile.json"),
    );
    expect(JSON.parse(await readFile(artifactPath, "utf8"))).toEqual(evidence);
  });

  it("writes schema-validated raw diagnostics with probe support and timing samples", async () => {
    const root = await mkdtemp(join(tmpdir(), "astr-presence-raw-"));
    temporaryDirectories.push(root);
    const raw = rawDiagnosticsProbe();

    const artifactPath = await writePresenceRawDiagnosticsArtifact(
      "desktop",
      "static-fallback",
      raw,
      root,
    );

    expect(artifactPath).toBe(
      join(root, "test-results", "presence-evidence", "desktop-raw.json"),
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(() => assertPresenceRawDiagnosticsSchema(artifact)).not.toThrow();
    expect(artifact).toMatchObject({
      schemaVersion: "1.0.0",
      profile: "desktop",
      renderPath: "static-fallback",
      probe: raw,
    });
  });

  it("rejects raw diagnostics that omit visual callback and missed-tick evidence", async () => {
    const raw = structuredClone(rawDiagnosticsProbe()) as unknown as {
      raf: { callbackDurationMs?: readonly number[] };
    };
    delete raw.raf.callbackDurationMs;

    await expect(
      writePresenceRawDiagnosticsArtifact(
        "desktop",
        "static-fallback",
        raw as unknown as PresencePerformanceProbeSnapshot,
      ),
    ).rejects.toThrow(/callbackDurationMs/i);
  });

  it("accepts source-verified scheduler policy provenance and rejects the legacy observed label", () => {
    const probe = rawDiagnosticsProbe();
    const raw = {
      schemaVersion: "1.0.0",
      profile: "desktop",
      renderPath: "dynamic",
      capturedAt: "2026-07-13T00:00:00.000Z",
      probe: {
        ...probe,
        raf: {
          ...probe.raf,
          scheduler: {
            renderPath: "dynamic",
            applicationRootCount: 1,
            sharedTickerListenerCount: 0,
            sharedTickerRafCount: 0,
            provenance: "source-verified-policy",
          },
        },
      },
    };

    expect(() => assertPresenceRawDiagnosticsSchema(raw)).not.toThrow();

    const legacy = structuredClone(raw);
    legacy.probe.raf.scheduler.provenance = "observed-production-policy";
    expect(() => assertPresenceRawDiagnosticsSchema(legacy)).toThrow(/provenance/i);
  });

  it.each([
    {
      status: "measured" as const,
      samples: [8_000_000, 8_500_000],
      postGcGrowthBytes: 500_000,
    },
    {
      status: "unsupported" as const,
      samples: [],
      postGcGrowthBytes: null,
    },
  ])("writes explicit $status soak support without manufacturing heap samples", async (heap) => {
    const root = await mkdtemp(join(tmpdir(), "astr-presence-soak-"));
    temporaryDirectories.push(root);

    const artifactPath = await writePresenceSoakArtifact({
      capturedAt: "2026-07-13T00:00:00.000Z",
      durationMs: 10_000,
      heap: {
        ...heap,
        unit: "bytes",
        limitBytes: 10 * 1024 * 1024,
        comparator: "less-than",
      },
    }, root);

    expect(artifactPath).toBe(
      join(root, "test-results", "presence-evidence", "soak.json"),
    );
    expect(JSON.parse(await readFile(artifactPath, "utf8"))).toMatchObject({ heap });
  });

  it("rejects measured soak evidence without raw heap samples", async () => {
    await expect(
      writePresenceSoakArtifact({
        capturedAt: "2026-07-13T00:00:00.000Z",
        durationMs: 10_000,
        heap: {
          status: "measured",
          unit: "bytes",
          samples: [],
          postGcGrowthBytes: 0,
          limitBytes: 10 * 1024 * 1024,
          comparator: "less-than",
        },
      }),
    ).rejects.toThrow(/raw heap samples/i);
  });

  it("rejects schema additions instead of silently emitting an incompatible artifact", () => {
    const evidence = buildPresenceEvidence({
      profile: "desktop",
      renderPath: "dynamic",
      capturedAt: "2026-07-13T00:00:00.000Z",
      environment: {
        browser: "Chromium 139",
        os: "Windows 11",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
        throttle: "none",
      },
      samples: zeroSamples(),
      inactiveRafStates: measuredInactiveRafStates(),
      dynamicCertification: { status: "passed" },
    });
    const incompatible = { ...evidence, summary: "not in schema" };

    expect(() => assertPresenceEvidenceSchema(incompatible)).toThrow(
      /unexpected property/i,
    );
  });
});

function rawDiagnosticsProbe(): PresencePerformanceProbeSnapshot {
  const capability = {
    supported: true,
    installed: true,
    observed: true,
  };
  return {
    support: {
      raf: { ...capability },
      canvas: { ...capability, observed: false },
      webgl: { ...capability },
      longTask: { ...capability },
      largestContentfulPaint: { ...capability },
      eventTiming: { ...capability },
      layoutShift: { ...capability },
    },
    environment: {
      platform: "Win32",
      hardwareConcurrency: 8,
      devicePixelRatio: 1,
    },
    raf: {
      active: 0,
      maxActive: 1,
      samples: [0, 1, 0],
      cadenceMs: [33.4],
      callbackDurationMs: [1.2],
      missedTicks: [0],
      schedulerStacks: [
        { stack: "at Ticker._tick", classification: "pixi-application" },
      ],
      scheduler: {
        renderPath: "static",
        applicationRootCount: 0,
        sharedTickerListenerCount: 0,
        sharedTickerRafCount: 0,
        provenance: "no-renderer",
      },
      inactiveWindows: {
        "reduced-motion": {
          status: "measured",
          startTime: 1_000,
          endTime: 11_000,
          samples: [0, 0],
        },
        paused: {
          status: "measured",
          startTime: 1_000,
          endTime: 11_000,
          samples: [0, 0],
        },
        offscreen: {
          status: "measured",
          startTime: 1_000,
          endTime: 11_000,
          samples: [0, 0],
        },
        hidden: {
          status: "unsupported",
          notes: "Headless page stayed visible.",
        },
      },
    },
    webgl: {
      contextCountSamples: [0],
      successfulContextCreationSamples: [0],
      drawCallSamples: [0],
      triangleSamples: [0],
      textureRtByteSamples: [0],
    },
    canvasDprSamples: [],
    canvasBackingSizeSamples: [],
    longTaskDurationMs: [0],
    longTasks: [],
    longTaskWindow: { startTime: 1_000, endTime: 11_000 },
    performance: {
      lcpMs: [1_200],
      inpMs: [80],
      clsSamples: [0],
      tbtMs: [0],
    },
    resources: [
      {
        name: "http://astr.test/live2d/model.json",
        initiatorType: "fetch",
        transferSize: 42,
        encodedBodySize: 21,
        decodedBodySize: 84,
        duration: 2,
      },
    ],
    dom: {
      activeJewelCountSamples: [0],
      visualPhase: "static",
      canvasCount: 0,
    },
  };
}
