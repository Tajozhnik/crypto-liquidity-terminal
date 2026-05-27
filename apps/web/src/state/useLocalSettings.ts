"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";
export type TableDensity = "comfortable" | "compact";

interface LocalSettings {
  theme: Theme;
  tableDensity: TableDensity;
  /** Mirror of the server-side default exchange so the UI keeps it after refresh
   *  even when the backend's database is unavailable. */
  defaultExchange: string | null;
  defaultMarketType: string | null;
  defaultQuoteAsset: string | null;
  setTheme: (t: Theme) => void;
  setTableDensity: (d: TableDensity) => void;
  setMirroredServerSettings: (p: { defaultExchange?: string; defaultMarketType?: string; defaultQuoteAsset?: string }) => void;
}

export const useLocalSettings = create<LocalSettings>()(
  persist(
    (set) => ({
      theme: "dark",
      tableDensity: "comfortable",
      defaultExchange: null,
      defaultMarketType: null,
      defaultQuoteAsset: null,
      setTheme: (theme) => set({ theme }),
      setTableDensity: (tableDensity) => set({ tableDensity }),
      setMirroredServerSettings: (p) =>
        set((state) => ({
          defaultExchange: p.defaultExchange ?? state.defaultExchange,
          defaultMarketType: p.defaultMarketType ?? state.defaultMarketType,
          defaultQuoteAsset: p.defaultQuoteAsset ?? state.defaultQuoteAsset,
        })),
    }),
    { name: "screener.local.settings.v1" },
  ),
);
