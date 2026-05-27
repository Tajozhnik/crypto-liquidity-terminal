import type { ScoreBand, ScreenerResult } from "@screener/shared";

// =============================================================================
// Modes
// =============================================================================

export type HeatmapMode =
  | "performance"
  | "volume"
  | "volatility"
  | "signal_score"
  | "relative_volume"
  | "liquidity"
  | "futures_oi";

export const HEATMAP_MODES: { id: HeatmapMode; label: string; description: string }[] = [
  { id: "performance", label: "Performance", description: "24h price change %" },
  { id: "volume", label: "Volume", description: "24h notional volume" },
  { id: "volatility", label: "Volatility", description: "Recent realised volatility" },
  { id: "signal_score", label: "Signal Score", description: "0–100 hotness score" },
  { id: "relative_volume", label: "Relative Volume", description: "Recent / baseline volume ratio" },
  { id: "liquidity", label: "Liquidity", description: "log(volume) ÷ spread%" },
  { id: "futures_oi", label: "Futures OI", description: "Open interest (futures only)" },
];

export type TileSizeMode = "volume_24h" | "market_cap" | "equal";

export const TILE_SIZE_MODES: {
  id: TileSizeMode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}[] = [
  { id: "volume_24h", label: "24h Volume" },
  {
    id: "market_cap",
    label: "Market Cap",
    disabled: true,
    disabledReason: "Market cap data is not available in this no-subscription MVP.",
  },
  { id: "equal", label: "Equal" },
];

// =============================================================================
// Metric extraction
// =============================================================================

export interface HeatmapMetric {
  value: number;
  /** Human-readable display string for the tile */
  display: string;
  /** Whether this row applies to the chosen mode (e.g. spot in Futures OI) */
  applicable: boolean;
}

export function getHeatmapMetric(r: ScreenerResult, mode: HeatmapMode): HeatmapMetric {
  switch (mode) {
    case "performance": {
      const v = r.change24h;
      const sign = v > 0 ? "+" : "";
      return { value: v, display: `${sign}${v.toFixed(2)}%`, applicable: true };
    }
    case "volume":
      return { value: r.volume24h, display: abbreviate(r.volume24h), applicable: true };
    case "volatility":
      return { value: r.volatility, display: r.volatility.toFixed(2), applicable: true };
    case "signal_score":
      return { value: r.signalScore, display: `${r.signalScore}`, applicable: true };
    case "relative_volume":
      return { value: r.relativeVolume, display: `${r.relativeVolume.toFixed(2)}×`, applicable: true };
    case "liquidity": {
      const score = liquidityScore(r);
      return { value: score, display: liquidityLabel(score), applicable: true };
    }
    case "futures_oi": {
      if (r.marketType !== "futures" || r.openInterest === null) {
        return { value: 0, display: "—", applicable: false };
      }
      return { value: r.openInterest, display: abbreviate(r.openInterest), applicable: true };
    }
  }
}

/**
 * Liquidity proxy: bigger volume + tighter spread = better liquidity.
 * Returns a 0..100 score (higher = better).
 */
export function liquidityScore(r: ScreenerResult): number {
  if (!Number.isFinite(r.volume24h) || r.volume24h <= 0) return 0;
  // log10 in [3, 10] roughly maps 1k..10B
  const logVol = Math.max(0, Math.min(10, Math.log10(Math.max(1, r.volume24h))));
  const volComponent = Math.max(0, Math.min(1, (logVol - 3) / 7)); // 0..1
  const spreadPenalty = Math.max(0, Math.min(1, r.spreadPct / 0.5)); // 0% spread = 0 penalty, 0.5%+ = full penalty
  const raw = volComponent * (1 - spreadPenalty);
  return Math.round(raw * 100);
}

function liquidityLabel(s: number): string {
  if (s >= 75) return "deep";
  if (s >= 45) return "good";
  if (s >= 20) return "thin";
  return "poor";
}

// =============================================================================
// Color logic
// =============================================================================

export interface HeatmapColor {
  /** CSS background string (rgba/hsl) */
  background: string;
  /** Foreground text color suggestion */
  color: string;
  /** 0..1 intensity scalar (used by tooltip / stats) */
  intensity: number;
  /** Whether the tile is rendered "muted" (e.g. spot in Futures OI mode) */
  muted: boolean;
}

const NEUTRAL_BG = "hsl(220, 8%, 14%)";
const MUTED_BG = "hsl(220, 8%, 12%)";

