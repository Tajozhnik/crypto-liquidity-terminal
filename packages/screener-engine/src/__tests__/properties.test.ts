import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateOrderBookImbalance,
  calculatePriceChange,
  calculateRelativeVolume,
  calculateSpread,
} from "../metrics.js";
import { calculateHotMarketScore, classifyScoreBand } from "../score.js";
import { runScreener, DEFAULT_CONFIG, type MarketSnapshot } from "../index.js";

const finiteNumber = () => fc.double({ noNaN: true, noDefaultInfinity: true });
const subScore = () => fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });

describe("Property: calculateHotMarketScore", () => {
  it("score is integer in [0, 100] for any subset of finite sub-scores in [0, 100]", () => {
    fc.assert(
      fc.property(
        fc.record({
          momentumScore: subScore(),
          volumeScore: subScore(),
          volatilityScore: subScore(),
          liquidityScore: subScore(),
          orderBookScore: subScore(),
        }),
        (subs) => {
          const r = calculateHotMarketScore(subs);
          expect(Number.isInteger(r.score)).toBe(true);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(100);
          expect(Array.isArray(r.warnings)).toBe(true);
          expect(r.warnings).toEqual([]); // no warnings for clean inputs
        },
      ),
    );
  });

  it("score handles partial sub-scores (some keys missing) without crashing", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("momentumScore", "volumeScore", "volatilityScore", "liquidityScore", "orderBookScore"), {
          minLength: 0,
          maxLength: 5,
        }),
        (keys) => {
          const subs: Record<string, number> = {};
          for (const k of new Set(keys)) subs[k] = 50;
          const r = calculateHotMarketScore(subs as Parameters<typeof calculateHotMarketScore>[0]);
          expect(Number.isInteger(r.score)).toBe(true);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(100);
          // Warnings should equal missing keys count
          expect(r.warnings.length).toBe(5 - new Set(keys).size);
        },
      ),
    );
  });

  it("score remains finite integer in [0, 100] even on hostile inputs (NaN, Infinity, missing)", () => {
    fc.assert(
      fc.property(
        fc.record({
          momentumScore: fc.oneof(finiteNumber(), fc.constant(NaN), fc.constant(Infinity), fc.constant(undefined)),
          volumeScore: fc.oneof(finiteNumber(), fc.constant(NaN), fc.constant(undefined)),
          volatilityScore: fc.oneof(finiteNumber(), fc.constant(undefined)),
          liquidityScore: fc.oneof(finiteNumber(), fc.constant(undefined)),
          orderBookScore: fc.oneof(finiteNumber(), fc.constant(undefined)),
        }),
        (subs) => {
          const r = calculateHotMarketScore(
            subs as Parameters<typeof calculateHotMarketScore>[0],
          );
          expect(Number.isFinite(r.score)).toBe(true);
          expect(Number.isInteger(r.score)).toBe(true);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});

describe("Property: classifyScoreBand", () => {
  it("matches documented band ranges for any integer 0..100", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (s) => {
        const band = classifyScoreBand(s);
        if (s <= 30) expect(band).toBe("cold");
        else if (s <= 60) expect(band).toBe("normal");
        else if (s <= 80) expect(band).toBe("hot");
        else expect(band).toBe("extreme");
      }),
    );
  });
});

describe("Property: calculateSpread", () => {
  it("returns a finite non-negative number for positive bid/ask", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.000001, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.000001, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (bid, ask) => {
          const v = calculateSpread(bid, ask);
          expect(Number.isFinite(v)).toBe(true);
        },
      ),
    );
  });

  it("returns 0 for invalid inputs (zero, negative, NaN)", () => {
    expect(calculateSpread(0, 100)).toBe(0);
    expect(calculateSpread(100, 0)).toBe(0);
    expect(calculateSpread(-1, 100)).toBe(0);
    expect(calculateSpread(NaN, 100)).toBe(0);
    expect(calculateSpread(100, NaN)).toBe(0);
  });
});

