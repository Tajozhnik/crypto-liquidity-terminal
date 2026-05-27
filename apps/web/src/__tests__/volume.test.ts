import { describe, expect, it } from "vitest";
import {
  buildDeltaBars,
  buildVolumeBars,
  renderDeltaBars,
  renderVolumeBars,
  timeframeToMs,
  type VolumeLayout,
} from "@/lib/liquidity/volumeRenderer";
import type { Viewport } from "@/lib/chart/viewport";

const layout: VolumeLayout = { xLeft: 0, xRight: 1000, yTop: 0, yBottom: 100 };

function vpFor(timeStart: number, timeEnd: number): Viewport {
  return { timeStart, timeEnd, priceMin: 0, priceMax: 1, autoFit: false };
}

describe("timeframeToMs", () => {
  it("maps each known timeframe to milliseconds", () => {
    expect(timeframeToMs("1m")).toBe(60_000);
    expect(timeframeToMs("5m")).toBe(300_000);
    expect(timeframeToMs("15m")).toBe(900_000);
  });

  it("falls back to 1m for unknown timeframe", () => {
    expect(timeframeToMs("bogus")).toBe(60_000);
  });
});

describe("buildVolumeBars", () => {
  const t0 = 1_700_000_000_000;
  const candles = [
    { t: t0, open: 100, close: 110, volume: 5 }, // up
    { t: t0 + 60_000, open: 110, close: 105, volume: 10 }, // down — max
    { t: t0 + 120_000, open: 105, close: 108, volume: 2 }, // up
  ];

  it("returns one bar per candle", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    expect(bars).toHaveLength(3);
  });

  it("bar width is the candle body width (slot × CANDLE_BODY_FRAC)", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    // 3 candles span the full 1000-px viewport → slot width ≈ 333 px.
    // Bar width matches the candle BODY = slot × 0.7 ≈ 233 px so it sits
    // exactly under the candle body (not the full slot).
    expect(bars[0]!.width).toBeGreaterThan(220);
    expect(bars[0]!.width).toBeLessThan(245);
    // All bars have identical width — same bucket, same body fraction.
    expect(bars[1]!.width).toBeCloseTo(bars[0]!.width, 5);
  });

  it("bar is centred under the candle body, not aligned to the slot left edge", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    // First candle's slot is [0, 333.33] → body starts at slot + (slot - body)/2.
    // body = slot × 0.7 → inset = slot × 0.15 = 50 px → bar.x ≈ 50.
    expect(bars[0]!.x).toBeGreaterThan(40);
    expect(bars[0]!.x).toBeLessThan(60);
  });

  it("scales bar height by max volume", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    const panelH = layout.yBottom - layout.yTop;
    // Max-volume candle (10) fills the panel.
    expect(bars[1]!.height).toBeCloseTo(panelH, 5);
    // 5/10 of panel.
    expect(bars[0]!.height).toBeCloseTo(panelH * 0.5, 5);
    // 2/10 of panel.
    expect(bars[2]!.height).toBeCloseTo(panelH * 0.2, 5);
  });

  it("colors bars green when close >= open and red otherwise", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    expect(bars[0]!.direction).toBe("up");
    expect(bars[1]!.direction).toBe("down");
    expect(bars[2]!.direction).toBe("up");
    expect(bars[0]!.color).toContain("120,210,140"); // green-ish
    expect(bars[1]!.color).toContain("220,90,100"); // red-ish
  });

  it("returns empty array for no candles", () => {
    expect(buildVolumeBars([], vpFor(t0, t0 + 60_000), layout, 60_000)).toEqual([]);
  });

  it("widens bars when viewport zooms in to one candle", () => {
    const vpZoom = vpFor(t0, t0 + 60_000); // viewport spans exactly one bucket
    const single = candles[0]!;
    const barsZoom = buildVolumeBars([single], vpZoom, layout, 60_000);
    // Slot covers full width (1000 px); bar width = body fraction = 700 px.
    expect(barsZoom[0]!.width).toBeGreaterThan(650);
    expect(barsZoom[0]!.width).toBeLessThan(720);
  });
});

