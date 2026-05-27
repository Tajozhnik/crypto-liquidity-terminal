import { describe, expect, it } from "vitest";
import {
  calculateOrderBookImbalance,
  calculatePriceChange,
  calculateRangeBreakout,
  calculateSpread,
  calculateVolatility,
  normalizeScore,
} from "../metrics.js";

describe("calculatePriceChange", () => {
  it("computes percent change", () => {
    expect(calculatePriceChange(100, 110)).toBe(10);
    expect(calculatePriceChange(100, 90)).toBe(-10);
  });
  it("returns 0 on bad input", () => {
    expect(calculatePriceChange(0, 100)).toBe(0);
    expect(calculatePriceChange(NaN, 100)).toBe(0);
  });
});

describe("calculateSpread", () => {
  it("computes spread percent", () => {
    expect(calculateSpread(99, 101)).toBeCloseTo(2.0, 5);
  });
  it("returns 0 on bad input", () => {
    expect(calculateSpread(0, 100)).toBe(0);
  });
});

describe("calculateOrderBookImbalance", () => {
  it("returns 0 on empty book", () => {
    expect(calculateOrderBookImbalance([], [], 5)).toBe(0);
  });
  it("returns +1 when only bids", () => {
    expect(calculateOrderBookImbalance([[100, 5]], [], 5)).toBe(1);
  });
  it("returns -1 when only asks", () => {
    expect(calculateOrderBookImbalance([], [[100, 5]], 5)).toBe(-1);
  });
});

describe("calculateVolatility", () => {
  it("returns 0 for short series", () => {
    expect(calculateVolatility([])).toBe(0);
  });
});

describe("calculateRangeBreakout", () => {
  it("detects high breakout", () => {
    const klines = [
      { open: 100, high: 102, low: 99, close: 101, volume: 1, openTime: "", closeTime: "" },
      { open: 101, high: 103, low: 100, close: 102, volume: 1, openTime: "", closeTime: "" },
      { open: 102, high: 110, low: 101, close: 109, volume: 1, openTime: "", closeTime: "" },
    ];
    const r = calculateRangeBreakout(klines, 2);
    expect(r.brokeHigh).toBe(true);
  });
});

describe("normalizeScore", () => {
  it("clamps to [0, 100]", () => {
    expect(normalizeScore(-1, 0, 10)).toBe(0);
    expect(normalizeScore(11, 0, 10)).toBe(100);
    expect(normalizeScore(5, 0, 10)).toBe(50);
  });
});
