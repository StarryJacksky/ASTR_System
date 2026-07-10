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
  announce: (message: string, politeness?: Announcement["politeness"]) => void;
  clearAnnouncement: () => void;
}

export const createSemanticStore = () =>
  createStore<SemanticStoreState>()((set) => ({
    ...initialSemanticState,
    announcement: null,
    dispatch: (event) => set((state) => ({ ...reduceSemanticState(state, event) })),
    announce: (message, politeness = "polite") =>
      set((state) => ({
        announcement: {
          id: (state.announcement?.id ?? 0) + 1,
          message,
          politeness,
        },
      })),
    clearAnnouncement: () => set({ announcement: null }),
  }));

export const semanticStore = createSemanticStore();

export function useSemanticStore<T>(selector: (state: SemanticStoreState) => T): T {
  return useStore(semanticStore, selector);
}
