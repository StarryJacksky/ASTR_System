import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIVE2D_ASSET_LOCK,
  assessLive2DAssetInventory,
  ensureCubismCore,
  validateLive2DModelReferences,
  verifyLive2DAssetInventory,
} from "./live2d-assets";
import { LIVE2D_REQUIRED_COPYRIGHT_NOTICE } from "./live2d-legal";

const CORE_SRC = "/live2d/core/live2dcubismcore.min.js";
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe("Live2D asset contract", () => {
  it("keeps the lightweight UI notice byte-identical to the pinned asset terms", () => {
    expect(LIVE2D_REQUIRED_COPYRIGHT_NOTICE).toBe(
      LIVE2D_ASSET_LOCK.modelSource.requiredCopyrightNotice,
    );
  });

  it("pins every downloadable byte by immutable source, size and SHA-256", () => {
    expect(LIVE2D_ASSET_LOCK.schemaVersion).toBe(1);
    expect(LIVE2D_ASSET_LOCK.modelSource.commit).toBe(
      "31317b37d5e22955a44d5b11f37f421e94a11269",
    );
    expect(LIVE2D_ASSET_LOCK.modelSource.requiredCopyrightNotice).toBe(
      "This content uses sample data owned and copyrighted by Live2D Inc.",
    );
    expect(LIVE2D_ASSET_LOCK.assets.length).toBeGreaterThan(20);
    expect(LIVE2D_ASSET_LOCK.assets.map((asset) => asset.path)).toEqual([
      "core/live2dcubismcore.min.js",
      "haru/haru_greeter_t03.model3.json",
      "haru/haru_greeter_t03.moc3",
      "haru/haru_greeter_t03.2048/texture_00.png",
      "haru/haru_greeter_t03.2048/texture_01.png",
      "haru/haru_greeter_t03.physics3.json",
      "haru/haru_greeter_t03.pose3.json",
      ...Array.from({ length: 8 }, (_, index) =>
        `haru/expressions/F0${index + 1}.exp3.json`,
      ),
      "haru/motion/haru_g_idle.motion3.json",
      "haru/motion/haru_g_m07.motion3.json",
      "haru/motion/haru_g_m15.motion3.json",
      "haru/motion/haru_g_m14.motion3.json",
      "haru/motion/haru_g_m05.motion3.json",
      "shizuku/sounds/flickHead_00.mp3",
      "shizuku/sounds/flickHead_01.mp3",
    ]);

    for (const asset of LIVE2D_ASSET_LOCK.assets) {
      expect(asset.path).toMatch(/^(?:core|haru|shizuku)\//);
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.url).toMatch(/^https:\/\//);
      expect(asset.url).not.toMatch(/\/(?:master|main|latest)\//);
      if (asset.kind !== "core") {
        expect(asset.url).toContain(LIVE2D_ASSET_LOCK.modelSource.commit);
      }
    }

    const core = LIVE2D_ASSET_LOCK.assets.find((asset) => asset.kind === "core");
    expect(core).toMatchObject({
      bytes: 207155,
      sha256: "25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f",
    });
    expect(Object.isFrozen(LIVE2D_ASSET_LOCK)).toBe(true);
    expect(Object.isFrozen(LIVE2D_ASSET_LOCK.assets)).toBe(true);
  });

  it("fails closed for a clean checkout and for any size or digest mismatch", () => {
    const clean = assessLive2DAssetInventory(LIVE2D_ASSET_LOCK, new Map());

    expect(clean.ready).toBe(false);
    expect(clean.missing).toEqual(
      expect.arrayContaining([
        "core/live2dcubismcore.min.js",
        "haru/haru_greeter_t03.model3.json",
        "haru/haru_greeter_t03.moc3",
        "haru/haru_greeter_t03.2048/texture_00.png",
      ]),
    );

    const complete = new Map(
      LIVE2D_ASSET_LOCK.assets.map((asset) => [
        asset.path,
        { bytes: asset.bytes, sha256: asset.sha256 },
      ]),
    );
    expect(assessLive2DAssetInventory(LIVE2D_ASSET_LOCK, complete)).toEqual({
      ready: true,
      missing: [],
      mismatched: [],
    });

    const texture = LIVE2D_ASSET_LOCK.assets.find((asset) => asset.kind === "texture")!;
    complete.set(texture.path, { bytes: texture.bytes + 1, sha256: "0".repeat(64) });
    expect(assessLive2DAssetInventory(LIVE2D_ASSET_LOCK, complete)).toMatchObject({
      ready: false,
      mismatched: [texture.path],
    });
  });

  it("verifies browser-served bytes before the model loader can use local assets", async () => {
    const payloads = new Map([
      ["core/live2dcubismcore.min.js", new TextEncoder().encode("core")],
      ["haru/haru_greeter_t03.model3.json", new TextEncoder().encode("model")],
    ]);
    const miniLock = {
      ...LIVE2D_ASSET_LOCK,
      assets: LIVE2D_ASSET_LOCK.assets.slice(0, 2).map((asset) => {
        const payload = payloads.get(asset.path)!;
        return {
          ...asset,
          bytes: payload.byteLength,
          sha256: createHash("sha256").update(payload).digest("hex"),
        };
      }),
    };
    const fetcher = vi.fn(async (url: string) => {
      const path = url.replace(/^\/live2d\//, "");
      const payload = payloads.get(path);
      if (!payload) {
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const copy = Uint8Array.from(payload);
      return { ok: true, status: 200, arrayBuffer: async () => copy.buffer };
    });
    const digest = async (bytes: ArrayBuffer) =>
      createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

    await expect(
      verifyLive2DAssetInventory(miniLock, { fetcher, digest }),
    ).resolves.toEqual({ ready: true, missing: [], mismatched: [] });
    expect(fetcher).toHaveBeenCalledWith(
      "/live2d/core/live2dcubismcore.min.js",
      expect.objectContaining({ cache: "no-cache" }),
    );

    payloads.set(
      "haru/haru_greeter_t03.model3.json",
      new TextEncoder().encode("changed"),
    );
    await expect(
      verifyLive2DAssetInventory(miniLock, { fetcher, digest }),
    ).resolves.toMatchObject({
      ready: false,
      mismatched: ["haru/haru_greeter_t03.model3.json"],
    });

    payloads.delete("core/live2dcubismcore.min.js");
    await expect(
      verifyLive2DAssetInventory(miniLock, { fetcher, digest }),
    ).resolves.toMatchObject({
      ready: false,
      missing: ["core/live2dcubismcore.min.js"],
    });

    payloads.set("core/live2dcubismcore.min.js", new TextEncoder().encode("core"));
    const digestGate = deferred<string>();
    const controller = new AbortController();
    const digestStarted = vi.fn(() => digestGate.promise);
    const verifying = verifyLive2DAssetInventory(
      { ...miniLock, assets: miniLock.assets.slice(0, 1) },
      { fetcher, digest: digestStarted, signal: controller.signal },
    );
    await vi.waitFor(() => expect(digestStarted).toHaveBeenCalledTimes(1));
    controller.abort();
    digestGate.resolve(miniLock.assets[0].sha256);
    await expect(verifying).rejects.toMatchObject({ name: "AbortError" });
  });

  it("requires model, moc, textures and audio while recording upstream optional metadata", () => {
    const model = {
      Version: 3,
      FileReferences: {
        Moc: "haru_greeter_t03.moc3",
        Textures: [
          "haru_greeter_t03.2048/texture_00.png",
          "haru_greeter_t03.2048/texture_01.png",
        ],
        Physics: "haru_greeter_t03.physics3.json",
        Pose: "haru_greeter_t03.pose3.json",
        DisplayInfo: "haru_greeter_t03.cdi3.json",
        Expressions: Array.from({ length: 8 }, (_, index) => ({
          Name: `f0${index}`,
          File: `expressions/F0${index + 1}.exp3.json`,
        })),
        Motions: {
          Idle: [
            { File: "motion/haru_g_idle.motion3.json" },
            { File: "motion/haru_g_m07.motion3.json" },
            { File: "motion/haru_g_m15.motion3.json" },
          ],
          Tap: [
            {
              File: "motion/haru_g_m14.motion3.json",
              Sound: "../shizuku/sounds/flickHead_00.mp3",
            },
            {
              File: "motion/haru_g_m05.motion3.json",
              Sound: "../shizuku/sounds/flickHead_01.mp3",
            },
          ],
        },
      },
    };

    const valid = validateLive2DModelReferences(
      model,
      "haru/haru_greeter_t03.model3.json",
      LIVE2D_ASSET_LOCK,
    );
    expect(valid.missingRequired).toEqual([]);
    expect(valid.knownMissingOptional).toEqual([
      "haru/haru_greeter_t03.cdi3.json",
    ]);

    const withoutAudio = {
      ...LIVE2D_ASSET_LOCK,
      assets: LIVE2D_ASSET_LOCK.assets.filter((asset) => asset.kind !== "audio"),
    };
    expect(
      validateLive2DModelReferences(
        model,
        "haru/haru_greeter_t03.model3.json",
        withoutAudio,
      ).missingRequired,
    ).toEqual([
      "shizuku/sounds/flickHead_00.mp3",
      "shizuku/sounds/flickHead_01.mp3",
    ]);
  });

  it("reports absolute, remote, backslash and root-escaping model references", () => {
    const assessment = validateLive2DModelReferences(
      {
        FileReferences: {
          Moc: "../../outside.moc3",
          Textures: ["https://example.com/texture.png", "/absolute.png"],
          Physics: "folder\\physics.json",
        },
      },
      "haru/haru_greeter_t03.model3.json",
      LIVE2D_ASSET_LOCK,
    );

    expect(assessment.invalidReferences).toEqual([
      "../../outside.moc3",
      "/absolute.png",
      "folder\\physics.json",
      "https://example.com/texture.png",
    ]);
  });

  it("rejects missing and non-string required model references", () => {
    const assessment = validateLive2DModelReferences(
      {
        FileReferences: {
          Moc: 123,
          Textures: [null],
          Motions: { Tap: [{ Sound: "../shizuku/sounds/flickHead_00.mp3" }] },
        },
      },
      "haru/haru_greeter_t03.model3.json",
      LIVE2D_ASSET_LOCK,
    );

    expect(assessment.invalidReferences).toEqual(
      expect.arrayContaining([
        "Moc: expected non-empty string",
        "Textures[0]: missing",
        "Motions.Tap[0].File: missing",
      ]),
    );
  });

  it("deduplicates the Cubism Core script and resolves every waiter only after Core exists", async () => {
    const coreDocument = document.implementation.createHTMLDocument("core-dedupe");
    const runtimeGlobal: { Live2DCubismCore?: unknown } = {};

    const first = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });
    const second = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });

    const scripts = coreDocument.querySelectorAll(`script[src="${CORE_SRC}"]`);
    expect(scripts).toHaveLength(1);
    runtimeGlobal.Live2DCubismCore = Object.freeze({ version: "test" });
    scripts[0].dispatchEvent(new Event("load"));

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("lets one Core waiter abort without cancelling the shared script for another owner", async () => {
    const coreDocument = document.implementation.createHTMLDocument("core-waiter-abort");
    const runtimeGlobal: { Live2DCubismCore?: unknown } = {};
    const controller = new AbortController();
    const aborted = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
      signal: controller.signal,
    });
    const survivor = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(coreDocument.querySelectorAll("script")).toHaveLength(1);

    runtimeGlobal.Live2DCubismCore = {};
    coreDocument.querySelector("script")!.dispatchEvent(new Event("load"));
    await expect(survivor).resolves.toBeUndefined();
  });

  it("replaces a stale same-source Core tag whose load event can no longer be observed", async () => {
    const coreDocument = document.implementation.createHTMLDocument("stale-core");
    const stale = coreDocument.createElement("script");
    stale.src = CORE_SRC;
    coreDocument.head.append(stale);
    const runtimeGlobal: { Live2DCubismCore?: unknown } = {};

    const loading = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });
    const replacement = coreDocument.querySelector("script")!;
    expect(replacement).not.toBe(stale);
    expect(stale.isConnected).toBe(false);

    runtimeGlobal.Live2DCubismCore = {};
    replacement.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();
  });

  it("fails a Core 404, permits a clean retry and never injects after abort", async () => {
    const coreDocument = document.implementation.createHTMLDocument("core-failure");
    const runtimeGlobal: { Live2DCubismCore?: unknown } = {};

    const failed = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });
    coreDocument.querySelector("script")!.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow(/Cubism Core.*load/i);
    expect(coreDocument.querySelectorAll("script")).toHaveLength(0);

    const retry = ensureCubismCore({
      document: coreDocument,
      global: runtimeGlobal,
      src: CORE_SRC,
    });
    expect(coreDocument.querySelectorAll("script")).toHaveLength(1);
    runtimeGlobal.Live2DCubismCore = {};
    coreDocument.querySelector("script")!.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeUndefined();

    const abortedDocument = document.implementation.createHTMLDocument("core-abort");
    const controller = new AbortController();
    controller.abort();
    await expect(
      ensureCubismCore({
        document: abortedDocument,
        global: {},
        src: CORE_SRC,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(abortedDocument.querySelector("script")).toBeNull();
  });

  it("makes the executable clean-checkout preflight fail independently of ignored local assets", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "astr-live2d-empty-"));
    temporaryDirectories.push(emptyRoot);
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/fetch-live2d.mjs"), "--check", "--root", emptyRoot],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing.*core|core.*missing/i);
  });

  it("rejects Windows backslash traversal in an untrusted lock before touching output", () => {
    const maliciousRoot = mkdtempSync(join(tmpdir(), "astr-live2d-traversal-"));
    temporaryDirectories.push(maliciousRoot);
    const scriptDirectory = join(maliciousRoot, "scripts");
    mkdirSync(scriptDirectory, { recursive: true });
    writeFileSync(
      join(scriptDirectory, "fetch-live2d.mjs"),
      readFileSync(resolve(process.cwd(), "scripts/fetch-live2d.mjs")),
    );
    writeFileSync(
      join(maliciousRoot, "live2d-assets.lock.json"),
      JSON.stringify({
        schemaVersion: 1,
        localRoot: "public/live2d",
        modelEntry: "haru/model.model3.json",
        modelSource: { commit: "a".repeat(40) },
        coreSource: { url: "https://example.com/core.js" },
        knownMissingOptionalReferences: [],
        assets: [
          {
            kind: "model",
            path: "core/..\\..\\outside.bin",
            bytes: 1,
            sha256: "0".repeat(64),
            url: `https://example.com/${"a".repeat(40)}/outside.bin`,
          },
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [join(scriptDirectory, "fetch-live2d.mjs"), "--check", "--root", maliciousRoot],
      { cwd: maliciousRoot, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/unsafe.*path/i);
  });

  it("documents source, redistribution limits and the non-floating Core snapshot", () => {
    const docs = readFileSync(resolve(process.cwd(), "docs/live2d-assets.md"), "utf8");
    const fetchScript = readFileSync(
      resolve(process.cwd(), "scripts/fetch-live2d.mjs"),
      "utf8",
    );

    expect(docs).toMatch(/Free Material License/i);
    expect(docs).toMatch(/Sample Data Terms/i);
    expect(docs).toMatch(/Proprietary Software License/i);
    expect(docs).toMatch(/31317b37d5e22955a44d5b11f37f421e94a11269/);
    expect(docs).toMatch(/25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f/);
    expect(docs).toMatch(/cdi3.*(?:404|missing|缺失)/i);
    expect(fetchScript).toMatch(/--accept-live2d-licenses/);
    expect(fetchScript).toMatch(/createHash\(["']sha256["']\)/);
    expect(fetchScript).not.toMatch(/cdn\.jsdelivr\.net\/gh\/guansss\/pixi-live2d-display\/test\//);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
