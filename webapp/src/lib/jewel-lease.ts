import type { SemanticState } from "./semantic-state";

export const JEWEL_PRIORITY = {
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
} as const;

export type JewelOwner =
  | "safetyBoundary"
  | "errorBoundary"
  | "authorizationSeal"
  | "soulLens"
  | "artifactReturn"
  | "evidenceReveal"
  | "live2d"
  | "orbitTraveler"
  | "composerTab"
  | "coldCalibration";

export type JewelMode =
  | "stop"
  | "reject"
  | "confirmed"
  | "streamStage"
  | "complete"
  | "selected"
  | "speech"
  | "navigate"
  | "focus"
  | "ready"
  | "idle";

export interface JewelEnvironment {
  visibility: SemanticState["visibility"];
  motion: SemanticState["motion"];
  runtime: SemanticState["visualRuntime"];
}

export interface JewelCapabilities {
  canSealApproval: boolean;
  canReturnArtifact: boolean;
}

export interface JewelLeaseIntent {
  owner: JewelOwner;
  mode: JewelMode;
  traceId: string | null;
  semanticEnd?: string | null;
}

export interface JewelLease {
  readonly owner: JewelOwner;
  readonly mode: JewelMode;
  readonly traceId: string | null;
  readonly priority: (typeof JEWEL_PRIORITY)[keyof typeof JEWEL_PRIORITY];
  readonly acquiredAt: number;
  readonly semanticEnd: string | null;
}

const JEWEL_LEASE_GENERATION: unique symbol = Symbol("ASTR Jewel lease generation");

export type JewelLeaseHandle = JewelLease & {
  readonly [JEWEL_LEASE_GENERATION]: symbol;
};

const DEFAULT_ENVIRONMENT: JewelEnvironment = {
  visibility: "visible",
  motion: "full",
  runtime: "loading",
};

const PRIORITY_BY_PAIR = {
  "safetyBoundary/stop": JEWEL_PRIORITY.safetyBoundary,
  "errorBoundary/reject": JEWEL_PRIORITY.errorBoundary,
  "authorizationSeal/confirmed": JEWEL_PRIORITY.authorizationSeal,
  "soulLens/streamStage": JEWEL_PRIORITY.soulLens,
  "artifactReturn/complete": JEWEL_PRIORITY.artifactReturn,
  "evidenceReveal/selected": JEWEL_PRIORITY.evidenceReveal,
  "live2d/speech": JEWEL_PRIORITY.live2dSpeech,
  "orbitTraveler/navigate": JEWEL_PRIORITY.orbitTraveler,
  "composerTab/focus": JEWEL_PRIORITY.composerTab,
  "coldCalibration/ready": JEWEL_PRIORITY.coldCalibration,
  "live2d/idle": JEWEL_PRIORITY.live2dIdle,
} as const;

type JewelPriority = (typeof PRIORITY_BY_PAIR)[keyof typeof PRIORITY_BY_PAIR];

function resolvePriority(owner: JewelOwner, mode: JewelMode): JewelPriority | null {
  const pair = `${owner}/${mode}`;
  return pair in PRIORITY_BY_PAIR ? PRIORITY_BY_PAIR[pair as keyof typeof PRIORITY_BY_PAIR] : null;
}

function normalizeCapabilities(
  capabilities: Partial<JewelCapabilities>,
): JewelCapabilities {
  return {
    canSealApproval: capabilities.canSealApproval === true,
    canReturnArtifact: capabilities.canReturnArtifact === true,
  };
}

export class JewelLeaseController {
  private activeLease: JewelLeaseHandle | null = null;
  private environment: JewelEnvironment = { ...DEFAULT_ENVIRONMENT };
  private capabilities: JewelCapabilities;

  constructor(capabilities: Partial<JewelCapabilities> = {}) {
    this.capabilities = normalizeCapabilities(capabilities);
  }

  acquire(intent: JewelLeaseIntent): JewelLeaseHandle | null {
    if (!this.canAnimate()) return null;

    const priority = resolvePriority(intent.owner, intent.mode);
    if (priority === null || !this.hasRequiredCapability(intent.owner, intent.mode)) return null;
    if (this.activeLease !== null && priority < this.activeLease.priority) return null;

    const lease: JewelLeaseHandle = Object.freeze({
      owner: intent.owner,
      mode: intent.mode,
      traceId: intent.traceId,
      priority,
      acquiredAt: Date.now(),
      semanticEnd: intent.semanticEnd ?? null,
      [JEWEL_LEASE_GENERATION]: Symbol("Jewel lease"),
    });
    this.activeLease = lease;
    return lease;
  }

  current(): JewelLease | null {
    return this.activeLease;
  }

  release(handle: JewelLeaseHandle): void {
    if (this.activeLease === handle) {
      this.activeLease = null;
    }
  }

  complete(handle: JewelLeaseHandle): void {
    this.release(handle);
  }

  setEnvironment(environment: JewelEnvironment): void {
    this.environment = { ...environment };
    if (!this.canAnimate()) this.activeLease = null;
  }

  setCapabilities(capabilities: Partial<JewelCapabilities> = {}): void {
    this.capabilities = normalizeCapabilities(capabilities);
    if (
      this.activeLease !== null &&
      !this.hasRequiredCapability(this.activeLease.owner, this.activeLease.mode)
    ) {
      this.activeLease = null;
    }
  }

  private canAnimate(): boolean {
    return (
      this.environment.visibility === "visible" &&
      this.environment.motion === "full" &&
      this.environment.runtime === "ready"
    );
  }

  private hasRequiredCapability(owner: JewelOwner, mode: JewelMode): boolean {
    if (owner === "authorizationSeal" && mode === "confirmed") {
      return this.capabilities.canSealApproval;
    }
    if (owner === "artifactReturn" && mode === "complete") {
      return this.capabilities.canReturnArtifact;
    }
    return true;
  }
}
