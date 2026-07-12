import { describe, expect, it, vi } from "vitest";

import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  type PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import { initialSemanticState, type SemanticState } from "@/lib/semantic-state";
import type { AstrEvent, ConversationProjection } from "@/lib/types";

import {
  JEWEL_RUNTIME_SERVER_SNAPSHOT,
  createJewelOwnership,
  createJewelRuntime,
  type JewelRuntime,
} from "./jewel-runtime";

const READY_SEMANTIC: SemanticState = {
  ...initialSemanticState,
  visibility: "visible",
  motion: "full",
  visualRuntime: "ready",
};

function event({
  id,
  traceId = "trace-active",
  source = "soul.orchestrator",
  stage = "recall",
  type = "agent.thought",
  payload,
}: {
  readonly id: string;
  readonly traceId?: string;
  readonly source?: string;
  readonly stage?: string;
  readonly type?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}): AstrEvent {
  return {
    id,
    trace_id: traceId,
    type,
    source,
    ts: "2026-07-12T00:00:00.000Z",
    payload: payload ?? { text: `stage ${stage}`, stage },
  };
}

function conversation(
  overrides: Partial<ConversationProjection> = {},
): ConversationProjection {
  return {
    messages: [],
    receipt: { event_id: "ingest-1", trace_id: "trace-active" },
    provisionalText: "",
    provisionalActive: false,
    authoritativeDecision: null,
    error: null,
    ...overrides,
  };
}

function presence({
  conversation: nextConversation = conversation(),
  lifeEvents = [],
  semantic = READY_SEMANTIC,
}: {
  readonly conversation?: ConversationProjection;
  readonly lifeEvents?: readonly AstrEvent[];
  readonly semantic?: SemanticState;
} = {}): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: Object.freeze({ ...semantic }),
    conversation: nextConversation,
    lifeEvents,
  });
}

function readyRuntime(snapshot = presence()): JewelRuntime {
  const runtime = createJewelRuntime();
  runtime.syncSemantic(READY_SEMANTIC);
  runtime.primePresence(snapshot);
  return runtime;
}

