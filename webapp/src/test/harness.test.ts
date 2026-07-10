import { describe, expect, it } from "vitest";

describe("foundation test harness", () => {
  it("provides a browser-like document and media query API", () => {
    expect(document.documentElement).toBeInstanceOf(HTMLElement);
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });
});
