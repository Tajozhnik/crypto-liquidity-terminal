/**
 * Pure liquidity-density math for the heatmap layer. Pulled into its own
 * module so the renderer keeps a tight, batchable hot path and so the
 * normalization logic is unit-testable without touching the canvas.
 *
 * Design goals:
 *   - Single outlier ("whale wall") must not blow out the visual scale —
 *     percentile cap (default p99) clamps the top.
 *   - Weak liquidity must remain readable — gamma < 1 lifts low-density bins.
 *   - Mode is a per-frame choice (raw/log/percentile/z-score) so users can
 *     compare without re-fetching.
 *   - No proprietary palette — colour functions live alongside but are kept
 *     minimal and original here.
 */

export type DensityMode = "raw" | "log" | "percentile" | "zscore";

export type DensityPreset = "balanced" | "deep" | "walls" | "weak" | "clean";

export interface DensityOptions {
  mode: DensityMode;
  /** Lower clamp at this percentile (0..1). p99 = clamp top 1 % of values. */
  capPercentile: number;
  /** intensity := pow(intensity, gamma). gamma < 1 amplifies weak signals. */
  gamma: number;
  /** Minimum drawn alpha for a non-zero cell. Below this the cell is skipped. */
  minOpacity: number;
  /** Maximum drawn alpha for the most intense cell. */
  maxOpacity: number;
  /** Drop cells whose normalized intensity is below this threshold. */
  hideWeakBelow: number;
  /** Show only cells whose intensity is at or above this threshold. */
  strongOnlyAbove: number;
  /** Apply a soft additive glow to top-percentile cells. */
  glow: boolean;
}

export const DEFAULT_DENSITY_OPTIONS: DensityOptions = {
  mode: "zscore",
  capPercentile: 0.99,
  gamma: 0.65,
  minOpacity: 0.08,
  maxOpacity: 0.92,
  hideWeakBelow: 0,
  strongOnlyAbove: 0,
  glow: true,
};

/** Applied on top of the chosen DensityMode to bias visibility. */
export function applyGamma(intensity: number, gamma: number): number {
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  if (intensity >= 1) return 1;
  const g = Math.max(0.05, Math.min(4, gamma));
  return Math.pow(intensity, g);
}

/**
 * Compute summary stats once per frame; the renderer reuses them for every
 * cell so we don't re-percentile per draw call.
 */
export interface LiquidityStats {
  count: number;
  max: number;
  mean: number;
  std: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  cap: number;
}

export function computeLiquidityStats(values: number[], capPercentile = 0.99): LiquidityStats {
  if (values.length === 0) {
    return { count: 0, max: 0, mean: 0, std: 0, p50: 0, p90: 0, p95: 0, p99: 0, cap: 0 };
  }
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, max: 0, mean: 0, std: 0, p50: 0, p90: 0, p95: 0, p99: 0, cap: 0 };
  }
  const n = sorted.length;
  const max = sorted[n - 1]!;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  let varSum = 0;
  for (const v of sorted) varSum += (v - mean) * (v - mean);
  const std = Math.sqrt(varSum / n);
  const pick = (q: number): number => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))]!;
  const p50 = pick(0.5);
  const p90 = pick(0.9);
  const p95 = pick(0.95);
  const p99 = pick(0.99);
  const cap = pick(Math.max(0, Math.min(0.999, capPercentile)));
  return { count: n, max, mean, std, p50, p90, p95, p99, cap };
}

/** Linear normalization clamped at the cap percentile. */
export function normalizeRaw(value: number, stats: LiquidityStats): number {
  if (stats.cap <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / stats.cap);
}

