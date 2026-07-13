import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];
const assetScript = resolve(process.cwd(), "scripts/check-presence-assets.mjs");

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { force: true, recursive: true });
  }
});

describe("Presence asset certification command", () => {
  it("reports fallback delivery without pretending that broken dynamic assets are certified", () => {
    const root = createAssetFixture({ dynamicReady: false });

    const result = runAssets(root);
    const report = JSON.parse(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toMatchObject({
      schemaVersion: 1,
      check: "presence-assets",
      passed: true,
      dynamicCertified: false,
      staticFallbackAvailable: true,
      policy: {
        mode: "fallback-capable",
        dynamicRequired: false,
      },
      authoritativeSources: {
        lock: "live2d-assets.lock.json",
        verifier: "scripts/fetch-live2d.mjs --check",
      },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: "mismatch", path: "haru/model.model3.json" }),
      expect.objectContaining({ kind: "missing", path: "shizuku/sounds/flickHead_00.mp3" }),
      expect.objectContaining({ kind: "missing", path: "shizuku/sounds/flickHead_01.mp3" }),
    ]);
    expect(report.policy.explanation).toMatch(/static fallback/i);
  });

  it("fails the command in explicit dynamic certification mode", () => {
    const root = createAssetFixture({ dynamicReady: false });

    const result = runAssets(root, "--require-dynamic");
    const report = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(report).toMatchObject({
      passed: false,
      dynamicCertified: false,
      staticFallbackAvailable: true,
      policy: { mode: "require-dynamic", dynamicRequired: true },
    });
  });

  it("certifies dynamic rendering only when the existing verifier accepts every locked byte", () => {
    const root = createAssetFixture({ dynamicReady: true });

    const result = runAssets(root, "--require-dynamic");
    const report = JSON.parse(result.stdout);

    expect(result.status, result.stderr).toBe(0);
    expect(report).toMatchObject({
      passed: true,
      dynamicCertified: true,
      staticFallbackAvailable: true,
      verifier: { exitCode: 0, passed: true },
      findings: [],
    });
  });
});

function runAssets(root, ...args) {
  return spawnSync(process.execPath, [assetScript, "--root", root, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function createAssetFixture({ dynamicReady }) {
  const root = mkdtempSync(join(tmpdir(), "astr-presence-assets-"));
  temporaryDirectories.push(root);
  const commit = "a".repeat(40);
  const assets = new Map([
    [
      "haru/model.model3.json",
      Buffer.from(JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: "model.moc3",
          Textures: ["texture.png"],
          Motions: {
            Tap: [
              {
                File: "motion.json",
                Sound: "../shizuku/sounds/flickHead_00.mp3",
              },
              {
                File: "motion.json",
                Sound: "../shizuku/sounds/flickHead_01.mp3",
              },
            ],
          },
        },
      })),
    ],
    ["haru/model.moc3", Buffer.from("moc")],
    ["haru/texture.png", Buffer.from("texture")],
    ["haru/motion.json", Buffer.from("motion")],
    ["shizuku/sounds/flickHead_00.mp3", Buffer.from("audio-0")],
    ["shizuku/sounds/flickHead_01.mp3", Buffer.from("audio-1")],
  ]);
  const kindFor = (path) => path.endsWith("model3.json")
    ? "model"
    : path.endsWith("moc3")
      ? "moc"
      : path.endsWith(".png")
        ? "texture"
        : path.endsWith("motion.json")
          ? "motion"
          : "audio";
  const lock = {
    schemaVersion: 1,
    publicBasePath: "/live2d",
    localRoot: "public/live2d",
    modelEntry: "haru/model.model3.json",
    modelSource: { commit },
    coreSource: { url: "https://example.test/core.js" },
    knownMissingOptionalReferences: [],
    assets: [...assets].map(([path, bytes]) => ({
      kind: kindFor(path),
      path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      url: `https://example.test/${commit}/${path}`,
    })),
  };

  write(root, "live2d-assets.lock.json", JSON.stringify(lock));
  copyVerifier(root);
  write(
    root,
    "src/features/presence/components/StaticSoulLens.tsx",
    "export function StaticSoulLens() { return null; }",
  );
  for (const [path, bytes] of assets) {
    if (!dynamicReady && path.endsWith(".mp3")) continue;
    write(
      root,
      `public/live2d/${path}`,
      !dynamicReady && path === lock.modelEntry ? Buffer.from("changed-model") : bytes,
    );
  }
  return root;
}

function copyVerifier(root) {
  const target = join(root, "scripts/fetch-live2d.mjs");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(process.cwd(), "scripts/fetch-live2d.mjs"), target);
}

function write(root, relativePath, contents) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
