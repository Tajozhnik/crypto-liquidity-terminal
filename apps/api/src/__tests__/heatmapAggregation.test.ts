import { describe, expect, it } from "vitest";
import type { DepthSnapshot } from "../market-depth/DepthSnapshotStore.js";
import { buildHeatmap } from "../market-depth/LiquidityHeatmapBuilder.js";
import { chooseBinWidth } from "../market-depth/PriceBinner.js";

describe("PriceBinner auto bin size", () => {
  it("creates >50 bins for a realistic ETHUSDT order book range", () => {
    // ETHUSDT around $3500, ±1.5% = $3447.5 .. $3552.5, range ≈ $105
    const mid = 3500;
    const { binWidth } = chooseBinWidth(mid, "auto", 0.015, {
      priceMin: 3447.5,
      priceMax: 3552.5,
      targetBins: 120,
    });
    expect(binWidth).toBeGreaterThan(0);
    const fullRange = 3552.5 - 3447.5;
    const cells = fullRange / binWidth;
    expect(cells).toBeGreaterThan(50);
    expect(cells).toBeLessThan(300);
  });

  it("respects targetBins and explicit price range over halfRangePct", () => {
    const { binWidth: bw } = chooseBinWidth(100, "auto", 0.05, {
      priceMin: 99,
      priceMax: 101,
      targetBins: 40,
    });
    // 2 / 40 = 0.05
    expect(bw).toBeCloseTo(0.05, 5);
  });

  it("never returns 0 binWidth for valid mid", () => {
    expect(chooseBinWidth(60_000, "auto").binWidth).toBeGreaterThan(0);
    expect(chooseBinWidth(0.000123, "auto").binWidth).toBeGreaterThan(0);
  });
});

describe("LiquidityHeatmapBuilder spreads cells across price levels", () => {
  function realisticETH(): DepthSnapshot[] {
    // Build 30 snapshots, 5 sec apart, each with 50 bid/ask levels around 3500
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const mid = 3500 + (Math.random() - 0.5) * 5;
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 50; k++) {
        bids.push([mid - k * 0.5, 1 + (k % 7)]);
        asks.push([mid + k * 0.5, 1 + (k % 5)]);
      }
      out.push({ t: now - (30 - i) * 5_000, bids, asks, midPrice: mid });
    }
    return out;
  }

  it("returns cells across multiple price levels (>20) and multiple time buckets", () => {
    const matrix = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(matrix.debugStats.cellCount).toBeGreaterThan(20);
    expect(matrix.debugStats.priceBinCount).toBeGreaterThan(10);
    expect(matrix.debugStats.timeBucketCount).toBeGreaterThan(0);
    expect(matrix.debugStats.nonEmptyBidCells).toBeGreaterThan(0);
    expect(matrix.debugStats.nonEmptyAskCells).toBeGreaterThan(0);
    expect(matrix.binWidth).toBeGreaterThan(0);
    expect(matrix.priceMax).toBeGreaterThan(matrix.priceMin);
  });

  it("respects an explicit maxHalfRangePct override (book extends ±5.7 %)", () => {
    // Single snapshot with one wide bid and one wide ask (~5.7 % each side).
    // The new builder defaults to ±2 % around mid; a caller that knows the
    // book is wider must opt in via maxHalfRangePct or supply the viewport
    // priceMin/priceMax explicitly.
    const snap: DepthSnapshot = {
      t: Date.now(),
      bids: [[3300, 5], [3450, 3]],
      asks: [[3550, 4], [3700, 6]],
      midPrice: 3500,
    };
    const m = buildHeatmap([snap], {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 60,
      minHalfRangePct: 0.005,
      maxHalfRangePct: 0.10, // ±10 % — wide enough to fit 3300..3700
    });
    expect(m.priceMin).toBeLessThanOrEqual(3300);
    expect(m.priceMax).toBeGreaterThanOrEqual(3700);
    expect(m.debugStats.cellCount).toBeGreaterThanOrEqual(4);
  });

  it("returns debugStats.warning when no snapshots", () => {
    const m = buildHeatmap([], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.debugStats.warning).toBeTruthy();
    expect(m.cells.length).toBe(0);
  });

  it("expands range to cover candle hint when maxHalfRangePct allows it", () => {
    const snap: DepthSnapshot = {
      t: Date.now(),
      bids: [[3499, 1]],
      asks: [[3501, 1]],
      midPrice: 3500,
    };
    const m = buildHeatmap([snap], {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      candlePriceMin: 3300,
      candlePriceMax: 3700,
      maxHalfRangePct: 0.10,
    });
    expect(m.priceMin).toBeLessThanOrEqual(3300);
    expect(m.priceMax).toBeGreaterThanOrEqual(3700);
  });
});


