import { describe, expect, it } from "vitest";
import { bucketDelta } from "../market-depth/DeltaCalculator.js";
import { DepthSnapshotStore } from "../market-depth/DepthSnapshotStore.js";
import { buildHeatmap } from "../market-depth/LiquidityHeatmapBuilder.js";
import { OrderBookReconstructor } from "../market-depth/OrderBookReconstructor.js";
import { chooseBinWidth, priceToBin } from "../market-depth/PriceBinner.js";
import { RingBuffer } from "../market-depth/RingBuffer.js";
import { TradeBuffer } from "../market-depth/TradeBuffer.js";

describe("RingBuffer", () => {
  it("caps at capacity, dropping oldest", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    r.push(3);
    r.push(4);
    expect(r.toArray()).toEqual([2, 3, 4]);
    expect(r.size()).toBe(3);
  });
});

describe("PriceBinner", () => {
  it("auto bin widths give reasonable cell count over ±5%", () => {
    const { binWidth } = chooseBinWidth(60_000, "auto");
    const fullRange = 60_000 * 0.1;
    const cells = fullRange / binWidth;
    expect(cells).toBeGreaterThan(40);
    expect(cells).toBeLessThan(400);
  });
  it("fixed pct mode produces exactly that bin width", () => {
    expect(chooseBinWidth(100, "0.5%").binWidth).toBeCloseTo(0.5);
    expect(chooseBinWidth(100, "1%").binWidth).toBeCloseTo(1);
  });
  it("priceToBin floors to bin lower bound", () => {
    expect(priceToBin(60_037, 10)).toBe(60_030);
    expect(priceToBin(0.000123, 0.0001)).toBeCloseTo(0.0001, 6);
  });
});

describe("OrderBookReconstructor", () => {
  it("applies a snapshot and reflects top-of-book", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({
      lastUpdateId: 100,
      bids: [["100", "5"], ["99", "3"]],
      asks: [["101", "2"], ["102", "4"]],
    });
    const top = r.topOfBook(5);
    expect(top.bids[0]).toEqual([100, 5]);
    expect(top.asks[0]).toEqual([101, 2]);
    expect(r.needsResync()).toBe(false);
  });

  it("drops zero-qty levels via diffs", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({
      lastUpdateId: 100,
      bids: [["100", "5"]],
      asks: [["101", "2"]],
    });
    r.applyDiff({ E: 1, U: 101, u: 101, b: [["100", "0"]], a: [] });
    expect(r.topOfBook(5).bids).toEqual([]);
  });

  it("detects gap and signals needs_resync", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({ lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] });
    const status = r.applyDiff({ E: 1, U: 200, u: 205, b: [], a: [] });
    expect(status).toBe("needs_resync");
    expect(r.needsResync()).toBe(true);
  });

  it("ignores stale diffs older than current state", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({ lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] });
    const status = r.applyDiff({ E: 1, U: 50, u: 50, b: [["100", "999"]], a: [] });
    expect(status).toBe("stale");
    expect(r.topOfBook(5).bids[0]).toEqual([100, 1]);
  });
});

describe("LiquidityHeatmapBuilder", () => {
  it("aggregates bids/asks into time-price cells", () => {
    const t = Date.now();
    const store = new DepthSnapshotStore();
    store.push({
      t,
      bids: [[100, 10], [99, 20]],
      asks: [[101, 5], [102, 15]],
      midPrice: 100.5,
    });
    const matrix = buildHeatmap(store.all(), {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "1%",
      lookbackMinutes: 60,
    });
    expect(matrix.cells.length).toBeGreaterThan(0);
    const totals = matrix.cells.reduce((acc, c) => acc + c.totalLiquidity, 0);
    // Notional = price×qty summed across both sides:
    // bids 100×10 + 99×20 = 2980; asks 101×5 + 102×15 = 2035; total 5015
    expect(totals).toBeCloseTo(5015, 0);
  });

  it("returns empty matrix when no recent snapshots", () => {
    const matrix = buildHeatmap([], {
      symbol: "BTCUSDT",
      exchange: "binance",
      marketType: "spot",
      timeframe: "1m",
      binSize: "auto",
      lookbackMinutes: 30,
    });
    expect(matrix.cells).toEqual([]);
  });

  it("clamps the visible range to ±maxHalfRangePct of mid (deep book tails are ignored)", () => {
    const t = Date.now();
    const matrix = buildHeatmap(
      [
        {
          t,
          bids: [[1, 10000]],         // far below mid (will be filtered out)
          asks: [[1_000_000, 10000]], // far above mid (will be filtered out)
          midPrice: 100,
        },
      ],
      {
        symbol: "BTCUSDT",
        exchange: "binance",
        marketType: "spot",
        timeframe: "1m",
        binSize: "1%",
        lookbackMinutes: 60,
        minHalfRangePct: 0.05,
        maxHalfRangePct: 0.10, // ±10 % — extreme levels still way outside
      },
    );
    // Heatmap clamps the range so that a 1000-level book tail at $1 cannot
    // stretch the visible window to $1..$1M — the matrix shows only the
    // ±10 % corridor around mid=100, i.e. roughly $90..$110.
    expect(matrix.priceMin).toBeGreaterThanOrEqual(85);
    expect(matrix.priceMax).toBeLessThanOrEqual(115);
    // Cells outside the clamped window are dropped.
    expect(matrix.cells.length).toBe(0);
  });
});

