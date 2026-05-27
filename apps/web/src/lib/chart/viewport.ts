/**
 * Pure viewport math. The chart canvas keeps a {timeStart, timeEnd, priceMin,
 * priceMax} window; user interactions (wheel, drag, scale-drag) mutate it
 * through these helpers. Nothing here touches the DOM.
 */

export interface Viewport {
  timeStart: number;
  timeEnd: number;
  priceMin: number;
  priceMax: number;
  /** When true, the viewport tracks data bounds on every render. Disabled by user interaction. */
  autoFit: boolean;
}

export interface DataBounds {
  timeStart: number;
  timeEnd: number;
  priceMin: number;
  priceMax: number;
}

const MIN_TIME_RANGE_MS = 30_000; // 30s
const MIN_PRICE_RANGE_FRAC = 0.0005; // 0.05% of mid

export function timeToX(t: number, vp: Viewport, xLeft: number, xRight: number): number {
  const span = vp.timeEnd - vp.timeStart;
  if (span <= 0) return xLeft;
  return xLeft + ((t - vp.timeStart) / span) * (xRight - xLeft);
}

export function xToTime(x: number, vp: Viewport, xLeft: number, xRight: number): number {
  const w = xRight - xLeft;
  if (w <= 0) return vp.timeStart;
  return vp.timeStart + ((x - xLeft) / w) * (vp.timeEnd - vp.timeStart);
}

export function priceToY(p: number, vp: Viewport, yTop: number, yBottom: number): number {
  const span = vp.priceMax - vp.priceMin;
  if (span <= 0) return yBottom;
  return yBottom - ((p - vp.priceMin) / span) * (yBottom - yTop);
}

export function yToPrice(y: number, vp: Viewport, yTop: number, yBottom: number): number {
  const h = yBottom - yTop;
  if (h <= 0) return vp.priceMin;
  return vp.priceMin + ((yBottom - y) / h) * (vp.priceMax - vp.priceMin);
}

/** Zoom around a fixed time anchor. factor < 1 shrinks span (zoom in), > 1 enlarges. */
export function zoomTime(vp: Viewport, anchorTime: number, factor: number): Viewport {
  const span = (vp.timeEnd - vp.timeStart) * factor;
  const minSpan = MIN_TIME_RANGE_MS;
  const newSpan = Math.max(minSpan, span);
  // Keep anchor at same relative position
  const ratio = (anchorTime - vp.timeStart) / Math.max(1, vp.timeEnd - vp.timeStart);
  const timeStart = anchorTime - ratio * newSpan;
  const timeEnd = timeStart + newSpan;
  return { ...vp, timeStart, timeEnd, autoFit: false };
}

export function zoomPrice(vp: Viewport, anchorPrice: number, factor: number): Viewport {
  const span = (vp.priceMax - vp.priceMin) * factor;
  const mid = (vp.priceMin + vp.priceMax) / 2;
  const minSpan = Math.max(mid * MIN_PRICE_RANGE_FRAC, 1e-12);
  const newSpan = Math.max(minSpan, span);
  const ratio = (anchorPrice - vp.priceMin) / Math.max(1e-12, vp.priceMax - vp.priceMin);
  const priceMin = anchorPrice - ratio * newSpan;
  const priceMax = priceMin + newSpan;
  return { ...vp, priceMin, priceMax, autoFit: false };
}

/** Pan by `deltaPx` pixels horizontally. Positive deltaPx → drag right → reveal earlier time. */
export function panTime(vp: Viewport, deltaPx: number, widthPx: number): Viewport {
  if (widthPx <= 0) return vp;
  const span = vp.timeEnd - vp.timeStart;
  const dt = (deltaPx / widthPx) * span;
  return { ...vp, timeStart: vp.timeStart - dt, timeEnd: vp.timeEnd - dt, autoFit: false };
}

/** Pan by `deltaPx` pixels vertically. Positive deltaPx → drag down → reveal higher prices. */
export function panPrice(vp: Viewport, deltaPx: number, heightPx: number): Viewport {
  if (heightPx <= 0) return vp;
  const span = vp.priceMax - vp.priceMin;
  const dp = (deltaPx / heightPx) * span;
  return { ...vp, priceMin: vp.priceMin + dp, priceMax: vp.priceMax + dp, autoFit: false };
}

/** Snap viewport to data bounds with a small price-only padding. Always sets autoFit=true. */
export function fitViewportToData(b: DataBounds): Viewport {
  const tSpan = Math.max(MIN_TIME_RANGE_MS, b.timeEnd - b.timeStart);
  const pSpan = Math.max(b.priceMax * MIN_PRICE_RANGE_FRAC, b.priceMax - b.priceMin);
  const pad = pSpan * 0.05;
  return {
    timeStart: b.timeEnd - tSpan,
    timeEnd: b.timeEnd,
    priceMin: b.priceMin - pad,
    priceMax: b.priceMax + pad,
    autoFit: true,
  };
}

