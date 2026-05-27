import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  applyFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  type ScreenerFilters,
} from "@/lib/filters";
import { PRESETS } from "@/lib/presets";
import type { ScreenerResult } from "@screener/shared";

const make = (over: Partial<ScreenerResult>): ScreenerResult => ({
  symbol: "BTCUSDT",
  exchange: "mock",
  marketType: "spot",
  quoteAsset: "USDT",
  price: 100,
  change5m: 0,
  change15m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  relativeVolume: 1,
  volatility: 0,
  tradesPerMinute: 0,
  spreadPct: 0,
  orderBookImbalance: 0,
  openInterest: null,
  fundingRate: null,
  signalScore: 0,
  scoreBand: "cold",
  activeSignals: [],
  lastSignalAt: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe("filters URL serialization", () => {
  it("round-trips a filter set", () => {
    const original: ScreenerFilters = {
      ...EMPTY_FILTERS,
      exchange: ["mock", "binance"],
      marketType: ["futures"],
      quoteAsset: ["USDT"],
      symbols: ["BTCUSDT", "ETHUSDT"],
      signalTypes: ["BREAKOUT"],
      search: "BTC",
      minVolume24h: 1_000_000,
      minSignalScore: 70,
      hasActiveSignal: true,
      watchlistOnly: true,
    };
    const params = filtersToSearchParams(original);
    const parsed = filtersFromSearchParams(params);
    expect(parsed.exchange).toEqual(original.exchange);
    expect(parsed.marketType).toEqual(original.marketType);
    expect(parsed.symbols).toEqual(original.symbols);
    expect(parsed.signalTypes).toEqual(original.signalTypes);
    expect(parsed.search).toBe(original.search);
    expect(parsed.minVolume24h).toBe(original.minVolume24h);
    expect(parsed.minSignalScore).toBe(original.minSignalScore);
    expect(parsed.hasActiveSignal).toBe(true);
    expect(parsed.watchlistOnly).toBe(true);
  });

  it("empty filter set serializes to empty params", () => {
    const params = filtersToSearchParams(EMPTY_FILTERS);
    expect(params.toString()).toBe("");
  });
});

describe("applyFilters", () => {
  const watch = new Set<string>(["BTCUSDT"]);
  const rows = [
    make({ symbol: "BTCUSDT", marketType: "futures", signalScore: 90, volume24h: 200_000_000, activeSignals: ["BREAKOUT"] }),
    make({ symbol: "ETHUSDT", marketType: "spot", signalScore: 30, volume24h: 5_000_000 }),
    make({ symbol: "SOLUSDT", marketType: "futures", signalScore: 60, volume24h: 50_000_000 }),
  ];

  it("filters by marketType", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, marketType: ["futures"] }, watch);
    expect(out.map((r) => r.symbol).sort()).toEqual(["BTCUSDT", "SOLUSDT"]);
  });

  it("filters by minSignalScore", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, minSignalScore: 80 }, watch);
    expect(out.map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("watchlistOnly restricts to watch set", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, watchlistOnly: true }, watch);
    expect(out.map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("hasActiveSignal hides empty-signal rows", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, hasActiveSignal: true }, watch);
    expect(out.map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("search is case-insensitive substring match", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, search: "eth" }, watch);
    expect(out.map((r) => r.symbol)).toEqual(["ETHUSDT"]);
  });
});

describe("preset application", () => {
  const watch = new Set<string>();
  const rows = [
    make({ symbol: "BTCUSDT", marketType: "futures", volume24h: 60_000_000, spreadPct: 0.05, tradesPerMinute: 80 }),
    make({ symbol: "DOGEUSDT", marketType: "spot", volume24h: 30_000_000, relativeVolume: 2.0, activeSignals: [] }),
    make({ symbol: "PEPEUSDT", marketType: "spot", volume24h: 5_000_000, relativeVolume: 2.5 }),
  ];

  it("Scalping preset selects high-volume futures with low spread", () => {
    const filters: ScreenerFilters = { ...EMPTY_FILTERS, ...PRESETS.Scalping };
    const out = applyFilters(rows, filters, watch);
    expect(out.map((r) => r.symbol)).toEqual(["BTCUSDT"]);
  });

  it("Meme Coins preset selects only configured meme symbols with rel vol", () => {
    const filters: ScreenerFilters = { ...EMPTY_FILTERS, ...PRESETS["Meme Coins"] };
    const out = applyFilters(rows, filters, watch);
    // DOGEUSDT (relVol 2.0) and PEPEUSDT (relVol 2.5) match symbols+minRelVol; BTCUSDT not in list.
    expect(out.map((r) => r.symbol).sort()).toEqual(["DOGEUSDT", "PEPEUSDT"]);
  });
});
