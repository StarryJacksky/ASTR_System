"use client";

import { semanticStore } from "@/lib/semantic-store";
import type { VisibilityState } from "@/lib/semantic-state";

export interface PresenceVisibilitySnapshot {
  readonly documentVisible: boolean;
  readonly viewportOnscreen: boolean | null;
  readonly visibility: VisibilityState;
}

export interface PresenceVisibilityCoordinator {
  getSnapshot(): PresenceVisibilitySnapshot;
  setDocumentVisible(documentVisible: boolean): void;
  setViewportOnscreen(viewportOnscreen: boolean): void;
}

export interface PresenceVisibilityCoordinatorOptions {
  readonly publish: (visibility: VisibilityState) => void;
  readonly documentVisible?: boolean;
  readonly viewportOnscreen?: boolean | null;
}

function deriveVisibility(
  documentVisible: boolean,
  viewportOnscreen: boolean | null,
): VisibilityState {
  if (!documentVisible) return "hidden";
  if (viewportOnscreen !== true) return "offscreen";
  return "visible";
}

export function createPresenceVisibilityCoordinator({
  publish,
  documentVisible = true,
  viewportOnscreen = null,
}: PresenceVisibilityCoordinatorOptions): PresenceVisibilityCoordinator {
  let snapshot = createSnapshot(documentVisible, viewportOnscreen);
  let lastPublished: VisibilityState | null = null;

  const update = (nextDocumentVisible: boolean, nextViewportOnscreen: boolean | null) => {
    if (
      nextDocumentVisible !== snapshot.documentVisible ||
      nextViewportOnscreen !== snapshot.viewportOnscreen
    ) {
      snapshot = createSnapshot(nextDocumentVisible, nextViewportOnscreen);
    }
    if (snapshot.visibility === lastPublished) return;
    lastPublished = snapshot.visibility;
    publish(snapshot.visibility);
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    setDocumentVisible: (nextDocumentVisible: boolean) => {
      update(nextDocumentVisible, snapshot.viewportOnscreen);
    },
    setViewportOnscreen: (nextViewportOnscreen: boolean) => {
      update(snapshot.documentVisible, nextViewportOnscreen);
    },
  });
}

function createSnapshot(
  documentVisible: boolean,
  viewportOnscreen: boolean | null,
): PresenceVisibilitySnapshot {
  return Object.freeze({
    documentVisible,
    viewportOnscreen,
    visibility: deriveVisibility(documentVisible, viewportOnscreen),
  });
}

export const presenceVisibilityCoordinator = createPresenceVisibilityCoordinator({
  publish: (visibility) => {
    semanticStore.getState().dispatch({ type: "VISIBILITY_DERIVED", visibility });
  },
});
