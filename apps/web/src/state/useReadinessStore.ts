"use client";
import type { ExchangeName, MarketType } from "@screener/shared";
import { create } from "zustand";

export interface ReadinessAdapter {
  name: ExchangeName;
  enabled: boolean;
  connected: boolean;
  status: "ok" | "degraded" | "disabled";
  marketTypes: MarketType[];
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

interface ReadinessStore {
  adapters: ReadinessAdapter[];
  /** Last fetch error, e.g. timeout or network error. Null when readiness is healthy. */
  lastFetchError: string | null;
  /** ISO timestamp of last successful fetch. */
  lastFetchedAt: string | null;
  setAdapters: (a: ReadinessAdapter[]) => void;
  setFetchError: (msg: string | null) => void;
  setFetchedAt: (iso: string | null) => void;
  isEnabled: (name: ExchangeName) => boolean;
  statusOf: (name: ExchangeName) => ReadinessAdapter["status"] | "unknown";
  enabledExchanges: () => ExchangeName[];
}

export const useReadinessStore = create<ReadinessStore>((set, get) => ({
  adapters: [],
  lastFetchError: null,
  lastFetchedAt: null,
  setAdapters: (adapters) => set({ adapters }),
  setFetchError: (lastFetchError) => set({ lastFetchError }),
  setFetchedAt: (lastFetchedAt) => set({ lastFetchedAt }),
  isEnabled: (name) => get().adapters.some((a) => a.name === name && a.enabled),
  statusOf: (name) => {
    const found = get().adapters.find((a) => a.name === name);
    return found ? found.status : "unknown";
  },
  enabledExchanges: () => get().adapters.filter((a) => a.enabled).map((a) => a.name),
}));
