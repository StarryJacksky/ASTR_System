import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const plan = readFileSync(
  resolve(process.cwd(), "../docs/superpowers/plans/2026-07-11-astr-foundation-implementation.md"),
  "utf8",
);

describe("Foundation binding implementation plan", () => {
  it("binds Intro to a cancellable one-shot timer rather than an animation frame", () => {
    expect(plan).not.toMatch(/const frame = requestAnimationFrame|cancelAnimationFrame\(frame\)/);
    expect(plan).toContain("window.setTimeout");
    expect(plan).toContain("window.clearTimeout");
  });

  it("binds the exact constitutional shape and spacing values", () => {
    for (const contract of [
      "--radius-small: 2px",
      "--radius-medium: 6px",
      "--radius-large: 12px",
      "--radius-jewel: 50%",
      "--corner-signature: 14px",
      "--space-5: 24px",
      "--space-6: 32px",
      "--space-7: 48px",
      "--space-8: 72px",
    ]) {
      expect(plan).toContain(contract);
    }
    expect(plan).not.toContain("--radius-large: 22px");
    expect(plan).not.toContain("--radius-jewel: 999px");
  });

  it("binds the single announcer to one-hertz polite coalescing and immediate assertive output", () => {
    expect(plan).toContain("POLITE_INTERVAL_MS = 1000");
    expect(plan).toContain("latest polite announcement");
    expect(plan).toContain("clearAnnouncement does not reset the polite cadence");
    expect(plan).toContain("assertive announcements publish immediately");
  });
});
