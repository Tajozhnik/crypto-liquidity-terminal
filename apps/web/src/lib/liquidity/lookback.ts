/**
 * Heatmap lookback options for the live order book history selector.
 *
 * Note: this controls only the *liquidity heatmap* lookback. Candles are
 * always backfilled from the public REST `klines` endpoint per the selected
 * timeframe; delta is computed off the live trade buffer. This selector
 * walks back into the depth-snapshot ring buffer only.
 */

export type HeatmapLookback = "15m" | "30m" | "1h" | "2h" | "4h" | "max";

export const HEATMAP_LOOKBACK_OPTIONS: { id: HeatmapLookback; label: string }[] = [
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
  { id: "1h", label: "1h" },
  { id: "2h", label: "2h" },
  { id: "4h", label: "4h" },
  { id: "max", label: "Max" },
];

/** Per-timeframe defaults — used until the user picks a lookback explicitly. */
export function defaultLookbackForTimeframe(timeframe: string): HeatmapLookback {
  if (timeframe === "5m") return "1h";
  if (timeframe === "15m") return "4h";
  return "30m";
}

/**
 * Resolve a lookback option to the query parameters the backend expects.
 * `max` becomes `lookback=max` and the server caps it at the env-configured
 * memory limit. Fixed options become a `lookbackMinutes` integer.
 */
export function lookbackToQuery(lookback: HeatmapLookback): {
  lookbackMinutes?: number;
  lookback?: "max";
} {
  if (lookback === "max") return { lookback: "max" };
  if (lookback === "15m") return { lookbackMinutes: 15 };
  if (lookback === "30m") return { lookbackMinutes: 30 };
  if (lookback === "1h") return { lookbackMinutes: 60 };
  if (lookback === "2h") return { lookbackMinutes: 120 };
  if (lookback === "4h") return { lookbackMinutes: 240 };
  return { lookbackMinutes: 30 };
}

/** Resolve a lookback option to its visible-range hint in milliseconds. */
export function lookbackToVisibleRangeMs(
  lookback: HeatmapLookback,
  availableHistoryMs: number,
  fallbackMs: number,
): number {
  if (lookback === "max") {
    if (availableHistoryMs > 0) return availableHistoryMs;
    return fallbackMs;
  }
  if (lookback === "15m") return 15 * 60_000;
  if (lookback === "30m") return 30 * 60_000;
  if (lookback === "1h") return 60 * 60_000;
  if (lookback === "2h") return 2 * 60 * 60_000;
  if (lookback === "4h") return 4 * 60 * 60_000;
  return fallbackMs;
}
