import type { Signal, SignalType } from "@screener/shared";
import {
  calculateAverageVolume,
  calculateOrderBookImbalance,
  calculatePriceChange,
  calculateRangeBreakout,
  calculateSpread,
  calculateVolatility,
} from "./metrics.js";
import type { MarketSnapshot, ScreenerConfig } from "./types.js";

const SHORT_WINDOW = 5; // last 5 klines for "recent"
const BASELINE_LOOKBACK = 20; // baseline for relative volume / volatility

let _signalCounter = 0;
const newSignalId = () => `sig_${Date.now().toString(36)}_${(_signalCounter++).toString(36)}`;

function makeSignal(
  type: SignalType,
  s: MarketSnapshot,
  score: number,
  message: string,
  payload: Record<string, unknown> = {},
  nowIso: string,
): Signal {
  return {
    id: newSignalId(),
    symbol: s.market.symbol,
    exchange: s.market.exchange,
    marketType: s.market.marketType,
    type,
    score,
    message,
    payload,
    createdAt: nowIso,
  };
}

// =============================================================================
// Volume / price detectors
// =============================================================================

export function detectVolumeSpike(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  const klines = s.klines1m;
  if (klines.length < BASELINE_LOOKBACK + SHORT_WINDOW) return null;
  const recent = klines.slice(-SHORT_WINDOW);
  const baseline = klines.slice(-BASELINE_LOOKBACK - SHORT_WINDOW, -SHORT_WINDOW);
  const recentAvg = calculateAverageVolume(recent, SHORT_WINDOW);
  const baseAvg = calculateAverageVolume(baseline, BASELINE_LOOKBACK);
  if (baseAvg <= 0) return null;
  const ratio = recentAvg / baseAvg;
  if (ratio > cfg.volumeSpike.relativeVolumeThreshold) {
    return makeSignal(
      "VOLUME_SPIKE",
      s,
      Math.min(100, Math.round((ratio / cfg.volumeSpike.relativeVolumeThreshold) * 60)),
      `Volume ${ratio.toFixed(2)}x baseline`,
      { ratio, threshold: cfg.volumeSpike.relativeVolumeThreshold },
      nowIso,
    );
  }
  return null;
}

export function detectPricePump(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (s.klines1m.length < SHORT_WINDOW + 1) return null;
  const earliest = s.klines1m[s.klines1m.length - SHORT_WINDOW]!.open;
  const last = s.klines1m[s.klines1m.length - 1]!.close;
  const change = calculatePriceChange(earliest, last);
  if (change > cfg.pricePump.thresholdPercent) {
    return makeSignal(
      "PRICE_PUMP",
      s,
      Math.min(100, Math.round((change / cfg.pricePump.thresholdPercent) * 50)),
      `Pump +${change.toFixed(2)}% over ${cfg.pricePump.timeframe}`,
      { changePercent: change },
      nowIso,
    );
  }
  return null;
}

export function detectPriceDump(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (s.klines1m.length < SHORT_WINDOW + 1) return null;
  const earliest = s.klines1m[s.klines1m.length - SHORT_WINDOW]!.open;
  const last = s.klines1m[s.klines1m.length - 1]!.close;
  const change = calculatePriceChange(earliest, last);
  if (change < cfg.priceDump.thresholdPercent) {
    return makeSignal(
      "PRICE_DUMP",
      s,
      Math.min(100, Math.round((Math.abs(change) / Math.abs(cfg.priceDump.thresholdPercent)) * 50)),
      `Dump ${change.toFixed(2)}% over ${cfg.priceDump.timeframe}`,
      { changePercent: change },
      nowIso,
    );
  }
  return null;
}

export function detectVolatilityExpansion(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (s.klines1m.length < BASELINE_LOOKBACK + SHORT_WINDOW) return null;
  const recent = s.klines1m.slice(-SHORT_WINDOW);
  const baseline = s.klines1m.slice(-BASELINE_LOOKBACK - SHORT_WINDOW, -SHORT_WINDOW);
  const recentVol = calculateVolatility(recent);
  const baseVol = calculateVolatility(baseline);
  if (baseVol <= 0) return null;
  const ratio = recentVol / baseVol;
  if (ratio > cfg.volatilityExpansion.thresholdMultiplier) {
    return makeSignal(
      "VOLATILITY_EXPANSION",
      s,
      Math.min(100, Math.round(ratio * 25)),
      `Volatility expanded ${ratio.toFixed(2)}x baseline`,
      { ratio },
      nowIso,
    );
  }
  return null;
}

