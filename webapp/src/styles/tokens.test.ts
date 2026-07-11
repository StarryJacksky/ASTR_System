import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const emotion = readFileSync(resolve(process.cwd(), "src/lib/emotion.ts"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/app/admin/page.tsx"), "utf8");

function customProperty(source: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = source.match(new RegExp(`${escaped}:\\s*([^;]+);`))?.[1]?.trim();
  if (!value) throw new Error(`Missing custom property ${token}`);
  return value;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

function rgbFromHex(value: string): [number, number, number] {
  const hex = value.slice(1);
  const expanded = hex.length === 3 || hex.length === 4
    ? [...hex].map((digit) => `${digit}${digit}`).join("")
    : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function hueForRgb([red8, green8, blue8]: [number, number, number]): {
  hue: number;
  saturation: number;
} {
  const [red, green, blue] = [red8, green8, blue8].map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(max + min - 1));
  const sector = max === red
    ? ((green - blue) / delta) % 6
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation };
}

function isGreenHue(rgb: [number, number, number]): boolean {
  const { hue, saturation } = hueForRgb(rgb);
  return saturation >= 0.2 && hue >= 75 && hue <= 170;
}

function forbiddenGreenUsages(source: string): string[] {
  const code = stripComments(source);
  const findings: string[] = [];
  for (const match of code.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    if (isGreenHue(rgbFromHex(match[0]))) findings.push(match[0]);
  }
  for (const match of code.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    const rgb = match.slice(1, 4).map(Number) as [number, number, number];
    if (rgb.every((channel) => channel <= 255) && isGreenHue(rgb)) findings.push(match[0]);
  }
  for (const match of code.matchAll(/\[\s*0x([0-9a-f]{2})\s*,\s*0x([0-9a-f]{2})\s*,\s*0x([0-9a-f]{2})\s*\]/gi)) {
    const rgb = match.slice(1, 4).map((channel) => Number.parseInt(channel, 16)) as [
      number,
      number,
      number,
    ];
    if (isGreenHue(rgb)) findings.push(match[0]);
  }
  for (const match of code.matchAll(/hsla?\(\s*(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%/gi)) {
    const hue = ((Number(match[1]) % 360) + 360) % 360;
    if (Number(match[2]) >= 20 && hue >= 75 && hue <= 170) findings.push(match[0]);
  }
  const semanticGreen = /(?:bg|text|border|outline|ring|fill|stroke|from|via|to)-(?:green|lime|emerald|teal)(?:-\d+)?\b|(?:color|background(?:-color)?|border-color|fill|stroke)\s*:\s*(?:green|lime|emerald|teal|chartreuse|springgreen|seagreen|forestgreen)\b/gi;
  findings.push(...Array.from(code.matchAll(semanticGreen), (match) => match[0]));
  return findings;
}

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

  it("keeps static frontend color literals and color utilities out of the green hue family", () => {
    expect(isGreenHue(rgbFromHex("#00ff00"))).toBe(true);
    expect(isGreenHue(rgbFromHex("#4ec98f"))).toBe(true);
    expect(isGreenHue(rgbFromHex("#3df5c4"))).toBe(true);
    expect(isGreenHue(rgbFromHex("#8bcfff"))).toBe(false);
    expect(
      forbiddenGreenUsages(
        '// green browser keyword\nconst copy = "evergreen";\nconst url = "https://green.example";\nconst color = action; // bg-green-500 is a comment',
      ),
    ).toEqual([]);
    expect(forbiddenGreenUsages("const anchor = [0x00, 0xff, 0x00];")).not.toEqual([]);

    const findings = sourceFiles(resolve(process.cwd(), "src")).flatMap((file) =>
      forbiddenGreenUsages(readFileSync(file, "utf8")).map((usage) => `${file}: ${usage}`),
    );

    expect(findings).toEqual([]);
  });

  it.each([
    ["--type--1", "11px"],
    ["--type-0", "13px"],
    ["--type-1", "16px"],
    ["--type-2", "20px"],
    ["--type-3", "28px"],
    ["--type-4", "48px"],
    ["--type-5", "72px"],
    ["--leading-body", "1.6"],
    ["--leading-long", "1.75"],
    ["--leading-display", "1"],
  ])("defines the constitutional typography token %s as %s", (token, value) => {
    expect(customProperty(css, token)).toBe(value);
  });

  it.each([
    ["--space-1", "4px"],
    ["--space-2", "8px"],
    ["--space-3", "12px"],
    ["--space-4", "16px"],
    ["--space-5", "24px"],
    ["--space-6", "32px"],
    ["--space-7", "48px"],
    ["--space-8", "72px"],
  ])("defines the constitutional spacing token %s as %s", (token, value) => {
    expect(customProperty(css, token)).toBe(value);
  });

  it.each([
    ["--radius-small", "2px"],
    ["--radius-medium", "6px"],
    ["--radius-large", "12px"],
    ["--radius-jewel", "50%"],
    ["--corner-signature", "14px"],
    ["--motion-instant", "120ms"],
    ["--motion-fast", "200ms"],
    ["--motion-medium", "320ms"],
    ["--motion-ritual", "1200ms"],
    ["--motion-life", "4000ms"],
    ["--ease-standard", "cubic-bezier(.2,.8,.2,1)"],
    ["--ease-emphatic", "cubic-bezier(.16,1,.3,1)"],
    ["--layout-container-max", "1510px"],
    ["--layout-columns-desktop", "12"],
    ["--layout-columns-mobile", "4"],
    ["--layout-gap-min", "16px"],
    ["--layout-gap-max", "24px"],
    ["--layout-density-gap-min", "8px"],
    ["--layout-density-gap-max", "12px"],
    ["--layout-intensity-max", "30%"],
    ["--layout-detail-jewels-max", "1"],
    ["--layout-motion-jewels-max", "1"],
    ["--dpr-desktop", "1.5"],
    ["--dpr-mobile", "1.25"],
    ["--touch-target", "44px"],
  ])("defines the constitutional craft token %s as %s", (token, value) => {
    expect(customProperty(css, token)).toBe(value);
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
