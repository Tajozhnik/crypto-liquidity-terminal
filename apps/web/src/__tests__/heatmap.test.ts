import type { ScreenerResult } from "@screener/shared";
import { describe, expect, it } from "vitest";
import {
  buildHeatmapLegend,
  calculateHeatmapSummary,
  getHeatmapColor,
  getHeatmapMetric,
  getTileSizeWeight,
  HEATMAP_MODES,
  TILE_SIZE_MODES,
  liquidityScore,
} from "@/lib/heatmap";

const make = (over: Partial<ScreenerResult> = {}): ScreenerResult => ({
  symbol: "BTCUSDT",
  exchange: "mock",
  marketType: "futures",
  quoteAsset: "USDT",
  price: 60000,
  change5m: 0,
  change15m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 1_000_000,
  relativeVolume: 1,
  volatility: 1,
  tradesPerMinute: 10,
  spreadPct: 0.05,
  orderBookImbalance: 0,
  openInterest: 100_000_000,
  fundingRate: 0.0001,
  signalScore: 50,
  scoreBand: "normal",
  activeSignals: [],
  lastSignalAt: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe("getHeatmapMetric", () => {
  it("returns positive perf for gainers and negative for losers", () => {
    expect(getHeatmapMetric(make({ change24h: 3.5 }), "performance").value).toBe(3.5);
    expect(getHeatmapMetric(make({ change24h: -2 }), "performance").value).toBe(-2);
  });

  it("formats display values per mode", () => {
    expect(getHeatmapMetric(make({ change24h: 1.234 }), "performance").display).toBe("+1.23%");
    expect(getHeatmapMetric(make({ volume24h: 1_500_000 }), "volume").display).toMatch(/M$/);
    expect(getHeatmapMetric(make({ relativeVolume: 2.5 }), "relative_volume").display).toBe("2.50×");
    expect(getHeatmapMetric(make({ signalScore: 87 }), "signal_score").display).toBe("87");
  });

  it("flags futures_oi as not applicable for spot markets", () => {
    const m = getHeatmapMetric(make({ marketType: "spot", openInterest: null }), "futures_oi");
    expect(m.applicable).toBe(false);
    expect(m.display).toBe("—");
  });

  it("flags futures_oi as applicable for futures with OI", () => {
    const m = getHeatmapMetric(make({ marketType: "futures", openInterest: 500_000_000 }), "futures_oi");
    expect(m.applicable).toBe(true);
    expect(m.value).toBe(500_000_000);
  });
});

describe("getHeatmapColor", () => {
  it("performance: positive change is green, negative is red", () => {
    const up = getHeatmapColor(make({ change24h: 5 }), "performance");
    const down = getHeatmapColor(make({ change24h: -5 }), "performance");
    expect(up.background).toMatch(/hsl\(140/);
    expect(down.background).toMatch(/hsl\(0/);
    expect(up.muted).toBe(false);
  });

  it("performance intensity scales with abs(change)", () => {
    const small = getHeatmapColor(make({ change24h: 0.5 }), "performance");
    const big = getHeatmapColor(make({ change24h: 5 }), "performance");
    expect(big.intensity).toBeGreaterThan(small.intensity);
    expect(big.intensity).toBeLessThanOrEqual(1);
  });

  it("signal_score uses different hues per band", () => {
    const cold = getHeatmapColor(make({ signalScore: 10, scoreBand: "cold" }), "signal_score");
    const extreme = getHeatmapColor(make({ signalScore: 95, scoreBand: "extreme" }), "signal_score");
    expect(cold.background).not.toBe(extreme.background);
  });

  it("relative_volume bands work as documented", () => {
    expect(getHeatmapColor(make({ relativeVolume: 0.5 }), "relative_volume").intensity).toBe(0);
    expect(getHeatmapColor(make({ relativeVolume: 1.5 }), "relative_volume").intensity).toBeCloseTo(0.3);
    expect(getHeatmapColor(make({ relativeVolume: 2.5 }), "relative_volume").intensity).toBeCloseTo(0.6);
    expect(getHeatmapColor(make({ relativeVolume: 4 }), "relative_volume").intensity).toBe(1);
  });

  it("futures_oi mutes spot tiles", () => {
    const c = getHeatmapColor(make({ marketType: "spot", openInterest: null }), "futures_oi");
    expect(c.muted).toBe(true);
  });

  it("futures_oi colours futures tiles", () => {
    const c = getHeatmapColor(make({ marketType: "futures", openInterest: 100_000_000 }), "futures_oi");
    expect(c.muted).toBe(false);
  });
});

describe("liquidityScore", () => {
  it("returns 0 for zero volume", () => {
    expect(liquidityScore(make({ volume24h: 0 }))).toBe(0);
  });
  it("higher volume + lower spread = higher score", () => {
    const a = liquidityScore(make({ volume24h: 1_000_000, spreadPct: 0.5 }));
    const b = liquidityScore(make({ volume24h: 100_000_000, spreadPct: 0.01 }));
    expect(b).toBeGreaterThan(a);
  });
});

describe("getTileSizeWeight", () => {
  it("equal mode returns 1 for any market", () => {
    expect(getTileSizeWeight(make({ volume24h: 1_000_000 }), "equal")).toBe(1);
    expect(getTileSizeWeight(make({ volume24h: 1 }), "equal")).toBe(1);
  });

  it("market_cap mode falls back to 1 (data unavailable)", () => {
    expect(getTileSizeWeight(make(), "market_cap")).toBe(1);
  });

  it("volume_24h mode is monotonic in volume (log scale)", () => {
    const small = getTileSizeWeight(make({ volume24h: 100_000 }), "volume_24h");
    const big = getTileSizeWeight(make({ volume24h: 100_000_000 }), "volume_24h");
    expect(big).toBeGreaterThan(small);
  });

  it("market_cap is marked disabled in TILE_SIZE_MODES", () => {
    const mc = TILE_SIZE_MODES.find((m) => m.id === "market_cap");
    expect(mc?.disabled).toBe(true);
    expect(mc?.disabledReason).toContain("Market cap");
  });
});

describe("buildHeatmapLegend", () => {
  it("returns swatches for every mode", () => {
    for (const mode of HEATMAP_MODES) {
      const l = buildHeatmapLegend(mode.id);
      expect(l.swatches.length).toBeGreaterThan(0);
      expect(l.title.length).toBeGreaterThan(0);
    }
  });

  it("futures_oi legend mentions spot muting", () => {
    const l = buildHeatmapLegend("futures_oi");
    expect(l.note).toMatch(/spot/i);
  });
});

describe("calculateHeatmapSummary", () => {
  it("counts hot and extreme markets correctly", () => {
    const rows = [
      make({ symbol: "A", signalScore: 90, volatility: 1, volume24h: 100 }),
      make({ symbol: "B", signalScore: 70, volatility: 2, volume24h: 200 }),
      make({ symbol: "C", signalScore: 25, volatility: 3, volume24h: 300 }),
    ];
    const s = calculateHeatmapSummary(rows);
    expect(s.total).toBe(3);
    expect(s.extreme).toBe(1);
    expect(s.hot).toBe(1); // 70 is hot, 90 is extreme (mutually exclusive in our counting)
    expect(s.totalVolume).toBe(600);
    expect(s.avgVolatility).toBeCloseTo(2);
  });

  it("returns zeros for empty input", () => {
    expect(calculateHeatmapSummary([])).toEqual({
      total: 0,
      hot: 0,
      extreme: 0,
      avgVolatility: 0,
      totalVolume: 0,
    });
  });
});
