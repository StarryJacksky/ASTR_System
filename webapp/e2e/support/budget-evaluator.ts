import evidenceSchema from "../evidence.schema.json";

type SchemaBudgetMatrix = (typeof evidenceSchema)["x-presenceBudgets"];

export type PresenceProfile = keyof SchemaBudgetMatrix;
export type PresenceRenderPath = "dynamic" | "static-fallback";
export type AutomatedMetricId = keyof SchemaBudgetMatrix["desktop"];
export type AutomatedEvidenceStatus =
  | "measured"
  | "unsupported"
  | "not-run"
  | "not-applicable";
export type CertificationStatus = "passed" | "failed" | "unsupported" | "not-run";

export const PRESENCE_BUDGETS = evidenceSchema["x-presenceBudgets"];
export const AUTOMATED_METRIC_IDS = Object.freeze(
  Object.keys(PRESENCE_BUDGETS.desktop) as AutomatedMetricId[],
);
export const FIXED_HARDWARE_CERTIFICATION_IDS = Object.freeze([
  ...evidenceSchema["x-presenceCertificationIds"].fixedHardware,
]);
export const MANUAL_CERTIFICATION_IDS = Object.freeze([
  ...evidenceSchema["x-presenceCertificationIds"].manual,
]);
export const INACTIVE_RAF_STATE_IDS = Object.freeze([
  "reduced-motion",
  "paused",
  "offscreen",
  "hidden",
] as const);
export type InactiveRafStateId = (typeof INACTIVE_RAF_STATE_IDS)[number];

export interface AutomatedMetricEvidence {
  status: AutomatedEvidenceStatus;
  unit: string;
  samples?: readonly number[];
  notes?: string;
}

export interface InactiveRafMetricEvidence {
  unit: "count";
  states: Record<InactiveRafStateId, AutomatedMetricEvidence>;
}

export type PresenceAutomatedEvidence = Omit<
  Record<AutomatedMetricId, AutomatedMetricEvidence>,
  "inactive-raf-count"
> & {
  "inactive-raf-count": InactiveRafMetricEvidence;
};

export interface CertificationEvidence {
  id: string;
  status: CertificationStatus;
  notes?: string;
}

export interface PresenceEvidence {
  schemaVersion: "1.0.0";
  profile: PresenceProfile;
  renderPath: PresenceRenderPath;
  dynamicCertification: Omit<CertificationEvidence, "id">;
  capturedAt: string;
  environment: {
    browser: string;
    os: string;
    cpu?: string;
    gpu?: string;
    viewport: { width: number; height: number };
    devicePixelRatio: number;
    throttle: string;
  };
  automated: PresenceAutomatedEvidence;
  fixedHardware: readonly CertificationEvidence[];
  manual: readonly CertificationEvidence[];
}

export interface AutomatedBudgetResult {
  gate: "automated";
  id: AutomatedMetricId;
  status: "passed" | "failed" | "not-applicable";
  observed: number | null;
  limit: number;
  comparator: "less-than-or-equal";
  reason?: string;
}

export interface CertificationBudgetResult {
  gate: "fixed-hardware" | "manual";
  id: string;
  status: "passed" | "failed" | "incomplete";
  reason?: string;
}

export interface DynamicCertificationBudgetResult {
  gate: "dynamic-certification";
  id: "dynamic-visual-certification";
  status: "passed" | "failed" | "incomplete";
  reason?: string;
}

export interface InactiveRafStateBudgetResult {
  gate: "inactive-raf-state";
  id: InactiveRafStateId;
  status: "passed" | "failed" | "incomplete";
  observed: number | null;
  limit: number;
  reason?: string;
}

export interface PresenceBudgetEvaluation {
  passed: boolean;
  certificationComplete: boolean;
  results: readonly (
    | AutomatedBudgetResult
    | CertificationBudgetResult
    | DynamicCertificationBudgetResult
    | InactiveRafStateBudgetResult
  )[];
  issues: readonly string[];
}

function failedAutomatedResult(
  id: AutomatedMetricId,
  limit: number,
  reason: string,
): AutomatedBudgetResult {
  return {
    gate: "automated",
    id,
    status: "failed",
    observed: null,
    limit,
    comparator: "less-than-or-equal",
    reason,
  };
}

