"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { EffectorClient } from "../data/effector-client";
import {
  createEffectorController,
  type EffectorActions,
  type EffectorSnapshot,
} from "./create-effector-controller";

export interface UseEffectorControllerResult {
  readonly snapshot: EffectorSnapshot;
  readonly actions: EffectorActions;
}

export function useEffectorController(
  client: EffectorClient,
): UseEffectorControllerResult {
  const [controller] = useState(() => createEffectorController(client));

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );

  return { snapshot, actions: controller.actions };
}
