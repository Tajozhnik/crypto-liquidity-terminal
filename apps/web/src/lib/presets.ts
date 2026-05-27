/** Screener presets — Requirement 8.1 */

import type { ScreenerFilters } from "./filters";

export type PresetName =
  | "Scalping"
  | "High Volume"
  | "Volatility"
  | "Futures OI"
  | "Low Spread"
  | "Meme Coins"
  | "Breakout";

export const PRESETS: Record<PresetName, Partial<ScreenerFilters>> = {
  Scalping: {
    marketType: ["futures"],
    minVolume24h: 10_000_000,
    maxSpreadPercent: 0.08,
    minTradesPerMinute: 50,
  },
  "High Volume": {
    quoteAsset: ["USDT"],
    minVolume24h: 50_000_000,
  },
  Volatility: {
    minVolatility: 2.0,
    minChange5mAbs: 1.5,
  },
  "Futures OI": {
    marketType: ["futures"],
    minOpenInterestChange15m: 3.0,
  },
  "Low Spread": {
    maxSpreadPercent: 0.05,
    minVolume24h: 20_000_000,
  },
  "Meme Coins": {
    symbols: ["DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "FLOKIUSDT", "WIFUSDT", "BONKUSDT"],
    minRelativeVolume: 1.5,
  },
  Breakout: {
    signalTypes: ["BREAKOUT"],
    minSignalScore: 70,
  },
};

export const PRESET_NAMES: PresetName[] = [
  "Scalping",
  "High Volume",
  "Volatility",
  "Futures OI",
  "Low Spread",
  "Meme Coins",
  "Breakout",
];
