import { vi } from "vitest";

import type {
  PresenceControllerActions,
  PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import type { PresenceControllerOwner } from "@/features/presence/controller/use-presence-controller";

export interface PresenceOwnerFixture {
  readonly owner: PresenceControllerOwner;
  readonly actions: PresenceControllerActions;
  readonly activeSubscribers: () => number;
  readonly peakSubscribers: () => number;
  readonly emit: (snapshot: PresenceControllerSnapshot) => void;
}

export function createPresenceOwnerFixture(
  initialSnapshot: PresenceControllerSnapshot,
): PresenceOwnerFixture {
  let snapshot = initialSnapshot;
  let active = 0;
  let peak = 0;
  const listeners = new Set<() => void>();
  const actions: PresenceControllerActions = {
    updateDraft: vi.fn(),
    send: vi.fn(async () => true),
    retryFailed: vi.fn(async () => true),
    transcribe: vi.fn(async () => ({ text: "测试转写" })),
    estop: vi.fn(async () => false),
    reset: vi.fn(async () => false),
  };

  const owner: PresenceControllerOwner = {
    subscribe(listener) {
      listeners.add(listener);
      active += 1;
      peak = Math.max(peak, active);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        listeners.delete(listener);
        active -= 1;
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    actions,
  };

  return {
    owner,
    actions,
    activeSubscribers: () => active,
    peakSubscribers: () => peak,
    emit(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}
