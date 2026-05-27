/**
 * Pure helpers + canvas drawing for the per-candle volume / delta histogram
 * shown below the main liquidity chart.
 *
 * Geometry contract (critical for visual alignment with the candle layer):
 *   - One bar per candle (or per delta bucket).
 *   - Bar width is computed from the actual `openTime` / `closeTime` of the
 *     candle via the SAME `timeToX()` helper the candle layer uses.
 *   - The drawn bar matches the candle BODY (CANDLE_BODY_FRAC of the slot,
 *     centred). It never matches the full slot — that would make the bar
 *     wider than the candle body and the user would see misalignment.
 *   - Bars are clipped to the shared plot area (xLeft .. xRight). A
 *     partially visible candle has its bar clipped the same way.
 *   - `timeframe` strings (1m/5m/15m) are NOT used to widen bars. Only
 *     real `openTime` / `closeTime` from the backend kline payload.
 */

import { timeToX, type Viewport } from "@/lib/chart/viewport";
import {
  CANDLE_BODY_FRAC,
  computeCandleSlot,
  getPlotArea,
  type PlotArea,
} from "./plotLayout";

export interface VolumeLayout {
  /** Pixel x of the left edge of the plotting area (matches main chart). */
  xLeft: number;
  /** Pixel x of the right edge of the plotting area. */
  xRight: number;
  /** Pixel y of the top of the histogram panel. */
  yTop: number;
  /** Pixel y of the bottom of the histogram panel. */
  yBottom: number;
}

export interface VolumeCandle {
  /** Open time, ms epoch (the kline's `t`). */
  t: number;
  open: number;
  close: number;
  volume: number;
  /** Optional explicit close time. When omitted, falls back to t + candleMs. */
  closeTime?: number;
}

export interface VolumeDeltaBucket {
  t: number;
  buyVolume?: number;
  sellVolume?: number;
  delta: number;
  cumulativeDelta?: number;
}

export interface VolumeBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** "up" → close ≥ open. */
  direction: "up" | "down";
}

export interface DeltaBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** "positive" → delta ≥ 0, drawn above baseline. */
  sign: "positive" | "negative";
}

const COLOR_UP = "rgba(120,210,140,0.85)";
const COLOR_DOWN = "rgba(220,90,100,0.85)";
const COLOR_POSITIVE = "rgba(120,210,140,0.85)";
const COLOR_NEGATIVE = "rgba(220,90,100,0.85)";
const COLOR_BASELINE = "rgba(255,255,255,0.18)";
const COLOR_CUM_LINE = "rgba(255,255,255,0.7)";

function clipToPlot(x1: number, x2: number, plot: PlotArea | VolumeLayout): { x: number; w: number } | null {
  const left = Math.max(plot.xLeft, x1);
  const right = Math.min(plot.xRight, x2);
  if (right <= left) return null;
  return { x: left, w: Math.max(1, right - left) };
}

/** Convert a `VolumeLayout` to the equivalent `PlotArea` shape used by helpers. */
function asPlotArea(layout: VolumeLayout): PlotArea {
  return { xLeft: layout.xLeft, xRight: layout.xRight, innerWidth: Math.max(0, layout.xRight - layout.xLeft) };
}

/**
 * Build one bar per candle, aligned to the candle BODY geometry exactly.
 * Width derives from `closeTime - openTime`; height from volume / maxVolume.
 * Bars off-screen are skipped; partially-visible bars are clipped to the
 * plot area so they never bleed past the right axis or under the left inset.
 */
export function buildVolumeBars(
  candles: VolumeCandle[],
  viewport: Viewport,
  layout: VolumeLayout,
  candleMs: number,
): VolumeBar[] {
  if (candles.length === 0) return [];
  const panelH = Math.max(1, layout.yBottom - layout.yTop);
  const plot = asPlotArea(layout);

  // Compute max from VISIBLE candles only — otherwise bars in the visible
  // window get scaled by an off-screen whale candle and look near-zero.
  const visible: VolumeCandle[] = [];
  for (const c of candles) {
    const open = c.t;
    const close = c.closeTime ?? c.t + candleMs;
    const x1 = timeToX(open, viewport, plot.xLeft, plot.xRight);
    const x2 = timeToX(close, viewport, plot.xLeft, plot.xRight);
    if (x2 < plot.xLeft || x1 > plot.xRight) continue;
    visible.push(c);
  }
  if (visible.length === 0) return [];

  let maxVol = 0;
  for (const c of visible) if (c.volume > maxVol) maxVol = c.volume;
  if (maxVol <= 0) maxVol = 1;

  const bars: VolumeBar[] = [];
  for (const c of visible) {
    const openTime = c.t;
    const closeTime = c.closeTime ?? c.t + candleMs;
    // Use the same body geometry as the candle layer — bar width = candle
    // body width (CANDLE_BODY_FRAC of the slot), centred under the body.
    const slot = computeCandleSlot(openTime, closeTime, viewport, plot);
    const clipped = clipToPlot(slot.bodyX, slot.bodyX + slot.bodyW, plot);
    if (!clipped) continue;
    const height = (Math.max(0, c.volume) / maxVol) * panelH;
    const up = c.close >= c.open;
    bars.push({
      x: clipped.x,
      y: layout.yBottom - height,
      width: clipped.w,
      height,
      color: up ? COLOR_UP : COLOR_DOWN,
      direction: up ? "up" : "down",
    });
  }
  return bars;
}