export function getHeatmapColor(r: ScreenerResult, mode: HeatmapMode): HeatmapColor {
  const metric = getHeatmapMetric(r, mode);
  if (!metric.applicable) {
    return { background: MUTED_BG, color: "#7a8190", intensity: 0, muted: true };
  }

  switch (mode) {
    case "performance":
      return performanceColor(r.change24h);
    case "volume":
      return volumeColor(r.volume24h);
    case "volatility":
      return volatilityColor(r.volatility);
    case "signal_score":
      return signalScoreColor(r.signalScore, r.scoreBand);
    case "relative_volume":
      return relativeVolumeColor(r.relativeVolume);
    case "liquidity":
      return liquidityColor(liquidityScore(r));
    case "futures_oi":
      return futuresOiColor(r.openInterest ?? 0);
  }
}

function performanceColor(changePct: number): HeatmapColor {
  if (!Number.isFinite(changePct) || changePct === 0) {
    return { background: NEUTRAL_BG, color: "#cad0d9", intensity: 0, muted: false };
  }
  const intensity = Math.min(1, Math.abs(changePct) / 5);
  const hue = changePct > 0 ? 140 : 0; // green / red
  const sat = 55 + intensity * 35; // 55..90
  const light = 18 + intensity * 22; // 18..40
  return {
    background: `hsl(${hue}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`,
    color: light > 30 ? "#ffffff" : "#e6ebf1",
    intensity,
    muted: false,
  };
}

function volumeColor(volume: number): HeatmapColor {
  if (!Number.isFinite(volume) || volume <= 0) {
    return { background: NEUTRAL_BG, color: "#7a8190", intensity: 0, muted: false };
  }
  const logV = Math.max(0, Math.min(10, Math.log10(Math.max(1, volume))));
  const intensity = Math.max(0, Math.min(1, (logV - 3) / 6)); // 1k..1B
  const light = 14 + intensity * 30; // 14..44
  return {
    background: `hsl(210, 70%, ${light.toFixed(0)}%)`,
    color: light > 30 ? "#ffffff" : "#cfd6e0",
    intensity,
    muted: false,
  };
}

function volatilityColor(vol: number): HeatmapColor {
  if (!Number.isFinite(vol)) return { background: NEUTRAL_BG, color: "#7a8190", intensity: 0, muted: false };
  const intensity = Math.max(0, Math.min(1, vol / 5));
  const hue = 30 - intensity * 30; // 30 (orange) -> 0 (red)
  const light = 18 + intensity * 25;
  return {
    background: `hsl(${hue.toFixed(0)}, 70%, ${light.toFixed(0)}%)`,
    color: light > 30 ? "#ffffff" : "#f0e6d8",
    intensity,
    muted: false,
  };
}

function signalScoreColor(score: number, band: ScoreBand): HeatmapColor {
  // discrete band hue, intensity within band
  const bandSpec: Record<ScoreBand, { hue: number; light: number }> = {
    cold: { hue: 220, light: 18 },
    normal: { hue: 210, light: 28 },
    hot: { hue: 30, light: 34 },
    extreme: { hue: 330, light: 40 },
  };
  const spec = bandSpec[band];
  return {
    background: `hsl(${spec.hue}, 65%, ${spec.light}%)`,
    color: spec.light > 30 ? "#ffffff" : "#e0e6f0",
    intensity: Math.max(0, Math.min(1, score / 100)),
    muted: false,
  };
}

function relativeVolumeColor(rv: number): HeatmapColor {
  if (!Number.isFinite(rv)) return { background: NEUTRAL_BG, color: "#7a8190", intensity: 0, muted: false };
  if (rv < 1) return { background: NEUTRAL_BG, color: "#7a8190", intensity: 0, muted: false };
  if (rv < 2) return { background: "hsl(210, 50%, 24%)", color: "#cdd5e0", intensity: 0.3, muted: false };
  if (rv < 3) return { background: "hsl(30, 70%, 32%)", color: "#ffffff", intensity: 0.6, muted: false };
  return { background: "hsl(330, 75%, 42%)", color: "#ffffff", intensity: 1, muted: false };
}

function liquidityColor(score: number): HeatmapColor {
  // good liquidity = green-cyan; poor = red-orange
  const intensity = score / 100;
  const hue = 0 + intensity * 160; // 0 (red) → 160 (green-cyan)
  const light = 20 + intensity * 18;
  return {
    background: `hsl(${hue.toFixed(0)}, 55%, ${light.toFixed(0)}%)`,
    color: light > 30 ? "#ffffff" : "#dde2ea",
    intensity,
    muted: false,
  };
}

function futuresOiColor(oi: number): HeatmapColor {
  const logOi = Math.max(0, Math.min(11, Math.log10(Math.max(1, oi))));
  const intensity = Math.max(0, Math.min(1, (logOi - 4) / 7)); // 10k..100B
  const light = 16 + intensity * 28;
  return {
    background: `hsl(280, 65%, ${light.toFixed(0)}%)`,
    color: light > 30 ? "#ffffff" : "#dccfe6",
    intensity,
    muted: false,
  };
}

// =============================================================================
// Tile size weight
// =============================================================================

