"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { semanticStore } from "@/lib/semantic-store";

import {
  presenceVisualRuntimeOwner,
  type PresenceVisualRuntimeOwner,
} from "./presence-visual-owner";
import type {
  PresenceVisualJewelOwnership,
  PresenceVisualSceneInitializer,
  PresenceVisualSemanticEvent,
  PresenceVisualSemanticSnapshot,
  PresenceVisualSemanticSource,
} from "./presence-visual-runtime";
import {
  deriveStaticVisualState,
  type WebglAvailability,
} from "./static-visual-state";

const PresenceVisualMount = dynamic(
  () =>
    import("./pixi-runtime-loader").then(
      (module) => module.PresenceVisualMount,
    ),
  { loading: () => null, ssr: false },
);

const HOST_SEMANTIC_SERVER_SNAPSHOT: PresenceVisualSemanticSnapshot =
  Object.freeze({
    visibility: "offscreen",
    motion: "full",
    visualRuntime: "loading",
  });
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const retryAnnouncementEpisodes = new WeakMap<
  PresenceVisualRuntimeOwner,
  { announced: boolean }
>();

const announceVisualStatus = (message: string): void => {
  semanticStore.getState().announce(message, "polite");
};

export const presenceVisualSemanticSource: PresenceVisualSemanticSource =
  Object.freeze({
    getSnapshot: () => semanticStore.getState(),
    subscribe: semanticStore.subscribe,
    dispatch: (event: PresenceVisualSemanticEvent) =>
      semanticStore.getState().dispatch(event),
  });

export interface PresenceVisualHostProps {
  readonly announce?: (message: string) => void;
  readonly owner?: PresenceVisualRuntimeOwner;
  readonly semanticSource?: PresenceVisualSemanticSource;
  readonly sceneLoader?: PresenceVisualSceneInitializer;
  readonly jewelOwnership?: PresenceVisualJewelOwnership;
  readonly viewportWidth?: number;
  readonly webglAvailability?: WebglAvailability;
}

export function PresenceVisualHost({
  announce = announceVisualStatus,
  owner = presenceVisualRuntimeOwner,
  semanticSource = presenceVisualSemanticSource,
  sceneLoader,
  jewelOwnership,
  viewportWidth,
  webglAvailability = "unknown",
}: PresenceVisualHostProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const browserFacts = useBrowserVisualFacts(viewportWidth);
  const semantic = useSyncExternalStore(
    semanticSource.subscribe,
    semanticSource.getSnapshot,
    () => HOST_SEMANTIC_SERVER_SNAPSHOT,
  );
  const ownerSnapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getServerSnapshot,
  );
  const effectiveWebglAvailability =
    ownerSnapshot.webglAvailability === "unknown"
      ? webglAvailability
      : ownerSnapshot.webglAvailability;

  useLayoutEffect(() => owner.retainHost(semanticSource), [owner, semanticSource]);

  const staticState =
    browserFacts === null
      ? deriveStaticVisualState({ renderEnvironment: "server" })
      : deriveStaticVisualState({
          renderEnvironment: "browser",
          sceneConfigured: sceneLoader !== undefined,
          viewportWidth: browserFacts.viewportWidth,
          webglAvailability: effectiveWebglAvailability,
          visibility: semantic.visibility,
          motion:
            browserFacts.prefersReducedMotion && semantic.motion !== "paused"
              ? "reduced"
              : semantic.motion,
          visualRuntime: semantic.visualRuntime,
          retryRequired: ownerSnapshot.retryRequired,
        });
  const shouldRetainDynamicMount =
    sceneLoader !== undefined &&
    (staticState.dynamicEligible || ownerSnapshot.hasStartedRuntime);

  useEffect(() => {
    const existingEpisode = retryAnnouncementEpisodes.get(owner);
    if (!ownerSnapshot.retryRequired) {
      if (existingEpisode !== undefined) existingEpisode.announced = false;
      return;
    }
    if (
      !staticState.retryAvailable ||
      staticState.announcement !== "polite" ||
      staticState.copy.retryLabel === null
    ) {
      return;
    }
    const episode = existingEpisode ?? { announced: false };
    if (existingEpisode === undefined) retryAnnouncementEpisodes.set(owner, episode);
    if (episode.announced) return;
    episode.announced = true;
    try {
      announce(
        `${staticState.copy.description} 可使用“${staticState.copy.retryLabel}”重新尝试。`,
      );
    } catch {
      // Accessibility announcements are observational and cannot own recovery.
    }
  }, [
    announce,
    owner,
    ownerSnapshot.retryRequired,
    staticState.announcement,
    staticState.copy.description,
    staticState.copy.retryLabel,
    staticState.retryAvailable,
  ]);

  return (
    <div
      data-presence-visual-host="true"
      data-visual-phase={ownerSnapshot.phase}
      data-visual-status={staticState.status}
      data-webgl-availability={effectiveWebglAvailability}
    >
      <div
        ref={surfaceRef}
        aria-hidden="true"
        data-presence-visual-surface="true"
        tabIndex={-1}
      />
      <p className="sr-only" data-presence-visual-copy="true">
        {staticState.copy.label}：{staticState.copy.description}
      </p>
      {staticState.retryAvailable && staticState.copy.retryLabel !== null ? (
        <button
          data-presence-visual-retry="true"
          onClick={() => void owner.retry()}
          type="button"
        >
          {staticState.copy.retryLabel}
        </button>
      ) : null}
      {shouldRetainDynamicMount ? (
        <PresenceVisualMount
          jewelOwnership={jewelOwnership}
          owner={owner}
          sceneLoader={sceneLoader}
          semanticSource={semanticSource}
          surfaceRef={surfaceRef}
        />
      ) : null}
    </div>
  );
}

interface BrowserVisualFacts {
  readonly viewportWidth: number;
  readonly prefersReducedMotion: boolean;
}

function useBrowserVisualFacts(
  override: number | undefined,
): BrowserVisualFacts | null {
  const [facts, setFacts] = useState<BrowserVisualFacts | null>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const synchronize = () => {
      setFacts({
        viewportWidth: override ?? window.innerWidth,
        prefersReducedMotion: reducedMotion.matches,
      });
    };
    synchronize();
    if (override === undefined) window.addEventListener("resize", synchronize);
    reducedMotion.addEventListener("change", synchronize);
    return () => {
      if (override === undefined) window.removeEventListener("resize", synchronize);
      reducedMotion.removeEventListener("change", synchronize);
    };
  }, [override]);

  return facts;
}