describe("LiquidityHeatmapBuilder timeframe parameter", () => {
  function realisticETH(): import("../market-depth/DepthSnapshotStore.js").DepthSnapshot[] {
    const out: import("../market-depth/DepthSnapshotStore.js").DepthSnapshot[] = [];
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const mid = 3500 + (Math.random() - 0.5) * 5;
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 50; k++) {
        bids.push([mid - k * 0.5, 1 + (k % 7)]);
        asks.push([mid + k * 0.5, 1 + (k % 5)]);
      }
      out.push({ t: now - (30 - i) * 5_000, bids, asks, midPrice: mid });
    }
    return out;
  }

  it("default heatmapBucketMs=5_000 regardless of timeframe", () => {
    const m1m = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    const m15m = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "15m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m1m.debugStats.timeBucketMs).toBe(5_000);
    expect(m1m.debugStats.requestedTimeframe).toBe("1m");
    expect(m15m.debugStats.timeBucketMs).toBe(5_000);
    expect(m15m.debugStats.requestedTimeframe).toBe("15m");
  });

  it("heatmapBucketMs override is honoured (1s, 2s, 10s)", () => {
    const m1s = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      heatmapBucketMs: 1_000,
    });
    expect(m1s.debugStats.timeBucketMs).toBe(1_000);
    const m10s = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      heatmapBucketMs: 10_000,
    });
    expect(m10s.debugStats.timeBucketMs).toBe(10_000);
  });

  it("emits accumulationWarning when snapshot span is shorter than the default visible range", () => {
    const m = buildHeatmap(realisticETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "15m", // default = 4h, sample span ≈ 150s
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.debugStats.accumulationWarning).toMatch(/15m/);
  });
});


describe("LiquidityHeatmapBuilder live history accumulation metadata", () => {
  function tinyETH(): DepthSnapshot[] {
    // 5 snapshots, 1s apart — short live history
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      out.push({
        t: now - (5 - i) * 1_000,
        bids: [[3499, 1]],
        asks: [[3501, 1]],
        midPrice: 3500,
      });
    }
    return out;
  }

  it("populates feedStartedAt, historyAgeMs, requiredHistoryMs and historyCompleteness", () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const m = buildHeatmap(tinyETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      feedStartedAt: startedAt,
    });
    expect(m.debugStats.feedStartedAt).toBe(startedAt);
    expect(m.debugStats.requiredHistoryMs).toBe(15 * 60_000);
    expect(m.debugStats.historyAgeMs).toBeGreaterThanOrEqual(60_000 - 1_000);
    expect(m.debugStats.historyAgeMs).toBeLessThanOrEqual(60_000 + 5_000);
    // 60s of 15m → ~6.7 % completeness
    expect(m.debugStats.historyCompleteness).toBeGreaterThan(0.05);
    expect(m.debugStats.historyCompleteness).toBeLessThan(0.2);
  });

  it("history completeness clamps to 1 once history exceeds the timeframe default range", () => {
    const startedAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString(); // 24h
    const m = buildHeatmap(tinyETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "15m",
      binSize: "auto",
      lookbackMinutes: 30,
      feedStartedAt: startedAt,
    });
    expect(m.debugStats.historyCompleteness).toBe(1);
  });

  it("missing feedStartedAt does not crash, falls back to 0 historyAge", () => {
    const m = buildHeatmap(tinyETH(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.debugStats.feedStartedAt).toBeNull();
    expect(m.debugStats.historyAgeMs).toBeGreaterThanOrEqual(0);
  });
});