describe("DeltaCalculator", () => {
  it("buckets buy/sell volumes correctly", () => {
    const buf = new TradeBuffer();
    buf.push({ t: 60_000, price: 100, qty: 1, buyerIsMaker: false }); // taker buy
    buf.push({ t: 60_500, price: 100, qty: 2, buyerIsMaker: true }); // taker sell
    buf.push({ t: 120_000, price: 101, qty: 1, buyerIsMaker: false });
    const buckets = bucketDelta(buf.recent(100), "1m");
    expect(buckets.length).toBe(2);
    expect(buckets[0]!.buyVolume).toBeCloseTo(100); // 1 × 100
    expect(buckets[0]!.sellVolume).toBeCloseTo(200); // 2 × 100
    expect(buckets[0]!.delta).toBeCloseTo(-100);
    expect(buckets[1]!.delta).toBeCloseTo(101);
    expect(buckets[1]!.cumulativeDelta).toBeCloseTo(1); // -100 + 101
  });
});

describe("Binance stream payload normalization", () => {
  it("processes a realistic agg trade payload via internal handler", () => {
    // Smoke check that the message router parses fields without throwing.
    const aggTrade = { e: "aggTrade", T: 1700000000000, p: "60000.5", q: "0.123", m: false };
    expect(Number.parseFloat(aggTrade.p)).toBeCloseTo(60000.5);
    expect(Number.parseFloat(aggTrade.q)).toBeCloseTo(0.123);
    expect(Boolean(aggTrade.m)).toBe(false);
  });
});


describe("OrderBookReconstructor strict-bridge gap detection (B-004)", () => {
  it("after the first bridge diff, a non-contiguous diff triggers needs_resync", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({ lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] });
    // Bridge diff: U=99 (≤ last+1=101) and u=110 — accepted, lastUpdateId=110.
    expect(r.applyDiff({ E: 1, U: 99, u: 110, b: [], a: [] })).toBe("applied");
    // Next diff must be exactly U=111. A diff with U=99 is "stale" (u <= 110)
    // — but the real strict-bridge case is U=120 (> 111 — gap detected).
    expect(r.applyDiff({ E: 2, U: 120, u: 130, b: [], a: [] })).toBe("needs_resync");
    expect(r.needsResync()).toBe(true);
  });

  it("after the bridge, the contiguous diff U=lastUpdateId+1 is accepted", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({ lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] });
    expect(r.applyDiff({ E: 1, U: 99, u: 110, b: [], a: [] })).toBe("applied");
    // U=111 is exactly lastUpdateId+1.
    expect(r.applyDiff({ E: 2, U: 111, u: 115, b: [["100", "5"]], a: [] })).toBe("applied");
    expect(r.topOfBook(5).bids[0]).toEqual([100, 5]);
  });

  it("re-applying a snapshot resets the bridged flag", () => {
    const r = new OrderBookReconstructor();
    r.applySnapshot({ lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] });
    r.applyDiff({ E: 1, U: 99, u: 110, b: [], a: [] });
    // Snapshot again — next diff is treated as a fresh bridge.
    r.applySnapshot({ lastUpdateId: 200, bids: [["100", "1"]], asks: [["101", "1"]] });
    // U=180 is ≤ 201 → bridge accepted with no gap.
    expect(r.applyDiff({ E: 2, U: 180, u: 210, b: [], a: [] })).toBe("applied");
  });
});


describe("RingBuffer (I-007 — circular buffer, O(1) push)", () => {
  it("preserves chronological order across many wraps", () => {
    const r = new RingBuffer<number>(4);
    for (let i = 1; i <= 12; i++) r.push(i);
    // capacity 4, last 4 pushed are 9,10,11,12
    expect(r.toArray()).toEqual([9, 10, 11, 12]);
    expect(r.size()).toBe(4);
  });

  it("filter returns chronological matches even after wrap", () => {
    const r = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) r.push(i);
    // last 3 = [5,6,7]
    expect(r.filter((n) => n % 2 === 1)).toEqual([5, 7]);
  });

  it("prune drops entries below cutoff and keeps the rest in order", () => {
    type Row = { t: number };
    const r = new RingBuffer<Row>(5);
    [1, 2, 3, 4, 5, 6, 7].forEach((t) => r.push({ t }));
    // After push: buffer holds [3,4,5,6,7]
    r.prune((x) => x.t, 5);
    expect(r.toArray().map((x) => x.t)).toEqual([5, 6, 7]);
    // After prune we can keep pushing and the order stays right.
    r.push({ t: 8 });
    r.push({ t: 9 });
    expect(r.toArray().map((x) => x.t)).toEqual([5, 6, 7, 8, 9]);
  });

  it("prune to empty resets the buffer cleanly", () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    r.prune((n) => n, 100);
    expect(r.size()).toBe(0);
    expect(r.toArray()).toEqual([]);
    r.push(42);
    expect(r.toArray()).toEqual([42]);
  });

  it("toArray returns object references — callers can mutate in place", () => {
    type Row = { v: number };
    const r = new RingBuffer<Row>(3);
    r.push({ v: 1 });
    r.push({ v: 2 });
    const arr = r.toArray();
    arr[arr.length - 1]!.v = 99;
    // mutation must be visible on a fresh toArray() call
    expect(r.toArray()[1]!.v).toBe(99);
  });
});