describe("buildDeltaBars", () => {
  const t0 = 1_700_000_000_000;
  const buckets = [
    { t: t0, buyVolume: 5, sellVolume: 1, delta: 4, cumulativeDelta: 4 }, // positive
    { t: t0 + 60_000, buyVolume: 1, sellVolume: 9, delta: -8, cumulativeDelta: -4 }, // negative — max abs
    { t: t0 + 120_000, buyVolume: 3, sellVolume: 2, delta: 1, cumulativeDelta: -3 }, // positive
  ];

  it("returns one bar per bucket with the right sign", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildDeltaBars(buckets, vp, layout, 60_000);
    expect(bars).toHaveLength(3);
    expect(bars[0]!.sign).toBe("positive");
    expect(bars[1]!.sign).toBe("negative");
    expect(bars[2]!.sign).toBe("positive");
  });

  it("places positive bars above the centered baseline", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildDeltaBars(buckets, vp, layout, 60_000);
    const panelH = layout.yBottom - layout.yTop;
    const baseline = layout.yTop + panelH / 2;
    // Positive bar sits above baseline — its bottom edge is at baseline.
    expect(bars[0]!.y + bars[0]!.height).toBeCloseTo(baseline, 5);
    // Negative bar starts at baseline and extends downward.
    expect(bars[1]!.y).toBeCloseTo(baseline, 5);
  });

  it("scales bars by max |delta|", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildDeltaBars(buckets, vp, layout, 60_000);
    const halfPanel = (layout.yBottom - layout.yTop) / 2;
    expect(bars[1]!.height).toBeCloseTo(halfPanel, 5); // max |delta|=8 fills half
    expect(bars[0]!.height).toBeCloseTo(halfPanel * (4 / 8), 5);
    expect(bars[2]!.height).toBeCloseTo(halfPanel * (1 / 8), 5);
  });

  it("returns empty array for no buckets", () => {
    expect(buildDeltaBars([], vpFor(t0, t0 + 60_000), layout, 60_000)).toEqual([]);
  });
});

describe("renderers do not draw a single full-width rectangle", () => {
  // Stub canvas context that records every fillRect call so we can assert
  // multiple distinct rectangles are drawn rather than one solid strip.
  function createStubCtx() {
    const fillRectCalls: { x: number; y: number; w: number; h: number }[] = [];
    let currentFillStyle = "";
    const ctx = {
      get fillStyle() {
        return currentFillStyle;
      },
      set fillStyle(v: string) {
        currentFillStyle = v;
      },
      strokeStyle: "",
      lineWidth: 1,
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h });
      },
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, fillRectCalls };
  }

  const t0 = 1_700_000_000_000;

  it("renderVolumeBars draws one rect per candle, none spanning full width", () => {
    const candles = [
      { t: t0, open: 100, close: 110, volume: 5 },
      { t: t0 + 60_000, open: 110, close: 105, volume: 10 },
      { t: t0 + 120_000, open: 105, close: 108, volume: 2 },
    ];
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildVolumeBars(candles, vp, layout, 60_000);
    const { ctx, fillRectCalls } = createStubCtx();
    renderVolumeBars(ctx, bars, layout);
    expect(fillRectCalls).toHaveLength(3);
    const fullWidth = layout.xRight - layout.xLeft;
    for (const call of fillRectCalls) {
      expect(call.w).toBeLessThan(fullWidth);
    }
  });

  it("renderDeltaBars draws one rect per bucket, none spanning full width", () => {
    const buckets = [
      { t: t0, delta: 4, cumulativeDelta: 4 },
      { t: t0 + 60_000, delta: -8, cumulativeDelta: -4 },
      { t: t0 + 120_000, delta: 1, cumulativeDelta: -3 },
    ];
    const vp = vpFor(t0, t0 + 180_000);
    const bars = buildDeltaBars(buckets, vp, layout, 60_000);
    const { ctx, fillRectCalls } = createStubCtx();
    renderDeltaBars(ctx, bars, buckets, vp, layout, 60_000);
    expect(fillRectCalls).toHaveLength(3);
    const fullWidth = layout.xRight - layout.xLeft;
    for (const call of fillRectCalls) {
      expect(call.w).toBeLessThan(fullWidth);
    }
  });
});


import { computeCandleSlot, getPlotArea, CANDLE_BODY_FRAC } from "@/lib/liquidity/plotLayout";