export function detectSpreadWidening(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  const spread = calculateSpread(s.ticker.bid, s.ticker.ask);
  if (spread > cfg.spreadWidening.thresholdPercent) {
    return makeSignal(
      "SPREAD_WIDENING",
      s,
      Math.min(100, Math.round((spread / cfg.spreadWidening.thresholdPercent) * 40)),
      `Spread ${spread.toFixed(3)}%`,
      { spreadPct: spread },
      nowIso,
    );
  }
  return null;
}

export function detectOrderBookImbalance(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  const imbalance = calculateOrderBookImbalance(
    s.orderBook.bids,
    s.orderBook.asks,
    cfg.orderBookImbalance.depthLevels,
  );
  if (Math.abs(imbalance) > cfg.orderBookImbalance.thresholdRatio) {
    return makeSignal(
      "ORDER_BOOK_IMBALANCE",
      s,
      Math.min(100, Math.round(Math.abs(imbalance) * 100)),
      `Imbalance ${(imbalance * 100).toFixed(1)}%`,
      { imbalance },
      nowIso,
    );
  }
  return null;
}

export function detectBreakout(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  const { brokeHigh, brokeLow } = calculateRangeBreakout(s.klines1m, cfg.breakout.lookbackCandles);
  if (brokeHigh || brokeLow) {
    return makeSignal(
      "BREAKOUT",
      s,
      75,
      brokeHigh ? "Range breakout (up)" : "Range breakout (down)",
      { direction: brokeHigh ? "up" : "down" },
      nowIso,
    );
  }
  return null;
}

export function detectOpenInterestSpike(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (s.market.marketType !== "futures") return null;
  const history = s.openInterestHistory ?? [];
  if (history.length < 2) return null;
  const last = history[history.length - 1]!;
  // Find first sample at least cfg.openInterestSpike.timeframe ago. We assume "15m" by default;
  // parse timeframe minutes naively.
  const match = /^(\d+)m$/.exec(cfg.openInterestSpike.timeframe);
  const windowMs = (match && match[1] ? Number.parseInt(match[1], 10) : 15) * 60_000;
  const windowAgo = last.ts - windowMs;
  const earliest = history.find((h) => h.ts >= windowAgo) ?? history[0]!;
  if (earliest.value <= 0) return null;
  const change = ((last.value - earliest.value) / earliest.value) * 100;
  if (change > cfg.openInterestSpike.thresholdPercent) {
    return makeSignal(
      "OI_SPIKE",
      s,
      Math.min(100, Math.round(change * 5)),
      `OI +${change.toFixed(2)}% in ${cfg.openInterestSpike.timeframe}`,
      { changePercent: change },
      nowIso,
    );
  }
  return null;
}

export function detectFundingAnomaly(
  s: MarketSnapshot,
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (s.market.marketType !== "futures") return null;
  const fr = s.futures?.fundingRate ?? null;
  if (fr === null || !Number.isFinite(fr)) return null;
  if (Math.abs(fr) > cfg.fundingAnomaly.absoluteThreshold) {
    return makeSignal(
      "FUNDING_ANOMALY",
      s,
      Math.min(100, Math.round(Math.abs(fr) * 1000)),
      `Funding rate ${(fr * 100).toFixed(3)}%`,
      { fundingRate: fr },
      nowIso,
    );
  }
  return null;
}

/** HOT_MARKET: derived from Signal_Score crossing threshold. */
export function detectHotMarket(
  input: { snapshot: MarketSnapshot; score: number },
  cfg: ScreenerConfig,
  nowIso: string,
): Signal | null {
  if (input.score >= cfg.hotMarket.scoreThreshold) {
    return makeSignal(
      "HOT_MARKET",
      input.snapshot,
      input.score,
      `Hot market score ${input.score}`,
      { score: input.score, threshold: cfg.hotMarket.scoreThreshold },
      nowIso,
    );
  }
  return null;
}