export function evaluatePresenceBudgets(evidence: PresenceEvidence): PresenceBudgetEvaluation {
  const limits = PRESENCE_BUDGETS[evidence.profile];
  const issues: string[] = [];
  const inactiveStateResults: InactiveRafStateBudgetResult[] = [];
  const automatedResults: AutomatedBudgetResult[] = AUTOMATED_METRIC_IDS.map((id) => {
    const limit = limits[id];
    const metric = evidence.automated[id];

    if (!metric) {
      const issue = `${evidence.profile}.${id} is missing`;
      issues.push(issue);
      return failedAutomatedResult(id, limit, "Required automated evidence is missing.");
    }

    if (id === "inactive-raf-count") {
      return evaluateInactiveRafMetric(
        evidence.profile,
        metric as InactiveRafMetricEvidence,
        limit,
        issues,
        inactiveStateResults,
      );
    }
    const automatedMetric = metric as AutomatedMetricEvidence;

    if (
      id === "device-pixel-ratio" &&
      evidence.renderPath === "static-fallback" &&
      automatedMetric.status === "not-applicable"
    ) {
      return {
        gate: "automated",
        id,
        status: "not-applicable",
        observed: null,
        limit,
        comparator: "less-than-or-equal",
        reason: "Static fallback has no renderer DPR to measure.",
      };
    }

    if (automatedMetric.status !== "measured") {
      const issue = `${evidence.profile}.${id} requires measured evidence; received ${automatedMetric.status}`;
      issues.push(issue);
      return failedAutomatedResult(
        id,
        limit,
        `Automated hard gates cannot be ${automatedMetric.status}.`,
      );
    }

    const samples = automatedMetric.samples;
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.some((sample) => !Number.isFinite(sample) || sample < 0)
    ) {
      const issue = `${evidence.profile}.${id} has no valid non-negative finite samples`;
      issues.push(issue);
      return failedAutomatedResult(id, limit, "Measured evidence requires valid raw samples.");
    }

    const observed = Math.max(...samples);
    const passed = observed <= limit;

    if (!passed) {
      issues.push(`${evidence.profile}.${id} observed ${observed} > ${limit}`);
    }

    return {
      gate: "automated",
      id,
      status: passed ? "passed" : "failed",
      observed,
      limit,
      comparator: "less-than-or-equal",
      ...(!passed && { reason: `Observed ${observed}; maximum is ${limit}.` }),
    };
  });

  const evaluateCertification = (
    entries: readonly CertificationEvidence[],
    expectedIds: readonly string[],
    gate: CertificationBudgetResult["gate"],
    evidenceKey: "fixedHardware" | "manual",
  ): CertificationBudgetResult[] => {
    const grouped = new Map<string, CertificationEvidence[]>();
    for (const entry of entries) {
      const group = grouped.get(entry.id) ?? [];
      group.push(entry);
      grouped.set(entry.id, group);
    }
    const results = expectedIds.map((id): CertificationBudgetResult => {
      const matches = grouped.get(id) ?? [];
      if (matches.length === 0) {
        issues.push(`${evidenceKey}.${id} is missing`);
        return { gate, id, status: "failed", reason: "Required certification evidence is missing." };
      }
      if (matches.length > 1) {
        issues.push(`${evidenceKey}.${id} is duplicated`);
        return { gate, id, status: "failed", reason: "Certification evidence ID is duplicated." };
      }
      const item = matches[0];
      if (item.status === "passed") {
        return { gate, id: item.id, status: "passed" };
      }

      if (item.status === "unsupported" || item.status === "not-run") {
        return {
          gate,
          id: item.id,
          status: "incomplete",
          reason: `Certification evidence was ${item.status}.`,
        };
      }

      issues.push(`${evidenceKey}.${item.id} failed`);
      return {
        gate,
        id: item.id,
        status: "failed",
        reason: "Certification check failed.",
      };
    });
    for (const id of grouped.keys()) {
      if (expectedIds.includes(id)) continue;
      issues.push(`${evidenceKey}.${id} is unexpected`);
      results.push({ gate, id, status: "failed", reason: "Unexpected certification evidence ID." });
    }
    return results;
  };

  const fixedResults = evaluateCertification(
    evidence.fixedHardware,
    FIXED_HARDWARE_CERTIFICATION_IDS,
    "fixed-hardware",
    "fixedHardware",
  );
  const manualResults = evaluateCertification(
    evidence.manual,
    MANUAL_CERTIFICATION_IDS,
    "manual",
    "manual",
  );
  const dynamicResult: DynamicCertificationBudgetResult =
    evidence.dynamicCertification.status === "passed"
      ? {
          gate: "dynamic-certification",
          id: "dynamic-visual-certification",
          status: "passed",
        }
      : evidence.dynamicCertification.status === "failed"
        ? {
            gate: "dynamic-certification",
            id: "dynamic-visual-certification",
            status: "failed",
            reason:
              evidence.renderPath === "static-fallback"
                ? "Dynamic certification failed while the static fallback remained the measured delivery path."
                : "Dynamic certification failed.",
          }
        : {
            gate: "dynamic-certification",
            id: "dynamic-visual-certification",
            status: "incomplete",
            reason: `Dynamic certification evidence was ${evidence.dynamicCertification.status}.`,
          };
  const certificationComplete =
    dynamicResult.status === "passed" &&
    inactiveStateResults.every((result) => result.status === "passed") &&
    fixedResults.length > 0 &&
    manualResults.length > 0 &&
    [...fixedResults, ...manualResults].every((result) => result.status === "passed");

  return {
    passed: issues.length === 0,
    certificationComplete,
    results: [
      ...automatedResults,
      ...inactiveStateResults,
      dynamicResult,
      ...fixedResults,
      ...manualResults,
    ],
    issues,
  };
}

