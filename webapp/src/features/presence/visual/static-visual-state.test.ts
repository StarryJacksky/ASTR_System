import { describe, expect, it } from "vitest";

import {
  COMPACT_VISUAL_MAX_WIDTH,
  deriveStaticVisualState,
  type StaticVisualBrowserInput,
} from "./static-visual-state";

const DESKTOP_READY: StaticVisualBrowserInput = {
  renderEnvironment: "browser",
  sceneConfigured: true,
  viewportWidth: 1280,
  webglAvailability: "available",
  visibility: "visible",
  motion: "full",
  visualRuntime: "ready",
  retryRequired: false,
};

describe("static visual state", () => {
  it("fails closed during SSR while keeping complete accessible copy", () => {
    const state = deriveStaticVisualState({ renderEnvironment: "server" });

    expect(state).toEqual({
      status: "ssr",
      dynamicEligible: false,
      animationAllowed: false,
      retryAvailable: false,
      announcement: "off",
      copy: {
        label: "星枢灵魂透镜",
        description: "静态灵魂透镜已就绪。",
        retryLabel: null,
      },
    });
  });

  it("allows loading the desktop visual runtime only after every eligibility fact is positive", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      visualRuntime: "loading",
    });

    expect(state.status).toBe("loading");
    expect(state.dynamicEligible).toBe(true);
    expect(state.animationAllowed).toBe(false);
    expect(state.copy.description).toContain("静态代表帧");
  });

  it("states that the dynamic scene is not configured instead of pretending to load", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      sceneConfigured: false,
      visualRuntime: "loading",
    });

    expect(state.status).toBe("notConfigured");
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.retryAvailable).toBe(false);
  });

  it("allows the sole runtime to probe an unknown WebGL capability without Host getContext", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      webglAvailability: "unknown",
      visualRuntime: "loading",
    });

    expect(state.status).toBe("loading");
    expect(state.dynamicEligible).toBe(true);
    expect(state.animationAllowed).toBe(false);
  });

  it("allows animation only for desktop, full-motion, visible and ready state", () => {
    const state = deriveStaticVisualState(DESKTOP_READY);

    expect(state.status).toBe("ready");
    expect(state.dynamicEligible).toBe(true);
    expect(state.animationAllowed).toBe(true);
    expect(state.retryAvailable).toBe(false);
  });

  it.each([
    [COMPACT_VISUAL_MAX_WIDTH, "compact"],
    [375, "compact"],
  ] as const)("keeps width %s on the compact static path", (viewportWidth, status) => {
    const state = deriveStaticVisualState({ ...DESKTOP_READY, viewportWidth });

    expect(state.status).toBe(status);
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
  });

  it("treats the first pixel above the compact boundary as desktop", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      viewportWidth: COMPACT_VISUAL_MAX_WIDTH + 1,
    });

    expect(state.status).toBe("ready");
    expect(state.dynamicEligible).toBe(true);
  });

  it.each([
    [{ motion: "reduced" }, "reduced", "已按系统偏好减少视觉动态。"],
    [{ motion: "paused" }, "paused", "视觉动态已暂停。"],
    [{ visibility: "hidden" }, "hidden", "页面不可见，视觉动态已停止。"],
    [{ visibility: "offscreen" }, "offscreen", "灵魂透镜不在视口内，视觉动态已停止。"],
  ] as const)("derives the %s static reason", (override, status, description) => {
    const state = deriveStaticVisualState({ ...DESKTOP_READY, ...override });

    expect(state.status).toBe(status);
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.copy.description).toBe(description);
  });

  it("uses a static fallback immediately after WebGL context loss", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      visualRuntime: "contextLost",
    });

    expect(state.status).toBe("contextLost");
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.announcement).toBe("polite");
    expect(state.retryAvailable).toBe(false);
  });

  it("advertises one accessible retry action only after restoration is exhausted", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      visualRuntime: "contextLost",
      retryRequired: true,
    });

    expect(state.status).toBe("retryRequired");
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.retryAvailable).toBe(true);
    expect(state.announcement).toBe("polite");
    expect(state.copy.retryLabel).toBe("重试视觉");
  });

  it.each([
    { webglAvailability: "unavailable" },
    { viewportWidth: COMPACT_VISUAL_MAX_WIDTH },
    { motion: "reduced" },
    { motion: "paused" },
    { visibility: "hidden" },
    { visibility: "offscreen" },
  ] as const)(
    "keeps retry state truthful but withholds an ineligible retry control: %o",
    (override) => {
      const state = deriveStaticVisualState({
        ...DESKTOP_READY,
        visualRuntime: "contextLost",
        retryRequired: true,
        ...override,
      });

      expect(state.status).toBe("retryRequired");
      expect(state.retryAvailable).toBe(false);
      expect(state.copy.retryLabel).toBeNull();
    },
  );

  it("fails closed when WebGL support is absent", () => {
    const state = deriveStaticVisualState({
      ...DESKTOP_READY,
      webglAvailability: "unavailable",
    });

    expect(state.status).toBe("unavailable");
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.copy.description).toContain("静态代表帧");
  });

  it.each([
    null,
    undefined,
    {},
    { renderEnvironment: "worker" },
    { ...DESKTOP_READY, viewportWidth: Number.NaN },
    { ...DESKTOP_READY, viewportWidth: Number.POSITIVE_INFINITY },
    { ...DESKTOP_READY, viewportWidth: -1 },
    { ...DESKTOP_READY, webglAvailability: "yes" },
    { ...DESKTOP_READY, visibility: "foreground" },
    { ...DESKTOP_READY, motion: "auto" },
    { ...DESKTOP_READY, visualRuntime: "failed" },
    { ...DESKTOP_READY, retryRequired: 1 },
  ])("fails closed for a runtime-invalid environment: %o", (input) => {
    const state = deriveStaticVisualState(input as never);

    expect(state.status).toBe("unavailable");
    expect(state.dynamicEligible).toBe(false);
    expect(state.animationAllowed).toBe(false);
    expect(state.retryAvailable).toBe(false);
  });

  it("returns deeply frozen state and copy objects", () => {
    const state = deriveStaticVisualState(DESKTOP_READY);

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.copy)).toBe(true);
    expect(() => {
      (state as { status: string }).status = "loading";
    }).toThrow(TypeError);
    expect(() => {
      (state.copy as { description: string }).description = "mutated";
    }).toThrow(TypeError);
  });
});