describe("LiquidityHeatmapBuilder distribution stats", () => {
  function withOutlier(): DepthSnapshot[] {
    // 30 snapshots; one of them carries a single huge level so we can confirm
    // p99 cap stays below the absolute max.
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const mid = 3500;
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 50; k++) {
        bids.push([mid - k * 0.5, 1]);
        asks.push([mid + k * 0.5, 1]);
      }
      if (i === 15) bids[10] = [mid - 5.5, 1_000_000]; // whale wall
      out.push({ t: now - (30 - i) * 5_000, bids, asks, midPrice: mid });
    }
    return out;
  }

  it("populates max/mean/std/p90/p95/p99 with finite values", () => {
    const m = buildHeatmap(withOutlier(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    const d = m.debugStats;
    expect(d.maxLiquidity).toBeGreaterThan(0);
    expect(d.meanLiquidity).toBeGreaterThan(0);
    expect(d.stdLiquidity).toBeGreaterThan(0);
    expect(d.p90Liquidity).toBeGreaterThan(0);
    expect(d.p95Liquidity).toBeGreaterThan(0);
    expect(d.p99Liquidity).toBeGreaterThan(0);
    expect(d.p90Liquidity).toBeLessThanOrEqual(d.p95Liquidity);
    expect(d.p95Liquidity).toBeLessThanOrEqual(d.p99Liquidity);
    expect(d.p99Liquidity).toBeLessThanOrEqual(d.maxLiquidity);
  });

  it("p99 sits below the whale wall outlier", () => {
    const m = buildHeatmap(withOutlier(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.debugStats.p99Liquidity).toBeLessThan(m.debugStats.maxLiquidity);
  });

  it("respects depthLevels — a 5-level cap shrinks bidLevelsUsed", () => {
    const m = buildHeatmap(withOutlier(), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      depthLevels: 5,
    });
    expect(m.debugStats.bidLevelsUsed).toBeLessThanOrEqual(5);
    expect(m.debugStats.askLevelsUsed).toBeLessThanOrEqual(5);
  });

  it("default produces ≥150 price bins on a realistic range (target ≈200)", () => {
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    // Wider book so auto bin width has plenty of granularity.
    for (let i = 0; i < 5; i++) {
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 200; k++) {
        bids.push([3500 - k * 0.5, 1]);
        asks.push([3500 + k * 0.5, 1]);
      }
      out.push({ t: now - i * 5_000, bids, asks, midPrice: 3500 });
    }
    const m = buildHeatmap(out, {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.debugStats.priceBinCount).toBeGreaterThanOrEqual(150);
  });
});


describe("LiquidityHeatmapBuilder time slicing is decoupled from candle timeframe", () => {
  function manyShortSnapshots(count: number, intervalMs: number): DepthSnapshot[] {
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const mid = 3500;
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 50; k++) {
        bids.push([mid - k * 0.5, 1]);
        asks.push([mid + k * 0.5, 1]);
      }
      out.push({ t: now - (count - i) * intervalMs, bids, asks, midPrice: mid });
    }
    return out;
  }

  it("250 snapshots over ~1 minute produce many time columns even on 15m timeframe", () => {
    // 250 snapshots, 250 ms apart → 62.5 s of history.
    const m = buildHeatmap(manyShortSnapshots(250, 250), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "15m", // candle is 15m, but heatmap must NOT be one fat column.
      binSize: "auto",
      lookbackMinutes: 30,
      heatmapBucketMs: 2_000, // 2 s per slice
    });
    // ~62 s of data / 2 s per bucket ≈ 31 columns. Allow some slack at the edges.
    expect(m.debugStats.timeBucketCount).toBeGreaterThanOrEqual(20);
  });

  it("default 5s bucket gives ≥10 columns from 60s of data, regardless of timeframe", () => {
    for (const tf of ["1m", "5m", "15m"] as const) {
      const m = buildHeatmap(manyShortSnapshots(240, 250), {
        symbol: "ETHUSDT",
        exchange: "binance",
        marketType: "futures",
        timeframe: tf,
        binSize: "auto",
        lookbackMinutes: 30,
      });
      expect(m.debugStats.timeBucketCount).toBeGreaterThanOrEqual(10);
    }
  });

  it("changing heatmapBucketMs does not affect price geometry — only column count", () => {
    const a = buildHeatmap(manyShortSnapshots(240, 250), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      heatmapBucketMs: 1_000,
    });
    const b = buildHeatmap(manyShortSnapshots(240, 250), {
      symbol: "ETHUSDT",
      exchange: "binance",
      marketType: "futures",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
      heatmapBucketMs: 10_000,
    });
    // Same price range, same bin width — only column count differs.
    expect(b.priceMin).toBeCloseTo(a.priceMin, 5);
    expect(b.priceMax).toBeCloseTo(a.priceMax, 5);
    expect(b.binWidth).toBeCloseTo(a.binWidth, 5);
    expect(a.debugStats.timeBucketCount).toBeGreaterThan(b.debugStats.timeBucketCount);
  });
});


