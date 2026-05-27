import type { ScreenerResult, Signal, SignalType } from "@screener/shared";
import {
  detectBreakout,
  detectFundingAnomaly,
  detectHotMarket,
  detectOpenInterestSpike,
  detectOrderBookImbalance,
  detectPriceDump,
  detectPricePump,
  detectSpreadWidening,
  detectVolatilityExpansion,
  detectVolumeSpike,
} from "./detectors.js";
import {
  calculateAverageVolume,
  calculateOrderBookImbalance,
  calculatePriceChange,
  calculateSpread,
  calculateTradesPerMinute,
  calculateVolatility,
  normalizeScore,
} from "./metrics.js";
import { calculateHotMarketScore, classifyScoreBand } from "./score.js";
import type { MarketSnapshot, RunScreenerResult, ScreenerConfig } from "./types.js";

function deriveChangePctOver(klines: MarketSnapshot["klines1m"], minutes: number): number {
  if (klines.length < 2) return 0;
  const last = klines[klines.length - 1]!;
  const idx = Math.max(0, klines.length - 1 - minutes);
  const prev = klines[idx]!;
  return calculatePriceChange(prev.open, last.close);
}

/**
 * Compose all detectors and metrics over a single MarketSnapshot.
 * Pure function — no I/O, no side effects.
 */
export function runScreener(
  snapshots: MarketSnapshot[],
  cfg: ScreenerConfig,
  nowMs: number,
): RunScreenerResult {
  const nowIso = new Date(nowMs).toISOString();
  const results: ScreenerResult[] = [];
  const signals: Signal[] = [];

  for (const snap of snapshots) {
    const klines = snap.klines1m;
    const change5m = snap.changes?.change5m ?? deriveChangePctOver(klines, 5);
    const change15m = snap.changes?.change15m ?? deriveChangePctOver(klines, 15);
    const change1h = snap.changes?.change1h ?? deriveChangePctOver(klines, 60);
    const change24h = snap.changes?.change24h ?? snap.ticker.change24h ?? deriveChangePctOver(klines, 1440);

    const recentAvgVol = calculateAverageVolume(klines.slice(-5), 5);
    const baselineAvgVol = calculateAverageVolume(klines.slice(-25, -5), 20);
    const relativeVolume = baselineAvgVol > 0 ? recentAvgVol / baselineAvgVol : 1;
    const volatility = calculateVolatility(klines.slice(-25));
    const tradesPerMinute = calculateTradesPerMinute(snap.recentTrades, 60_000);
    const spreadPct = calculateSpread(snap.ticker.bid, snap.ticker.ask);
    const orderBookImbalance = calculateOrderBookImbalance(
      snap.orderBook.bids,
      snap.orderBook.asks,
      cfg.orderBookImbalance.depthLevels,
    );

    // Sub-scores: project metrics into [0, 100]
    const momentumScore = normalizeScore(Math.abs(change5m), 0, 5);
    const volumeScore = normalizeScore(relativeVolume, 1, 5);
    const volatilityScore = normalizeScore(volatility, 0, 5);
    const liquidityScore = normalizeScore(snap.ticker.volume24h, 0, 100_000_000);
    const orderBookScore = normalizeScore(Math.abs(orderBookImbalance), 0, 1);

    const { score: signalScore } = calculateHotMarketScore({
      momentumScore,
      volumeScore,
      volatilityScore,
      liquidityScore,
      orderBookScore,
    });
    const scoreBand = classifyScoreBand(signalScore);

    // Run detectors
    const detected: (Signal | null)[] = [
      detectVolumeSpike(snap, cfg, nowIso),
      detectPricePump(snap, cfg, nowIso),
      detectPriceDump(snap, cfg, nowIso),
      detectVolatilityExpansion(snap, cfg, nowIso),
      detectSpreadWidening(snap, cfg, nowIso),
      detectOrderBookImbalance(snap, cfg, nowIso),
      detectBreakout(snap, cfg, nowIso),
      detectOpenInterestSpike(snap, cfg, nowIso),
      detectFundingAnomaly(snap, cfg, nowIso),
      detectHotMarket({ snapshot: snap, score: signalScore }, cfg, nowIso),
    ];

    const activeSignals: SignalType[] = [];
    for (const sig of detected) {
      if (sig) {
        signals.push(sig);
        activeSignals.push(sig.type);
      }
    }

    results.push({
      symbol: snap.market.symbol,
      exchange: snap.market.exchange,
      marketType: snap.market.marketType,
      quoteAsset: snap.market.quote,
      price: snap.ticker.last,
      change5m,
      change15m,
      change1h,
      change24h,
      volume24h: snap.ticker.volume24h,
      relativeVolume,
      volatility,
      tradesPerMinute,
      spreadPct,
      orderBookImbalance,
      openInterest: snap.futures?.openInterest ?? null,
      fundingRate: snap.futures?.fundingRate ?? null,
      signalScore,
      scoreBand,
      activeSignals,
      lastSignalAt: activeSignals.length > 0 ? nowIso : null,
      updatedAt: nowIso,
    });
  }

  return { results, signals };
}