function evaluateInactiveRafMetric(
  profile: PresenceProfile,
  metric: InactiveRafMetricEvidence,
  limit: number,
  issues: string[],
  stateResults: InactiveRafStateBudgetResult[],
): AutomatedBudgetResult {
  let hardGateFailed = false;
  const observedSamples: number[] = [];
  for (const state of INACTIVE_RAF_STATE_IDS) {
    const stateEvidence = metric.states?.[state];
    const requiredDeliveryState = state !== "hidden";
    if (stateEvidence === undefined) {
      issues.push(`${profile}.inactive-raf-count.${state} is missing`);
      hardGateFailed = true;
      stateResults.push({
        gate: "inactive-raf-state",
        id: state,
        status: "failed",
        observed: null,
        limit,
        reason: "Required inactive RAF state evidence is missing.",
      });
      continue;
    }
    if (stateEvidence.status !== "measured") {
      const incomplete = state === "hidden" &&
        (stateEvidence.status === "unsupported" || stateEvidence.status === "not-run");
      if (requiredDeliveryState || !incomplete) {
        issues.push(
          `${profile}.inactive-raf-count.${state} requires measured evidence; received ${stateEvidence.status}`,
        );
        hardGateFailed = true;
      }
      stateResults.push({
        gate: "inactive-raf-state",
        id: state,
        status: incomplete ? "incomplete" : "failed",
        observed: null,
        limit,
        reason: incomplete
          ? `Inactive RAF state evidence was ${stateEvidence.status}.`
          : `Inactive RAF state cannot be ${stateEvidence.status}.`,
      });
      continue;
    }
    const samples = stateEvidence.samples;
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.some((sample) => !Number.isFinite(sample) || sample < 0)
    ) {
      issues.push(`${profile}.inactive-raf-count.${state} has no valid samples`);
      hardGateFailed = true;
      stateResults.push({
        gate: "inactive-raf-state",
        id: state,
        status: "failed",
        observed: null,
        limit,
        reason: "Measured inactive RAF evidence requires valid raw samples.",
      });
      continue;
    }
    const observed = Math.max(...samples);
    observedSamples.push(observed);
    const passed = observed <= limit;
    if (!passed) {
      issues.push(`${profile}.inactive-raf-count.${state} observed ${observed} > ${limit}`);
      hardGateFailed = true;
    }
    stateResults.push({
      gate: "inactive-raf-state",
      id: state,
      status: passed ? "passed" : "failed",
      observed,
      limit,
      ...(!passed && { reason: `Observed ${observed}; maximum is ${limit}.` }),
    });
  }
  const observed = observedSamples.length === 0 ? null : Math.max(...observedSamples);
  return {
    gate: "automated",
    id: "inactive-raf-count",
    status: hardGateFailed ? "failed" : "passed",
    observed,
    limit,
    comparator: "less-than-or-equal",
    ...(hardGateFailed && {
      reason: "One or more required inactive RAF states did not certify.",
    }),
  };
}