describe("LiquidityHeatmapBuilder price range protects against deep book tails", () => {
  it("ignores a stale level at $45 000 when mid=$77 900 (default ±2 % cap)", () => {
    // Reproduces the BTCUSDT bug where 1000-level books carry deep stale
    // quotes that used to stretch the heatmap to a $32k range.
    const t = Date.now();
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (let k = 1; k <= 50; k++) {
      bids.push([77900 - k, 1]);
      asks.push([77900 + k, 1]);
    }
    bids.push([45_000, 999]); // whale wall on the deep tail
    const m = buildHeatmap(
      [{ t, bids, asks, midPrice: 77900 }],
      {
        symbol: "BTCUSDT",
        exchange: "binance",
        marketType: "spot",
        timeframe: "1m",
        binSize: "auto",
        lookbackMinutes: 30,
      },
    );
    // Visible window stays within ±2 % of mid → 76_342..79_458, NOT 45 000.
    expect(m.priceMin).toBeGreaterThan(77900 * 0.97);
    expect(m.priceMax).toBeLessThan(77900 * 1.03);
    // Stale $45k level is dropped because it's outside the clamped range.
    // The remaining 50+50 active levels span only $50 around mid, so with
    // a $1500 visible window and 200 target bins we land on ~6 priceBins.
    // The key assertion is: range did NOT stretch to $45k.
    expect(m.debugStats.priceBinCount).toBeGreaterThanOrEqual(3);
  });

  it("honours an explicit viewport priceMin/priceMax from the frontend", () => {
    const t = Date.now();
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (let k = 1; k <= 200; k++) {
      bids.push([100 - k * 0.05, 1]);
      asks.push([100 + k * 0.05, 1]);
    }
    const m = buildHeatmap(
      [{ t, bids, asks, midPrice: 100 }],
      {
        symbol: "BTCUSDT",
        exchange: "binance",
        marketType: "spot",
        timeframe: "1m",
        binSize: "auto",
        lookbackMinutes: 30,
        priceMin: 99,
        priceMax: 101,
      },
    );
    expect(m.priceMin).toBeCloseTo(99, 1);
    expect(m.priceMax).toBeCloseTo(101, 1);
  });
});


describe("LiquidityHeatmapBuilder honours large lookbackMinutes (used by Max)", () => {
  function syntheticHistory(spanMinutes: number, intervalMs: number): DepthSnapshot[] {
    const out: DepthSnapshot[] = [];
    const now = Date.now();
    const total = Math.floor((spanMinutes * 60_000) / intervalMs);
    for (let i = 0; i < total; i++) {
      const mid = 77900;
      const bids: [number, number][] = [];
      const asks: [number, number][] = [];
      for (let k = 1; k <= 30; k++) {
        bids.push([mid - k, 1]);
        asks.push([mid + k, 1]);
      }
      out.push({ t: now - (total - i) * intervalMs, bids, asks, midPrice: mid });
    }
    return out;
  }

  it("3.7 hours of accumulated snapshots produce a full 3.7h matrix when lookbackMinutes=240", () => {
    // 3.7 hours @ 1 snapshot/s = 13_320 entries.
    // We sample with a coarser interval to keep the test fast while still
    // covering > 60 minutes of history.
    const snapshots = syntheticHistory(3.7 * 60, 5_000);
    const m = buildHeatmap(snapshots, {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 240, // 4h cap
      heatmapBucketMs: 5_000,
    });
    // Builder is asked for 4h, the data covers 3.7h → spans 3.7h.
    expect(m.debugStats.snapshotTimeSpanMs).toBeGreaterThan(3 * 60 * 60_000);
    expect(m.debugStats.snapshotTimeSpanMs).toBeLessThan(4 * 60 * 60_000);
    expect(m.debugStats.timeBucketCount).toBeGreaterThan(60);
  });
});


describe("LiquidityHeatmapBuilder produces stable price window when no viewport supplied", () => {
  function snap(mid: number, time = Date.now()): DepthSnapshot {
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (let k = 1; k <= 30; k++) {
      bids.push([mid - k, 1]);
      asks.push([mid + k, 1]);
    }
    // Add a stale tail level far below — should NOT expand the window.
    bids.push([mid * 0.55, 999]);
    return { t: time, bids, asks, midPrice: mid };
  }

  it("two consecutive builds with the same snapshot produce the same priceMin/priceMax", () => {
    const s = snap(77900);
    const a = buildHeatmap([s], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    const b = buildHeatmap([s], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(a.priceMin).toBeCloseTo(b.priceMin, 5);
    expect(a.priceMax).toBeCloseTo(b.priceMax, 5);
    expect(a.binWidth).toBeCloseTo(b.binWidth, 5);
  });

  it("cells carry absolute price coordinates inside [priceMin, priceMax]", () => {
    const s = snap(77900);
    const m = buildHeatmap([s], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.cells.length).toBeGreaterThan(0);
    for (const c of m.cells) {
      expect(c.price).toBeGreaterThanOrEqual(m.priceMin - 1e-9);
      expect(c.price).toBeLessThanOrEqual(m.priceMax + 1e-9);
    }
  });

  it("stale tail bid at $42 845 does NOT expand the window when mid=$77 900", () => {
    const s = snap(77900);
    const m = buildHeatmap([s], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(m.priceMin).toBeGreaterThan(77900 * 0.95); // way above the stale 42_845
  });
});
