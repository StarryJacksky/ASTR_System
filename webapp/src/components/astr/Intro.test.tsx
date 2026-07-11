import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Intro", () => {
  it("does not own an independent animation frame loop", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/astr/Intro.tsx"), "utf8");

    expect(source).not.toMatch(/(?:request|cancel)AnimationFrame/);
  });
});
