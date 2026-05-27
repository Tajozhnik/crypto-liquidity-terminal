/**
 * Original colour scheme for the liquidity heatmap. Bid liquidity is rendered
 * with a cool teal range; ask liquidity with a warm magenta-orange range. No
 * brand-specific palette is used.
 */

export type LiquiditySide = "bid" | "ask" | "combined";

export interface HeatmapCellViz {
  bidLiquidity: number;
  askLiquidity: number;
  intensity: number; // 0..1 baseline intensity
}

export interface ColorOptions {
  /** 0.5 .. 5 multiplier. Higher = more saturated. */
  intensityMultiplier: number;
  /** Apply log scaling to the intensity. */
  logScale: boolean;
  /** Which side to highlight. */
  sideMode: "combined" | "bids" | "asks" | "imbalance";
}

export function applyIntensity(intensity: number, opts: ColorOptions): number {
  let v = Math.max(0, Math.min(1, intensity));
  if (opts.logScale) {
    // log1p smooths out long tails
    v = Math.log1p(9 * v) / Math.log(10);
  }
  v = Math.min(1, v * opts.intensityMultiplier);
  return v;
}

/** Returns an rgba() colour string. */
export function colorForCell(cell: HeatmapCellViz, opts: ColorOptions): string {
  const total = cell.bidLiquidity + cell.askLiquidity;
  if (total <= 0) return "rgba(0,0,0,0)";

  const i = applyIntensity(cell.intensity, opts);
  if (i <= 0.005) return "rgba(0,0,0,0)";

  if (opts.sideMode === "bids") {
    if (cell.bidLiquidity <= 0) return "rgba(0,0,0,0)";
    return rgba(80, 220, 200, i); // teal
  }
  if (opts.sideMode === "asks") {
    if (cell.askLiquidity <= 0) return "rgba(0,0,0,0)";
    return rgba(240, 130, 80, i); // warm orange/magenta
  }
  if (opts.sideMode === "imbalance") {
    const imb = (cell.bidLiquidity - cell.askLiquidity) / total;
    if (imb >= 0) return rgba(80, 220, 200, Math.min(1, Math.abs(imb) * i + 0.1));
    return rgba(240, 130, 80, Math.min(1, Math.abs(imb) * i + 0.1));
  }
  // combined: blend by side dominance
  const bidShare = cell.bidLiquidity / total;
  const r = Math.round(80 * bidShare + 240 * (1 - bidShare));
  const g = Math.round(220 * bidShare + 130 * (1 - bidShare));
  const b = Math.round(200 * bidShare + 80 * (1 - bidShare));
  return rgba(r, g, b, i);
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
