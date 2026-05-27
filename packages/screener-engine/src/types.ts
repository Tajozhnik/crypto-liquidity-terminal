import type {
  FuturesMetrics,
  Kline,
  Market,
  OrderBook,
  ScreenerResult,
  Signal,
  Ticker,
  Trade,
} from "@screener/shared";

export type SubScores = {
  momentumScore: number;
  volumeScore: number;
  volatilityScore: number;
  liquidityScore: number;
  orderBookScore: number;
};

export type MarketSnapshot = {
  market: Market;
  ticker: Ticker;
  klines1m: Kline[]; // newest at the end
  recentTrades: Trade[]; // newest at the end
  orderBook: OrderBook;
  futures?: FuturesMetrics | undefined;
  /** Optional precomputed cross-window changes; if omitted, derived from klines1m */
  changes?: {
    change5m: number;
    change15m: number;
    change1h: number;
    change24h: number;
  };
  /** Optional history of OI for OI_SPIKE detection */
  openInterestHistory?: { ts: number; value: number }[];
};

export type ScreenerConfig = {
  volumeSpike: { timeframe: string; relativeVolumeThreshold: number };
  pricePump: { timeframe: string; thresholdPercent: number };
  priceDump: { timeframe: string; thresholdPercent: number };
  volatilityExpansion: { timeframe: string; thresholdMultiplier: number };
  spreadWidening: { thresholdPercent: number };
  orderBookImbalance: { depthLevels: number; thresholdRatio: number };
  openInterestSpike: { timeframe: string; thresholdPercent: number };
  fundingAnomaly: { absoluteThreshold: number };
  breakout: { lookbackCandles: number; timeframe: string };
  hotMarket: { scoreThreshold: number };
};

export const DEFAULT_CONFIG: ScreenerConfig = {
  volumeSpike: { timeframe: "5m", relativeVolumeThreshold: 3.0 },
  pricePump: { timeframe: "5m", thresholdPercent: 2.0 },
  priceDump: { timeframe: "5m", thresholdPercent: -2.0 },
  volatilityExpansion: { timeframe: "5m", thresholdMultiplier: 2.0 },
  spreadWidening: { thresholdPercent: 0.15 },
  orderBookImbalance: { depthLevels: 20, thresholdRatio: 0.65 },
  openInterestSpike: { timeframe: "15m", thresholdPercent: 5.0 },
  fundingAnomaly: { absoluteThreshold: 0.03 },
  breakout: { lookbackCandles: 20, timeframe: "5m" },
  hotMarket: { scoreThreshold: 81 },
};

export type RunScreenerResult = {
  results: ScreenerResult[];
  signals: Signal[];
};
