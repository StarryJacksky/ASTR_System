import { describe, expect, it } from "vitest";

import {
  JEWEL_PRIORITY,
  JewelLeaseController,
  type JewelCapabilities,
  type JewelEnvironment,
  type JewelLeaseHandle,
  type JewelLeaseIntent,
} from "./jewel-lease";

const READY_ENVIRONMENT: JewelEnvironment = {
  visibility: "visible",
  motion: "full",
  runtime: "ready",
};

function readyController(capabilities: Partial<JewelCapabilities> = {}): JewelLeaseController {
  const leases = new JewelLeaseController(capabilities);
  leases.setEnvironment(READY_ENVIRONMENT);
  return leases;
}

function acquireOrThrow(
  leases: JewelLeaseController,
  intent: JewelLeaseIntent,
): JewelLeaseHandle {
  const handle = leases.acquire(intent);
  if (handle === null) throw new Error("expected Jewel lease acquisition to succeed");
  return handle;
}

describe("global Jewel lease", () => {
  it("uses the exact global priority table", () => {
    expect(JEWEL_PRIORITY).toEqual({
      safetyBoundary: 1000,
      errorBoundary: 900,
      authorizationSeal: 800,
      soulLens: 700,
      artifactReturn: 650,
      evidenceReveal: 600,
      live2dSpeech: 500,
      orbitTraveler: 400,
      composerTab: 300,
      coldCalibration: 200,
      live2dIdle: 100,
    });
  });

  it("fails closed until the visual runtime is explicitly ready", () => {
    const leases = new JewelLeaseController();

    expect(leases.acquire({ owner: "live2d", mode: "idle", traceId: null })).toBeNull();

    leases.setEnvironment(READY_ENVIRONMENT);
    expect(leases.acquire({ owner: "live2d", mode: "idle", traceId: null })?.owner).toBe(
      "live2d",
    );
  });

  it.each([
    ["safetyBoundary", "stop", JEWEL_PRIORITY.safetyBoundary],
    ["errorBoundary", "reject", JEWEL_PRIORITY.errorBoundary],
    ["authorizationSeal", "confirmed", JEWEL_PRIORITY.authorizationSeal],
    ["soulLens", "streamStage", JEWEL_PRIORITY.soulLens],
    ["artifactReturn", "complete", JEWEL_PRIORITY.artifactReturn],
    ["evidenceReveal", "selected", JEWEL_PRIORITY.evidenceReveal],
    ["live2d", "speech", JEWEL_PRIORITY.live2dSpeech],
    ["orbitTraveler", "navigate", JEWEL_PRIORITY.orbitTraveler],
    ["composerTab", "focus", JEWEL_PRIORITY.composerTab],
    ["coldCalibration", "ready", JEWEL_PRIORITY.coldCalibration],
    ["live2d", "idle", JEWEL_PRIORITY.live2dIdle],
  ] as const)("resolves %s/%s to priority %i", (owner, mode, priority) => {
    const leases = readyController({ canSealApproval: true, canReturnArtifact: true });
    const beforeAcquire = Date.now();

    const lease = leases.acquire({
      owner,
      mode,
      traceId: "trc_priority",
      semanticEnd: "settled",
    });

    expect(lease).toMatchObject({
      owner,
      mode,
      traceId: "trc_priority",
      priority,
      semanticEnd: "settled",
    });
    expect(lease?.acquiredAt).toBeGreaterThanOrEqual(beforeAcquire);
    expect(lease?.acquiredAt).toBeLessThanOrEqual(Date.now());
  });

  it("allows only one owner and higher priority preempts", () => {
    const leases = readyController();

    expect(leases.acquire({ owner: "live2d", mode: "idle", traceId: null })?.owner).toBe(
      "live2d",
    );
    expect(
      leases.acquire({ owner: "orbitTraveler", mode: "navigate", traceId: "trc_1" })?.owner,
    ).toBe("orbitTraveler");
    expect(leases.current()?.owner).toBe("orbitTraveler");
  });

  it("rejects lower-priority intents without disturbing the current owner", () => {
    const leases = readyController();
    leases.acquire({ owner: "evidenceReveal", mode: "selected", traceId: "trc_evidence" });

    expect(
      leases.acquire({ owner: "composerTab", mode: "focus", traceId: "trc_composer" }),
    ).toBeNull();
    expect(leases.current()).toMatchObject({
      owner: "evidenceReveal",
      mode: "selected",
      traceId: "trc_evidence",
    });
  });

  it("lets the newest equal-priority intent replace the old lease", () => {
    const leases = readyController();
    leases.acquire({
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trc_old",
      semanticEnd: "old-target",
    });

    const newest = leases.acquire({
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trc_new",
      semanticEnd: "new-target",
    });

    expect(newest).toMatchObject({ traceId: "trc_new", semanticEnd: "new-target" });
    expect(leases.current()).toBe(newest);
  });

  it("keeps returned and stored arbitration fields immutable", () => {
    const leases = readyController();
    const lease = leases.acquire({ owner: "live2d", mode: "idle", traceId: "trc_idle" });
    expect(lease).not.toBeNull();
    if (lease === null) throw new Error("expected an acquired lease");

    const forgeable = lease as unknown as {
      owner: string;
      mode: string;
      priority: number;
    };

    expect(() => {
      forgeable.priority = 2000;
    }).toThrow(TypeError);
    expect(() => {
      forgeable.owner = "soulLens";
    }).toThrow(TypeError);
    expect(() => {
      forgeable.mode = "streamStage";
    }).toThrow(TypeError);
    expect(leases.current()).toBe(lease);
    expect(leases.current()).toMatchObject({
      owner: "live2d",
      mode: "idle",
      priority: JEWEL_PRIORITY.live2dIdle,
    });
    expect(Object.isFrozen(leases.current())).toBe(true);

    expect(
      leases.acquire({ owner: "safetyBoundary", mode: "stop", traceId: "trc_stop" }),
    ).toMatchObject({ owner: "safetyBoundary", priority: JEWEL_PRIORITY.safetyBoundary });
  });

  it("transfers stream ownership from Lens to speech without overlap", () => {
    const leases = readyController();
    const lensHandle = acquireOrThrow(leases, {
      owner: "soulLens",
      mode: "streamStage",
      traceId: "trc_1",
    });

    expect(leases.acquire({ owner: "live2d", mode: "speech", traceId: "trc_1" })).toBeNull();
    expect(leases.current()).toMatchObject({ owner: "soulLens", mode: "streamStage" });

    leases.complete(lensHandle);
    leases.acquire({ owner: "live2d", mode: "speech", traceId: "trc_1" });
    expect(leases.current()).toMatchObject({ owner: "live2d", mode: "speech" });
  });

  it("releases only the exact handle and remains idempotent", () => {
    const leases = readyController();
    const speechHandle = acquireOrThrow(leases, {
      owner: "live2d",
      mode: "speech",
      traceId: "trc_1",
    });
    const unrelated = acquireOrThrow(readyController(), {
      owner: "live2d",
      mode: "speech",
      traceId: "trc_1",
    });

    leases.release(unrelated);
    expect(leases.current()).toMatchObject({ owner: "live2d", mode: "speech" });

    leases.release(speechHandle);
    leases.release(speechHandle);
    expect(leases.current()).toBeNull();
  });

  it("does not let stale completion or release clear a newer same-pair lease", () => {
    const leases = readyController();
    const oldHandle = acquireOrThrow(leases, {
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trc_old",
      semanticEnd: "old-target",
    });
    const newHandle = acquireOrThrow(leases, {
      owner: "orbitTraveler",
      mode: "navigate",
      traceId: "trc_new",
      semanticEnd: "new-target",
    });

    leases.complete(oldHandle);
    leases.release(oldHandle);

    expect(leases.current()).toBe(newHandle);
    expect(leases.current()).toMatchObject({
      traceId: "trc_new",
      semanticEnd: "new-target",
    });

    leases.complete(newHandle);
    leases.complete(newHandle);
    expect(leases.current()).toBeNull();
  });

  it("does not let a preempted handle release the higher-priority lease", () => {
    const leases = readyController();
    const idleHandle = acquireOrThrow(leases, {
      owner: "live2d",
      mode: "idle",
      traceId: null,
    });
    const stopHandle = acquireOrThrow(leases, {
      owner: "safetyBoundary",
      mode: "stop",
      traceId: "trc_stop",
    });

    leases.complete(idleHandle);
    leases.release(idleHandle);

    expect(leases.current()).toBe(stopHandle);
  });

  it.each(["hidden", "offscreen"] as const)(
    "releases immediately when visibility is %s",
    (visibility) => {
      const leases = readyController();
      leases.acquire({ owner: "live2d", mode: "idle", traceId: null });

      leases.setEnvironment({ visibility, motion: "full", runtime: "ready" });

      expect(leases.current()).toBeNull();
      expect(
        leases.acquire({ owner: "safetyBoundary", mode: "stop", traceId: "trc_stop" }),
      ).toBeNull();
    },
  );

  it.each([
    { visibility: "visible", motion: "reduced", runtime: "ready" },
    { visibility: "visible", motion: "paused", runtime: "ready" },
    { visibility: "visible", motion: "full", runtime: "loading" },
    { visibility: "visible", motion: "full", runtime: "contextLost" },
  ] as const)("releases and rejects acquisition in $motion/$runtime", (environment) => {
    const leases = readyController();
    leases.acquire({ owner: "live2d", mode: "idle", traceId: null });

    leases.setEnvironment(environment);

    expect(leases.current()).toBeNull();
    expect(leases.acquire({ owner: "safetyBoundary", mode: "stop", traceId: "trc_stop" })).toBeNull();
  });

  it("keeps future success rituals disabled without evidence", () => {
    const leases = readyController();

    expect(
      leases.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_1" }),
    ).toBeNull();
    expect(
      leases.acquire({ owner: "authorizationSeal", mode: "confirmed", traceId: "trc_1" }),
    ).toBeNull();
  });

  it.each([
    { label: "the string false", value: "false" },
    { label: "the number one", value: 1 },
    { label: "an object", value: {} },
  ])("treats $label as absent capability evidence", ({ value }) => {
    const malformed = {
      canSealApproval: value,
      canReturnArtifact: value,
    } as unknown as Partial<JewelCapabilities>;

    const constructed = readyController(malformed);
    expect(
      constructed.acquire({ owner: "authorizationSeal", mode: "confirmed", traceId: "trc_1" }),
    ).toBeNull();
    expect(
      constructed.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_1" }),
    ).toBeNull();

    const updated = readyController({ canSealApproval: true, canReturnArtifact: true });
    updated.setCapabilities(malformed);
    expect(
      updated.acquire({ owner: "authorizationSeal", mode: "confirmed", traceId: "trc_2" }),
    ).toBeNull();
    expect(
      updated.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_2" }),
    ).toBeNull();
  });

  it("enables each success ritual only from its own capability evidence", () => {
    const leases = readyController({ canSealApproval: true });

    const sealHandle = acquireOrThrow(leases, {
      owner: "authorizationSeal",
      mode: "confirmed",
      traceId: "trc_seal",
    });
    expect(sealHandle).toMatchObject({ owner: "authorizationSeal", mode: "confirmed" });
    leases.release(sealHandle);
    expect(
      leases.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_artifact" }),
    ).toBeNull();

    leases.setCapabilities({ canReturnArtifact: true });
    expect(
      leases.acquire({ owner: "authorizationSeal", mode: "confirmed", traceId: "trc_seal" }),
    ).toBeNull();
    expect(
      leases.acquire({ owner: "artifactReturn", mode: "complete", traceId: "trc_artifact" }),
    ).toMatchObject({ owner: "artifactReturn", mode: "complete" });
  });

  it.each([
    {
      ritual: "authorization seal",
      capabilities: { canSealApproval: true },
      revoked: { canSealApproval: false },
      intent: { owner: "authorizationSeal", mode: "confirmed", traceId: "trc_seal" },
    },
    {
      ritual: "artifact return",
      capabilities: { canReturnArtifact: true },
      revoked: { canReturnArtifact: false },
      intent: { owner: "artifactReturn", mode: "complete", traceId: "trc_artifact" },
    },
  ] as const)(
    "releases an active $ritual when its evidence is revoked",
    ({ capabilities, revoked, intent }) => {
      const leases = readyController(capabilities);
      expect(leases.acquire(intent)).not.toBeNull();

      leases.setCapabilities(revoked);

      expect(leases.current()).toBeNull();
    },
  );

  it("invalidates old handles across environment revocation and re-acquisition", () => {
    const leases = readyController();
    const beforeHidden = acquireOrThrow(leases, {
      owner: "live2d",
      mode: "idle",
      traceId: "trc_before_hidden",
    });

    leases.setEnvironment({ visibility: "hidden", motion: "full", runtime: "ready" });
    leases.setEnvironment(READY_ENVIRONMENT);
    const afterHidden = acquireOrThrow(leases, {
      owner: "live2d",
      mode: "idle",
      traceId: "trc_after_hidden",
    });

    leases.release(beforeHidden);
    leases.complete(beforeHidden);

    expect(leases.current()).toBe(afterHidden);
  });

  it("invalidates old handles across capability revocation and re-acquisition", () => {
    const leases = readyController({ canReturnArtifact: true });
    const beforeRevocation = acquireOrThrow(leases, {
      owner: "artifactReturn",
      mode: "complete",
      traceId: "trc_before_revocation",
    });

    leases.setCapabilities({ canReturnArtifact: false });
    leases.setCapabilities({ canReturnArtifact: true });
    const afterRevocation = acquireOrThrow(leases, {
      owner: "artifactReturn",
      mode: "complete",
      traceId: "trc_after_revocation",
    });

    leases.complete(beforeRevocation);
    leases.release(beforeRevocation);

    expect(leases.current()).toBe(afterRevocation);
  });

  it("stores a null semantic end when none is supplied", () => {
    const leases = readyController();

    expect(leases.acquire({ owner: "live2d", mode: "idle", traceId: null })).toMatchObject({
      semanticEnd: null,
    });
  });
});
