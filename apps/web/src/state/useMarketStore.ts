"use client";
import type { ScreenerResult, Signal } from "@screener/shared";
import { create } from "zustand";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface MarketStore {
  markets: Map<string, ScreenerResult>;
  recentSignals: Signal[];
  connection: ConnectionState;
  setSnapshot: (markets: ScreenerResult[], signals: Signal[]) => void;
  applyBatch: (results: ScreenerResult[]) => void;
  pushSignal: (signal: Signal) => void;
  setConnection: (s: ConnectionState) => void;
}

export const useMarketStore = create<MarketStore>((set) => ({
  markets: new Map(),
  recentSignals: [],
  connection: "connecting",
  setSnapshot: (markets, signals) =>
    set({
      markets: new Map(markets.map((m) => [m.symbol, m])),
      recentSignals: signals,
    }),
  applyBatch: (results) =>
    set((state) => {
      const next = new Map(state.markets);
      for (const r of results) next.set(r.symbol, r);
      return { markets: next };
    }),
  pushSignal: (signal) =>
    set((state) => ({
      recentSignals: [signal, ...state.recentSignals].slice(0, 200),
    })),
  setConnection: (s) => set({ connection: s }),
}));
