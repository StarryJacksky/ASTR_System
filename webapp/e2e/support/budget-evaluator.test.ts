import { describe, expect, it } from "vitest";

import {
  AUTOMATED_METRIC_IDS,
  INACTIVE_RAF_STATE_IDS,
  PRESENCE_BUDGETS,
  evaluatePresenceBudgets,
  type AutomatedMetricId,
  type PresenceEvidence,
} from "./budget-evaluator";
import evidenceSchema from "../evidence.schema.json";

const units: Record<AutomatedMetricId, string> = {
  "webgl-context-count": "count",
  "active-raf-count": "count",
  "inactive-raf-count": "count",
  "device-pixel-ratio": "ratio",
  "draw-calls": "count",
  triangles: "count",
  "texture-rt-bytes": "bytes",
  "visual-transfer-bytes": "bytes",
  "active-jewel-count": "count",
  "lens-gzip-bytes": "bytes",
  "stream-long-task-duration-ms": "milliseconds",
};
const fixedHardwareIds = [
  "visual-js-frame-p95",
  "visual-cadence",
  "cwv-fixed-profile",
  "gpu-timing",
  "thirty-minute-soak",
] as const;
const manualIds = [
  "real-soft-keyboard",
  "microsoft-ime",
  "macos-ime",
  "japanese-ime",
  "gboard-ime",
  "nvda",
  "voiceover",
  "talkback",
] as const;

function evidenceAtLimits(profile: "desktop" | "mobile"): PresenceEvidence {
  const limits = PRESENCE_BUDGETS[profile];

  return {
    schemaVersion: "1.0.0",
    profile,
    renderPath: "dynamic",
    dynamicCertification: {
      status: "passed",
      notes: "Live2D and Lens reached the ready phase.",
    },
    capturedAt: "2026-07-13T00:00:00.000Z",
    environment: {
      browser: "Chromium 139",
      os: "Windows 11",
      viewport: { width: profile === "desktop" ? 1440 : 390, height: 900 },
      devicePixelRatio: limits["device-pixel-ratio"],
      throttle: "none",
    },
    automated: Object.fromEntries(
      AUTOMATED_METRIC_IDS.map((id) => [
        id,
        id === "inactive-raf-count"
          ? {
              unit: "count",
              states: Object.fromEntries(
                INACTIVE_RAF_STATE_IDS.map((state) => [
                  state,
                  { status: "measured", unit: "count", samples: [0] },
                ]),
              ),
            }
          : {
          status: "measured",
          unit: units[id],
          samples: [limits[id]],
          },
      ]),
    ) as unknown as PresenceEvidence["automated"],
    fixedHardware: fixedHardwareIds.map((id) => ({ id, status: "passed" })),
    manual: manualIds.map((id) => ({ id, status: "passed" })),
  };
}

