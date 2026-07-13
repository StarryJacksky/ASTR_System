import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

import type { PresenceControllerOwner } from "@/features/presence/controller/use-presence-controller";

import { MobileAuthorityProvider } from "../authority/MobileAuthorityProvider";
import { MobilePresenceDomain } from "./MobilePresenceDomain";

interface MountedDomain {
  readonly host: HTMLDivElement;
  root: Root | null;
}

export interface HydratedDomain {
  readonly serverHtml: string;
  readonly host: HTMLDivElement;
  readonly recoverableError: ReturnType<typeof vi.fn>;
  readonly unmount: () => Promise<void>;
}

export function createPoisonOwner() {
  const touches = vi.fn((member: string): never => {
    throw new Error("Presence owner touched: " + member);
  });
  const owner: PresenceControllerOwner = {
    subscribe: vi.fn(() => touches("subscribe")),
    getSnapshot: vi.fn(() => touches("getSnapshot")),
    getServerSnapshot: vi.fn(() => touches("getServerSnapshot")),
    get actions() {
      return touches("actions");
    },
  };
  return { owner, touches };
}

export function createDomainHydrationHarness() {
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
      owner: PresenceControllerOwner,
    ): Promise<HydratedDomain> {
      const tree = (
        <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
          <MobilePresenceDomain owner={owner} />
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
