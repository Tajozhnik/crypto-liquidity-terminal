import { colorForCell, type ColorOptions } from "./heatmapColor";
import {
  buildStyleFn,
  colorForSide,
  glowColorForSide,
  type DensityOptions,
} from "./densityScale";
import { priceToY, timeToX, type PriceScale, type TimeScale } from "./chartMath";
import { computeCandleSlot, type PlotArea } from "./plotLayout";

export interface HeatmapCellRow {
  t: number;
  price: number;
  bidLiquidity: number;
  askLiquidity: number;
  totalLiquidity: number;
  intensity: number;
}

export interface CandleRow {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RenderConfig {
  priceScale: PriceScale;
  timeScale: TimeScale;
  binWidth: number;
  /** Width of one heatmap time bucket in ms (5 s by default, decoupled from candle timeframe). */
  timeBucketMs: number;
  /** Width of one candle in ms (1m=60_000, 5m=300_000, 15m=900_000). Used by `renderCandles`. */
  candleMs?: number;
  colorOpts: ColorOptions;
  /**
   * Optional density-aware rendering. When provided, the new normalization
   * pipeline (raw/log/percentile/z-score + gamma + glow) takes over from the
   * legacy `colorForCell` path.
   */
  density?: DensityOptions;
  /** Side mode for the new pipeline; defaults to whatever `colorOpts.sideMode` is. */
  densitySide?: "combined" | "bids" | "asks" | "imbalance";
}

/** Clears + draws the heatmap layer. */
export function renderHeatmap(
  ctx: CanvasRenderingContext2D,
  cells: HeatmapCellRow[],
  cfg: RenderConfig,
): void {
  const { priceScale, timeScale, binWidth, timeBucketMs } = cfg;
  ctx.clearRect(
    timeScale.xLeft,
    priceScale.yTop,
    Math.max(1, timeScale.xRight - timeScale.xLeft),
    Math.max(1, priceScale.yBottom - priceScale.yTop),
  );
  if (cells.length === 0 || binWidth <= 0) return;

  const timeRange = Math.max(1, timeScale.timeMax - timeScale.timeMin);
  const xRange = timeScale.xRight - timeScale.xLeft;
  // Cell width in pixels = (one time bucket / total time range) * chart width
  const rawCellW = (timeBucketMs / timeRange) * xRange;
  // If bucket spans the whole range, fall back to a usable strip width so we
  // never collapse to a single-pixel column.
  const cellWidthPx = Math.max(2, Math.min(xRange, rawCellW));

  // Cell height in pixels: difference of priceToY between `priceMin` and
  // `priceMin + binWidth`. Both anchors are guaranteed inside the visible
  // window — the previous form sampled `priceToY(0)` which extrapolated far
  // below the bottom edge and only happened to give the right magnitude
  // because the price scale is linear. Use the in-window sample so this
  // stays correct on any future non-linear price scale.
  const yAtMin = priceToY(priceScale.priceMin, priceScale);
  const yAtMinPlusBin = priceToY(priceScale.priceMin + binWidth, priceScale);
  const cellHeightPx = Math.max(1, Math.abs(yAtMin - yAtMinPlusBin));

  if (cfg.density) {
    renderHeatmapDensity(ctx, cells, cfg, cellWidthPx, cellHeightPx);
    return;
  }

  // Legacy path — kept for the existing tests and as a low-cost fallback.
  for (const c of cells) {
    const fill = colorForCell(c, cfg.colorOpts);
    if (fill === "rgba(0,0,0,0)") continue;
    const x = timeToX(c.t, timeScale);
    const yTopOfCell = priceToY(c.price + binWidth, priceScale); // top edge
    ctx.fillStyle = fill;
    ctx.fillRect(x, yTopOfCell, cellWidthPx, cellHeightPx);
  }
}

/**
 * Density-aware draw path. Cells are drawn in two passes:
 *   1) base rectangle with side-tinted alpha from the chosen DensityMode;
 *   2) optional additive glow rectangle for top-percentile cells.
 *
 * The two passes give the heatmap a noticeable "wall" aesthetic without
 * overfitting to any specific upstream palette.
 */
function renderHeatmapDensity(
  ctx: CanvasRenderingContext2D,
  cells: HeatmapCellRow[],
  cfg: RenderConfig,
  cellWidthPx: number,
  cellHeightPx: number,
): void {
  const { priceScale, timeScale, binWidth, density } = cfg;
  if (!density) return;

  // Filter cells to the visible viewport before computing stats so the
  // normalization actually reflects what the user sees.
  const visible: HeatmapCellRow[] = [];
  for (const c of cells) {
    if (c.t + cfg.timeBucketMs < timeScale.timeMin) continue;
    if (c.t > timeScale.timeMax) continue;
    if (c.price + binWidth < priceScale.priceMin) continue;
    if (c.price > priceScale.priceMax) continue;
    visible.push(c);
  }
  if (visible.length === 0) return;

  const sideFilter = cfg.densitySide ?? cfg.colorOpts.sideMode ?? "combined";
  const valueFor = (c: HeatmapCellRow): number => {
    if (sideFilter === "bids") return c.bidLiquidity;
    if (sideFilter === "asks") return c.askLiquidity;
    if (sideFilter === "imbalance") return Math.abs(c.bidLiquidity - c.askLiquidity);
    return c.bidLiquidity + c.askLiquidity;
  };
  const values = visible.map(valueFor);
  const { styleFor } = buildStyleFn(values, density);

  // First pass — base fills.
  for (const c of visible) {
    const cellInput = sideFilter === "bids"
      ? { bidLiquidity: c.bidLiquidity, askLiquidity: 0 }
      : sideFilter === "asks"
      ? { bidLiquidity: 0, askLiquidity: c.askLiquidity }
      : { bidLiquidity: c.bidLiquidity, askLiquidity: c.askLiquidity };
    const style = styleFor(cellInput);
    if (style.alpha <= 0) continue;
    const x = timeToX(c.t, timeScale);
    const yTopOfCell = priceToY(c.price + binWidth, priceScale);
    ctx.fillStyle = colorForSide(style.side, style.alpha);
    ctx.fillRect(x, yTopOfCell, cellWidthPx, cellHeightPx);
  }

  // Second pass — glow on strong cells. Done after the base so the additive
  // overlay doesn't dim under subsequent neighbours.
  if (!density.glow) return;
  const prevComposite = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  for (const c of visible) {
    const cellInput = sideFilter === "bids"
      ? { bidLiquidity: c.bidLiquidity, askLiquidity: 0 }
      : sideFilter === "asks"
      ? { bidLiquidity: 0, askLiquidity: c.askLiquidity }
      : { bidLiquidity: c.bidLiquidity, askLiquidity: c.askLiquidity };
    const style = styleFor(cellInput);
    if (!style.isStrong) continue;
    const x = timeToX(c.t, timeScale);
    const yTopOfCell = priceToY(c.price + binWidth, priceScale);
    ctx.fillStyle = glowColorForSide(style.side, style.alpha);
    ctx.fillRect(x, yTopOfCell, cellWidthPx, cellHeightPx);
  }
  ctx.globalCompositeOperation = prevComposite;
}

/** Draws candles on top of the heatmap. */
export function renderCandles(
  ctx: CanvasRenderingContext2D,
  candles: CandleRow[],
  cfg: RenderConfig,
): void {
  const { priceScale, timeScale } = cfg;
  if (candles.length === 0) return;
  // The volume / delta panel uses the same `computeCandleSlot` helper, so the
  // bar widths and centres match this draw call pixel for pixel.
  const candleMs = cfg.candleMs ?? 60_000;
  const plot: PlotArea = {
    xLeft: timeScale.xLeft,
    xRight: timeScale.xRight,
    innerWidth: Math.max(0, timeScale.xRight - timeScale.xLeft),
  };
  // Build a tiny viewport-shaped object from the timeScale so we can reuse
  // the shared helper (volumeRenderer keeps its own `Viewport`-typed input).
  const vp = {
    timeStart: timeScale.timeMin,
    timeEnd: timeScale.timeMax,
    priceMin: priceScale.priceMin,
    priceMax: priceScale.priceMax,
    autoFit: false,
  };

  for (const c of candles) {
    const slot = computeCandleSlot(c.t, c.t + candleMs, vp, plot);
    if (slot.offscreen) continue;
    const yHigh = priceToY(c.high, priceScale);
    const yLow = priceToY(c.low, priceScale);
    const yOpen = priceToY(c.open, priceScale);
    const yClose = priceToY(c.close, priceScale);
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? "rgba(140,230,160,0.95)" : "rgba(230,100,110,0.95)";
    ctx.fillStyle = up ? "rgba(140,230,160,0.55)" : "rgba(230,100,110,0.55)";
    ctx.lineWidth = 1;
    // wick — at the slot centre.
    const wickX = slot.slotX + slot.slotW / 2;
    ctx.beginPath();
    ctx.moveTo(wickX, yHigh);
    ctx.lineTo(wickX, yLow);
    ctx.stroke();
    // body — same geometry as the volume bar below.
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    ctx.fillRect(slot.bodyX, bodyTop, slot.bodyW, bodyHeight);
  }
}

/** Draws a current-price horizontal line. */
export function renderPriceLine(
  ctx: CanvasRenderingContext2D,
  price: number,
  cfg: RenderConfig,
): void {
  if (!Number.isFinite(price) || price <= 0) return;
  if (price < cfg.priceScale.priceMin || price > cfg.priceScale.priceMax) return;
  const y = priceToY(price, cfg.priceScale);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cfg.timeScale.xLeft, y);
  ctx.lineTo(cfg.timeScale.xRight, y);
  ctx.stroke();
  ctx.restore();
}
