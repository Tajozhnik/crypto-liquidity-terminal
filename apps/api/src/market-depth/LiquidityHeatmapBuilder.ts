import { chooseBinWidth, priceToBin, type BinSizeMode } from "./PriceBinner.js";
import type { DepthSnapshot } from "./DepthSnapshotStore.js";

export interface HeatmapCell {
  /** Time bucket start, ms epoch */
  t: number;
  /** Lower bound of the price bin */
  price: number;
  bidLiquidity: number;
  askLiquidity: number;
  totalLiquidity: number;
  /** 0..1 normalized intensity */
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
  /** Reason if cells came back empty. */
  warning: string | null;
  /** Echo of the requested timeframe ("1m"/"5m"/"15m"). */
  requestedTimeframe: string;
  /** Time bucket size in ms derived from the timeframe. */
  timeBucketMs: number;
  /** ms covered by the snapshots in the lookback window. */
  snapshotTimeSpanMs: number;
  /** Accumulation hint when snapshot history < default visible range for the timeframe. */
  accumulationWarning: string | null;
  /** Ms of history required to fill the timeframe's default visible range. */
  requiredHistoryMs: number;
  /** ISO timestamp of when the feed started for this symbol — null if not started yet. */
  feedStartedAt: string | null;
  /** Ms since the feed for this symbol started ingesting depth events. */
  historyAgeMs: number;
  /** 0..1 ratio of snapshot history coverage relative to the timeframe default range. */
  historyCompleteness: number;
  // ---------- Density-pipeline diagnostics ----------
  /** Largest single cell totalLiquidity in the matrix. */
  maxLiquidity: number;
  /** Mean cell totalLiquidity (positive cells only). */
  meanLiquidity: number;
  /** Std-dev of cell totalLiquidity (population, positive cells only). */
  stdLiquidity: number;
  /** 90th-percentile cell totalLiquidity. */
  p90Liquidity: number;
  /** 95th-percentile cell totalLiquidity. */
  p95Liquidity: number;
  /** 99th-percentile cell totalLiquidity. */
  p99Liquidity: number;
  /** Max number of bid levels seen in any snapshot for this build. */
  bidLevelsUsed: number;
  /** Max number of ask levels seen in any snapshot for this build. */
  askLevelsUsed: number;
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
  cells: HeatmapCell[];
  debugStats: HeatmapDebugStats;
  updatedAt: string;
}

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

const DEFAULT_VISIBLE_RANGE_MS: Record<string, number> = {
  "1m": 15 * 60_000,
  "5m": 60 * 60_000,
  "15m": 4 * 60 * 60_000,
};

export interface BuildOptions {
  symbol: string;
  exchange: string;
  marketType: "spot" | "futures";
  timeframe: string;
  binSize: BinSizeMode;
  /** Restrict to last `lookbackMinutes` of snapshots */
  lookbackMinutes: number;
  /** Minimum half-range (%) around mid to render even if order book is empty. */
  minHalfRangePct?: number;
  /**
   * Hard cap on the half-range (% of mid). Default 2 % so a 1000-level book
   * tail at $45 000 cannot stretch the visible range to $32 000 when mid is
   * $77 900. The interesting liquidity for a heatmap lives within ±2 % of mid;
   * deeper levels are background and would render as a single column.
   */
  maxHalfRangePct?: number;
  /** Optional candle hint: extend the price range to cover candle highs/lows. */
  candlePriceMin?: number;
  candlePriceMax?: number;
  /** Optional explicit price window — overrides book extent when provided. */
  priceMin?: number;
  priceMax?: number;
  /** Target bin count for auto bin size. */
  targetBins?: number;
  /** ISO timestamp of when the per-symbol feed started — drives historyAgeMs/historyCompleteness. */
  feedStartedAt?: string | null;
  /** Top-N depth levels per side to consume from each snapshot. Default 1000. */
  depthLevels?: number;
  /**
   * Time bucket size for the *heatmap* (not candles). Decoupled from
   * `timeframe` because liquidity slices need much finer time resolution
   * than candles to look like a continuous density map. Default: 5 s.
   * Pass a smaller value (1–10 s) for live mode, larger for zoomed-out views.
   */
  heatmapBucketMs?: number;
}