describe("application Jewel runtime", () => {
  it("projects owner-scoped generation tokens and rejects a stale visual release", () => {
    const runtime = readyRuntime();
    const lensOwnership = createJewelOwnership(runtime, ["soulLens"]);
    const live2dOwnership = createJewelOwnership(runtime, ["live2d"]);
    const aggregateOwnership = createJewelOwnership(runtime, ["soulLens", "live2d"]);

    const first = runtime.acquire({
      owner: "soulLens",
      mode: "streamStage",
      traceId: "trace-active",
      semanticEnd: "recall",
    });
    expect(first).not.toBeNull();
    const firstLensSnapshot = lensOwnership.getSnapshot();
    expect(firstLensSnapshot.ownsLease).toBe(true);
    if (!firstLensSnapshot.ownsLease) throw new Error("expected Lens ownership");
    const staleToken = firstLensSnapshot.leaseToken;
    expect(live2dOwnership.getSnapshot().ownsLease).toBe(false);
    expect(aggregateOwnership.getSnapshot().ownsLease).toBe(true);

    const newest = runtime.acquire({
      owner: "soulLens",
      mode: "streamStage",
      traceId: "trace-active",
      semanticEnd: "compose",
    });
    expect(newest).not.toBeNull();
    const newestSnapshot = runtime.getSnapshot();
    const newestLensSnapshot = lensOwnership.getSnapshot();
    if (!newestLensSnapshot.ownsLease) throw new Error("expected newest Lens ownership");
    const newestToken = newestLensSnapshot.leaseToken;
    expect(newestToken).not.toBe(staleToken);

    lensOwnership.releaseOwned("initialization-failed", staleToken);
    expect(runtime.getSnapshot()).toBe(newestSnapshot);
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "soulLens",
      semanticEnd: "compose",
    });

    lensOwnership.releaseOwned("initialization-failed", newestToken);
    expect(runtime.getSnapshot()).toMatchObject({
      lease: null,
      endpoint: { kind: "rest" },
      activeDynamicJewelCount: 0,
    });
  });

  it("publishes stable, frozen external-store snapshots and ignores rejected mutations", () => {
    const runtime = createJewelRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    expect(runtime.getServerSnapshot()).toBe(JEWEL_RUNTIME_SERVER_SNAPSHOT);
    expect(runtime.getServerSnapshot()).toBe(runtime.getServerSnapshot());
    expect(runtime.getSnapshot()).toBe(JEWEL_RUNTIME_SERVER_SNAPSHOT);
    expect(Object.isFrozen(runtime.getSnapshot())).toBe(true);
    expect(Object.isFrozen(runtime.getSnapshot().endpoint)).toBe(true);

    expect(
      runtime.acquire({ owner: "live2d", mode: "idle", traceId: null }),
    ).toBeNull();
    expect(runtime.getSnapshot()).toBe(JEWEL_RUNTIME_SERVER_SNAPSHOT);
    expect(listener).not.toHaveBeenCalled();

    runtime.syncSemantic(READY_SEMANTIC);
    const handle = runtime.acquire({
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trace-nav",
      semanticEnd: "life",
    });
    expect(handle).not.toBeNull();
    expect(runtime.getSnapshot()).not.toBe(JEWEL_RUNTIME_SERVER_SNAPSHOT);
    expect(runtime.getSnapshot()).toMatchObject({ activeDynamicJewelCount: 1 });
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trace-nav",
    });
    expect(runtime.getSnapshot().lease).not.toBe(handle);
    expect(Object.getOwnPropertySymbols(runtime.getSnapshot().lease ?? {})).toHaveLength(0);
    expect(Object.isFrozen(runtime.getSnapshot().lease)).toBe(true);

    const stable = runtime.getSnapshot();
    runtime.syncSemantic({ ...READY_SEMANTIC });
    expect(runtime.getSnapshot()).toBe(stable);

    unsubscribe();
  });

  it("publishes capability revocation immediately and fails closed afterward", () => {
    const runtime = createJewelRuntime({
      capabilities: { canReturnArtifact: true },
    });
    runtime.syncSemantic(READY_SEMANTIC);
    const artifact = runtime.acquire({
      owner: "artifactReturn",
      mode: "complete",
      traceId: "trace-artifact",
      semanticEnd: "artifact-ready",
    });
    expect(artifact).not.toBeNull();
    expect(runtime.getSnapshot().lease?.owner).toBe("artifactReturn");

    runtime.syncCapabilities({ canReturnArtifact: false });

    expect(runtime.getSnapshot()).toMatchObject({
      lease: null,
      activeDynamicJewelCount: 0,
    });
    expect(
      runtime.acquire({
        owner: "artifactReturn",
        mode: "complete",
        traceId: "trace-artifact-new",
      }),
    ).toBeNull();
  });

  it("owns only the exact newest generation and ignores stale runtime settlement", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_752_278_400_000);
    const runtime = readyRuntime();
    const intent = {
      owner: "orbitTraveler" as const,
      mode: "navigate" as const,
      traceId: "trace-same",
      semanticEnd: "life",
    };
    const oldHandle = runtime.acquire(intent);
    const newHandle = runtime.acquire(intent);
    expect(oldHandle).not.toBeNull();
    expect(newHandle).not.toBeNull();
    if (oldHandle === null || newHandle === null) {
      throw new Error("expected both Jewel generations to be acquired");
    }
    expect(oldHandle).toMatchObject(newHandle);
    expect(runtime.owns(oldHandle)).toBe(false);
    expect(runtime.owns(newHandle)).toBe(true);

    const newestSnapshot = runtime.getSnapshot();
    runtime.complete(oldHandle, {
      kind: "stage",
      traceId: "trace-stale",
      stage: "stale",
    });
    runtime.release(oldHandle);

    expect(runtime.getSnapshot()).toBe(newestSnapshot);
    expect(runtime.getSnapshot().endpoint).toBe(newestSnapshot.endpoint);
    expect(runtime.owns(newHandle)).toBe(true);
    now.mockRestore();
  });

  it("lands a preempted Lens on its semantic endpoint before publishing safety", () => {
    const runtime = readyRuntime();
    const lens = runtime.acquire({
      owner: "soulLens",
      mode: "streamStage",
      traceId: "trace-active",
      semanticEnd: "compose",
    });
    expect(lens).not.toBeNull();
    const snapshots: Array<ReturnType<JewelRuntime["getSnapshot"]>> = [];
    const unsubscribe = runtime.subscribe(() => snapshots.push(runtime.getSnapshot()));

    const safety = runtime.acquire({
      owner: "safetyBoundary",
      mode: "stop",
      traceId: "trace-stop",
      semanticEnd: "rest",
    });

    expect(safety).not.toBeNull();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      lease: { owner: "safetyBoundary", mode: "stop", traceId: "trace-stop" },
      endpoint: { kind: "stage", traceId: "trace-active", stage: "compose" },
      activeDynamicJewelCount: 1,
    });
    if (lens !== null && safety !== null) {
      expect(runtime.owns(lens)).toBe(false);
      expect(runtime.owns(safety)).toBe(true);
    }
    unsubscribe();
  });

  it.each(["reduced", "paused"] as const)(
    "resets a released Lens endpoint to rest when motion is %s",
    (motion) => {
      const runtime = readyRuntime();
      const lens = runtime.acquire({
        owner: "soulLens",
        mode: "streamStage",
        traceId: "trace-active",
        semanticEnd: "compose",
      });
      expect(lens).not.toBeNull();

      runtime.syncSemantic({ ...READY_SEMANTIC, motion });

      expect(runtime.getSnapshot()).toMatchObject({
        lease: null,
        endpoint: { kind: "rest", traceId: null, stage: null },
        activeDynamicJewelCount: 0,
      });
    },
  );

  it.each([
    { visibility: "hidden", motion: "full", visualRuntime: "ready" },
    { visibility: "offscreen", motion: "full", visualRuntime: "ready" },
    { visibility: "visible", motion: "reduced", visualRuntime: "ready" },
    { visibility: "visible", motion: "paused", visualRuntime: "ready" },
    { visibility: "visible", motion: "full", visualRuntime: "loading" },
    { visibility: "visible", motion: "full", visualRuntime: "contextLost" },
  ] as const)(
    "releases immediately and rejects acquisition in $visibility/$motion/$visualRuntime",
    (environment) => {
      const runtime = readyRuntime();
      const active = runtime.acquire({
        owner: "live2d",
        mode: "idle",
        traceId: null,
        semanticEnd: "rest",
      });
      expect(active).not.toBeNull();

      runtime.syncSemantic({ ...READY_SEMANTIC, ...environment });

      expect(runtime.getSnapshot().lease).toBeNull();
      expect(runtime.getSnapshot().activeDynamicJewelCount).toBe(0);
      expect(
        runtime.acquire({ owner: "safetyBoundary", mode: "stop", traceId: "stop" }),
      ).toBeNull();
    },
  );

  it("accepts only a new own nonblank active-trace stage event", () => {
    const runtime = readyRuntime();
    const baseline = presence();
    const inheritedPayload = Object.create({ stage: "forged" }) as Record<string, unknown>;
    inheritedPayload.text = "inherited stage";
    const rejected = [
      event({ id: "heartbeat", source: "soul.heartbeat", stage: "monologue" }),
      event({ id: "local-stage", source: "local.timer", stage: "compose" }),
      event({ id: "other-trace", traceId: "trace-other" }),
      event({ id: "wrong-type", type: "moa.report" }),
      event({ id: "blank-stage", payload: { text: "blank", stage: "   " } }),
      event({ id: "inherited-stage", payload: inheritedPayload }),
    ];

    runtime.syncPresence(presence({ lifeEvents: rejected }));
    expect(runtime.getSnapshot().lease).toBeNull();

    const valid = event({ id: "valid-stage", stage: "compose" });
    runtime.syncPresence(presence({ lifeEvents: [...rejected, valid] }));
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "soulLens",
      mode: "streamStage",
      traceId: "trace-active",
      semanticEnd: "compose",
    });

    const firstLease = runtime.getSnapshot().lease;
    runtime.syncPresence(presence({ lifeEvents: [...rejected, valid] }));
    expect(runtime.getSnapshot().lease).toBe(firstLease);

    const newer = event({ id: "new-stage", stage: "memory" });
    runtime.syncPresence(presence({ lifeEvents: [...rejected, valid, newer] }));
    expect(runtime.getSnapshot().lease).not.toBe(firstLease);
    expect(runtime.getSnapshot().lease).toMatchObject({ semanticEnd: "memory" });

    expect(baseline.conversation.receipt?.trace_id).toBe("trace-active");
  });

  it("does not normalize receipt trace identity when matching a stage event", () => {
    const paddedConversation = conversation({
      receipt: { event_id: "ingest-padded", trace_id: " trace-active " },
    });
    const runtime = readyRuntime(
      presence({ conversation: paddedConversation }),
    );

    runtime.syncPresence(
      presence({
        conversation: paddedConversation,
        lifeEvents: [event({ id: "untrimmed-mismatch", traceId: "trace-active" })],
      }),
    );

    expect(runtime.getSnapshot().lease).toBeNull();
  });

  it("accepts an exact padded trace and releases speech on its exact decision", () => {
    const paddedConversation = conversation({
      receipt: { event_id: "ingest-padded", trace_id: " trace-active " },
    });
    const stage = event({
      id: "padded-stage",
      traceId: " trace-active ",
      stage: "compose",
    });
    const runtime = readyRuntime(
      presence({ conversation: paddedConversation }),
    );

    runtime.syncPresence(
      presence({ conversation: paddedConversation, lifeEvents: [stage] }),
    );
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "soulLens",
      traceId: " trace-active ",
    });

    runtime.syncPresence(
      presence({
        conversation: conversation({
          ...paddedConversation,
          provisionalText: "first delta",
          provisionalActive: true,
        }),
        lifeEvents: [stage],
      }),
    );
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "live2d",
      mode: "speech",
      traceId: " trace-active ",
    });

    runtime.syncPresence(
      presence({
        conversation: conversation({
          ...paddedConversation,
          provisionalText: "first delta",
          provisionalActive: false,
          authoritativeDecision: event({
            id: "padded-decision",
            traceId: " trace-active ",
            type: "soul.decision",
          }),
        }),
        lifeEvents: [stage],
      }),
    );
    expect(runtime.getSnapshot().lease).toBeNull();
    expect(runtime.getSnapshot().endpoint).toBe(
      JEWEL_RUNTIME_SERVER_SNAPSHOT.endpoint,
    );
  });

  it("resets stream state when raw receipt trace identities differ", () => {
    const stage = event({ id: "raw-trace-stage", traceId: "trace-active" });
    const runtime = readyRuntime();
    runtime.syncPresence(presence({ lifeEvents: [stage] }));
    expect(runtime.getSnapshot().lease?.owner).toBe("soulLens");

    runtime.syncPresence(
      presence({
        conversation: conversation({
          receipt: { event_id: "ingest-next", trace_id: " trace-active " },
        }),
        lifeEvents: [stage],
      }),
    );

    expect(runtime.getSnapshot().lease).toBeNull();
    expect(runtime.getSnapshot().endpoint).toBe(
      JEWEL_RUNTIME_SERVER_SNAPSHOT.endpoint,
    );
  });

  it("never replays a pre-ACK stage after the receipt establishes its trace", () => {
    const runtime = createJewelRuntime();
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(
      presence({ conversation: conversation({ receipt: null }), lifeEvents: [] }),
    );
    const early = event({ id: "stage-before-ack", stage: "recall" });

    runtime.syncPresence(
      presence({
        conversation: conversation({ receipt: null }),
        lifeEvents: [early],
      }),
    );
    runtime.syncPresence(presence({ lifeEvents: [early] }));

    expect(runtime.getSnapshot().lease).toBeNull();
  });

  it("completes Lens before speech on the first nonblank delta and never restarts per token", () => {
    const stage = event({ id: "stage-1", stage: "compose" });
    const runtime = readyRuntime();
    runtime.syncPresence(presence({ lifeEvents: [stage] }));
    expect(runtime.getSnapshot().lease?.owner).toBe("soulLens");
    const snapshots: Array<ReturnType<JewelRuntime["getSnapshot"]>> = [];
    const unsubscribe = runtime.subscribe(() => snapshots.push(runtime.getSnapshot()));

    runtime.syncPresence(
      presence({
        lifeEvents: [stage],
        conversation: conversation({ provisionalText: "第一段", provisionalActive: true }),
      }),
    );

    expect(snapshots.map((snapshot) => snapshot.lease?.owner ?? null)).toEqual([
      null,
      "live2d",
    ]);
    expect(snapshots[0]?.endpoint).toEqual({
      kind: "stage",
      traceId: "trace-active",
      stage: "compose",
    });
    expect(runtime.getSnapshot()).toMatchObject({ activeDynamicJewelCount: 1 });
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "live2d",
      mode: "speech",
      traceId: "trace-active",
    });

    const speechSnapshot = runtime.getSnapshot();
    runtime.syncPresence(
      presence({
        lifeEvents: [stage],
        conversation: conversation({ provisionalText: "第一段第二段", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot()).toBe(speechSnapshot);
    unsubscribe();
  });

  it("does not transfer on whitespace and skips Lens when stage and first delta are coalesced", () => {
    const runtime = readyRuntime();
    runtime.syncPresence(
      presence({
        conversation: conversation({ provisionalText: "   ", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot().lease).toBeNull();

    runtime.syncPresence(
      presence({
        lifeEvents: [event({ id: "coalesced-stage", stage: "compose" })],
        conversation: conversation({ provisionalText: "answer", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot().lease).toMatchObject({
      owner: "live2d",
      mode: "speech",
    });
  });

  it("ignores other-trace decisions and resets on matching decision or error", () => {
    const runtime = readyRuntime();
    runtime.syncPresence(
      presence({
        conversation: conversation({ provisionalText: "answer", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot().lease?.owner).toBe("live2d");

    runtime.syncPresence(
      presence({
        conversation: conversation({
          provisionalText: "answer",
          provisionalActive: true,
          authoritativeDecision: event({
            id: "other-decision",
            traceId: "trace-other",
            type: "soul.decision",
            payload: { reply_text: "external" },
          }),
        }),
      }),
    );
    expect(runtime.getSnapshot().lease?.owner).toBe("live2d");

    runtime.syncPresence(
      presence({
        conversation: conversation({
          authoritativeDecision: event({
            id: "active-decision",
            type: "soul.decision",
            payload: { reply_text: "final" },
          }),
        }),
      }),
    );
    expect(runtime.getSnapshot()).toMatchObject({
      lease: null,
      endpoint: { kind: "rest", traceId: null, stage: null },
      activeDynamicJewelCount: 0,
    });

    const errorRuntime = readyRuntime();
    errorRuntime.syncPresence(
      presence({
        conversation: conversation({ provisionalText: "answer", provisionalActive: true }),
      }),
    );
    errorRuntime.syncPresence(
      presence({ conversation: conversation({ error: "reply failed" }) }),
    );
    expect(errorRuntime.getSnapshot().lease).toBeNull();
    expect(errorRuntime.getSnapshot().endpoint.kind).toBe("rest");
  });

  it("releases on environment loss and never replays the missed stream action on resume", () => {
    const stage = event({ id: "stage-pause", stage: "compose" });
    const runtime = readyRuntime();
    runtime.syncPresence(presence({ lifeEvents: [stage] }));
    runtime.syncPresence(
      presence({
        lifeEvents: [stage],
        conversation: conversation({ provisionalText: "answer", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot().lease?.owner).toBe("live2d");

    runtime.syncSemantic({ ...READY_SEMANTIC, motion: "paused" });
    expect(runtime.getSnapshot().lease).toBeNull();
    expect(runtime.getSnapshot().endpoint.kind).toBe("rest");

    const pausedSnapshot = runtime.getSnapshot();
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.syncPresence(
      presence({
        lifeEvents: [stage],
        conversation: conversation({ provisionalText: "answer", provisionalActive: true }),
      }),
    );
    expect(runtime.getSnapshot()).toBe(pausedSnapshot);
  });

  it("releases and resets when the active receipt trace changes or disappears", () => {
    const runtime = readyRuntime();
    runtime.syncPresence(
      presence({ lifeEvents: [event({ id: "stage-old", stage: "recall" })] }),
    );
    expect(runtime.getSnapshot().lease?.owner).toBe("soulLens");

    runtime.syncPresence(
      presence({
        conversation: conversation({
          receipt: { event_id: "ingest-2", trace_id: "trace-new" },
        }),
      }),
    );
    expect(runtime.getSnapshot().lease).toBeNull();
    expect(runtime.getSnapshot().endpoint.kind).toBe("rest");

    const afterTraceChange = runtime.getSnapshot();
    runtime.syncPresence(
      presence({ conversation: conversation({ receipt: null }) }),
    );
    expect(runtime.getSnapshot()).toBe(afterTraceChange);
  });

  it("primes history without replay, disposes idempotently, and owns no scheduler", () => {
    const requestAnimationFrame = vi.fn();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const originalRaf = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: requestAnimationFrame,
    });
    const runtime = createJewelRuntime();
    runtime.syncSemantic(READY_SEMANTIC);
    runtime.primePresence(
      presence({
        lifeEvents: [event({ id: "historical-stage", stage: "memory" })],
        conversation: conversation({ provisionalText: "historical", provisionalActive: true }),
      }),
    );

    expect(runtime.getSnapshot().lease).toBeNull();
    runtime.dispose();
    runtime.dispose();
    expect(runtime.getSnapshot()).toBe(JEWEL_RUNTIME_SERVER_SNAPSHOT);
    expect(
      runtime.acquire({ owner: "live2d", mode: "idle", traceId: null }),
    ).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: originalRaf,
    });
  });
});