/** log1p compression — keeps weak bins visible without saturating top. */
export function normalizeLog(value: number, stats: LiquidityStats): number {
  if (stats.cap <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  const clipped = Math.min(value, stats.cap);
  return Math.log1p(clipped) / Math.log1p(stats.cap);
}

/**
 * Map `value` to its rank in the sorted distribution. We do binary search on
 * the pre-sorted positive values; rank/n ∈ [0, 1].
 */
export function normalizePercentile(value: number, sortedPositiveValues: number[]): number {
  if (sortedPositiveValues.length === 0 || !Number.isFinite(value) || value <= 0) return 0;
  const arr = sortedPositiveValues;
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / arr.length;
}

/**
 * Z-score → [0,1] mapping with bands:
 *   z < 0.5      → near-transparent (weak)
 *   0.5 ≤ z<1.5  → 0.30..0.55 (notable)
 *   1.5 ≤ z<2.5  → 0.55..0.80 (strong wall)
 *   z ≥ 2.5      → 0.80..1.00 (extreme; clamped at z=4 to avoid burnout)
 */
export function normalizeZScore(value: number, stats: LiquidityStats): number {
  if (stats.std <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  const z = (value - stats.mean) / stats.std;
  if (z < 0.5) return 0;
  if (z < 1.5) return 0.30 + ((z - 0.5) / 1.0) * 0.25;
  if (z < 2.5) return 0.55 + ((z - 1.5) / 1.0) * 0.25;
  const tail = Math.min(1, (z - 2.5) / 1.5);
  return 0.80 + tail * 0.20;
}

export function normalize(value: number, mode: DensityMode, stats: LiquidityStats, sortedPositive: number[]): number {
  switch (mode) {
    case "raw":
      return normalizeRaw(value, stats);
    case "log":
      return normalizeLog(value, stats);
    case "percentile":
      return normalizePercentile(value, sortedPositive);
    case "zscore":
      return normalizeZScore(value, stats);
    default:
      return normalizeLog(value, stats);
  }
}

/**
 * Visibility presets — saved tuples of DensityOptions so users can flip
 * between "Deep Liquidity" / "Strong Walls" / etc. with one click. Default
 * for the chart is `deep` because that matches what users expect from a
 * professional order-book heatmap.
 */
export const DENSITY_PRESETS: Record<DensityPreset, DensityOptions> = {
  balanced: {
    mode: "percentile",
    capPercentile: 0.99,
    gamma: 0.75,
    minOpacity: 0.06,
    maxOpacity: 0.9,
    hideWeakBelow: 0,
    strongOnlyAbove: 0,
    glow: false,
  },
  deep: {
    mode: "zscore",
    capPercentile: 0.99,
    gamma: 0.6,
    minOpacity: 0.08,
    maxOpacity: 0.95,
    hideWeakBelow: 0,
    strongOnlyAbove: 0,
    glow: true,
  },
  walls: {
    mode: "percentile",
    capPercentile: 0.995,
    gamma: 0.85,
    minOpacity: 0,
    maxOpacity: 0.95,
    hideWeakBelow: 0.85, // top ~15 % only
    strongOnlyAbove: 0.85,
    glow: true,
  },
  weak: {
    mode: "log",
    capPercentile: 0.95,
    gamma: 0.5,
    minOpacity: 0.12,
    maxOpacity: 0.85,
    hideWeakBelow: 0,
    strongOnlyAbove: 0,
    glow: false,
  },
  clean: {
    mode: "zscore",
    capPercentile: 0.99,
    gamma: 0.7,
    minOpacity: 0,
    maxOpacity: 0.9,
    hideWeakBelow: 0.55,
    strongOnlyAbove: 0,
    glow: false,
  },
};

export function densityPreset(name: DensityPreset): DensityOptions {
  return { ...DENSITY_PRESETS[name] };
}

/**
 * Build a `getLiquidityCellStyle` closure for one frame: pre-computes stats
 * once, then per-cell calls are O(log n) for percentile mode and O(1) for
 * the others.
 */
export interface CellInput {
  bidLiquidity: number;
  askLiquidity: number;
}

export interface CellStyle {
  /** Final alpha (0..maxOpacity). 0 means do not draw. */
  alpha: number;
  /** Normalized intensity (post-gamma, 0..1) for downstream colour math. */
  intensity: number;
  /** "bid" if bid-dominant, "ask" if ask-dominant, "balanced" otherwise. */
  side: "bid" | "ask" | "balanced";
  /** True when the cell should additionally render the glow pass. */
  isStrong: boolean;
}

export function buildStyleFn(values: number[], opts: DensityOptions): {
  stats: LiquidityStats;
  styleFor: (cell: CellInput) => CellStyle;
} {
  const stats = computeLiquidityStats(values, opts.capPercentile);
  const sortedPositive = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const styleFor = (cell: CellInput): CellStyle => {
    const total = cell.bidLiquidity + cell.askLiquidity;
    if (total <= 0) return { alpha: 0, intensity: 0, side: "balanced", isStrong: false };
    const raw = normalize(total, opts.mode, stats, sortedPositive);
    if (raw <= 0) return { alpha: 0, intensity: 0, side: "balanced", isStrong: false };
    if (raw < opts.hideWeakBelow) return { alpha: 0, intensity: 0, side: "balanced", isStrong: false };
    if (opts.strongOnlyAbove > 0 && raw < opts.strongOnlyAbove) {
      return { alpha: 0, intensity: 0, side: "balanced", isStrong: false };
    }
    const intensity = applyGamma(raw, opts.gamma);
    const alpha =
      intensity > 0
        ? Math.min(opts.maxOpacity, Math.max(opts.minOpacity, opts.minOpacity + (opts.maxOpacity - opts.minOpacity) * intensity))
        : 0;
    const bidShare = cell.bidLiquidity / total;
    const side: CellStyle["side"] =
      bidShare > 0.6 ? "bid" : bidShare < 0.4 ? "ask" : "balanced";
    const isStrong = raw >= 0.85;
    return { alpha, intensity, side, isStrong };
  };
  return { stats, styleFor };
}

/**
 * Original palette: cyan/teal for bid, magenta/orange for ask, muted lilac
 * for balanced. Glow pass uses a softened white so any palette change in
 * future does not require re-tuning the glow.
 */
export function colorForSide(side: CellStyle["side"], alpha: number): string {
  if (side === "bid") return `rgba(60, 200, 220, ${alpha.toFixed(3)})`;   // cyan / teal
  if (side === "ask") return `rgba(245, 120, 160, ${alpha.toFixed(3)})`;  // magenta-pink
  return `rgba(160, 130, 220, ${alpha.toFixed(3)})`;                       // muted lilac
}

export function glowColorForSide(side: CellStyle["side"], alpha: number): string {
  // Soft additive overlay; alpha here is the *additive* boost on top of the
  // base cell. Capped at 0.35 so we never blow the canvas to pure white.
  const a = Math.min(0.35, alpha);
  if (side === "bid") return `rgba(180, 255, 255, ${a.toFixed(3)})`;
  if (side === "ask") return `rgba(255, 200, 220, ${a.toFixed(3)})`;
  return `rgba(220, 200, 255, ${a.toFixed(3)})`;
}