describe("evaluatePresenceBudgets", () => {
  it.each(["desktop", "mobile"] as const)(
    "passes %s evidence when every automated sample equals its inclusive limit",
    (profile) => {
      const result = evaluatePresenceBudgets(evidenceAtLimits(profile));

      expect(result.passed).toBe(true);
      expect(result.certificationComplete).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.results).toHaveLength(29);
      expect(result.results.every((entry) => entry.status === "passed")).toBe(true);
    },
  );

  const overLimitCases = (["desktop", "mobile"] as const).flatMap((profile) =>
    AUTOMATED_METRIC_IDS.map((id) => ({ profile, id })),
  );

  it.each(overLimitCases)(
    "fails $profile $id when the maximum raw sample is exactly one over budget",
    ({ profile, id }) => {
      const evidence = evidenceAtLimits(profile);
      const limit = PRESENCE_BUDGETS[profile][id];
      if (id === "inactive-raf-count") {
        evidence.automated[id].states.paused = {
          status: "measured",
          unit: "count",
          samples: [0, limit + 1, limit],
        };
      } else {
        evidence.automated[id] = {
          ...evidence.automated[id],
          samples: [0, limit + 1, limit],
        };
      }

      const result = evaluatePresenceBudgets(evidence);
      const metric = result.results.find(
        (entry) => entry.gate === "automated" && entry.id === id,
      );

      expect(result.passed).toBe(false);
      expect(metric).toMatchObject({
        gate: "automated",
        id,
        status: "failed",
        observed: limit + 1,
        limit,
      });
      expect(result.issues).toContain(
        id === "inactive-raf-count"
          ? `${profile}.${id}.paused observed ${limit + 1} > ${limit}`
          : `${profile}.${id} observed ${limit + 1} > ${limit}`,
      );
    },
  );

  it("fails instead of throwing when a required automated metric is missing", () => {
    const evidence = evidenceAtLimits("desktop");
    delete (evidence.automated as Partial<PresenceEvidence["automated"]>)["draw-calls"];

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        gate: "automated",
        id: "draw-calls",
        status: "failed",
        observed: null,
      }),
    );
    expect(result.issues).toContain("desktop.draw-calls is missing");
  });

  it.each(["unsupported", "not-run"] as const)(
    "fails an automated hard gate whose evidence status is %s",
    (status) => {
      const evidence = evidenceAtLimits("desktop");
      evidence.automated["webgl-context-count"] = {
        status,
        unit: "count",
      };

      const result = evaluatePresenceBudgets(evidence);

      expect(result.passed).toBe(false);
      expect(result.results).toContainEqual(
        expect.objectContaining({
          gate: "automated",
          id: "webgl-context-count",
          status: "failed",
          observed: null,
        }),
      );
      expect(result.issues).toContain(
        `desktop.webgl-context-count requires measured evidence; received ${status}`,
      );
    },
  );

  it.each(["reduced-motion", "paused", "offscreen"] as const)(
    "fails the inactive RAF hard gate when required state %s is absent",
    (state) => {
      const evidence = evidenceAtLimits("desktop");
      delete evidence.automated["inactive-raf-count"].states[state];

      const result = evaluatePresenceBudgets(evidence);

      expect(result.passed).toBe(false);
      expect(result.issues).toContain(`desktop.inactive-raf-count.${state} is missing`);
      expect(result.results).toContainEqual(
        expect.objectContaining({
          gate: "inactive-raf-state",
          id: state,
          status: "failed",
        }),
      );
    },
  );

  it("keeps a genuinely unavailable hidden lifecycle explicit and incomplete", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.automated["inactive-raf-count"].states.hidden = {
      status: "unsupported",
      unit: "count",
      notes: "Headless Chromium cannot enter a real hidden lifecycle.",
    };

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(true);
    expect(result.certificationComplete).toBe(false);
    expect(result.results).toContainEqual({
      gate: "inactive-raf-state",
      id: "hidden",
      status: "incomplete",
      observed: null,
      limit: 0,
      reason: "Inactive RAF state evidence was unsupported.",
    });
  });

  it("does not invent DPR zero when the measured delivery path has no renderer", () => {
    const evidence = evidenceAtLimits("mobile");
    evidence.renderPath = "static-fallback";
    evidence.dynamicCertification = { status: "not-run" };
    evidence.automated["device-pixel-ratio"] = {
      status: "not-applicable",
      unit: "ratio",
      notes: "Static fallback created no renderer or backing store.",
    };

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual({
      gate: "automated",
      id: "device-pixel-ratio",
      status: "not-applicable",
      observed: null,
      limit: 1.25,
      comparator: "less-than-or-equal",
      reason: "Static fallback has no renderer DPR to measure.",
    });
  });

  it("rejects not-applicable DPR on a dynamic renderer path", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.automated["device-pixel-ratio"] = {
      status: "not-applicable",
      unit: "ratio",
      notes: "incorrect",
    };

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.issues).toContain(
      "desktop.device-pixel-ratio requires measured evidence; received not-applicable",
    );
  });

  it.each([
    { label: "no samples", samples: undefined },
    { label: "an empty sample set", samples: [] },
    { label: "a negative sample", samples: [0, -1] },
    { label: "a non-finite sample", samples: [0, Number.NaN] },
  ])("fails measured evidence with $label", ({ samples }) => {
    const evidence = evidenceAtLimits("mobile");
    evidence.automated.triangles = {
      status: "measured",
      unit: "count",
      samples,
    };

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        gate: "automated",
        id: "triangles",
        status: "failed",
        observed: null,
      }),
    );
    expect(result.issues).toContain("mobile.triangles has no valid non-negative finite samples");
  });

  it("rejects the largest finite JavaScript number as a budget breach", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.automated["texture-rt-bytes"].samples = [Number.MAX_VALUE];

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        id: "texture-rt-bytes",
        observed: Number.MAX_VALUE,
        status: "failed",
      }),
    );
  });

  it.each(["fixedHardware", "manual"] as const)(
    "allows %s not-run evidence without claiming complete certification",
    (gate) => {
      const evidence = evidenceAtLimits("desktop");
      const id = evidence[gate][0].id;
      evidence[gate] = evidence[gate].map((entry, index) =>
        index === 0 ? { ...entry, status: "not-run" } : entry,
      );

      const result = evaluatePresenceBudgets(evidence);

      expect(result.passed).toBe(true);
      expect(result.certificationComplete).toBe(false);
      expect(result.results).toContainEqual({
        gate: gate === "fixedHardware" ? "fixed-hardware" : "manual",
        id,
        status: "incomplete",
        reason: "Certification evidence was not-run.",
      });
    },
  );

  it("keeps a measured static fallback automated pass separate from failed dynamic certification", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.renderPath = "static-fallback";
    evidence.dynamicCertification = {
      status: "failed",
      notes: "Pinned dynamic assets failed integrity preflight.",
    };
    evidence.fixedHardware = evidence.fixedHardware.map((entry) =>
      entry.id === "visual-js-frame-p95" || entry.id === "visual-cadence"
        ? { ...entry, status: "not-run" }
        : entry,
    );
    evidence.manual = evidence.manual.map((entry) =>
      entry.id === "nvda" ? { ...entry, status: "not-run" } : entry,
    );

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(true);
    expect(result.certificationComplete).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.results).toContainEqual({
      gate: "dynamic-certification",
      id: "dynamic-visual-certification",
      status: "failed",
      reason: "Dynamic certification failed while the static fallback remained the measured delivery path.",
    });
  });

  it.each(["fixedHardware", "manual"] as const)(
    "fails when a %s certification check explicitly failed",
    (gate) => {
      const evidence = evidenceAtLimits("mobile");
      const id = evidence[gate][0].id;
      evidence[gate] = evidence[gate].map((entry, index) =>
        index === 0 ? { ...entry, status: "failed" } : entry,
      );

      const result = evaluatePresenceBudgets(evidence);

      expect(result.passed).toBe(false);
      expect(result.certificationComplete).toBe(false);
      expect(result.issues).toContain(`${gate}.${id} failed`);
    },
  );

  it("fails when expected fixed-hardware and manual IDs are missing", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.fixedHardware = [];
    evidence.manual = [];

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.certificationComplete).toBe(false);
    expect(result.issues).toContain("fixedHardware.visual-js-frame-p95 is missing");
    expect(result.issues).toContain("manual.real-soft-keyboard is missing");
  });

  it("fails duplicate certification IDs instead of counting them as complete", () => {
    const evidence = evidenceAtLimits("desktop");
    evidence.fixedHardware = [
      evidence.fixedHardware[0],
      evidence.fixedHardware[0],
      ...evidence.fixedHardware.slice(2),
    ];

    const result = evaluatePresenceBudgets(evidence);

    expect(result.passed).toBe(false);
    expect(result.certificationComplete).toBe(false);
    expect(result.issues).toContain("fixedHardware.visual-js-frame-p95 is duplicated");
  });
});