export function getTileSizeWeight(r: ScreenerResult, mode: TileSizeMode): number {
  switch (mode) {
    case "volume_24h": {
      // log-scale weight so small markets aren't invisible
      const v = Math.max(1, r.volume24h);
      return Math.max(1, Math.log10(v));
    }
    case "market_cap":
      // market cap is unavailable in MVP — fallback to equal so the layout still renders
      return 1;
    case "equal":
      return 1;
  }
}

// =============================================================================
// Legend
// =============================================================================

export interface LegendSwatch {
  label: string;
  background: string;
  color: string;
}
export interface HeatmapLegendData {
  title: string;
  swatches: LegendSwatch[];
  note?: string;
}

export function buildHeatmapLegend(mode: HeatmapMode): HeatmapLegendData {
  switch (mode) {
    case "performance":
      return {
        title: "24h price change",
        swatches: [
          { label: "≤ −5%", ...swatch(performanceColor(-5)) },
          { label: "−2%", ...swatch(performanceColor(-2)) },
          { label: "0", ...swatch(performanceColor(0)) },
          { label: "+2%", ...swatch(performanceColor(2)) },
          { label: "≥ +5%", ...swatch(performanceColor(5)) },
        ],
      };
    case "volume":
      return {
        title: "24h volume (log scale)",
        swatches: [
          { label: "≤ 1k", ...swatch(volumeColor(1_000)) },
          { label: "1M", ...swatch(volumeColor(1_000_000)) },
          { label: "100M", ...swatch(volumeColor(100_000_000)) },
          { label: "≥ 1B", ...swatch(volumeColor(1_000_000_000)) },
        ],
      };
    case "volatility":
      return {
        title: "Realised volatility",
        swatches: [
          { label: "0", ...swatch(volatilityColor(0)) },
          { label: "1", ...swatch(volatilityColor(1)) },
          { label: "2.5", ...swatch(volatilityColor(2.5)) },
          { label: "≥ 5", ...swatch(volatilityColor(5)) },
        ],
      };
    case "signal_score":
      return {
        title: "Signal Score band",
        swatches: [
          { label: "cold (0–30)", ...swatch(signalScoreColor(15, "cold")) },
          { label: "normal (31–60)", ...swatch(signalScoreColor(45, "normal")) },
          { label: "hot (61–80)", ...swatch(signalScoreColor(70, "hot")) },
          { label: "extreme (81–100)", ...swatch(signalScoreColor(95, "extreme")) },
        ],
      };
    case "relative_volume":
      return {
        title: "Relative Volume",
        swatches: [
          { label: "< 1×", ...swatch(relativeVolumeColor(0.5)) },
          { label: "1–2×", ...swatch(relativeVolumeColor(1.5)) },
          { label: "2–3×", ...swatch(relativeVolumeColor(2.5)) },
          { label: "> 3×", ...swatch(relativeVolumeColor(4)) },
        ],
      };
    case "liquidity":
      return {
        title: "Liquidity (volume ÷ spread)",
        swatches: [
          { label: "poor", ...swatch(liquidityColor(10)) },
          { label: "thin", ...swatch(liquidityColor(30)) },
          { label: "good", ...swatch(liquidityColor(60)) },
          { label: "deep", ...swatch(liquidityColor(90)) },
        ],
      };
    case "futures_oi":
      return {
        title: "Open Interest (futures only)",
        note: "Spot pairs are rendered muted in this mode.",
        swatches: [
          { label: "≤ 10k", ...swatch(futuresOiColor(10_000)) },
          { label: "1M", ...swatch(futuresOiColor(1_000_000)) },
          { label: "100M", ...swatch(futuresOiColor(100_000_000)) },
          { label: "≥ 10B", ...swatch(futuresOiColor(10_000_000_000)) },
        ],
      };
  }
}

function swatch(c: HeatmapColor): { background: string; color: string } {
  return { background: c.background, color: c.color };
}

// =============================================================================
// Summary
// =============================================================================

export interface HeatmapSummary {
  total: number;
  hot: number; // signalScore >= 61
  extreme: number; // signalScore >= 81
  avgVolatility: number;
  totalVolume: number;
}

export function calculateHeatmapSummary(rows: ScreenerResult[]): HeatmapSummary {
  if (rows.length === 0) {
    return { total: 0, hot: 0, extreme: 0, avgVolatility: 0, totalVolume: 0 };
  }
  let hot = 0;
  let extreme = 0;
  let totalVol = 0;
  let totalVolume = 0;
  for (const r of rows) {
    if (r.signalScore >= 81) extreme++;
    else if (r.signalScore >= 61) hot++;
    if (Number.isFinite(r.volatility)) totalVol += r.volatility;
    if (Number.isFinite(r.volume24h)) totalVolume += r.volume24h;
  }
  return {
    total: rows.length,
    hot,
    extreme,
    avgVolatility: totalVol / rows.length,
    totalVolume,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function abbreviate(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}