/**
 * Build positive/negative bars around a horizontal baseline. Bars are sized
 * to the same body fraction as candles so when a delta bucket maps 1:1 to a
 * candle (which it usually does — we request delta with the same timeframe)
 * they line up under their candles.
 */
export function buildDeltaBars(
  buckets: VolumeDeltaBucket[],
  viewport: Viewport,
  layout: VolumeLayout,
  bucketMs: number,
): DeltaBar[] {
  if (buckets.length === 0) return [];
  const panelH = Math.max(1, layout.yBottom - layout.yTop);
  const baseline = layout.yTop + panelH / 2;
  const halfH = panelH / 2;
  const plot = asPlotArea(layout);

  // Visible-only normalization — same rationale as volume bars above.
  const visible: VolumeDeltaBucket[] = [];
  for (const b of buckets) {
    const x1 = timeToX(b.t, viewport, plot.xLeft, plot.xRight);
    const x2 = timeToX(b.t + bucketMs, viewport, plot.xLeft, plot.xRight);
    if (x2 < plot.xLeft || x1 > plot.xRight) continue;
    visible.push(b);
  }
  if (visible.length === 0) return [];

  let maxAbs = 0;
  for (const b of visible) {
    const a = Math.abs(b.delta);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= 0) maxAbs = 1;

  const bars: DeltaBar[] = [];
  for (const b of visible) {
    const slot = computeCandleSlot(b.t, b.t + bucketMs, viewport, plot);
    const clipped = clipToPlot(slot.bodyX, slot.bodyX + slot.bodyW, plot);
    if (!clipped) continue;
    const height = (Math.abs(b.delta) / maxAbs) * halfH;
    if (b.delta >= 0) {
      bars.push({
        x: clipped.x,
        y: baseline - height,
        width: clipped.w,
        height,
        color: COLOR_POSITIVE,
        sign: "positive",
      });
    } else {
      bars.push({
        x: clipped.x,
        y: baseline,
        width: clipped.w,
        height,
        color: COLOR_NEGATIVE,
        sign: "negative",
      });
    }
  }
  return bars;
}

/** Draws volume bars. One fillRect per bar — never one full-width rect. */
export function renderVolumeBars(
  ctx: CanvasRenderingContext2D,
  bars: VolumeBar[],
  layout: VolumeLayout,
): void {
  ctx.clearRect(0, 0, layout.xRight + Math.max(0, layout.xLeft), layout.yBottom + Math.max(0, layout.yTop));
  ctx.save();
  ctx.strokeStyle = COLOR_BASELINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.xLeft, layout.yBottom);
  ctx.lineTo(layout.xRight, layout.yBottom);
  ctx.stroke();
  ctx.restore();
  for (const b of bars) {
    if (b.height <= 0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.width, b.height);
  }
}

/**
 * Draws delta bars + a horizontal baseline. Optionally overlays a cumulative
 * delta line if buckets carry that field.
 */
export function renderDeltaBars(
  ctx: CanvasRenderingContext2D,
  bars: DeltaBar[],
  buckets: VolumeDeltaBucket[],
  viewport: Viewport,
  layout: VolumeLayout,
  bucketMs: number,
): void {
  ctx.clearRect(0, 0, layout.xRight + Math.max(0, layout.xLeft), layout.yBottom + Math.max(0, layout.yTop));
  const panelH = Math.max(1, layout.yBottom - layout.yTop);
  const baseline = layout.yTop + panelH / 2;
  ctx.save();
  ctx.strokeStyle = COLOR_BASELINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.xLeft, baseline);
  ctx.lineTo(layout.xRight, baseline);
  ctx.stroke();
  ctx.restore();
  for (const b of bars) {
    if (b.height <= 0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.width, b.height);
  }
  const hasCum = buckets.some((b) => typeof b.cumulativeDelta === "number");
  if (!hasCum || buckets.length === 0) return;
  let maxAbsCum = 0;
  for (const b of buckets) {
    const v = Math.abs(b.cumulativeDelta ?? 0);
    if (v > maxAbsCum) maxAbsCum = v;
  }
  if (maxAbsCum <= 0) return;
  const halfH = panelH / 2;
  ctx.save();
  ctx.strokeStyle = COLOR_CUM_LINE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let started = false;
  for (const b of buckets) {
    const cum = b.cumulativeDelta ?? 0;
    const x = timeToX(b.t + bucketMs / 2, viewport, layout.xLeft, layout.xRight);
    if (x < layout.xLeft || x > layout.xRight) continue;
    const y = baseline - (cum / maxAbsCum) * halfH;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Resolve timeframe label → milliseconds. Mirrors lib/liquidity/binning. */
export function timeframeToMs(timeframe: string): number {
  if (timeframe === "1m") return 60_000;
  if (timeframe === "5m") return 300_000;
  if (timeframe === "15m") return 900_000;
  return 60_000;
}

// Re-export the shared geometry helpers so callers (renderer, candle layer)
// resolve them from one place.
export { CANDLE_BODY_FRAC, getPlotArea };
