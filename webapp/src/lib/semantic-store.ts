"use client";

import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";

import {
  initialSemanticState,
  reduceSemanticState,
  type SemanticEvent,
  type SemanticState,
} from "./semantic-state";

export interface Announcement {
  id: number;
  message: string;
  politeness: "polite" | "assertive";
}

export interface SemanticStoreState extends SemanticState {
  announcement: Announcement | null;
  dispatch: (event: SemanticEvent) => void;
  dispatchMany: (events: readonly SemanticEvent[]) => void;
  announce: (message: string, politeness?: Announcement["politeness"]) => void;
  clearAnnouncement: () => void;
}

export const createSemanticStore = () => {
  let nextAnnouncementId = 0;

  return createStore<SemanticStoreState>()((set) => ({
    ...initialSemanticState,
    announcement: null,
    dispatch: (event) => set((state) => ({ ...reduceSemanticState(state, event) })),
    dispatchMany: (events) =>
      set((state) => events.reduce<SemanticState>(reduceSemanticState, state)),
    announce: (message, politeness = "polite") =>
      set({
        announcement: {
          id: ++nextAnnouncementId,
          message,
          politeness,
        },
      }),
    clearAnnouncement: () => set({ announcement: null }),
  }));
};

export const semanticStore = createSemanticStore();

export function useSemanticStore<T>(selector: (state: SemanticStoreState) => T): T {
  return useStore(semanticStore, selector);
}
