import { describe, expect, it, vi } from "vitest";

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

  it("dispatches multiple semantic events in one atomic store notification", () => {
    const store = createSemanticStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().dispatchMany([
      { type: "REPLY_SSE_CONNECTING" },
      { type: "LIFE_SSE_CONNECTING" },
      { type: "ESTOP_STATUS_CHECK" },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      replySse: "connecting",
      lifeSse: "connecting",
      safety: "stopUnknown",
    });
    unsubscribe();
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

  it("keeps announcement ids monotonic across clears so repeated text can be re-announced", () => {
    const store = createSemanticStore();

    store.getState().announce("状态未变化");
    const firstId = store.getState().announcement?.id;
    store.getState().clearAnnouncement();
    store.getState().announce("状态未变化");

    expect(firstId).toBe(1);
    expect(store.getState().announcement).toEqual({
      id: 2,
      message: "状态未变化",
      politeness: "polite",
    });
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
