import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const emotion = readFileSync(resolve(process.cwd(), "src/lib/emotion.ts"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/app/admin/page.tsx"), "utf8");

function cssHexToken(declarations: string, token: string): string {
  const value = declarations.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing hex token ${token}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("ASTR constitutional tokens", () => {
  it.each([
    ["--astr-bg", "#050611"],
    ["--astr-surface", "#0e1123"],
    ["--astr-text", "#f5f4fb"],
    ["--astr-text-2", "#969fbd"],
    ["--astr-hairline-strong", "#2b3253"],
    ["--astr-soul", "#9184ff"],
    ["--astr-action", "#8bcfff"],
    ["--astr-warning", "#efa85f"],
    ["--astr-danger", "#ff7087"],
  ])("defines %s as %s", (name, value) => {
    expect(css.toLowerCase()).toMatch(new RegExp(`${name}:\\s*${value}`));
  });

  it("contains the complete day material inversion", () => {
    for (const value of ["#f1f3fa", "#ffffff", "#16172b", "#5b48b8", "#216ca6", "#955005", "#b92f4c"]) {
      expect(css.toLowerCase()).toContain(value);
    }
  });

  it("contains no legacy green success or calm color", () => {
    expect(css.toLowerCase()).not.toContain("#4ec98f");
    expect(css.toLowerCase()).not.toContain("#3df5c4");
  });

  it("defines non-color craft and performance tokens", () => {
    for (const token of ["--radius-jewel", "--corner-eclipse", "--motion-instant", "--motion-signature", "--dpr-desktop", "--dpr-mobile", "--touch-target"]) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("maps soul and action roles and uses action for focus", () => {
    expect(globals).toMatch(/--color-soul:\s*var\(--astr-soul\)/);
    expect(globals).toMatch(/--color-action:\s*var\(--astr-action\)/);
    expect(globals).toMatch(/outline:\s*2px solid var\(--astr-action\)/);
  });

  it("uses the constitutional emotion anchors in the runtime fallback", () => {
    for (const anchor of [
      "[0x6f, 0x8c, 0xff]",
      "[0xff, 0x8c, 0x78]",
      "[0xc8, 0x84, 0xff]",
      "[0x92, 0xb7, 0xff]",
    ]) {
      expect(emotion).toContain(anchor);
    }
  });

  it("uses the warning role for confirm audit decisions", () => {
    expect(admin).toMatch(/if \(decision === "confirm"\) return "var\(--astr-warning\)";/);
  });

  it("keeps day text-3 legible on surface-2", () => {
    const lightTheme = css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1];
    if (!lightTheme) throw new Error("Missing light theme declarations");

    const text = cssHexToken(lightTheme, "--astr-text-3");
    const surface = cssHexToken(lightTheme, "--astr-surface-2");

    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
  });
});
