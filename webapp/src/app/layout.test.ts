import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("root viewport", () => {
  it("enables safe-area geometry without disabling zoom", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(source).toMatch(/import type \{ Metadata, Viewport \} from "next"/);
    expect(source).toMatch(/export const viewport:\s*Viewport/);
    expect(source).toMatch(/width:\s*"device-width"/);
    expect(source).toMatch(/initialScale:\s*1/);
    expect(source).toMatch(/viewportFit:\s*"cover"/);
    expect(source).not.toMatch(/maximumScale|userScalable/);
  });
});
