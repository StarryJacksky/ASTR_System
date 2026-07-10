import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialSemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import { SemanticRuntimeBridge } from "./SemanticRuntimeBridge";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const initialVisibilityDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

function createReducedMotionQuery(initialMatches = false) {
  let matches = initialMatches;
  let changeListener: ((event: MediaQueryListEvent) => void) | undefined;

  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: vi.fn(
      (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      },
    ),
    removeEventListener: vi.fn(
      (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
        if (changeListener === listener) changeListener = undefined;
      },
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      act(() =>
        changeListener?.({
          matches: nextMatches,
          media: REDUCED_MOTION_QUERY,
        } as MediaQueryListEvent),
      );
    },
  };
}

describe("SemanticRuntimeBridge", () => {
  beforeEach(() => {
    setDocumentVisibility("visible");
    semanticStore.setState({
      ...initialSemanticState,
      announcement: null,
    });
  });

  afterEach(() => {
    if (initialVisibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", initialVisibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("synchronizes the current and changing document visibility", () => {
    const reducedMotion = createReducedMotionQuery();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotion.mediaQuery);
    setDocumentVisibility("hidden");

    render(<SemanticRuntimeBridge />);

    expect(semanticStore.getState().visibility).toBe("hidden");

    setDocumentVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(semanticStore.getState().visibility).toBe("visible");
  });

  it("tracks reduced-motion changes while preserving an explicit pause", () => {
    const reducedMotion = createReducedMotionQuery();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotion.mediaQuery);
    render(<SemanticRuntimeBridge />);

    reducedMotion.setMatches(true);
    expect(semanticStore.getState().motion).toBe("reduced");

    reducedMotion.setMatches(false);
    expect(semanticStore.getState().motion).toBe("full");

    act(() => semanticStore.getState().dispatch({ type: "VISUAL_PAUSE" }));
    reducedMotion.setMatches(true);
    reducedMotion.setMatches(false);

    expect(semanticStore.getState().motion).toBe("paused");
  });

  it("reapplies live reduced-motion truth whenever visual motion resumes", () => {
    const reducedMotion = createReducedMotionQuery();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotion.mediaQuery);
    render(<SemanticRuntimeBridge />);

    act(() => semanticStore.getState().dispatch({ type: "VISUAL_PAUSE" }));
    reducedMotion.setMatches(true);
    act(() => semanticStore.getState().dispatch({ type: "VISUAL_RESUME" }));

    expect(semanticStore.getState().motion).toBe("reduced");

    act(() => semanticStore.getState().dispatch({ type: "VISUAL_RESUME" }));

    expect(semanticStore.getState().motion).toBe("reduced");
  });

  it("registers one listener per browser signal and removes both on unmount", () => {
    const reducedMotion = createReducedMotionQuery();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotion.mediaQuery);
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");

    const { container, unmount } = render(<SemanticRuntimeBridge />);

    const visibilityRegistrations = addEventListener.mock.calls.filter(
      ([type]) => type === "visibilitychange",
    );
    expect(visibilityRegistrations).toHaveLength(1);
    expect(reducedMotion.mediaQuery.addEventListener).toHaveBeenCalledTimes(1);
    expect(reducedMotion.mediaQuery.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(container).toBeEmptyDOMElement();

    unmount();

    const visibilityRemovals = removeEventListener.mock.calls.filter(
      ([type]) => type === "visibilitychange",
    );
    expect(visibilityRemovals).toHaveLength(1);
    expect(visibilityRemovals[0]?.[1]).toBe(visibilityRegistrations[0]?.[1]);
    expect(reducedMotion.mediaQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("does not create an animation frame loop", () => {
    const reducedMotion = createReducedMotionQuery();
    vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotion.mediaQuery);
    const requestAnimationFrame = vi.fn();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: requestAnimationFrame,
    });

    const { unmount } = render(<SemanticRuntimeBridge />);
    reducedMotion.setMatches(true);
    setDocumentVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    unmount();

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
  });
});
