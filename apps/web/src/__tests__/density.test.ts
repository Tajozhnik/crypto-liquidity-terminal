import { describe, expect, it } from "vitest";
import {
  applyGamma,
  buildStyleFn,
  colorForSide,
  computeLiquidityStats,
  DEFAULT_DENSITY_OPTIONS,
  densityPreset,
  glowColorForSide,
  normalize,
  normalizeLog,
  normalizePercentile,
  normalizeRaw,
  normalizeZScore,
} from "@/lib/liquidity/densityScale";

describe("computeLiquidityStats", () => {
  it("returns zero stats for an empty input", () => {
    const s = computeLiquidityStats([]);
    expect(s.count).toBe(0);
    expect(s.max).toBe(0);
    expect(s.std).toBe(0);
  });

  it("ignores zero/negative values", () => {
    const s = computeLiquidityStats([0, -1, 5, 10, 20]);
    expect(s.count).toBe(3);
    expect(s.max).toBe(20);
  });

  it("p99 cap is below max when there is one outlier", () => {
    // 99 ones and one outlier — the cap percentile for default 0.99 lands on
    // a normal value, not the outlier.
    const values = Array.from({ length: 99 }, () => 1).concat([1_000_000]);
    const s = computeLiquidityStats(values, 0.99);
    expect(s.cap).toBeLessThan(s.max);
  });
});

describe("normalize functions", () => {
  const stats = computeLiquidityStats([1, 2, 3, 4, 5, 100], 0.99);

  it("normalizeRaw clamps at the cap", () => {
    expect(normalizeRaw(stats.cap, stats)).toBeCloseTo(1);
    expect(normalizeRaw(stats.cap * 10, stats)).toBe(1); // capped
    expect(normalizeRaw(0, stats)).toBe(0);
  });

  it("normalizeLog keeps weak values visible compared to raw", () => {
    expect(normalizeLog(2, stats)).toBeGreaterThan(normalizeRaw(2, stats));
  });

  it("normalizePercentile maps min→~0 and max→~1", () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(normalizePercentile(1, sorted)).toBeCloseTo(0.2);
    expect(normalizePercentile(5, sorted)).toBeCloseTo(1);
    expect(normalizePercentile(3, sorted)).toBeCloseTo(0.6);
  });

  it("normalizeZScore returns 0 for sub-z=0.5 values", () => {
    // mean ≈ 19.16, std ≈ 36.97 — value=20 → z≈0.02 → 0
    expect(normalizeZScore(20, stats)).toBe(0);
  });

  it("normalizeZScore highlights extreme outliers", () => {
    // value=100 → z≈2.18, lands in the 0.55..0.80 band
    const z = normalizeZScore(100, stats);
    expect(z).toBeGreaterThan(0.55);
    expect(z).toBeLessThan(0.85);
  });

  it("normalize dispatches by mode", () => {
    const sortedPositive = [1, 2, 3, 4, 5, 100].sort((a, b) => a - b);
    expect(normalize(2, "raw", stats, sortedPositive)).toBeGreaterThan(0);
    expect(normalize(2, "log", stats, sortedPositive)).toBeGreaterThan(0);
    expect(normalize(2, "percentile", stats, sortedPositive)).toBeGreaterThan(0);
    expect(normalize(2, "zscore", stats, sortedPositive)).toBe(0);
  });
});

describe("applyGamma", () => {
  it("gamma < 1 amplifies low values", () => {
    expect(applyGamma(0.1, 0.5)).toBeGreaterThan(0.1);
  });
  it("gamma > 1 attenuates low values", () => {
    expect(applyGamma(0.5, 2)).toBeLessThan(0.5);
  });
  it("clamps below 0 and above 1", () => {
    expect(applyGamma(-0.5, 0.5)).toBe(0);
    expect(applyGamma(2, 0.5)).toBe(1);
  });
});

describe("density presets", () => {
  it("deep preset uses zscore + glow + low gamma", () => {
    const p = densityPreset("deep");
    expect(p.mode).toBe("zscore");
    expect(p.glow).toBe(true);
    expect(p.gamma).toBeLessThan(0.7);
  });
  it("walls preset hides weak liquidity", () => {
    const p = densityPreset("walls");
    expect(p.hideWeakBelow).toBeGreaterThan(0.5);
    expect(p.strongOnlyAbove).toBeGreaterThan(0.5);
  });
  it("clean preset suppresses sub-noise without glow", () => {
    const p = densityPreset("clean");
    expect(p.glow).toBe(false);
    expect(p.hideWeakBelow).toBeGreaterThan(0);
  });
});

describe("buildStyleFn", () => {
  const values = [1, 2, 3, 4, 5, 100];

  it("transparent for empty cells", () => {
    const { styleFor } = buildStyleFn(values, DEFAULT_DENSITY_OPTIONS);
    expect(styleFor({ bidLiquidity: 0, askLiquidity: 0 }).alpha).toBe(0);
  });

  it("strong cells reach high alpha and isStrong=true", () => {
    const { styleFor } = buildStyleFn(values, { ...DEFAULT_DENSITY_OPTIONS, mode: "percentile", gamma: 1 });
    const s = styleFor({ bidLiquidity: 100, askLiquidity: 0 });
    expect(s.isStrong).toBe(true);
    expect(s.alpha).toBeGreaterThan(0.7);
    expect(s.side).toBe("bid");
  });

  it("hideWeakBelow drops sub-threshold cells entirely", () => {
    const { styleFor } = buildStyleFn(values, {
      ...DEFAULT_DENSITY_OPTIONS,
      mode: "percentile",
      hideWeakBelow: 0.9,
    });
    const weak = styleFor({ bidLiquidity: 1, askLiquidity: 0 });
    expect(weak.alpha).toBe(0);
  });

  it("strongOnlyAbove keeps only top cells", () => {
    const { styleFor } = buildStyleFn(values, {
      ...DEFAULT_DENSITY_OPTIONS,
      mode: "percentile",
      strongOnlyAbove: 0.9,
    });
    expect(styleFor({ bidLiquidity: 1, askLiquidity: 0 }).alpha).toBe(0);
    expect(styleFor({ bidLiquidity: 100, askLiquidity: 0 }).alpha).toBeGreaterThan(0);
  });

  it("classifies side by 60/40 share", () => {
    const { styleFor } = buildStyleFn(values, { ...DEFAULT_DENSITY_OPTIONS, mode: "raw" });
    expect(styleFor({ bidLiquidity: 80, askLiquidity: 20 }).side).toBe("bid");
    expect(styleFor({ bidLiquidity: 20, askLiquidity: 80 }).side).toBe("ask");
    expect(styleFor({ bidLiquidity: 50, askLiquidity: 50 }).side).toBe("balanced");
  });
});

describe("colour helpers", () => {
  it("returns distinct rgba strings per side", () => {
    expect(colorForSide("bid", 1)).not.toBe(colorForSide("ask", 1));
    expect(colorForSide("bid", 1)).not.toBe(colorForSide("balanced", 1));
  });

  it("glow alpha is capped at 0.35 to avoid burnout", () => {
    expect(glowColorForSide("bid", 1)).toContain("0.350");
    expect(glowColorForSide("ask", 0.1)).toContain("0.100");
  });

  it("alpha is rendered with 3 decimals", () => {
    expect(colorForSide("bid", 0.123456)).toContain("0.123");
  });
});
