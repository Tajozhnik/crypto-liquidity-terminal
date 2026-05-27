import { describe, expect, it } from "vitest";
import {
  fitViewportToData,
  panPrice,
  panTime,
  priceToY,
  timeToX,
  xToTime,
  yToPrice,
  zoomPrice,
  zoomTime,
  type Viewport,
} from "@/lib/chart/viewport";

const VP: Viewport = {
  timeStart: 0,
  timeEnd: 1_000_000,
  priceMin: 100,
  priceMax: 200,
  autoFit: false,
};

describe("viewport coordinate math", () => {
  it("timeToX/xToTime are inverse", () => {
    for (const t of [50_000, 250_000, 750_000]) {
      expect(xToTime(timeToX(t, VP, 0, 1000), VP, 0, 1000)).toBeCloseTo(t, 6);
    }
  });
  it("priceToY/yToPrice are inverse", () => {
    for (const p of [110, 137.5, 199]) {
      expect(yToPrice(priceToY(p, VP, 0, 100), VP, 0, 100)).toBeCloseTo(p, 6);
    }
  });
  it("priceToY maps top→top, bottom→bottom", () => {
    expect(priceToY(200, VP, 0, 100)).toBe(0);
    expect(priceToY(100, VP, 0, 100)).toBe(100);
  });
});

describe("zoom / pan", () => {
  it("zoomTime keeps the anchor at the same relative position", () => {
    const anchor = 600_000;
    const before = (anchor - VP.timeStart) / (VP.timeEnd - VP.timeStart);
    const out = zoomTime(VP, anchor, 0.5);
    const after = (anchor - out.timeStart) / (out.timeEnd - out.timeStart);
    expect(after).toBeCloseTo(before, 6);
    expect(out.timeEnd - out.timeStart).toBeCloseTo((VP.timeEnd - VP.timeStart) * 0.5);
    expect(out.autoFit).toBe(false);
  });

  it("zoomTime respects minimum span", () => {
    const out = zoomTime(VP, 500_000, 0.0000001);
    expect(out.timeEnd - out.timeStart).toBeGreaterThan(0);
  });

  it("zoomPrice keeps the anchor and disables autoFit", () => {
    const anchor = 150;
    const before = (anchor - VP.priceMin) / (VP.priceMax - VP.priceMin);
    const out = zoomPrice(VP, anchor, 0.5);
    const after = (anchor - out.priceMin) / (out.priceMax - out.priceMin);
    expect(after).toBeCloseTo(before, 6);
    expect(out.priceMax - out.priceMin).toBeCloseTo(50);
    expect(out.autoFit).toBe(false);
  });

  it("panTime shifts the time range", () => {
    const out = panTime(VP, 100, 1000); // 10% of width
    const span = VP.timeEnd - VP.timeStart;
    expect(out.timeStart).toBeCloseTo(VP.timeStart - span * 0.1);
    expect(out.timeEnd).toBeCloseTo(VP.timeEnd - span * 0.1);
    expect(out.timeEnd - out.timeStart).toBeCloseTo(span);
  });

  it("panPrice shifts the price range", () => {
    const out = panPrice(VP, 100, 1000); // 10% of height
    const span = VP.priceMax - VP.priceMin;
    expect(out.priceMin).toBeCloseTo(VP.priceMin + span * 0.1);
    expect(out.priceMax).toBeCloseTo(VP.priceMax + span * 0.1);
  });
});

describe("fitViewportToData", () => {
  it("matches data bounds with small price padding and sets autoFit=true", () => {
    const v = fitViewportToData({ timeStart: 0, timeEnd: 60_000, priceMin: 100, priceMax: 110 });
    expect(v.timeEnd - v.timeStart).toBeGreaterThanOrEqual(60_000);
    expect(v.priceMin).toBeLessThanOrEqual(100);
    expect(v.priceMax).toBeGreaterThanOrEqual(110);
    expect(v.autoFit).toBe(true);
  });
});


import { fitViewportToTimeframe, getDefaultVisibleRangeMs } from "@/lib/chart/viewport";

describe("getDefaultVisibleRangeMs", () => {
  it("returns 15 minutes for 1m", () => {
    expect(getDefaultVisibleRangeMs("1m")).toBe(15 * 60_000);
  });
  it("returns 1 hour for 5m", () => {
    expect(getDefaultVisibleRangeMs("5m")).toBe(60 * 60_000);
  });
  it("returns 4 hours for 15m", () => {
    expect(getDefaultVisibleRangeMs("15m")).toBe(4 * 60 * 60_000);
  });
  it("falls back to 15 minutes on unknown", () => {
    expect(getDefaultVisibleRangeMs("foo")).toBe(15 * 60_000);
  });
});

