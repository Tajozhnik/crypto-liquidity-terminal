import type { Kline, OrderBookLevel, Trade } from "@screener/shared";

/**
 * Percentage price change between two prices.
 * Returns 0 if `prevPrice` is non-positive or non-finite.
 */
export function calculatePriceChange(prevPrice: number, currentPrice: number): number {
  if (!Number.isFinite(prevPrice) || !Number.isFinite(currentPrice) || prevPrice <= 0) return 0;
  return ((currentPrice - prevPrice) / prevPrice) * 100;
}

/**
 * Relative volume (recent / baseline). Returns 1 when baseline is non-positive.
 */
export function calculateRelativeVolume(recentVolume: number, baselineAvgVolume: number): number {
  if (!Number.isFinite(recentVolume) || recentVolume < 0) return 0;
  if (!Number.isFinite(baselineAvgVolume) || baselineAvgVolume <= 0) return recentVolume > 0 ? Infinity : 1;
  return recentVolume / baselineAvgVolume;
}

/**
 * Volatility as standard deviation of close-to-close percentage returns.
 * Returns 0 for fewer than 2 klines.
 */
export function calculateVolatility(klines: Kline[]): number {
  if (klines.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1]!.close;
    const cur = klines[i]!.close;
    if (prev > 0) returns.push(((cur - prev) / prev) * 100);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Spread percentage = (ask - bid) / mid * 100.
 * Returns 0 if either side is non-positive or invalid.
 */
export function calculateSpread(bid: number, ask: number): number {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return 0;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return 0;
  return ((ask - bid) / mid) * 100;
}

/**
 * Order book imbalance = (bidVol - askVol) / (bidVol + askVol) ∈ [-1, 1].
 * Considers top `depth` levels on each side. Returns 0 if both totals are zero.
 */
export function calculateOrderBookImbalance(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  depth = 20,
): number {
  const sumQty = (levels: OrderBookLevel[]) =>
    levels.slice(0, depth).reduce((acc, [, qty]) => acc + (Number.isFinite(qty) ? qty : 0), 0);
  const bidVol = sumQty(bids);
  const askVol = sumQty(asks);
  const total = bidVol + askVol;
  if (total <= 0) return 0;
  return (bidVol - askVol) / total;
}

/**
 * Trades per minute over a given window in milliseconds.
 */
export function calculateTradesPerMinute(trades: Trade[], windowMs: number): number {
  if (windowMs <= 0 || trades.length === 0) return 0;
  // Trades pre-filtered by caller; just normalize count to per-minute
  return trades.length / (windowMs / 60_000);
}

/**
 * Average kline volume over the most recent `lookback` klines.
 */
export function calculateAverageVolume(klines: Kline[], lookback: number): number {
  const slice = klines.slice(-lookback);
  if (slice.length === 0) return 0;
  return slice.reduce((acc, k) => acc + k.volume, 0) / slice.length;
}

/**
 * Detect range breakout: current candle's close vs prior `lookback` highs/lows.
 * Returns `{ brokeHigh, brokeLow }`.
 */
export function calculateRangeBreakout(
  klines: Kline[],
  lookback: number,
): { brokeHigh: boolean; brokeLow: boolean } {
  if (klines.length <= lookback) return { brokeHigh: false, brokeLow: false };
  const last = klines[klines.length - 1]!;
  const prior = klines.slice(-lookback - 1, -1);
  let highMax = -Infinity;
  let lowMin = Infinity;
  for (const k of prior) {
    if (k.high > highMax) highMax = k.high;
    if (k.low < lowMin) lowMin = k.low;
  }
  return {
    brokeHigh: last.close > highMax,
    brokeLow: last.close < lowMin,
  };
}

/**
 * Linear normalization to [0, 100]. Clamps inputs outside [min, max].
 */
export function normalizeScore(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}
