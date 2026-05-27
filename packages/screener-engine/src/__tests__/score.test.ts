import { describe, expect, it } from "vitest";
import { calculateHotMarketScore, classifyScoreBand } from "../score.js";

describe("calculateHotMarketScore", () => {
  it("returns integer 0..100 with empty warnings on full input", () => {
    const r = calculateHotMarketScore({
      momentumScore: 50,
      volumeScore: 50,
      volatilityScore: 50,
      liquidityScore: 50,
      orderBookScore: 50,
    });
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBe(50);
    expect(r.warnings).toEqual([]);
  });

  it("clamps and warns on out-of-range sub-score", () => {
    const r = calculateHotMarketScore({
      momentumScore: 200,
      volumeScore: 0,
      volatilityScore: 0,
      liquidityScore: 0,
      orderBookScore: 0,
    });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("substitutes 0 and warns on missing sub-score", () => {
    const r = calculateHotMarketScore({ momentumScore: 100 });
    expect(r.warnings.length).toBe(4);
    // 100*0.25 = 25
    expect(r.score).toBe(25);
  });

  it("rounds half-up to integer", () => {
    // weighted = 50.5
    const r = calculateHotMarketScore({
      momentumScore: 50.5,
      volumeScore: 50.5,
      volatilityScore: 50.5,
      liquidityScore: 50.5,
      orderBookScore: 50.5,
    });
    expect(r.score).toBe(51);
  });

  it("never returns NaN or non-finite even on hostile input", () => {
    const r = calculateHotMarketScore({
      momentumScore: NaN,
      volumeScore: Infinity,
      volatilityScore: -Infinity,
      liquidityScore: undefined as never,
      orderBookScore: "x" as never,
    });
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("classifyScoreBand", () => {
  it("maps band boundaries correctly", () => {
    expect(classifyScoreBand(0)).toBe("cold");
    expect(classifyScoreBand(30)).toBe("cold");
    expect(classifyScoreBand(31)).toBe("normal");
    expect(classifyScoreBand(60)).toBe("normal");
    expect(classifyScoreBand(61)).toBe("hot");
    expect(classifyScoreBand(80)).toBe("hot");
    expect(classifyScoreBand(81)).toBe("extreme");
    expect(classifyScoreBand(100)).toBe("extreme");
  });
});
