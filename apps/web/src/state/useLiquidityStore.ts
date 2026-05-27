"use client";
import { create } from "zustand";
import type { HeatmapMatrix } from "@/lib/liquidity/binning";
import type { DensityMode, DensityPreset } from "@/lib/liquidity/densityScale";

export type HeatmapLookback = "15m" | "30m" | "1h" | "2h" | "4h" | "max";

export interface CandleRow {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookRow {
  bids: [number, number][];
  asks: [number, number][];
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPct: number;
  imbalance: number;
  updatedAt: string;
}

export interface DeltaBucket {
  t: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
}

export interface FeedStatus {
  symbol: string;
  exchange: string;
  marketType: "spot" | "futures";
  connected: boolean;
  needsResync: boolean;
  snapshots: number;
  trades: number;
  lastErrorMessage: string | null;
  /** ISO timestamp of when the per-symbol feed started — used to shade the
   *  pre-feed region of the chart and label the "collection started" marker. */
  startedAt?: string | null;
  historyAgeMs?: number;
}

export interface DebugStats {
  snapshotCount: number;
  cellCount: number;
  priceBinCount: number;
  timeBucketCount: number;
  priceMin: number;
  priceMax: number;
  binWidth: number;
  nonEmptyBidCells: number;
  nonEmptyAskCells: number;
  warning: string | null;
}

export type ChartConnState = "idle" | "loading" | "ready" | "error";

interface LiquidityStore {
  symbol: string;
  marketType: "spot" | "futures";
  timeframe: "1m" | "5m" | "15m";
  binSize: "auto" | "0.1%" | "0.25%" | "0.5%" | "1%";
  intensity: number;
  logScale: boolean;
  sideMode: "combined" | "bids" | "asks" | "imbalance";
  showCandles: boolean;
  showDelta: boolean;

  // ---------- Density / professional heatmap controls ----------
  densityMode: DensityMode;
  densityPreset: DensityPreset;
  gamma: number;
  capPercentile: number;
  minOpacity: number;
  maxOpacity: number;
  hideWeak: boolean;
  strongOnly: boolean;
  glow: boolean;
  /** Order book depth levels requested per side (50 / 100 / 250 / 500 / 1000). */
  depthLevels: number;
  /** How far back the heatmap aggregates depth history. "max" = all live history. */
  heatmapLookback: HeatmapLookback;
  /** True when the user explicitly chose a lookback (so timeframe changes don't override). */
  heatmapLookbackUserSet: boolean;

  matrix: HeatmapMatrix | null;
  candles: CandleRow[];
  orderBook: OrderBookRow | null;
  delta: DeltaBucket[];
  status: FeedStatus | null;
  connection: ChartConnState;
  error: string | null;

  setControls: (
    p: Partial<
      Pick<
        LiquidityStore,
        | "symbol"
        | "marketType"
        | "timeframe"
        | "binSize"
        | "intensity"
        | "logScale"
        | "sideMode"
        | "showCandles"
        | "showDelta"
        | "densityMode"
        | "densityPreset"
        | "gamma"
        | "capPercentile"
        | "minOpacity"
        | "maxOpacity"
        | "hideWeak"
        | "strongOnly"
        | "glow"
        | "depthLevels"
        | "heatmapLookback"
        | "heatmapLookbackUserSet"
      >
    >,
  ) => void;

  setMatrix: (m: HeatmapMatrix | null) => void;
  setCandles: (c: CandleRow[]) => void;
  setOrderBook: (b: OrderBookRow | null) => void;
  setDelta: (d: DeltaBucket[]) => void;
  setStatus: (s: FeedStatus | null) => void;
  setConnection: (c: ChartConnState) => void;
  setError: (e: string | null) => void;
}

export const useLiquidityStore = create<LiquidityStore>((set) => ({
  symbol: "BTCUSDT",
  marketType: "spot",
  timeframe: "1m",
  binSize: "auto",
  intensity: 1.5,
  logScale: true,
  sideMode: "combined",
  showCandles: true,
  showDelta: true,

  // Default to the "Deep Liquidity" preset values.
  densityMode: "zscore",
  densityPreset: "deep",
  gamma: 0.6,
  capPercentile: 0.99,
  minOpacity: 0.08,
  maxOpacity: 0.95,
  hideWeak: false,
  strongOnly: false,
  glow: true,
  depthLevels: 500,
  heatmapLookback: "30m",
  heatmapLookbackUserSet: false,

  matrix: null,
  candles: [],
  orderBook: null,
  delta: [],
  status: null,
  connection: "idle",
  error: null,

  setControls: (p) => set(p),
  setMatrix: (matrix) => set({ matrix }),
  setCandles: (candles) => set({ candles }),
  setOrderBook: (orderBook) => set({ orderBook }),
  setDelta: (delta) => set({ delta }),
  setStatus: (status) => set({ status }),
  setConnection: (connection) => set({ connection }),
  setError: (error) => set({ error }),
}));
