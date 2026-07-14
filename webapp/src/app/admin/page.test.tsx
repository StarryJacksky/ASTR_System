import { describe, expect, it } from "vitest";

import { metadata } from "./page";

describe("Control index route", () => {
  it("publishes a distinct index title for assistive route announcements", () => {
    expect(metadata).toEqual({
      title: "主权档案索引 · ASTR Control",
    });
  });
});
