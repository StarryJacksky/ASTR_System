import { describe, expect, it } from "vitest";

import { matchesBuildStamp } from "./e2e-build-stamp.mjs";

describe("matchesBuildStamp", () => {
  const expected = {
    version: 1,
    buildId: "current-build",
    coreMode: "mock",
    coreOrigin: "http://127.0.0.1:18300",
    sourceHash: "source-hash",
  };

  it("accepts only the current Next build identity", () => {
    expect(matchesBuildStamp(expected, expected)).toBe(true);
    expect(
      matchesBuildStamp({ ...expected, buildId: "stale-build" }, expected),
    ).toBe(false);
  });
});
