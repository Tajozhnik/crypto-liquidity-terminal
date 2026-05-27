/**
 * Helpers shared between frontend rendering and tooltip lookup. No I/O.
 */

export interface BackendHeatmapCell {
  t: number;
  price: number;
  bidLiquidity: number;
  askLiquidity: number;
  totalLiquidity: number;
  intensity: number;
}

export interface HeatmapDebugStats {
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
  /** Heatmap time-slice resolution in ms (decoupled from candle timeframe). */
  timeBucketMs?: number;
  requestedTimeframe?: string;
  snapshotTimeSpanMs?: number;
  accumulationWarning?: string | null;
  requiredHistoryMs?: number;
  feedStartedAt?: string | null;
  historyAgeMs?: number;
  historyCompleteness?: number;
  maxLiquidity?: number;
  meanLiquidity?: number;
  stdLiquidity?: number;
  p90Liquidity?: number;
  p95Liquidity?: number;
  p99Liquidity?: number;
  bidLevelsUsed?: number;
  askLevelsUsed?: number;
}

export interface HeatmapMatrix {
  symbol: string;
  exchange: string;
  marketType: "spot" | "futures";
  timeframe: string;
  binWidth: number;
  priceMin: number;
  priceMax: number;
  timeStart: number;
  timeEnd: number;
  cells: BackendHeatmapCell[];
  debugStats?: HeatmapDebugStats;
  /** Optional `/snapshot?lookback=...` echo block — populated by the route handler, not the builder. */
  lookback?: {
    mode: "fixed" | "max";
    appliedMinutes: number;
    availableHistoryMs: number;
    maxLookbackMs: number;
    truncated: boolean;
    oldestSnapshotMs: number | null;
    newestSnapshotMs: number | null;
  };
  updatedAt: string;
}

/** Find the cell (if any) covering a given (time, price) pair. */
export function findCellAt(
  cells: BackendHeatmapCell[],
  t: number,
  price: number,
  binWidth: number,
  timeBucketMs: number,
): BackendHeatmapCell | null {
  if (binWidth <= 0 || timeBucketMs <= 0) return null;
  const tBucket = Math.floor(t / timeBucketMs) * timeBucketMs;
  let best: BackendHeatmapCell | null = null;
  let bestDist = Infinity;
  for (const c of cells) {
    if (c.t !== tBucket) continue;
    const d = Math.abs(c.price - price);
    if (d <= binWidth && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function timeframeMs(timeframe: string): number {
  if (timeframe === "1m") return 60_000;
  if (timeframe === "5m") return 300_000;
  if (timeframe === "15m") return 900_000;
  return 60_000;
}
