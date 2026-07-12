import { StrictMode, useRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPresenceVisibilityCoordinator,
  type PresenceVisibilityCoordinator,
} from "./visibility-coordinator";
import {
  PRESENCE_VISIBILITY_THRESHOLD,
  PresenceVisibilityBridge,
} from "./PresenceVisibilityBridge";

interface ObserverRecord {
  readonly callback: IntersectionObserverCallback;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly observe: ReturnType<typeof vi.fn>;
  disconnected: boolean;
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

function createObserverHarness() {
  const records: ObserverRecord[] = [];
  let live = 0;
  let maximumLive = 0;

  const Observer = class {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [PRESENCE_VISIBILITY_THRESHOLD];
    readonly observe = vi.fn();
    readonly unobserve = vi.fn();
    readonly takeRecords = vi.fn(() => []);
    readonly disconnect: ReturnType<typeof vi.fn>;

    constructor(callback: IntersectionObserverCallback) {
      live += 1;
      maximumLive = Math.max(maximumLive, live);
      const record: ObserverRecord = {
        callback,
        disconnected: false,
        disconnect: vi.fn(() => {
          if (record.disconnected) return;
          record.disconnected = true;
          live -= 1;
        }),
        observe: this.observe,
      };
      this.disconnect = record.disconnect;
      records.push(record);
    }
  };

  return {
    Observer,
    emit(record: ObserverRecord, target: Element, isIntersecting: boolean, ratio: number) {
      act(() => {
        record.callback(
          [
            {
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRatio: ratio,
              intersectionRect: target.getBoundingClientRect(),
              isIntersecting,
              rootBounds: null,
              target,
              time: 1,
            },
          ],
          {} as IntersectionObserver,
        );
      });
    },
    get live() {
      return live;
    },
    get maximumLive() {
      return maximumLive;
    },
    records,
  };
}

function BridgeHarness({
  coordinator,
  strict = false,
}: {
  readonly coordinator: PresenceVisibilityCoordinator;
  readonly strict?: boolean;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const content = (
    <>
      <div data-testid="presence-visibility-target" ref={targetRef} />
      <PresenceVisibilityBridge coordinator={coordinator} targetRef={targetRef} />
    </>
  );
  return strict ? <StrictMode>{content}</StrictMode> : content;
}

describe("PresenceVisibilityBridge", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: originalIntersectionObserver,
    });
  });

  it("owns one observer with the named threshold and maps entries to viewport facts", () => {
    const harness = createObserverHarness();
    const construct = vi.fn(function (
      this: IntersectionObserver,
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      expect(options).toEqual({ threshold: PRESENCE_VISIBILITY_THRESHOLD });
      return new harness.Observer(callback);
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: construct,
    });
    const publish = vi.fn();
    const coordinator = createPresenceVisibilityCoordinator({ publish });

    const { unmount } = render(<BridgeHarness coordinator={coordinator} />);
    const target = screen.getByTestId("presence-visibility-target");
    const observer = harness.records[0];

    expect(construct).toHaveBeenCalledTimes(1);
    expect(observer?.observe).toHaveBeenCalledWith(target);
    expect(coordinator.getSnapshot().viewportOnscreen).toBe(false);
    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual(["offscreen"]);

    harness.emit(observer!, target, true, PRESENCE_VISIBILITY_THRESHOLD - 0.01);
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");

    harness.emit(observer!, target, true, PRESENCE_VISIBILITY_THRESHOLD);
    expect(coordinator.getSnapshot().visibility).toBe("visible");
    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual([
      "offscreen",
      "visible",
    ]);

    unmount();
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");
    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual([
      "offscreen",
      "visible",
      "offscreen",
    ]);
  });

  it("never keeps two observers live under StrictMode and ignores stale callbacks", () => {
    const harness = createObserverHarness();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: harness.Observer,
    });
    const coordinator = createPresenceVisibilityCoordinator({ publish: vi.fn() });

    const { rerender, unmount } = render(<BridgeHarness coordinator={coordinator} strict />);
    const staleTarget = screen.getByTestId("presence-visibility-target");

    rerender(<BridgeHarness key="strict-remount" coordinator={coordinator} strict />);
    const liveTarget = screen.getByTestId("presence-visibility-target");

    expect(harness.records.length).toBeGreaterThanOrEqual(2);
    expect(harness.maximumLive).toBe(1);
    expect(harness.live).toBe(1);

    const staleObserver = harness.records.find((record) => record.disconnected)!;
    harness.emit(staleObserver, staleTarget, true, 1);
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");

    const liveObserver = harness.records.find((record) => !record.disconnected)!;
    harness.emit(liveObserver, liveTarget, true, 1);
    expect(coordinator.getSnapshot().visibility).toBe("visible");

    unmount();
    expect(harness.live).toBe(0);
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");

    harness.emit(liveObserver, liveTarget, true, 1);
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");
  });

  it("fails closed without IntersectionObserver support", () => {
    const coordinator = createPresenceVisibilityCoordinator({
      publish: vi.fn(),
      viewportOnscreen: true,
    });

    const { unmount } = render(<BridgeHarness coordinator={coordinator} />);

    expect(coordinator.getSnapshot().visibility).toBe("offscreen");
    unmount();
    expect(coordinator.getSnapshot().visibility).toBe("offscreen");
  });

  it("does not create an animation-frame loop", () => {
    const harness = createObserverHarness();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: harness.Observer,
    });
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
    const coordinator = createPresenceVisibilityCoordinator({ publish: vi.fn() });

    const { unmount } = render(<BridgeHarness coordinator={coordinator} />);
    harness.emit(
      harness.records[0]!,
      screen.getByTestId("presence-visibility-target"),
      true,
      1,
    );
    unmount();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