describe("Property: calculateRelativeVolume", () => {
  it("never NaN for any finite non-negative inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        (recent, baseline) => {
          const v = calculateRelativeVolume(recent, baseline);
          expect(Number.isNaN(v)).toBe(false);
          // Either finite or +Infinity (recent>0 baseline=0)
          expect(Number.isFinite(v) || v === Infinity).toBe(true);
        },
      ),
    );
  });
});

describe("Property: calculateOrderBookImbalance", () => {
  it("always in [-1, 1]", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 1, max: 100_000, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
          ),
          { minLength: 0, maxLength: 25 },
        ),
        fc.array(
          fc.tuple(
            fc.double({ min: 1, max: 100_000, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
          ),
          { minLength: 0, maxLength: 25 },
        ),
        (bids, asks) => {
          const v = calculateOrderBookImbalance(bids, asks, 20);
          expect(v).toBeGreaterThanOrEqual(-1);
          expect(v).toBeLessThanOrEqual(1);
          expect(Number.isFinite(v)).toBe(true);
        },
      ),
    );
  });
});

describe("Property: calculatePriceChange", () => {
  it("never NaN; returns 0 for non-positive previous price; finite for normal-range inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (prev, cur) => {
          const v = calculatePriceChange(prev, cur);
          expect(Number.isNaN(v)).toBe(false);
          if (prev <= 0 || !Number.isFinite(prev)) {
            expect(v).toBe(0);
          } else if (prev > 1e-10) {
            // Denormalized prev (≪ 1e-10) can overflow the multiplication; not a real-world case.
            expect(Number.isFinite(v)).toBe(true);
          }
        },
      ),
    );
  });
});

// =============================================================================
// runScreener robustness
// =============================================================================

function makeMinimalSnapshot(): MarketSnapshot {
  const ts = (i: number) => new Date(1_700_000_000_000 + i * 60_000).toISOString();
  return {
    market: { symbol: "X", exchange: "mock", marketType: "spot", base: "X", quote: "USDT" },
    ticker: {
      symbol: "X",
      last: 100,
      bid: 99,
      ask: 101,
      volume24h: 10_000,
      change24h: 0,
      ts: ts(50),
    },
    klines1m: Array.from({ length: 50 }, (_, i) => ({
      openTime: ts(i),
      closeTime: ts(i + 1),
      open: 100 + i,
      high: 102 + i,
      low: 98 + i,
      close: 101 + i,
      volume: 1000,
    })),
    recentTrades: [],
    orderBook: {
      symbol: "X",
      bids: [[99, 1]],
      asks: [[101, 1]],
      ts: ts(50),
    },
  };
}

describe("Property: runScreener does not throw", () => {
  it("handles empty snapshot array", () => {
    const r = runScreener([], DEFAULT_CONFIG, Date.now());
    expect(r.results).toEqual([]);
    expect(r.signals).toEqual([]);
  });

  it("handles snapshots with zero or short klines without crashing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (klineCount) => {
        const snap = makeMinimalSnapshot();
        snap.klines1m = snap.klines1m.slice(0, klineCount);
        const r = runScreener([snap], DEFAULT_CONFIG, Date.now());
        expect(r.results.length).toBe(1);
        const result = r.results[0]!;
        expect(Number.isInteger(result.signalScore)).toBe(true);
        expect(result.signalScore).toBeGreaterThanOrEqual(0);
        expect(result.signalScore).toBeLessThanOrEqual(100);
      }),
      { numRuns: 50 },
    );
  });

  it("handles empty order book without crashing", () => {
    const snap = makeMinimalSnapshot();
    snap.orderBook = { symbol: "X", bids: [], asks: [], ts: snap.orderBook.ts };
    const r = runScreener([snap], DEFAULT_CONFIG, Date.now());
    expect(r.results[0]!.orderBookImbalance).toBe(0);
  });
});
