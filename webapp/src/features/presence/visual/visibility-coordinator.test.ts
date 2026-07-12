import { describe, expect, it, vi } from "vitest";

import type { VisibilityState } from "@/lib/semantic-state";

import { createPresenceVisibilityCoordinator } from "./visibility-coordinator";

describe("PresenceVisibilityCoordinator", () => {
  it.each<{
    documentVisible: boolean;
    viewportOnscreen: boolean | null;
    expected: VisibilityState;
  }>([
    { documentVisible: false, viewportOnscreen: null, expected: "hidden" },
    { documentVisible: false, viewportOnscreen: false, expected: "hidden" },
    { documentVisible: false, viewportOnscreen: true, expected: "hidden" },
    { documentVisible: true, viewportOnscreen: null, expected: "offscreen" },
    { documentVisible: true, viewportOnscreen: false, expected: "offscreen" },
    { documentVisible: true, viewportOnscreen: true, expected: "visible" },
  ])(
    "derives $expected from documentVisible=$documentVisible and viewportOnscreen=$viewportOnscreen",
    ({ documentVisible, viewportOnscreen, expected }) => {
      const coordinator = createPresenceVisibilityCoordinator({
        documentVisible,
        viewportOnscreen,
        publish: vi.fn(),
      });

      expect(coordinator.getSnapshot()).toEqual({
        documentVisible,
        viewportOnscreen,
        visibility: expected,
      });
    },
  );

  it("publishes only the final derived union when independent facts change", () => {
    const publish = vi.fn();
    const coordinator = createPresenceVisibilityCoordinator({
      documentVisible: false,
      viewportOnscreen: null,
      publish,
    });

    coordinator.setDocumentVisible(true);

    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual(["offscreen"]);
    expect(publish).not.toHaveBeenCalledWith("visible");

    coordinator.setViewportOnscreen(true);
    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual([
      "offscreen",
      "visible",
    ]);
  });

  it("publishes the fail-closed union on first document synchronization", () => {
    const publish = vi.fn();
    const coordinator = createPresenceVisibilityCoordinator({ publish });
    const initialSnapshot = coordinator.getSnapshot();

    coordinator.setDocumentVisible(true);

    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual(["offscreen"]);
    expect(publish).not.toHaveBeenCalledWith("visible");
    expect(coordinator.getSnapshot()).toBe(initialSnapshot);

    coordinator.setDocumentVisible(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot()).toBe(initialSnapshot);
  });

  it("keeps hidden dominant and suppresses duplicate derived publications", () => {
    const publish = vi.fn();
    const coordinator = createPresenceVisibilityCoordinator({
      documentVisible: false,
      viewportOnscreen: null,
      publish,
    });

    coordinator.setViewportOnscreen(true);
    coordinator.setViewportOnscreen(false);
    coordinator.setDocumentVisible(false);

    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual(["hidden"]);

    coordinator.setDocumentVisible(true);
    coordinator.setViewportOnscreen(false);

    expect(publish.mock.calls.map(([visibility]) => visibility)).toEqual([
      "hidden",
      "offscreen",
    ]);
  });

  it("starts the application baseline fail-closed while viewport evidence is unknown", () => {
    const coordinator = createPresenceVisibilityCoordinator({ publish: vi.fn() });

    expect(coordinator.getSnapshot()).toEqual({
      documentVisible: true,
      viewportOnscreen: null,
      visibility: "offscreen",
    });
  });
});