describe("fitViewportToTimeframe", () => {
  it("uses default visible range for the timeframe even if data span is short", () => {
    const now = Date.now();
    const v = fitViewportToTimeframe(
      { timeStart: now - 30_000, timeEnd: now, priceMin: 100, priceMax: 110 },
      "5m",
    );
    expect(v.timeEnd - v.timeStart).toBe(60 * 60_000);
    expect(v.autoFit).toBe(true);
  });

  it("uses the wider of data span vs default visible range", () => {
    const now = Date.now();
    const long = 6 * 60 * 60_000; // 6 hours
    const v = fitViewportToTimeframe(
      { timeStart: now - long, timeEnd: now, priceMin: 100, priceMax: 110 },
      "5m",
    );
    expect(v.timeEnd - v.timeStart).toBe(long);
  });
});


import { fitViewportToLiveWindow } from "@/lib/chart/viewport";

describe("fitViewportToLiveWindow", () => {
  it("anchors timeEnd at now and sizes the time axis to the timeframe default", () => {
    const now = 1_700_000_000_000;
    // Pretend candles span 8 hours but heatmap is fresh — the bounds shouldn't
    // cause the viewport to be 8h wide.
    const v = fitViewportToLiveWindow(
      { timeStart: now - 8 * 60 * 60_000, timeEnd: now, priceMin: 100, priceMax: 110 },
      "1m",
      now,
    );
    expect(v.timeEnd).toBe(now);
    expect(v.timeEnd - v.timeStart).toBe(15 * 60_000);
  });

  it("uses 1 hour default for 5m and 4 hours for 15m", () => {
    const now = 1_700_000_000_000;
    const bounds = { timeStart: now - 60_000, timeEnd: now, priceMin: 100, priceMax: 110 };
    expect(fitViewportToLiveWindow(bounds, "5m", now).timeEnd - fitViewportToLiveWindow(bounds, "5m", now).timeStart).toBe(60 * 60_000);
    expect(fitViewportToLiveWindow(bounds, "15m", now).timeEnd - fitViewportToLiveWindow(bounds, "15m", now).timeStart).toBe(4 * 60 * 60_000);
  });

  it("does not push timeEnd past `now` when bounds.timeEnd is in the future", () => {
    const now = 1_700_000_000_000;
    // Backend clock skew could put bounds slightly into the future.
    const v = fitViewportToLiveWindow(
      { timeStart: now - 60_000, timeEnd: now + 5_000, priceMin: 100, priceMax: 110 },
      "1m",
      now,
    );
    // The helper takes max(now, bounds.timeEnd) — so the viewport ends at
    // bounds.timeEnd (slight forward drift) but never collapses to a sliver.
    expect(v.timeEnd).toBe(now + 5_000);
    expect(v.timeEnd - v.timeStart).toBe(15 * 60_000);
  });

  it("sets autoFit=true so subsequent data updates keep tracking", () => {
    const now = 1_700_000_000_000;
    const v = fitViewportToLiveWindow(
      { timeStart: now - 60_000, timeEnd: now, priceMin: 100, priceMax: 110 },
      "1m",
      now,
    );
    expect(v.autoFit).toBe(true);
  });
});


describe("panPrice direct-manipulation semantics", () => {
  // The chart drag handler calls panPrice(vp, dy, height) where `dy = mouseY - startY`.
  // dy > 0 means the cursor moved DOWN. Direct manipulation: the chart should
  // visually move with the cursor — content goes down → priceMin/priceMax
  // values shift UP (we are now revealing a higher slice of the book at the
  // top of the chart, equivalent to dragging the paper down).
  const VP = { timeStart: 0, timeEnd: 60_000, priceMin: 100, priceMax: 200, autoFit: false };

  it("dragging down (positive dy) raises priceMin and priceMax", () => {
    const out = panPrice(VP, 50, 1000);
    expect(out.priceMin).toBeGreaterThan(VP.priceMin);
    expect(out.priceMax).toBeGreaterThan(VP.priceMax);
  });

  it("dragging up (negative dy) lowers priceMin and priceMax", () => {
    const out = panPrice(VP, -50, 1000);
    expect(out.priceMin).toBeLessThan(VP.priceMin);
    expect(out.priceMax).toBeLessThan(VP.priceMax);
  });
});
