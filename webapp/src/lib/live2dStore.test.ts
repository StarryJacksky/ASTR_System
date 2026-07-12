import { afterEach, describe, expect, it } from "vitest";

import {
  L2D_DEFAULT,
  LIVE2D_STORAGE_KEY,
  loadLive2DTransform,
  normalizeLive2DTransform,
  useLive2D,
} from "./live2dStore";

afterEach(() => {
  localStorage.clear();
  useLive2D.getState().reset();
});

describe("Live2D transform validation", () => {
  it("uses per-field defaults for non-finite and non-numeric values", () => {
    expect(
      normalizeLive2DTransform({
        scale: Number.NaN,
        x: Number.POSITIVE_INFINITY,
        y: "0.2",
      }),
    ).toEqual(L2D_DEFAULT);
  });

  it("clamps finite values to the truthful control ranges", () => {
    expect(normalizeLive2DTransform({ scale: 99, x: -99, y: 99 })).toEqual({
      scale: 0.4,
      x: -0.5,
      y: 1.5,
    });
  });

  it("fails safely for corrupt storage and clamps a valid stored object", () => {
    const corrupt = { getItem: () => "{" };
    expect(loadLive2DTransform(corrupt)).toEqual(L2D_DEFAULT);

    const hostile = {
      getItem: () =>
        JSON.stringify({
          scale: 20,
          x: -20,
          y: Number.POSITIVE_INFINITY,
        }),
    };
    expect(loadLive2DTransform(hostile)).toEqual({
      scale: 0.4,
      x: -0.5,
      y: L2D_DEFAULT.y,
    });
  });

  it("sanitizes every store patch before exposing or persisting it", () => {
    useLive2D.getState().set({ scale: Number.NEGATIVE_INFINITY, x: 4, y: -4 });

    expect(useLive2D.getState()).toMatchObject({
      scale: L2D_DEFAULT.scale,
      x: 0.5,
      y: -1.5,
    });
    expect(JSON.parse(localStorage.getItem(LIVE2D_STORAGE_KEY) ?? "null")).toEqual({
      scale: L2D_DEFAULT.scale,
      x: 0.5,
      y: -1.5,
    });
  });
});
