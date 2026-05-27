/**
 * Shared plot-area geometry used by every chart layer that needs to align to
 * the candle/heatmap canvas: the price-axis gutter on the right, the time-axis
 * gutter on the bottom, and the inner padding on the left. Centralising this
 * in one module is the only safe way to keep the candle body, the heatmap
 * cells and the volume / delta bars perfectly aligned on the X axis.
 */

import { timeToX, type Viewport } from "@/lib/chart/viewport";

/** Reserved width on the right edge for the price axis labels. */
export const RIGHT_PRICE_AXIS_PX = 60;
/** Reserved height at the bottom for the time axis labels. */
export const BOTTOM_TIME_AXIS_PX = 18;
/** Inset on the left so cells/bars don't touch the chart edge. */
export const LEFT_INSET_PX = 4;
/**
 * Candle body width as a fraction of the candle slot. The wick is drawn at
 * the slot centre and the body covers `1 - 2 * BODY_INSET_FRAC` of the slot
 * width. Volume and delta bars use the SAME geometry so they line up under
 * each candle body — no wider, no narrower.
 */
export const CANDLE_BODY_FRAC = 0.7;

export interface PlotArea {
  /** Inclusive pixel x of the leftmost plot column. */
  xLeft: number;
  /** Pixel x of the rightmost plot column (exclusive). */
  xRight: number;
  /** Inner plot width in pixels. */
  innerWidth: number;
}

/** Compute the X-axis plot area shared by candles, heatmap and volume. */
export function getPlotArea(canvasWidth: number): PlotArea {
  const xLeft = LEFT_INSET_PX;
  const xRight = Math.max(LEFT_INSET_PX + 8, canvasWidth - RIGHT_PRICE_AXIS_PX);
  return { xLeft, xRight, innerWidth: Math.max(0, xRight - xLeft) };
}

export interface CandleSlot {
  /** Slot left edge — same as `timeToX(openTime)`. */
  slotX: number;
  /** Slot right edge — same as `timeToX(closeTime)`. */
  slotXEnd: number;
  /** Slot width in pixels. */
  slotW: number;
  /** Body left edge (centred inside the slot, width = slotW × CANDLE_BODY_FRAC). */
  bodyX: number;
  /** Body width in pixels. */
  bodyW: number;
  /** Whether the slot is fully outside the visible plot area. */
  offscreen: boolean;
}

/**
 * Compute the pixel slot for a single candle given its open / close time and
 * the current viewport. The body geometry is what volume / delta bars must
 * mirror — never the slot — so bars are exactly under each candle's body.
 */
export function computeCandleSlot(
  openTime: number,
  closeTime: number,
  viewport: Viewport,
  plot: PlotArea,
): CandleSlot {
  const slotX = timeToX(openTime, viewport, plot.xLeft, plot.xRight);
  const slotXEnd = timeToX(closeTime, viewport, plot.xLeft, plot.xRight);
  const slotW = Math.max(1, slotXEnd - slotX);
  const bodyW = Math.max(1, slotW * CANDLE_BODY_FRAC);
  const bodyX = slotX + (slotW - bodyW) / 2;
  const offscreen = slotXEnd < plot.xLeft || slotX > plot.xRight;
  return { slotX, slotXEnd, slotW, bodyX, bodyW, offscreen };
}
