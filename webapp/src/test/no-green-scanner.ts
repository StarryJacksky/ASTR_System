export const CSS_GREEN_HUE_NAMES = [
  "aquamarine",
  "chartreuse",
  "darkgreen",
  "darkolivegreen",
  "darkseagreen",
  "forestgreen",
  "green",
  "greenyellow",
  "honeydew",
  "lawngreen",
  "lightgreen",
  "lightseagreen",
  "lime",
  "limegreen",
  "mediumaquamarine",
  "mediumseagreen",
  "mediumspringgreen",
  "mintcream",
  "olivedrab",
  "palegreen",
  "seagreen",
  "springgreen",
  "teal",
  "yellowgreen",
] as const;

function stripComments(source: string): string {
  let result = "";
  let quote: '"' | "'" | "`" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (character === "\\" && next !== undefined) {
        result += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      if (index < source.length) result += "\n";
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") result += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
}

export function rgbFromHex(value: string): [number, number, number] {
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

export function isGreenHue(rgb: [number, number, number]): boolean {
  const { hue, saturation } = hueForRgb(rgb);
  return saturation >= 0.2 && hue >= 75 && hue <= 170;
}

function namedGreenPattern(flags: string): RegExp {
  return new RegExp(`\\b(?:${CSS_GREEN_HUE_NAMES.join("|")})\\b`, flags);
}

export function findForbiddenGreenUsages(source: string): string[] {
  const code = stripComments(source);
  const findings: string[] = [];

  for (const match of code.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    if (isGreenHue(rgbFromHex(match[0]))) findings.push(match[0]);
  }

  for (const match of code.matchAll(/rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/gi)) {
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

  for (const match of code.matchAll(/hsla?\(\s*(-?[\d.]+)(?:deg)?(?:\s*,\s*|\s+)([\d.]+)%/gi)) {
    const hue = ((Number(match[1]) % 360) + 360) % 360;
    if (Number(match[2]) >= 20 && hue >= 75 && hue <= 170) findings.push(match[0]);
  }

  for (const match of code.matchAll(/(["'`])\s*([a-z]+)\s*\1/gi)) {
    if (CSS_GREEN_HUE_NAMES.includes(match[2].toLowerCase() as (typeof CSS_GREEN_HUE_NAMES)[number])) {
      findings.push(match[0]);
    }
  }

  const colorValue = /(?:--[\w-]+|accent-color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?-color|caret-color|color|fill|flood-color|lighting-color|outline-color|stop-color|stroke|text-decoration-color)\s*:\s*([^;}\n]+)/gi;
  for (const match of code.matchAll(colorValue)) {
    findings.push(...Array.from(match[1].matchAll(namedGreenPattern("gi")), (named) => named[0]));
  }

  const utility = /(?:bg|text|border|outline|ring|fill|stroke|from|via|to)-(?:green|lime|emerald|teal)(?:-\d+)?\b|(?:bg|text|border|outline|ring|fill|stroke|from|via|to)-\[(?:aquamarine|chartreuse|darkgreen|lightgreen|lime|seagreen|springgreen|teal|yellowgreen)\]/gi;
  findings.push(...Array.from(code.matchAll(utility), (match) => match[0]));

  return findings;
}
