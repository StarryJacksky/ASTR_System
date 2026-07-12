import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  PresenceVisualJewelOwnership,
  PresenceVisualJewelSnapshot,
} from "./presence-visual-runtime";
import {
  createSoulLensPass,
  type SoulLensPixiModule,
  type SoulLensTruthSnapshot,
  type SoulLensTruthSource,
} from "./soul-lens-pass";

const REST_TRUTH: SoulLensTruthSnapshot = Object.freeze({
  modelKey: "astr-local",
  provenance: Object.freeze({ kind: "unprovided" }),
  endpoint: Object.freeze({ kind: "rest" }),
});

describe("Soul Lens single pass", () => {
  it("builds one renderer-owned quad from four vertices, six indices and one pass", async () => {
    const harness = createHarness();
    const lens = await harness.create();

    expect(harness.Geometry).toHaveBeenCalledTimes(1);
    expect(harness.Shader.from).toHaveBeenCalledTimes(1);
    expect(harness.Mesh).toHaveBeenCalledTimes(1);
    expect(harness.geometry.addAttribute).toHaveBeenCalledWith(
      "aVertexPosition",
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      2,
    );
    expect(harness.geometry.addIndex).toHaveBeenCalledWith(
      new Uint16Array([0, 1, 2, 0, 2, 3]),
    );
    expect(harness.Mesh).toHaveBeenCalledWith(
      harness.geometry,
      harness.shader,
      undefined,
      4,
    );
    expect(harness.mesh.size).toBe(6);
    expect(harness.mesh.eventMode).toBe("none");
    expect(harness.stage.addChild).toHaveBeenCalledWith(harness.mesh);
    expect(harness.ticker.add).toHaveBeenCalledTimes(1);
    expect(lens.readTopology()).toEqual({
      vertices: 4,
      indices: 6,
      triangles: 2,
      passes: 1,
      drawCalls: 1,
      textureBytes: 0,
      renderTargetBytes: 0,
    });
    expect(Object.isFrozen(lens.readTopology())).toBe(true);
  });

  it("keeps identity and provenance fixed while model changes affect only the middle shell", async () => {
    const harness = createHarness();
    harness.jewel.setOwned({});
    await harness.create();
    const before = cloneUniforms(harness.uniforms);

    harness.truth.set({ ...REST_TRUTH, modelKey: "astr-orbit-v2" });
    const changed = changedUniformKeys(before, harness.uniforms);

    expect(changed).toEqual(["uModelSignature"]);
    expect(harness.uniforms).not.toHaveProperty("uIdentity");
    expect(harness.uniforms.uProvenanceState).toBe(0);

    harness.truth.set({ ...REST_TRUTH, modelKey: "   " });
    expect(harness.uniforms.uModelPresent).toBe(0);
    expect(harness.uniforms.uProvenanceState).toBe(0);
  });

  it("advances motion only for a valid Lens token and freezes on the latest static endpoint", async () => {
    const harness = createHarness();
    const lens = await harness.create();
    const initialTime = harness.uniforms.uTime;

    harness.ticker.tick(16);
    expect(harness.uniforms.uTime).toBe(initialTime);
    expect(harness.uniforms.uMotion).toBe(0);

    const firstToken = {};
    harness.truth.set({
      ...REST_TRUTH,
      endpoint: { kind: "stage", traceId: "trace-1", stage: "recall" },
    });
    harness.jewel.setOwned(firstToken);
    harness.ticker.tick(20);
    expect(harness.uniforms.uTime).toBeCloseTo(0.02);
    expect(harness.uniforms.uMotion).toBe(1);

    const nextToken = {};
    harness.jewel.setOwned(nextToken);
    expect(harness.uniforms.uTime).toBe(0);
    harness.ticker.tick(10);
    expect(harness.uniforms.uTime).toBeCloseTo(0.01);

    harness.truth.set({
      ...REST_TRUTH,
      endpoint: { kind: "stage", traceId: "trace-1", stage: "compose" },
    });
    const settledStage = [...(harness.uniforms.uStageSignature as Float32Array)];
    harness.jewel.setUnowned();
    harness.ticker.tick(40);

    expect(harness.uniforms.uMotion).toBe(0);
    expect(harness.uniforms.uTime).toBeCloseTo(0.01);
    expect([...(harness.uniforms.uStageSignature as Float32Array)]).toEqual(
      settledStage,
    );
    expect(harness.mesh.visible).toBe(true);

    harness.truth.set(REST_TRUTH);
    expect(harness.mesh.visible).toBe(false);
    expect(harness.uniforms.uTime).toBeCloseTo(0.01);
    expect([...(harness.uniforms.uStageSignature as Float32Array)]).toEqual(
      settledStage,
    );

    lens.destroy();
    lens.destroy();
    expect(harness.ticker.remove).toHaveBeenCalledTimes(1);
    expect(harness.stage.removeChild).toHaveBeenCalledWith(harness.mesh);
    expect(harness.mesh.destroy).toHaveBeenCalledTimes(1);
    expect(harness.shader.destroy).toHaveBeenCalledTimes(1);
    expect(harness.geometry.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses no private scheduler, context, filter or render target and stays under 25KB gzip", () => {
    const directory = resolve(process.cwd(), "src/features/presence/visual");
    const wrapper = readFileSync(resolve(directory, "soul-lens-pass.ts"), "utf8");
    const shader = readFileSync(resolve(directory, "soul-lens-shader.ts"), "utf8");
    const source = `${wrapper}\n${shader}`;

    expect(source).not.toMatch(
      /requestAnimationFrame|getContext|new\s+(?:PIXI\.)?Application|new\s+(?:PIXI\.)?Ticker|\bFilter\b|RenderTexture/,
    );
    expect(shader).not.toMatch(/uProvenance(?:Percent|Ratio)|continuityPercent/i);
    expect(gzipSync(source).byteLength).toBeLessThan(25 * 1024);
  });

  it("updates only the viewport on resize and preserves the frozen motion endpoint", async () => {
    const harness = createHarness();
    harness.jewel.setOwned({});
    const lens = await harness.create();
    const before = cloneUniforms(harness.uniforms);

    lens.resize({ width: 1280, height: 640 });

    expect(changedUniformKeys(before, harness.uniforms)).toEqual(["uViewport"]);
    expect([...(harness.uniforms.uViewport as Float32Array)]).toEqual([1280, 640]);
  });

  it("caches model truth without touching uniforms until a Lens generation owns the pass", async () => {
    const harness = createHarness();
    await harness.create();
    const before = cloneUniforms(harness.uniforms);

    harness.truth.set({ ...REST_TRUTH, modelKey: "astr-deferred-shell" });
    expect(changedUniformKeys(before, harness.uniforms)).toEqual([]);

    harness.jewel.setOwned({});
    expect(changedUniformKeys(before, harness.uniforms)).toEqual([
      "uModelPresent",
      "uModelSignature",
      "uMotion",
    ]);
  });

  it("inverts only the material palette on the next owned frame", async () => {
    const harness = createHarness();
    harness.jewel.setOwned({});
    await harness.create();
    expect(harness.uniforms.uLightMaterial).toBe(0);

    harness.setMaterial("light");
    harness.ticker.tick(16);
    expect(harness.uniforms.uLightMaterial).toBe(1);

    harness.jewel.setUnowned();
    harness.setMaterial("dark");
    harness.ticker.tick(16);
    expect(harness.uniforms.uLightMaterial).toBe(1);

    harness.jewel.setOwned({});
    expect(harness.uniforms.uLightMaterial).toBe(0);
  });

  it("unwinds the exact shared-ticker listener when abort lands during attachment", async () => {
    const harness = createHarness({ abortOnTickerAdd: true });

    await expect(harness.create()).rejects.toMatchObject({ name: "AbortError" });

    const addedListener = harness.ticker.add.mock.calls[0]?.[0];
    expect(addedListener).toBeTypeOf("function");
    expect(harness.ticker.remove).toHaveBeenCalledWith(addedListener);
    expect(harness.truth.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.jewel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.stage.removeChild).toHaveBeenCalledWith(harness.mesh);
    expect(harness.mesh.destroy).toHaveBeenCalledTimes(1);
    expect(harness.shader.destroy).toHaveBeenCalledTimes(1);
    expect(harness.geometry.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys all created pass resources if stage attachment rejects", async () => {
    const harness = createHarness({ stageAddFailure: new Error("stage closed") });

    await expect(harness.create()).rejects.toMatchObject({
      name: "PresenceVisualInitializationError",
      stage: "pass",
    });
    expect(harness.ticker.add).not.toHaveBeenCalled();
    expect(harness.mesh.destroy).toHaveBeenCalledTimes(1);
    expect(harness.shader.destroy).toHaveBeenCalledTimes(1);
    expect(harness.geometry.destroy).toHaveBeenCalledTimes(1);
  });
});

function createHarness(
  options: {
    readonly abortOnTickerAdd?: boolean;
    readonly stageAddFailure?: Error;
  } = {},
) {
  const geometry = {
    addAttribute: vi.fn(function addAttribute() {
      return geometry;
    }),
    addIndex: vi.fn(function addIndex() {
      return geometry;
    }),
    destroy: vi.fn(),
  };
  const shader = { uniforms: {} as Record<string, unknown>, destroy: vi.fn() };
  const mesh = { size: 0, eventMode: "auto", visible: true, destroy: vi.fn() };
  const Geometry = vi.fn(function Geometry() {
    return geometry;
  });
  const Shader = {
    from: vi.fn((_vertex: string, _fragment: string, uniforms: Record<string, unknown>) => {
      shader.uniforms = uniforms;
      return shader;
    }),
  };
  const Mesh = vi.fn(function Mesh() {
    return mesh;
  });
  const pixiModule: SoulLensPixiModule = {
    Geometry: Geometry as unknown as SoulLensPixiModule["Geometry"],
    Shader: Shader as unknown as SoulLensPixiModule["Shader"],
    Mesh: Mesh as unknown as SoulLensPixiModule["Mesh"],
    DRAW_MODES: { TRIANGLES: 4 },
  };
  const controller = new AbortController();
  const stage = {
    addChild: vi.fn(() => {
      if (options.stageAddFailure) throw options.stageAddFailure;
    }),
    removeChild: vi.fn(),
  };
  const ticker = new FakeTicker(() => {
    if (options.abortOnTickerAdd) controller.abort();
  });
  const truth = new FakeTruthSource(REST_TRUTH);
  const jewel = new FakeJewelOwnership();
  let material: "dark" | "light" = "dark";

  return {
    Geometry,
    Shader,
    Mesh,
    geometry,
    shader,
    mesh,
    stage,
    ticker,
    truth,
    jewel,
    setMaterial(next: "dark" | "light") {
      material = next;
    },
    get uniforms() {
      return shader.uniforms;
    },
    create: async () => {
      const result = await createSoulLensPass({
        stage,
        ticker,
        jewel,
        truthSource: truth,
        readViewport: () => ({ width: 720, height: 900 }),
        readMaterial: () => material,
        signal: controller.signal,
        loadPixi: async () => pixiModule,
      });
      return result;
    },
  } as const;
}

class FakeTicker {
  deltaMS = 0;
  readonly add = vi.fn((listener: () => void) => {
    this.listeners.add(listener);
  });
  readonly remove = vi.fn((listener: () => void) => this.listeners.delete(listener));
  private readonly listeners = new Set<() => void>();

  constructor(onAdd: () => void = () => undefined) {
    this.add.mockImplementation((listener: () => void) => {
      this.listeners.add(listener);
      onAdd();
    });
  }

  tick(deltaMS: number) {
    this.deltaMS = deltaMS;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeTruthSource implements SoulLensTruthSource {
  private snapshot: SoulLensTruthSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(initial: SoulLensTruthSnapshot) {
    this.snapshot = initial;
  }

  getSnapshot = () => this.snapshot;
  readonly unsubscribe = vi.fn();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.unsubscribe();
    };
  };

  set(snapshot: SoulLensTruthSnapshot) {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeJewelOwnership implements PresenceVisualJewelOwnership {
  private snapshot: PresenceVisualJewelSnapshot = Object.freeze({
    ownsLease: false,
    leaseToken: null,
  });
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;
  readonly unsubscribe = vi.fn();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.unsubscribe();
    };
  };
  releaseOwned = vi.fn();

  setOwned(token: object) {
    this.snapshot = Object.freeze({ ownsLease: true, leaseToken: token });
    this.emit();
  }

  setUnowned() {
    this.snapshot = Object.freeze({ ownsLease: false, leaseToken: null });
    this.emit();
  }

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }
}

function cloneUniforms(uniforms: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(uniforms).map(([key, value]) => [
      key,
      value instanceof Float32Array ? new Float32Array(value) : value,
    ]),
  );
}

function changedUniformKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after)
    .filter((key) => {
      const left = before[key];
      const right = after[key];
      if (left instanceof Float32Array && right instanceof Float32Array) {
        return left.length !== right.length || left.some((value, index) => value !== right[index]);
      }
      return !Object.is(left, right);
    })
    .sort();
}