describe("presence evidence schema", () => {
  it("is the evaluator's single source of truth for every automated budget", () => {
    expect(PRESENCE_BUDGETS).toBe(evidenceSchema["x-presenceBudgets"]);
    expect(Object.keys(evidenceSchema["x-presenceBudgets"].desktop)).toEqual([
      ...AUTOMATED_METRIC_IDS,
    ]);
    expect(Object.keys(evidenceSchema["x-presenceBudgets"].mobile)).toEqual([
      ...AUTOMATED_METRIC_IDS,
    ]);
  });

  it("requires raw automated rows and explicit certification collections", () => {
    expect(evidenceSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(evidenceSchema.required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "profile",
        "renderPath",
        "dynamicCertification",
        "capturedAt",
        "environment",
        "automated",
        "fixedHardware",
        "manual",
      ]),
    );
    expect(evidenceSchema.properties.automated.required).toEqual([
      ...AUTOMATED_METRIC_IDS,
    ]);
    expect(evidenceSchema.properties.automated.additionalProperties).toBe(false);
    expect(evidenceSchema.$defs.measuredMetric.properties.samples.minItems).toBe(1);
    expect(evidenceSchema.$defs.measuredMetric.properties.samples.items.minimum).toBe(0);
    expect(evidenceSchema["x-presenceCertificationIds"]).toEqual({
      fixedHardware: [...fixedHardwareIds],
      manual: [...manualIds],
    });
    expect(evidenceSchema.properties.fixedHardware).toMatchObject({
      minItems: fixedHardwareIds.length,
      maxItems: fixedHardwareIds.length,
    });
    expect(evidenceSchema.properties.manual).toMatchObject({
      minItems: manualIds.length,
      maxItems: manualIds.length,
    });
  });

  it("uses decimal MB/KB transfer and Lens limits while retaining binary MiB memory limits", () => {
    expect(PRESENCE_BUDGETS.desktop["visual-transfer-bytes"]).toBe(4_000_000);
    expect(PRESENCE_BUDGETS.mobile["visual-transfer-bytes"]).toBe(1_500_000);
    expect(PRESENCE_BUDGETS.desktop["lens-gzip-bytes"]).toBe(25_000);
    expect(PRESENCE_BUDGETS.mobile["lens-gzip-bytes"]).toBe(25_000);
    expect(PRESENCE_BUDGETS.desktop["texture-rt-bytes"]).toBe(64 * 1024 * 1024);
    expect(PRESENCE_BUDGETS.mobile["texture-rt-bytes"]).toBe(32 * 1024 * 1024);
  });
});
