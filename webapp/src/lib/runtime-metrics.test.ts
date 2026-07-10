import { afterEach, describe, expect, it } from "vitest";

import {
  clearRuntimeMetrics,
  readRuntimeMetrics,
  recordRuntimeMetric,
  type RuntimeMetric,
} from "./runtime-metrics";

describe("runtime metrics", () => {
  afterEach(() => clearRuntimeMetrics());

  it("keeps only the latest 100 samples", () => {
    for (let index = 0; index < 105; index += 1) {
      recordRuntimeMetric("app-raf", index, index);
    }

    const samples = readRuntimeMetrics();

    expect(samples).toHaveLength(100);
    expect(samples[0]).toEqual({ name: "app-raf", value: 5, at: 5 });
    expect(samples.at(-1)).toEqual({ name: "app-raf", value: 104, at: 104 });
  });

  it("ignores non-finite or negative values and timestamps", () => {
    recordRuntimeMetric("app-raf", Number.NaN, 1);
    recordRuntimeMetric("webgl-context", Number.POSITIVE_INFINITY, 2);
    recordRuntimeMetric("draw-calls", -1, 3);
    recordRuntimeMetric("gpu-memory-mib", 1, Number.NaN);
    recordRuntimeMetric("decoded-texture-mib", 1, -1);

    expect(readRuntimeMetrics()).toEqual([]);
  });

  it("returns fresh frozen snapshots whose records cannot mutate internal samples", () => {
    recordRuntimeMetric("app-raf", 0, 12);

    const firstRead = readRuntimeMetrics();
    const mutableRead = firstRead as RuntimeMetric[];

    expect(Object.isFrozen(firstRead)).toBe(true);
    expect(Object.isFrozen(firstRead[0])).toBe(true);
    expect(() => {
      mutableRead[0].value = 99;
    }).toThrow(TypeError);
    expect(() => {
      mutableRead.push({ name: "app-raf", value: 1, at: 13 });
    }).toThrow(TypeError);

    const secondRead = readRuntimeMetrics();
    expect(secondRead).not.toBe(firstRead);
    expect(secondRead[0]).not.toBe(firstRead[0]);
    expect(secondRead).toEqual([{ name: "app-raf", value: 0, at: 12 }]);
  });

  it("clears all in-memory samples", () => {
    recordRuntimeMetric("app-raf", 0, 1);

    clearRuntimeMetrics();

    expect(readRuntimeMetrics()).toEqual([]);
  });
});
