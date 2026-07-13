import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MOBILE_DOMAINS, getMobileDomainByPath } from "./mobile-domains";

const EXPECTED_IDS = ["presence", "tasks", "workbench", "knowledge", "safety"];
const EXPECTED_HREFS = [
  "/mobile/presence",
  "/mobile/tasks",
  "/mobile/workbench",
  "/mobile/knowledge",
  "/mobile/safety",
];

describe("Mobile domain registry", () => {
  it("defines the exact five-domain information architecture once", () => {
    expect(MOBILE_DOMAINS.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(MOBILE_DOMAINS.map(({ href }) => href)).toEqual(EXPECTED_HREFS);
    expect(MOBILE_DOMAINS.map(({ index }) => index)).toEqual(["01", "02", "03", "04", "05"]);
    expect(MOBILE_DOMAINS.map(({ status }) => status)).toEqual([
      "local-available",
      "local-only",
      "unavailable",
      "unavailable",
      "local-read-only",
    ]);
    expect(new Set(MOBILE_DOMAINS.map(({ id }) => id)).size).toBe(5);
    expect(new Set(MOBILE_DOMAINS.map(({ href }) => href)).size).toBe(5);
  });

  it("publishes a deeply immutable registry", () => {
    expect(Object.isFrozen(MOBILE_DOMAINS)).toBe(true);
    for (const domain of MOBILE_DOMAINS) expect(Object.isFrozen(domain)).toBe(true);
  });

  it("looks up exact routes and uses Presence metadata as the total fallback", () => {
    expect(getMobileDomainByPath("/mobile/tasks").id).toBe("tasks");
    expect(getMobileDomainByPath("/mobile/safety").id).toBe("safety");
    expect(getMobileDomainByPath("/mobile").id).toBe("presence");
    expect(getMobileDomainByPath("/mobile/unknown").id).toBe("presence");
    expect(getMobileDomainByPath("").id).toBe("presence");
  });

  it("remains metadata-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/mobile/model/mobile-domains.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /components\/|controller\/|data\/|fetch\s*\(|import\s*\(|CoreClient|SafetyClient/,
    );
  });
});
