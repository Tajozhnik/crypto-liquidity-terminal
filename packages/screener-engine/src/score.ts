import type { ScoreBand } from "@screener/shared";
import { SCORE_BANDS } from "@screener/shared";
import type { SubScores } from "./types.js";

const WEIGHTS: Record<keyof SubScores, number> = {
  momentumScore: 0.25,
  volumeScore: 0.25,
  volatilityScore: 0.2,
  liquidityScore: 0.15,
  orderBookScore: 0.15,
};

/**
 * Total function: always returns `{ score, warnings }`.
 *
 * - Substitutes 0 for missing/non-finite sub-scores and appends a warning.
 * - Score is an integer in [0, 100], rounded half-up.
 * - See Requirement 11.6, 18.6.
 */
export function calculateHotMarketScore(
  subScores: Partial<SubScores>,
): { score: number; warnings: string[] } {
  const warnings: string[] = [];
  let weightedSum = 0;

  for (const key of Object.keys(WEIGHTS) as (keyof SubScores)[]) {
    const raw = subScores[key];
    let value: number;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      warnings.push(`Missing or non-finite sub-score: ${key}`);
      value = 0;
    } else if (raw < 0 || raw > 100) {
      warnings.push(`Sub-score out of [0,100] range, clamping: ${key}=${raw}`);
      value = Math.max(0, Math.min(100, raw));
    } else {
      value = raw;
    }
    weightedSum += value * WEIGHTS[key];
  }

  const clamped = Math.max(0, Math.min(100, weightedSum));
  // Round half-up explicitly so .5 always rounds up (Math.round on negatives differs;
  // we never have negatives after clamp).
  const score = Math.floor(clamped + 0.5);
  return { score, warnings };
}

/** Classify integer score into a band — see Requirement 11.5 */
export function classifyScoreBand(score: number): ScoreBand {
  if (score <= SCORE_BANDS.cold.max) return "cold";
  if (score <= SCORE_BANDS.normal.max) return "normal";
  if (score <= SCORE_BANDS.hot.max) return "hot";
  return "extreme";
}
