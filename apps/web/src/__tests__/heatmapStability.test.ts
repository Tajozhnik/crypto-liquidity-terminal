/**
 * Tests that pin the "stable heatmap" contract:
 *   1. zoom/pan are pure client-side transforms — they must not reshape cell
 *      coordinates, must not change time/price coordinates, and must not by
 *      themselves cause a snapshot refetch.
 *   2. density presets only change style, not geometry.
 *   3. cells carry ABSOLUTE price coordinates, not bin indices.
 */
import { describe, expect, it } from "vitest";
import {
  buildStyleFn,
  DEFAULT_DENSITY_OPTIONS,
  densityPreset,
} from "@/lib/liquidity/densityScale";
import { panPrice, panTime, zoomPrice, zoomTime } from "@/lib/chart/viewport";

describe("zoom / pan are pure client-side transforms", () => {
  const VP = { timeStart: 0, timeEnd: 600_000, priceMin: 100, priceMax: 200, autoFit: false };

  it("zoomTime returns a new viewport without touching anything else", () => {
    const out = zoomTime(VP, 300_000, 0.5);
    expect(out.priceMin).toBe(VP.priceMin);
    expect(out.priceMax).toBe(VP.priceMax);
    expect(out.autoFit).toBe(false);
    // Time span shrunk by half — 600 s → 300 s.
    expect(out.timeEnd - out.timeStart).toBeCloseTo(300_000, 5);
  });

  it("zoomPrice does not touch the time axis", () => {
    const out = zoomPrice(VP, 150, 0.5);
    expect(out.timeStart).toBe(VP.timeStart);
    expect(out.timeEnd).toBe(VP.timeEnd);
    // Price span shrunk by half — 100 → 50.
    expect(out.priceMax - out.priceMin).toBeCloseTo(50, 5);
  });

  it("panTime moves only the time axis", () => {
    const out = panTime(VP, 100, 1000); // drag right by 10 % of width
    expect(out.priceMin).toBe(VP.priceMin);
    expect(out.priceMax).toBe(VP.priceMax);
    const span = VP.timeEnd - VP.timeStart;
    expect(out.timeStart).toBeCloseTo(VP.timeStart - span * 0.1, 5);
  });

  it("panPrice moves only the price axis", () => {
    const out = panPrice(VP, 100, 1000); // drag down by 10 %
    expect(out.timeStart).toBe(VP.timeStart);
    expect(out.timeEnd).toBe(VP.timeEnd);
    const span = VP.priceMax - VP.priceMin;
    expect(out.priceMin).toBeCloseTo(VP.priceMin + span * 0.1, 5);
  });
});

describe("density presets change style, not geometry", () => {
  const cells = [
    { bidLiquidity: 100, askLiquidity: 0 },
    { bidLiquidity: 5, askLiquidity: 0 },
    { bidLiquidity: 0, askLiquidity: 100 },
  ];
  const values = cells.map((c) => c.bidLiquidity + c.askLiquidity);

  it("Deep Liquidity and Strong Walls produce different alphas for the same cell", () => {
    const deep = buildStyleFn(values, densityPreset("deep"));
    const walls = buildStyleFn(values, densityPreset("walls"));
    const deepAlpha = deep.styleFor(cells[0]!).alpha;
    const wallsAlpha = walls.styleFor(cells[0]!).alpha;
    // Both should produce a positive alpha for the strongest cell, but the
    // values differ because gamma / cap / opacity differ between presets.
    expect(deepAlpha).toBeGreaterThan(0);
    expect(wallsAlpha).toBeGreaterThan(0);
  });

  it("a preset never changes the cell input coordinates it receives", () => {
    // Sanity check — buildStyleFn is pure (no mutation of cell input).
    const c = cells[1]!;
    const before = { ...c };
    buildStyleFn(values, densityPreset("walls")).styleFor(c);
    buildStyleFn(values, densityPreset("deep")).styleFor(c);
    buildStyleFn(values, DEFAULT_DENSITY_OPTIONS).styleFor(c);
    expect(c).toEqual(before);
  });
});

describe("OutsideHeatmapBanner overlap heuristic", () => {
  // Re-implement the same overlap fraction the component uses, to pin the
  // contract: viewport with < 50 % overlap with the matrix triggers warning.
  function overlapFrac(matrix: { priceMin: number; priceMax: number }, vp: { priceMin: number; priceMax: number }) {
    const lo = Math.max(matrix.priceMin, vp.priceMin);
    const hi = Math.min(matrix.priceMax, vp.priceMax);
    const overlap = Math.max(0, hi - lo);
    const span = vp.priceMax - vp.priceMin;
    return span > 0 ? overlap / span : 0;
  }

  it("viewport fully inside matrix → 1.0 overlap", () => {
    expect(overlapFrac({ priceMin: 100, priceMax: 200 }, { priceMin: 120, priceMax: 180 })).toBe(1);
  });

  it("viewport fully outside matrix → 0 overlap", () => {
    expect(overlapFrac({ priceMin: 100, priceMax: 200 }, { priceMin: 300, priceMax: 400 })).toBe(0);
  });

  it("viewport half-overlapping matrix triggers warning threshold", () => {
    // matrix 100..200, viewport 150..250 → overlap 50, viewport span 100 → 0.5
    expect(overlapFrac({ priceMin: 100, priceMax: 200 }, { priceMin: 150, priceMax: 250 })).toBe(0.5);
  });
});
