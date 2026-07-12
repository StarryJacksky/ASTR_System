"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  presenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";
import type { PresenceControllerSnapshot } from "@/features/presence/controller/create-presence-controller";
import type { SemanticState } from "@/lib/semantic-state";
import { semanticStore } from "@/lib/semantic-store";

import {
  jewelRuntime,
  type JewelRuntime,
  type JewelRuntimeSnapshot,
} from "./jewel-runtime";

export interface JewelSemanticSource {
  readonly getState: () => Pick<
    SemanticState,
    "visibility" | "motion" | "visualRuntime"
  >;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface JewelPresenceSource {
  readonly getSnapshot: () => PresenceControllerSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface JewelRuntimeBridgeOwner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => JewelRuntimeSnapshot;
  readonly getServerSnapshot: () => JewelRuntimeSnapshot;
}

export interface JewelRuntimeBridgeOwnerOptions {
  readonly runtime: JewelRuntime;
  readonly semanticSource: JewelSemanticSource;
  readonly presenceSource: JewelPresenceSource;
  readonly scheduleMicrotask?: (callback: () => void) => void;
}

interface RuntimeConnection {
  readonly releaseSemantic: () => void;
  readonly releasePresence: () => void;
}

interface SharedRuntimeOwnership {
  readonly runtime: JewelRuntime;
  readonly semanticSource: JewelSemanticSource;
  readonly presenceSource: JewelPresenceSource;
  readonly scheduleMicrotask: (callback: () => void) => void;
  subscriberCount: number;
  cleanupGeneration: number;
  connection: RuntimeConnection | null;
}

interface MarkerRegistryEntry {
  owner: symbol | null;
  readonly listeners: Map<symbol, (ownsMarker: boolean) => void>;
}

const runtimeOwnershipRegistry = new WeakMap<JewelRuntime, SharedRuntimeOwnership>();
const ownerRuntimeRegistry = new WeakMap<JewelRuntimeBridgeOwner, JewelRuntime>();
const markerRegistry = new WeakMap<object, MarkerRegistryEntry>();

export function createJewelRuntimeBridgeOwner({
  runtime,
  semanticSource,
  presenceSource,
  scheduleMicrotask = enqueueMicrotask,
}: JewelRuntimeBridgeOwnerOptions): JewelRuntimeBridgeOwner {
  let ownership = runtimeOwnershipRegistry.get(runtime);
  if (ownership !== undefined) {
    if (
      ownership.semanticSource !== semanticSource ||
      ownership.presenceSource !== presenceSource
    ) {
      throw new Error(
        "A Jewel runtime must use the same semantic and Presence sources across bridge owners.",
      );
    }
  } else {
    ownership = {
      runtime,
      semanticSource,
      presenceSource,
      scheduleMicrotask,
      subscriberCount: 0,
      cleanupGeneration: 0,
      connection: null,
    };
    runtimeOwnershipRegistry.set(runtime, ownership);
  }

  const connect = (): void => {
    if (ownership.connection !== null) return;

    const synchronizeSemantic = () => runtime.syncSemantic(semanticSource.getState());
    const synchronizePresence = () => runtime.syncPresence(presenceSource.getSnapshot());
    let releaseSemantic: (() => void) | null = null;
    let releasePresence: (() => void) | null = null;

    try {
      releaseSemantic = semanticSource.subscribe(synchronizeSemantic);
      synchronizeSemantic();
      releasePresence = presenceSource.subscribe(synchronizePresence);
      runtime.primePresence(presenceSource.getSnapshot());
      ownership.connection = { releaseSemantic, releasePresence };
    } catch (error) {
      releaseQuietly(releasePresence);
      releaseQuietly(releaseSemantic);
      runtime.dispose();
      throw error;
    }
  };

  const disconnect = (): void => {
    const ownedConnection = ownership.connection;
    if (ownedConnection === null) return;
    ownership.connection = null;
    ownedConnection.releasePresence();
    ownedConnection.releaseSemantic();
    runtime.dispose();
  };

  const subscribe = (listener: () => void): (() => void) => {
    ownership.cleanupGeneration += 1;
    connect();
    ownership.subscriberCount += 1;
    const releaseRuntime = runtime.subscribe(listener);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      releaseRuntime();
      ownership.subscriberCount -= 1;
      if (ownership.subscriberCount !== 0) return;

      const scheduledGeneration = ++ownership.cleanupGeneration;
      ownership.scheduleMicrotask(() => {
        if (
          ownership.subscriberCount !== 0 ||
          scheduledGeneration !== ownership.cleanupGeneration
        ) {
          return;
        }
        disconnect();
      });
    };
  };

  const owner = Object.freeze({
    subscribe,
    getSnapshot: runtime.getSnapshot,
    getServerSnapshot: runtime.getServerSnapshot,
  });
  ownerRuntimeRegistry.set(owner, runtime);
  return owner;
}

export const jewelRuntimeBridgeOwner = createJewelRuntimeBridgeOwner({
  runtime: jewelRuntime,
  semanticSource: semanticStore,
  presenceSource: presenceControllerOwner,
});

export function JewelRuntimeBridge({
  owner = jewelRuntimeBridgeOwner,
}: {
  readonly owner?: JewelRuntimeBridgeOwner;
}) {
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getServerSnapshot,
  );
  const markerTokenRef = useRef(Symbol("ASTR Jewel marker"));
  const [ownsMarker, setOwnsMarker] = useState(false);

  useLayoutEffect(
    () =>
      registerMarker(
        ownerRuntimeRegistry.get(owner) ?? owner,
        markerTokenRef.current,
        setOwnsMarker,
      ),
    [owner],
  );

  if (!ownsMarker) return null;

  return (
    <span
      aria-hidden="true"
      data-dynamic-jewel={snapshot.lease === null ? "inactive" : "active"}
      data-jewel-endpoint={
        snapshot.endpoint.kind === "stage" ? snapshot.endpoint.stage : "rest"
      }
      data-jewel-mode={snapshot.lease?.mode}
      data-jewel-owner={snapshot.lease?.owner}
      hidden
    />
  );
}

function registerMarker(
  runtimeKey: object,
  token: symbol,
  listener: (ownsMarker: boolean) => void,
): () => void {
  let entry = markerRegistry.get(runtimeKey);
  if (entry === undefined) {
    entry = { owner: null, listeners: new Map() };
    markerRegistry.set(runtimeKey, entry);
  }
  entry.listeners.set(token, listener);
  if (entry.owner === null) entry.owner = token;
  listener(entry.owner === token);

  return () => {
    const current = markerRegistry.get(runtimeKey);
    if (current === undefined) return;
    current.listeners.delete(token);
    if (current.owner === token) {
      current.owner = current.listeners.keys().next().value ?? null;
      for (const [candidate, notify] of current.listeners) {
        notify(candidate === current.owner);
      }
    }
    if (current.listeners.size === 0) markerRegistry.delete(runtimeKey);
  };
}

function releaseQuietly(release: (() => void) | null): void {
  try {
    release?.();
  } catch {
    // Preserve the original connection error while still unwinding ownership.
  }
}

function enqueueMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}