/**
 * Build a liquidity heatmap from a list of order book snapshots.
 *
 * Price range is determined as the union of:
 *   - actual order book extent (min bid price ... max ask price across snapshots)
 *   - candle high/low hint (so candles never escape the heatmap rectangle)
 *   - minimum ±minHalfRangePct of mid (fallback)
 */
export function buildHeatmap(
  snapshots: DepthSnapshot[],
  opts: BuildOptions,
): HeatmapMatrix {
  // `tfMs` here is the candle timeframe — used for accumulation warnings and
  // the API echo. The actual heatmap aggregation uses a separate, much finer
  // bucket (default 5 s) decoupled from candles so the heatmap doesn't
  // collapse to one column per candle.
  const tfMs = TIMEFRAME_MS[opts.timeframe] ?? 60_000;
  const heatmapBucketMs = Math.max(250, opts.heatmapBucketMs ?? 5_000);
  const cutoff = Date.now() - opts.lookbackMinutes * 60_000;
  const inWindow = snapshots.filter((s) => s.t >= cutoff);
  const requiredHistoryMs = DEFAULT_VISIBLE_RANGE_MS[opts.timeframe] ?? 15 * 60_000;
  const feedStartedAtMs = opts.feedStartedAt ? Date.parse(opts.feedStartedAt) : NaN;
  const historyAgeMs = Number.isFinite(feedStartedAtMs)
    ? Math.max(0, Date.now() - feedStartedAtMs)
    : 0;

  const debug: HeatmapDebugStats = {
    snapshotCount: inWindow.length,
    cellCount: 0,
    priceBinCount: 0,
    timeBucketCount: 0,
    priceMin: 0,
    priceMax: 0,
    binWidth: 0,
    nonEmptyBidCells: 0,
    nonEmptyAskCells: 0,
    warning: null,
    requestedTimeframe: opts.timeframe,
    timeBucketMs: heatmapBucketMs,
    snapshotTimeSpanMs: 0,
    accumulationWarning: null,
    requiredHistoryMs,
    feedStartedAt: opts.feedStartedAt ?? null,
    historyAgeMs,
    historyCompleteness: 0,
    maxLiquidity: 0,
    meanLiquidity: 0,
    stdLiquidity: 0,
    p90Liquidity: 0,
    p95Liquidity: 0,
    p99Liquidity: 0,
    bidLevelsUsed: 0,
    askLevelsUsed: 0,
  };

  if (inWindow.length === 0) {
    debug.warning = "no snapshots in lookback window";
    return emptyMatrix(opts, debug);
  }

  const last = inWindow[inWindow.length - 1]!;
  const mid = last.midPrice;
  if (!Number.isFinite(mid) || mid <= 0) {
    debug.warning = "invalid mid price in latest snapshot";
    return emptyMatrix(opts, debug);
  }

  // ---------- Price range ----------
  // Authoritative source order:
  //   1) explicit `opts.priceMin/priceMax` (frontend viewport — best UX);
  //   2) book extent + candle hint, but clamped at ±`maxHalfRangePct`.
  // We pull min/max from the snapshots so a real wall at ±1 % of mid expands
  // the visible window — but we cap that expansion at `maxHalfRangePct`
  // (default ±2 %) so a 1000-level book tail at $45k cannot stretch the
  // visible range to $32k when mid is $77.9k.
  const minHalf = opts.minHalfRangePct ?? 0.015; // ±1.5% floor
  const maxHalf = opts.maxHalfRangePct ?? 0.02; // ±2% ceiling around mid
  const minRangeLo = mid * (1 - minHalf);
  const minRangeHi = mid * (1 + minHalf);
  const maxRangeLo = mid * (1 - maxHalf);
  const maxRangeHi = mid * (1 + maxHalf);

  let priceMin: number;
  let priceMax: number;
  if (
    opts.priceMin !== undefined &&
    opts.priceMax !== undefined &&
    Number.isFinite(opts.priceMin) &&
    Number.isFinite(opts.priceMax) &&
    opts.priceMax > opts.priceMin
  ) {
    // Frontend viewport explicitly drives the heatmap range. We still clamp
    // to ±10 % of mid so a runaway viewport doesn't produce an unusable
    // matrix server-side.
    const hardLo = mid * 0.9;
    const hardHi = mid * 1.1;
    priceMin = Math.max(hardLo, opts.priceMin);
    priceMax = Math.min(hardHi, opts.priceMax);
  } else {
    // Compute book extent (min/max across the lookback window) — but cap it.
    let bookMin = Infinity;
    let bookMax = -Infinity;
    for (const snap of inWindow) {
      for (const [p] of snap.bids) {
        if (p < bookMin) bookMin = p;
        if (p > bookMax) bookMax = p;
      }
      for (const [p] of snap.asks) {
        if (p < bookMin) bookMin = p;
        if (p > bookMax) bookMax = p;
      }
    }
    if (!Number.isFinite(bookMin)) bookMin = mid;
    if (!Number.isFinite(bookMax)) bookMax = mid;
    const candleLo = Number.isFinite(opts.candlePriceMin as number) ? (opts.candlePriceMin as number) : Infinity;
    const candleHi = Number.isFinite(opts.candlePriceMax as number) ? (opts.candlePriceMax as number) : -Infinity;
    // Take the union of book + candle extension, but clamp to maxHalf range.
    const wantLo = Math.min(bookMin, minRangeLo, candleLo);
    const wantHi = Math.max(bookMax, minRangeHi, candleHi);
    priceMin = Math.max(maxRangeLo, wantLo);
    priceMax = Math.min(maxRangeHi, wantHi);
  }
  if (priceMax <= priceMin) {
    priceMin = minRangeLo;
    priceMax = minRangeHi;
  }

  const targetBins = opts.targetBins ?? 200;
  const { binWidth } = chooseBinWidth(mid, opts.binSize, minHalf, {
    priceMin,
    priceMax,
    targetBins,
  });
  if (binWidth <= 0) {
    debug.warning = "bin width resolved to zero";
    return emptyMatrix(opts, debug);
  }

  const cells = new Map<string, HeatmapCell>();
  let bidLevelsUsed = 0;
  let askLevelsUsed = 0;
  const depthLevels = Math.max(1, opts.depthLevels ?? 1000);
  for (const snap of inWindow) {
    // Honour the requested per-side depth — letting users compare 50 vs 1000
    // levels side by side without re-feeding the WS pipeline.
    const bids = snap.bids.length > depthLevels ? snap.bids.slice(0, depthLevels) : snap.bids;
    const asks = snap.asks.length > depthLevels ? snap.asks.slice(0, depthLevels) : snap.asks;
    if (bids.length > bidLevelsUsed) bidLevelsUsed = bids.length;
    if (asks.length > askLevelsUsed) askLevelsUsed = asks.length;
    const tBucket = Math.floor(snap.t / heatmapBucketMs) * heatmapBucketMs;
    for (const [p, q] of bids) {
      if (p < priceMin || p > priceMax) continue;
      const bin = priceToBin(p, binWidth);
      const key = `${tBucket}:${bin}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { t: tBucket, price: bin, bidLiquidity: 0, askLiquidity: 0, totalLiquidity: 0, intensity: 0 };
        cells.set(key, cell);
      }
      cell.bidLiquidity += p * q;
    }
    for (const [p, q] of asks) {
      if (p < priceMin || p > priceMax) continue;
      const bin = priceToBin(p, binWidth);
      const key = `${tBucket}:${bin}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { t: tBucket, price: bin, bidLiquidity: 0, askLiquidity: 0, totalLiquidity: 0, intensity: 0 };
        cells.set(key, cell);
      }
      cell.askLiquidity += p * q;
    }
  }

  const list = [...cells.values()];
  let max = 0;
  let nonEmptyBid = 0;
  let nonEmptyAsk = 0;
  const priceBins = new Set<number>();
  const timeBuckets = new Set<number>();
  for (const c of list) {
    c.totalLiquidity = c.bidLiquidity + c.askLiquidity;
    if (c.totalLiquidity > max) max = c.totalLiquidity;
    if (c.bidLiquidity > 0) nonEmptyBid++;
    if (c.askLiquidity > 0) nonEmptyAsk++;
    priceBins.add(c.price);
    timeBuckets.add(c.t);
  }
  if (max > 0) {
    for (const c of list) c.intensity = c.totalLiquidity / max;
  }
  list.sort((a, b) => (a.t === b.t ? a.price - b.price : a.t - b.t));

  // Time window: stretch to at least 60 s so the chart is not collapsed when
  // we only have a single second of history.
  const firstSnapTs = inWindow[0]!.t;
  const lastSnapTs = inWindow[inWindow.length - 1]!.t;
  // Align matrix bounds to the heatmap bucket so cells line up with the grid.
  const timeStart = Math.floor(firstSnapTs / heatmapBucketMs) * heatmapBucketMs;
  let timeEnd = Math.ceil((lastSnapTs + 1) / heatmapBucketMs) * heatmapBucketMs;
  if (timeEnd - timeStart < 60_000) timeEnd = timeStart + 60_000;

  debug.cellCount = list.length;
  debug.priceBinCount = priceBins.size;
  debug.timeBucketCount = timeBuckets.size;
  debug.priceMin = priceMin;
  debug.priceMax = priceMax;
  debug.binWidth = binWidth;
  debug.nonEmptyBidCells = nonEmptyBid;
  debug.nonEmptyAskCells = nonEmptyAsk;
  debug.snapshotTimeSpanMs = lastSnapTs - firstSnapTs;
  debug.bidLevelsUsed = bidLevelsUsed;
  debug.askLevelsUsed = askLevelsUsed;
  // Liquidity distribution stats — used by the frontend to label the debug
  // bar and to show "Low resolution" warnings, and by tests to verify the
  // p99 cap actually represents the distribution.
  const positiveTotals: number[] = [];
  for (const c of list) if (c.totalLiquidity > 0) positiveTotals.push(c.totalLiquidity);
  positiveTotals.sort((a, b) => a - b);
  if (positiveTotals.length > 0) {
    const n = positiveTotals.length;
    let sum = 0;
    for (const v of positiveTotals) sum += v;
    const meanV = sum / n;
    let varSum = 0;
    for (const v of positiveTotals) varSum += (v - meanV) * (v - meanV);
    const stdV = Math.sqrt(varSum / n);
    const pick = (q: number): number =>
      positiveTotals[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))]!;
    debug.maxLiquidity = positiveTotals[n - 1]!;
    debug.meanLiquidity = meanV;
    debug.stdLiquidity = stdV;
    debug.p90Liquidity = pick(0.9);
    debug.p95Liquidity = pick(0.95);
    debug.p99Liquidity = pick(0.99);
  }
  const expectedSpan = DEFAULT_VISIBLE_RANGE_MS[opts.timeframe] ?? 15 * 60_000;
  const liveAgeMs = Math.max(debug.snapshotTimeSpanMs, historyAgeMs);
  debug.historyCompleteness = Math.min(1, liveAgeMs / Math.max(1, expectedSpan));
  if (debug.snapshotTimeSpanMs < expectedSpan) {
    debug.accumulationWarning = `Accumulating history for ${opts.timeframe} timeframe: ${Math.round(
      debug.snapshotTimeSpanMs / 1000,
    )}s of ${Math.round(expectedSpan / 1000)}s collected`;
  }
  if (list.length === 0) debug.warning = "no levels fell inside priceMin..priceMax";

  return {
    symbol: opts.symbol,
    exchange: opts.exchange,
    marketType: opts.marketType,
    timeframe: opts.timeframe,
    binWidth,
    priceMin,
    priceMax,
    timeStart,
    timeEnd,
    cells: list,
    debugStats: debug,
    updatedAt: new Date().toISOString(),
  };
}

function emptyMatrix(opts: BuildOptions, debug: HeatmapDebugStats): HeatmapMatrix {
  const heatmapBucketMs = Math.max(250, opts.heatmapBucketMs ?? 5_000);
  const requiredHistoryMs = DEFAULT_VISIBLE_RANGE_MS[opts.timeframe] ?? 15 * 60_000;
  return {
    symbol: opts.symbol,
    exchange: opts.exchange,
    marketType: opts.marketType,
    timeframe: opts.timeframe,
    binWidth: 0,
    priceMin: 0,
    priceMax: 0,
    timeStart: 0,
    timeEnd: 0,
    cells: [],
    debugStats: {
      ...debug,
      requestedTimeframe: opts.timeframe,
      timeBucketMs: heatmapBucketMs,
      requiredHistoryMs,
    },
    updatedAt: new Date().toISOString(),
  };
}
