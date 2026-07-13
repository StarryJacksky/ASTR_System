"use client";

import { useSyncExternalStore } from "react";

import { createMobileSafetyClient } from "./mobile-safety-client";
import {
  MOBILE_SAFETY_SERVER_SNAPSHOT,
  createMobileSafetyController,
  type MobileSafetyActions,
  type MobileSafetyController,
  type MobileSafetySnapshot,
} from "./create-mobile-safety-controller";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MobileSafetyControllerOwnerOptions {
  readonly createController: () => MobileSafetyController;
  readonly setTimer?: (callback: () => void, delay: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
}

export interface MobileSafetyControllerOwner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => MobileSafetySnapshot;
  readonly getServerSnapshot: () => MobileSafetySnapshot;
  readonly actions: MobileSafetyActions;
}

export interface UseMobileSafetyControllerResult {
  readonly snapshot: MobileSafetySnapshot;
  readonly actions: MobileSafetyActions;
}

export function createMobileSafetyControllerOwner(
  options: MobileSafetyControllerOwnerOptions,
): MobileSafetyControllerOwner {
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  let controller: MobileSafetyController | null = null;
  let subscriberCount = 0;
  let pendingDisposal: TimerHandle | null = null;

  const cancelPendingDisposal = (): void => {
    if (pendingDisposal === null) return;
    clearTimer(pendingDisposal);
    pendingDisposal = null;
  };

  const withActiveController = (
    action: (activeController: MobileSafetyController) => void,
  ): void => {
    if (subscriberCount === 0 || controller === null) return;
    action(controller);
  };

  const actions: MobileSafetyActions = Object.freeze({
    refreshStatus: () => {
      withActiveController((activeController) => activeController.actions.refreshStatus());
    },
    refreshPolicy: () => {
      withActiveController((activeController) => activeController.actions.refreshPolicy());
    },
    refreshAudit: () => {
      withActiveController((activeController) => activeController.actions.refreshAudit());
    },
  });

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

  return Object.freeze({
    subscribe,
    getSnapshot: () => controller?.getSnapshot() ?? MOBILE_SAFETY_SERVER_SNAPSHOT,
    getServerSnapshot: () => MOBILE_SAFETY_SERVER_SNAPSHOT,
    actions,
  });
}

export const mobileSafetyControllerOwner = createMobileSafetyControllerOwner({
  createController: () =>
    createMobileSafetyController({
      client: createMobileSafetyClient(),
    }),
});

export function useMobileSafetyController(
  owner: MobileSafetyControllerOwner = mobileSafetyControllerOwner,
): UseMobileSafetyControllerResult {
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getServerSnapshot,
  );
  return { snapshot, actions: owner.actions } as const;
}
