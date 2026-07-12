"use client";

import { useEffect, type RefObject } from "react";

import {
  createBrowserPresenceVisualRuntime,
  type PresenceVisualApplication,
  type PresenceVisualApplicationModule,
  type PresenceVisualJewelOwnership,
  type PresenceVisualSceneInitializer,
  type PresenceVisualSemanticSource,
} from "./presence-visual-runtime";
import type { PresenceVisualRuntimeOwner } from "./presence-visual-owner";
import { COMPACT_VISUAL_MAX_WIDTH } from "./static-visual-state";

const INERT_JEWEL_SNAPSHOT = Object.freeze({ ownsLease: false });
const PIXI_NO_RENDERER_MESSAGE = "Unable to auto-detect a suitable renderer.";
const inertJewelOwnership: PresenceVisualJewelOwnership = Object.freeze({
  getSnapshot: () => INERT_JEWEL_SNAPSHOT,
  subscribe: () => () => undefined,
  releaseOwned: () => undefined,
});
const visualConfigurationKeys = new WeakMap<
  PresenceVisualSceneInitializer,
  WeakMap<PresenceVisualJewelOwnership, object>
>();

export interface PresenceVisualMountProps {
  readonly owner: PresenceVisualRuntimeOwner;
  readonly semanticSource: PresenceVisualSemanticSource;
  readonly sceneLoader: PresenceVisualSceneInitializer;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly jewelOwnership?: PresenceVisualJewelOwnership;
}

export async function loadPixiApplicationModule(): Promise<PresenceVisualApplicationModule> {
  const pixi = await import("pixi.js");
  return Object.freeze({
    Application:
      pixi.Application as unknown as PresenceVisualApplicationModule["Application"],
    isWebglApplication: (application: PresenceVisualApplication) =>
      (application.renderer as { readonly type?: number }).type ===
      pixi.RENDERER_TYPE.WEBGL,
    isWebglUnavailableError: (error: unknown) =>
      readErrorMessage(error) === PIXI_NO_RENDERER_MESSAGE,
  });
}

export function PresenceVisualMount({
  owner,
  semanticSource,
  sceneLoader,
  surfaceRef,
  jewelOwnership = inertJewelOwnership,
}: PresenceVisualMountProps) {
  const configurationKey = getVisualConfigurationKey(
    sceneLoader,
    jewelOwnership,
  );

  useEffect(() => {
    const surfaceElement = surfaceRef.current;
    if (surfaceElement === null) return;

    return owner.acquireRuntime({
      configurationKey,
      mountKey: surfaceElement,
      createRuntime: () =>
        createBrowserPresenceVisualRuntime({
          target: surfaceElement,
          semantic: semanticSource,
          jewel: jewelOwnership,
          compact: () => window.innerWidth <= COMPACT_VISUAL_MAX_WIDTH,
          loadApplicationModule: loadPixiApplicationModule,
          initializeScene: sceneLoader,
          activityAllowed: (profile) => !profile.compact,
        }),
    });
  }, [
    configurationKey,
    jewelOwnership,
    owner,
    sceneLoader,
    semanticSource,
    surfaceRef,
  ]);

  return null;
}

function getVisualConfigurationKey(
  sceneLoader: PresenceVisualSceneInitializer,
  jewelOwnership: PresenceVisualJewelOwnership,
): object {
  let jewelKeys = visualConfigurationKeys.get(sceneLoader);
  if (jewelKeys === undefined) {
    jewelKeys = new WeakMap<PresenceVisualJewelOwnership, object>();
    visualConfigurationKeys.set(sceneLoader, jewelKeys);
  }
  const existing = jewelKeys.get(jewelOwnership);
  if (existing !== undefined) return existing;
  const configurationKey = Object.freeze({ sceneLoader, jewelOwnership });
  jewelKeys.set(jewelOwnership, configurationKey);
  return configurationKey;
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  return typeof error.message === "string" ? error.message : null;
}
