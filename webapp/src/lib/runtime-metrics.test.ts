import { afterEach, describe, expect, it } from "vitest";

import {
  clearRuntimeMetrics,
  readRuntimeMetrics,
  recordRuntimeMetric,
  type RuntimeMetricName,
} from "./runtime-metrics";

describe("runtime metrics", () => {
  afterEach(() => clearRuntimeMetrics());

  it("keeps only the latest 100 samples across mixed metric names", () => {
    const names = [
      "app-raf",
      "webgl-context",
      "draw-calls",
      "gpu-memory-mib",
      "decoded-texture-mib",
      "canvas-backing-width",
      "canvas-backing-height",
    ] as const;

    for (let index = 0; index < 105; index += 1) {
      recordRuntimeMetric(names[index % names.length], index, index);
    }

    const samples = readRuntimeMetrics();

    expect(samples).toHaveLength(100);
    expect(samples[0]).toEqual({ name: "canvas-backing-width", value: 5, at: 5 });
    expect(samples.at(-1)).toEqual({ name: "canvas-backing-height", value: 104, at: 104 });
  });

  it("rejects names outside the runtime allowlist even through an unsafe call", () => {
    const recordUnsafe = recordRuntimeMetric as unknown as (
      name: unknown,
      value: number,
      at: number,
    ) => void;

    recordUnsafe("raf", 1, 1);
    recordUnsafe("APP-RAF", 1, 2);
    recordUnsafe("", 1, 3);
    recordUnsafe(-1, 1, 4);
    recordUnsafe(Number.NaN, 1, 5);
    recordUnsafe(Number.POSITIVE_INFINITY, 1, 6);
    recordUnsafe(null, 1, 7);

    expect(readRuntimeMetrics()).toEqual([]);
  });

  it("ignores non-finite or negative values and timestamps", () => {
    recordRuntimeMetric("app-raf", Number.NaN, 1);
    recordRuntimeMetric("webgl-context", Number.POSITIVE_INFINITY, 2);
    recordRuntimeMetric("draw-calls", -1, 3);
    recordRuntimeMetric("gpu-memory-mib", 1, Number.NaN);
    recordRuntimeMetric("decoded-texture-mib", 1, -1);

    expect(readRuntimeMetrics()).toEqual([]);
  });

  it("uses the default clock only when the timestamp is truly omitted", () => {
    const recordUnsafe = recordRuntimeMetric as unknown as (
      name: "app-raf",
      value: number,
      at?: unknown,
    ) => void;

    recordUnsafe("app-raf", 1, null);
    recordUnsafe("app-raf", 1, "12");
    recordUnsafe("app-raf", 1, {});

    expect(readRuntimeMetrics()).toEqual([]);

    recordUnsafe("app-raf", 0);
    expect(readRuntimeMetrics()).toHaveLength(1);
    expect(readRuntimeMetrics()[0].at).toEqual(expect.any(Number));
  });

  it("accepts real canvas backing dimensions without inventing a derived sample", () => {
    recordRuntimeMetric("canvas-backing-width", 1440, 8);
    recordRuntimeMetric("canvas-backing-height", 900, 9);

    expect(readRuntimeMetrics()).toEqual([
      { name: "canvas-backing-width", value: 1440, at: 8 },
      { name: "canvas-backing-height", value: 900, at: 9 },
    ]);
  });

  it("returns fresh frozen snapshots whose records cannot mutate internal samples", () => {
    recordRuntimeMetric("app-raf", 0, 12);

    const firstRead = readRuntimeMetrics();
    const mutableRead = firstRead as unknown as Array<{
      name: RuntimeMetricName;
      value: number;
      at: number;
    }>;

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
