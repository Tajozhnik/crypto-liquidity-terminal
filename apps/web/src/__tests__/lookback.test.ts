import { describe, expect, it } from "vitest";
import {
  HEATMAP_LOOKBACK_OPTIONS,
  defaultLookbackForTimeframe,
  lookbackToQuery,
  lookbackToVisibleRangeMs,
} from "@/lib/liquidity/lookback";

describe("HEATMAP_LOOKBACK_OPTIONS", () => {
  it("includes Max in the selector list", () => {
    const ids = HEATMAP_LOOKBACK_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(["15m", "30m", "1h", "2h", "4h", "max"]);
  });
});

describe("defaultLookbackForTimeframe", () => {
  it("returns 30m for 1m timeframe", () => {
    expect(defaultLookbackForTimeframe("1m")).toBe("30m");
  });
  it("returns 1h for 5m timeframe", () => {
    expect(defaultLookbackForTimeframe("5m")).toBe("1h");
  });
  it("returns 4h for 15m timeframe", () => {
    expect(defaultLookbackForTimeframe("15m")).toBe("4h");
  });
  it("falls back to 30m for unknown timeframe", () => {
    expect(defaultLookbackForTimeframe("bogus")).toBe("30m");
  });
});

describe("lookbackToQuery", () => {
  it("max becomes lookback=max with no minutes", () => {
    expect(lookbackToQuery("max")).toEqual({ lookback: "max" });
  });
  it("fixed values become lookbackMinutes integers", () => {
    expect(lookbackToQuery("15m")).toEqual({ lookbackMinutes: 15 });
    expect(lookbackToQuery("30m")).toEqual({ lookbackMinutes: 30 });
    expect(lookbackToQuery("1h")).toEqual({ lookbackMinutes: 60 });
    expect(lookbackToQuery("2h")).toEqual({ lookbackMinutes: 120 });
    expect(lookbackToQuery("4h")).toEqual({ lookbackMinutes: 240 });
  });
});

describe("lookbackToVisibleRangeMs", () => {
  it("max returns availableHistoryMs when > 0", () => {
    expect(lookbackToVisibleRangeMs("max", 1_800_000, 60_000)).toBe(1_800_000);
  });
  it("max falls back when no history yet", () => {
    expect(lookbackToVisibleRangeMs("max", 0, 60_000)).toBe(60_000);
  });
  it("fixed values map to their explicit ranges", () => {
    expect(lookbackToVisibleRangeMs("15m", 0, 0)).toBe(15 * 60_000);
    expect(lookbackToVisibleRangeMs("30m", 0, 0)).toBe(30 * 60_000);
    expect(lookbackToVisibleRangeMs("1h", 0, 0)).toBe(60 * 60_000);
    expect(lookbackToVisibleRangeMs("2h", 0, 0)).toBe(2 * 60 * 60_000);
    expect(lookbackToVisibleRangeMs("4h", 0, 0)).toBe(4 * 60 * 60_000);
  });
});
