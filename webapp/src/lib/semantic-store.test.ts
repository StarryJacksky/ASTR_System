import { describe, expect, it } from "vitest";

import { createSemanticStore, semanticStore, useSemanticStore } from "./semantic-store";

describe("semantic store", () => {
  it("dispatches events through the semantic reducer", () => {
    const store = createSemanticStore();

    store.getState().dispatch({ type: "STATUS_OK" });
    store.getState().dispatch({ type: "WEBGL_LOST" });

    expect(store.getState()).toMatchObject({
      core: "reachable",
      visualRuntime: "contextLost",
    });
  });

  it("atomically replaces the live-region announcement", () => {
    const store = createSemanticStore();

    store.getState().announce("Core connected");
    const first = store.getState().announcement;
    store.getState().announce("Execution stopped", "assertive");

    expect(first).toEqual({ id: 1, message: "Core connected", politeness: "polite" });
    expect(store.getState().announcement).toEqual({
      id: 2,
      message: "Execution stopped",
      politeness: "assertive",
    });
    expect(store.getState().announcement).not.toBe(first);
    expect(Array.isArray(store.getState().announcement)).toBe(false);
  });

  it("clears an announcement without changing semantic state", () => {
    const store = createSemanticStore();
    store.getState().dispatch({ type: "STATUS_OK" });
    store.getState().announce("Core connected");

    store.getState().clearAnnouncement();

    expect(store.getState().announcement).toBeNull();
    expect(store.getState().core).toBe("reachable");
  });

  it("creates isolated stores while also exporting one app singleton and selector hook", () => {
    const first = createSemanticStore();
    const second = createSemanticStore();
    first.getState().dispatch({ type: "STATUS_OK" });

    expect(second.getState().core).toBe("cold");
    expect(semanticStore).not.toBe(first);
    expect(typeof useSemanticStore).toBe("function");
  });
});