describe("candle ↔ volume bar alignment (shared plotLayout)", () => {
  const t0 = 1_700_000_000_000;

  it("buildVolumeBars produces the SAME body x/width as computeCandleSlot", () => {
    const candles = [
      { t: t0, open: 100, close: 110, volume: 5 },
      { t: t0 + 60_000, open: 110, close: 105, volume: 10 },
      { t: t0 + 120_000, open: 105, close: 108, volume: 2 },
    ];
    const vp = vpFor(t0, t0 + 180_000);
    const plot = getPlotArea(1100); // canvas width 1100 → xLeft 4, xRight 1040
    const sharedLayout: VolumeLayout = {
      xLeft: plot.xLeft,
      xRight: plot.xRight,
      yTop: 0,
      yBottom: 100,
    };
    const bars = buildVolumeBars(candles, vp, sharedLayout, 60_000);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const slot = computeCandleSlot(c.t, c.t + 60_000, vp, plot);
      const bar = bars[i]!;
      // The volume bar must match the candle body geometry pixel-for-pixel.
      expect(bar.x).toBeCloseTo(slot.bodyX, 5);
      expect(bar.width).toBeCloseTo(slot.bodyW, 5);
    }
  });

  it("delta bars match the candle body geometry too", () => {
    const buckets = [
      { t: t0, delta: 4, cumulativeDelta: 4 },
      { t: t0 + 60_000, delta: -8, cumulativeDelta: -4 },
      { t: t0 + 120_000, delta: 1, cumulativeDelta: -3 },
    ];
    const vp = vpFor(t0, t0 + 180_000);
    const plot = getPlotArea(1100);
    const sharedLayout: VolumeLayout = {
      xLeft: plot.xLeft,
      xRight: plot.xRight,
      yTop: 0,
      yBottom: 100,
    };
    const bars = buildDeltaBars(buckets, vp, sharedLayout, 60_000);
    for (let i = 0; i < buckets.length; i++) {
      const slot = computeCandleSlot(buckets[i]!.t, buckets[i]!.t + 60_000, vp, plot);
      expect(bars[i]!.x).toBeCloseTo(slot.bodyX, 5);
      expect(bars[i]!.width).toBeCloseTo(slot.bodyW, 5);
    }
  });

  it("clips a partially-visible candle bar to the plot area", () => {
    // The first candle is at viewport's left edge, half off-screen to the left.
    const vp = vpFor(t0 + 30_000, t0 + 180_000); // start half-way through candle 0
    const candles = [
      { t: t0, open: 100, close: 110, volume: 5 },
      { t: t0 + 60_000, open: 110, close: 105, volume: 10 },
    ];
    const plot = getPlotArea(1000);
    const layoutClip: VolumeLayout = { xLeft: plot.xLeft, xRight: plot.xRight, yTop: 0, yBottom: 100 };
    const bars = buildVolumeBars(candles, vp, layoutClip, 60_000);
    // Candle 0 stays in the matrix because closeTime > viewport.timeStart;
    // its x is clamped to plot.xLeft and its right edge is the body edge.
    const first = bars.find((b) => b.x === plot.xLeft);
    expect(first).toBeDefined();
    expect(first!.x + first!.width).toBeLessThanOrEqual(plot.xRight + 0.001);
    expect(first!.width).toBeGreaterThan(0);
  });

  it("bar width never exceeds the candle slot width", () => {
    const vp = vpFor(t0, t0 + 180_000);
    const candles = [
      { t: t0, open: 100, close: 110, volume: 5 },
      { t: t0 + 60_000, open: 110, close: 105, volume: 10 },
    ];
    const plot = getPlotArea(1000);
    const lay: VolumeLayout = { xLeft: plot.xLeft, xRight: plot.xRight, yTop: 0, yBottom: 100 };
    const bars = buildVolumeBars(candles, vp, lay, 60_000);
    for (const c of candles) {
      const slot = computeCandleSlot(c.t, c.t + 60_000, vp, plot);
      const bar = bars.find((b) => Math.abs(b.x - slot.bodyX) < 1)!;
      expect(bar.width).toBeLessThanOrEqual(slot.slotW + 0.001);
    }
  });

  it("uses real openTime → closeTime, not timeframeMs label", () => {
    // Two candles with EXPLICIT closeTime that does not equal t + 60_000.
    // The bar width should follow the explicit close, not 60s.
    const vp = vpFor(t0, t0 + 200_000);
    const c0 = { t: t0, closeTime: t0 + 30_000, open: 100, close: 110, volume: 5 };
    const c1 = { t: t0 + 30_000, closeTime: t0 + 200_000, open: 110, close: 105, volume: 10 };
    const plot = getPlotArea(1000);
    const lay: VolumeLayout = { xLeft: plot.xLeft, xRight: plot.xRight, yTop: 0, yBottom: 100 };
    const bars = buildVolumeBars([c0, c1], vp, lay, 60_000); // candleMs hint is ignored when closeTime is explicit
    // c1 is much wider than c0.
    expect(bars[1]!.width).toBeGreaterThan(bars[0]!.width * 3);
  });

  it("CANDLE_BODY_FRAC is the documented 70 % constant", () => {
    expect(CANDLE_BODY_FRAC).toBeCloseTo(0.7, 5);
  });
});