export function clampViewport(vp: Viewport, b: DataBounds): Viewport {
  // Allow zooming out wider than data, but clamp insane values.
  const out: Viewport = { ...vp };
  if (out.timeEnd <= out.timeStart) out.timeEnd = out.timeStart + MIN_TIME_RANGE_MS;
  if (out.priceMax <= out.priceMin) {
    const mid = (out.priceMin + out.priceMax) / 2 || 1;
    out.priceMin = mid * (1 - MIN_PRICE_RANGE_FRAC);
    out.priceMax = mid * (1 + MIN_PRICE_RANGE_FRAC);
  }
  // Don't let the user drift completely off the data.
  if (out.timeEnd < b.timeStart) {
    const span = out.timeEnd - out.timeStart;
    out.timeEnd = b.timeStart + span / 4;
    out.timeStart = out.timeEnd - span;
  }
  if (out.timeStart > b.timeEnd) {
    const span = out.timeEnd - out.timeStart;
    out.timeStart = b.timeEnd - span / 4;
    out.timeEnd = out.timeStart + span;
  }
  return out;
}

/** Approximate zoom percentage relative to a reference span. */
export function zoomPercent(vp: Viewport, refSpanMs: number): number {
  const span = vp.timeEnd - vp.timeStart;
  if (span <= 0 || refSpanMs <= 0) return 100;
  return Math.round((refSpanMs / span) * 100);
}

/**
 * Default visible time range per timeframe — used to size the viewport even
 * when only a few seconds of live history are available, so the chart looks
 * useful immediately after a timeframe switch.
 */
export function getDefaultVisibleRangeMs(timeframe: string): number {
  switch (timeframe) {
    case "1m":
      return 15 * 60_000; // 15 minutes
    case "5m":
      return 60 * 60_000; // 1 hour
    case "15m":
      return 4 * 60 * 60_000; // 4 hours
    default:
      return 15 * 60_000;
  }
}

/**
 * Build a viewport anchored at "now" using the timeframe's default visible
 * range. Candle backfill (often hundreds of historical bars) is intentionally
 * ignored when sizing the time axis — otherwise the live order book heatmap,
 * which has only a few seconds of accumulated history, collapses into a sliver
 * on the right edge of the chart while the rest is empty candles.
 *
 * Price bounds still come from the union of heatmap and candles inside the
 * visible window, with a 5% padding on each side.
 *
 * @param overrideSpanMs  if provided, overrides the timeframe-default span.
 *                        Used by the heatmap-lookback selector ("Max", "1h", …)
 *                        to make the viewport match the data the user asked for.
 */
export function fitViewportToLiveWindow(
  bounds: DataBounds,
  timeframe: string,
  nowMs: number = Date.now(),
  overrideSpanMs?: number,
): Viewport {
  const defaultSpan = getDefaultVisibleRangeMs(timeframe);
  const span = overrideSpanMs && overrideSpanMs > 0 ? overrideSpanMs : defaultSpan;
  const timeEnd = Math.max(nowMs, bounds.timeEnd);
  const timeStart = timeEnd - span;
  const pSpan = Math.max(bounds.priceMax * MIN_PRICE_RANGE_FRAC, bounds.priceMax - bounds.priceMin);
  const pad = pSpan * 0.05;
  return {
    timeStart,
    timeEnd,
    priceMin: bounds.priceMin - pad,
    priceMax: bounds.priceMax + pad,
    autoFit: true,
  };
}

/**
 * Build a viewport that fits accumulated data and a chosen timeframe.
 * If data span is shorter than the timeframe's default visible range, extend
 * `timeStart` backwards so cells/candles are not stretched into a single
 * horizontal strip.
 */
export function fitViewportToTimeframe(
  bounds: DataBounds,
  timeframe: string,
): Viewport {
  const defaultSpan = getDefaultVisibleRangeMs(timeframe);
  const dataSpan = Math.max(0, bounds.timeEnd - bounds.timeStart);
  const tSpan = Math.max(defaultSpan, dataSpan);
  const pSpan = Math.max(bounds.priceMax * MIN_PRICE_RANGE_FRAC, bounds.priceMax - bounds.priceMin);
  const pad = pSpan * 0.05;
  return {
    timeStart: bounds.timeEnd - tSpan,
    timeEnd: bounds.timeEnd,
    priceMin: bounds.priceMin - pad,
    priceMax: bounds.priceMax + pad,
    autoFit: true,
  };
}
