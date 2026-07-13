import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

import type {
  MobileSafetyActions,
  MobileSafetySnapshot,
} from "./create-mobile-safety-controller";
import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import type { MobileSafetyControllerOwner } from "./use-mobile-safety-controller";
import { MobileLocalSafetyDomain } from "./MobileLocalSafetyDomain";

interface MountedDomain {
  readonly host: HTMLDivElement;
  root: Root | null;
}

export interface HydratedSafetyDomain {
  readonly serverHtml: string;
  readonly host: HTMLDivElement;
  readonly recoverableError: ReturnType<typeof vi.fn>;
  readonly unmount: () => Promise<void>;
}

export interface SafetyOwnerFixture {
  readonly owner: MobileSafetyControllerOwner;
  readonly actions: MobileSafetyActions;
  readonly activeSubscribers: () => number;
  readonly peakSubscribers: () => number;
  readonly emit: (snapshot: MobileSafetySnapshot) => void;
}

export function createPoisonSafetyOwner() {
  const touches = vi.fn((member: string): never => {
    throw new Error("Mobile Safety owner touched: " + member);
  });
  const owner: MobileSafetyControllerOwner = {
    subscribe: vi.fn(() => touches("subscribe")),
    getSnapshot: vi.fn(() => touches("getSnapshot")),
    getServerSnapshot: vi.fn(() => touches("getServerSnapshot")),
    get actions() {
      return touches("actions");
    },
  };
  return { owner, touches };
}

export function createSafetyOwnerFixture(
  initialSnapshot: MobileSafetySnapshot,
): SafetyOwnerFixture {
  let snapshot = initialSnapshot;
  let active = 0;
  let peak = 0;
  const listeners = new Set<() => void>();
  const actions: MobileSafetyActions = {
    refreshStatus: vi.fn(),
    refreshPolicy: vi.fn(),
    refreshAudit: vi.fn(),
  };
  const owner: MobileSafetyControllerOwner = {
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

export function createSafetyHydrationHarness() {
  const mountedDomains = new Set<MountedDomain>();

  async function releaseDomain(mount: MountedDomain): Promise<void> {
    if (!mountedDomains.delete(mount)) return;
    const root = mount.root;
    try {
      if (root) await act(async () => root.unmount());
    } finally {
      mount.host.remove();
    }
  }

  return Object.freeze({
    async hydrate(
      serverAuthorityTrusted: boolean,
      owner: MobileSafetyControllerOwner,
    ): Promise<HydratedSafetyDomain> {
      const tree = (
        <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
          <MobileLocalSafetyDomain owner={owner} />
        </MobileAuthorityProvider>
      );
      const serverHtml = renderToString(tree);
      const host = document.createElement("div");
      host.innerHTML = serverHtml;
      document.body.append(host);
      const recoverableError = vi.fn();
      const mount: MountedDomain = { host, root: null };
      mountedDomains.add(mount);

      try {
        await act(async () => {
          mount.root = hydrateRoot(host, tree, {
            onRecoverableError: recoverableError,
          });
        });
      } catch (error) {
        await releaseDomain(mount);
        throw error;
      }

      return {
        serverHtml,
        host,
        recoverableError,
        unmount: () => releaseDomain(mount),
      };
    },
    async releaseAll(): Promise<void> {
      for (const mount of [...mountedDomains]) await releaseDomain(mount);
    },
  });
}
