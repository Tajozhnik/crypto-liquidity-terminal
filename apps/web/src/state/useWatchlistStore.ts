"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WatchlistStore {
  symbols: string[];
  toggle: (symbol: string) => void;
  has: (symbol: string) => boolean;
  clear: () => void;
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => ({
      symbols: [],
      toggle: (symbol) =>
        set((state) => {
          const set2 = new Set(state.symbols);
          if (set2.has(symbol)) set2.delete(symbol);
          else set2.add(symbol);
          return { symbols: [...set2].sort() };
        }),
      has: (symbol) => get().symbols.includes(symbol),
      clear: () => set({ symbols: [] }),
    }),
    {
      name: "screener.watchlist.v1",
    },
  ),
);
