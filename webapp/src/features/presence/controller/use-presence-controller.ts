"use client";

import { useSyncExternalStore } from "react";

import { createCoreClient } from "@/features/presence/data/core-client";
import { PresenceStream } from "@/features/presence/data/presence-stream";
import type { DraftSnapshot } from "@/features/presence/model/presence-types";
import { semanticStore } from "@/lib/semantic-store";

import {
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  createPresenceController,
  type PresenceController,
  type PresenceControllerActions,
  type PresenceControllerSnapshot,
} from "./create-presence-controller";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface PresenceControllerOwnerOptions {
  readonly createController: () => PresenceController;
  readonly setTimer?: (callback: () => void, delay: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
}

export interface PresenceControllerOwner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PresenceControllerSnapshot;
  readonly getServerSnapshot: () => PresenceControllerSnapshot;
  readonly actions: PresenceControllerActions;
}

export interface UsePresenceControllerResult {
  readonly snapshot: PresenceControllerSnapshot;
  readonly actions: PresenceControllerActions;
}

export function createPresenceControllerOwner(
  options: PresenceControllerOwnerOptions,
): PresenceControllerOwner {
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  let controller: PresenceController | null = null;
  let subscriberCount = 0;
  let pendingDisposal: TimerHandle | null = null;

  const cancelPendingDisposal = (): void => {
    if (pendingDisposal === null) return;
    clearTimer(pendingDisposal);
    pendingDisposal = null;
  };

  const actions: PresenceControllerActions = {
    updateDraft: (draft: DraftSnapshot) => {
      controller?.actions.updateDraft(draft);
    },
    send: (draft: DraftSnapshot) => controller?.actions.send(draft) ?? Promise.resolve(false),
    retryFailed: () => controller?.actions.retryFailed() ?? Promise.resolve(false),
    transcribe: (wavB64: string, signal?: AbortSignal) =>
      controller?.actions.transcribe(wavB64, signal) ??
      Promise.reject(new Error("Presence controller is unavailable")),
    estop: () => controller?.actions.estop() ?? Promise.resolve(false),
    reset: () => controller?.actions.reset() ?? Promise.resolve(false),
  };

  const subscribe = (listener: () => void): (() => void) => {
    cancelPendingDisposal();
    if (controller === null) {
      controller = options.createController();
      controller.start();
    }

    const acquiredController = controller;
    const unsubscribeController = acquiredController.subscribe(listener);
    subscriberCount += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      unsubscribeController();
      subscriberCount -= 1;
      if (subscriberCount !== 0) return;

      pendingDisposal = setTimer(() => {
        pendingDisposal = null;
        if (subscriberCount !== 0 || controller !== acquiredController) return;
        controller = null;
        acquiredController.dispose();
      }, 0);
    };
  };

  return {
    subscribe,
    getSnapshot: () => controller?.getSnapshot() ?? PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    getServerSnapshot: () => PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    actions,
  };
}

export const presenceControllerOwner = createPresenceControllerOwner({
  createController: () =>
    createPresenceController({
      coreClient: createCoreClient(),
      semanticStore,
      streamFactory: (callbacks) => new PresenceStream(callbacks),
    }),
});

export function usePresenceController(
  owner: PresenceControllerOwner = presenceControllerOwner,
): UsePresenceControllerResult {
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getServerSnapshot,
  );
  return { snapshot, actions: owner.actions };
}
