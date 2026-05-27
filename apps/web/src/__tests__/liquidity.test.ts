import { describe, expect, it } from "vitest";
import { findCellAt, timeframeMs } from "@/lib/liquidity/binning";
import {
  priceToY,
  timeToX,
  xToTime,
  yToPrice,
} from "@/lib/liquidity/chartMath";
import { applyIntensity, colorForCell } from "@/lib/liquidity/heatmapColor";

describe("chartMath", () => {
  const ps = { priceMin: 100, priceMax: 200, yTop: 0, yBottom: 100 };
  const ts = { timeMin: 0, timeMax: 1000, xLeft: 0, xRight: 100 };
  it("priceToY maps top of range to top, bottom to bottom", () => {
    expect(priceToY(200, ps)).toBe(0);
    expect(priceToY(100, ps)).toBe(100);
    expect(priceToY(150, ps)).toBe(50);
  });
  it("yToPrice is inverse of priceToY", () => {
    for (const p of [110, 137, 199]) {
      expect(yToPrice(priceToY(p, ps), ps)).toBeCloseTo(p, 6);
    }
  });
  it("timeToX maps endpoints", () => {
    expect(timeToX(0, ts)).toBe(0);
    expect(timeToX(1000, ts)).toBe(100);
    expect(timeToX(500, ts)).toBe(50);
  });
  it("xToTime is inverse of timeToX", () => {
    for (const t of [50, 250, 750]) {
      expect(xToTime(timeToX(t, ts), ts)).toBeCloseTo(t, 6);
    }
  });
});

describe("binning helpers", () => {
  it("timeframeMs covers known frames", () => {
    expect(timeframeMs("1m")).toBe(60_000);
    expect(timeframeMs("5m")).toBe(300_000);
    expect(timeframeMs("15m")).toBe(900_000);
    expect(timeframeMs("unknown")).toBe(60_000);
  });
  it("findCellAt locates a cell by (t, price)", () => {
    const cells = [
      { t: 60_000, price: 100, bidLiquidity: 5, askLiquidity: 0, totalLiquidity: 5, intensity: 1 },
      { t: 60_000, price: 110, bidLiquidity: 0, askLiquidity: 7, totalLiquidity: 7, intensity: 0.7 },
    ];
    const hit = findCellAt(cells, 60_500, 105, 10, 60_000);
    expect(hit?.price).toBe(100);
  });
  it("findCellAt returns null when no match", () => {
    expect(findCellAt([], 0, 0, 1, 60_000)).toBeNull();
  });
});

describe("heatmapColor", () => {
  it("applyIntensity is monotonic and clamped", () => {
    const a = applyIntensity(0.1, { intensityMultiplier: 1, logScale: false, sideMode: "combined" });
    const b = applyIntensity(0.5, { intensityMultiplier: 1, logScale: false, sideMode: "combined" });
    const c = applyIntensity(2, { intensityMultiplier: 1, logScale: false, sideMode: "combined" });
    expect(b).toBeGreaterThan(a);
    expect(c).toBeLessThanOrEqual(1);
  });
  it("colorForCell returns transparent on empty cell", () => {
    expect(
      colorForCell({ bidLiquidity: 0, askLiquidity: 0, intensity: 0 }, {
        intensityMultiplier: 1,
        logScale: false,
        sideMode: "combined",
      }),
    ).toBe("rgba(0,0,0,0)");
  });
  it("colorForCell bids-only returns transparent on ask-dominant cell when sideMode=bids", () => {
    expect(
      colorForCell({ bidLiquidity: 0, askLiquidity: 10, intensity: 1 }, {
        intensityMultiplier: 1,
        logScale: false,
        sideMode: "bids",
      }),
    ).toBe("rgba(0,0,0,0)");
  });
  it("colorForCell combined returns rgba string on non-empty cell", () => {
    const r = colorForCell({ bidLiquidity: 5, askLiquidity: 5, intensity: 0.5 }, {
      intensityMultiplier: 1,
      logScale: false,
      sideMode: "combined",
    });
    expect(r.startsWith("rgba(")).toBe(true);
  });
});

describe("canvas renderer (smoke)", () => {
  it("does not throw when rendering empty heatmap", async () => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom 2D ctx may be unavailable; skip in that case
    const { renderHeatmap } = await import("@/lib/liquidity/canvasRenderer");
    expect(() =>
      renderHeatmap(ctx, [], {
        priceScale: { priceMin: 1, priceMax: 2, yTop: 0, yBottom: 100 },
        timeScale: { timeMin: 0, timeMax: 1000, xLeft: 0, xRight: 100 },
        binWidth: 0.01,
        timeBucketMs: 60_000,
        colorOpts: { intensityMultiplier: 1, logScale: false, sideMode: "combined" },
      }),
    ).not.toThrow();
  });
});


import type { BackendHeatmapCell } from "@/lib/liquidity/binning";

describe("canvas renderer multi-cell", () => {
  it("draws a non-zero number of fillRect calls when many cells are provided", async () => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let calls = 0;
    const orig = ctx.fillRect.bind(ctx);
    ctx.fillRect = ((...args: Parameters<typeof orig>) => {
      calls++;
      return orig(...args);
    }) as typeof ctx.fillRect;

    const cells: BackendHeatmapCell[] = [];
    for (let i = 0; i < 30; i++) {
      cells.push({
        t: i * 60_000,
        price: 100 + i * 0.5,
        bidLiquidity: 5,
        askLiquidity: 1,
        totalLiquidity: 6,
        intensity: 0.6,
      });
    }
    const { renderHeatmap } = await import("@/lib/liquidity/canvasRenderer");
    renderHeatmap(ctx, cells, {
      priceScale: { priceMin: 99, priceMax: 120, yTop: 0, yBottom: 200 },
      timeScale: { timeMin: 0, timeMax: 30 * 60_000, xLeft: 0, xRight: 200 },
      binWidth: 0.5,
      timeBucketMs: 60_000,
      colorOpts: { intensityMultiplier: 1, logScale: false, sideMode: "combined" },
    });
    expect(calls).toBeGreaterThanOrEqual(20);
  });
});

import { priceToY as priceToY2 } from "@/lib/liquidity/chartMath";

describe("priceToY produces distinct Y values for distinct prices", () => {
  it("maps 30 distinct prices to 30 distinct Y values", () => {
    const ps = { priceMin: 100, priceMax: 200, yTop: 0, yBottom: 100 };
    const ys = new Set<number>();
    for (let i = 0; i < 30; i++) ys.add(priceToY2(100 + i * 3, ps));
    expect(ys.size).toBe(30);
  });
});
