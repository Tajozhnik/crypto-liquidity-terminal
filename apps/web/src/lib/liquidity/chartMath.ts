/**
 * Pure helpers that map domain (price/time) to canvas pixels and back.
 * Kept dependency-free so they can be unit-tested directly.
 */

export interface PriceScale {
  priceMin: number;
  priceMax: number;
  /** Top of the chart in canvas pixels. */
  yTop: number;
  /** Bottom of the chart in canvas pixels. */
  yBottom: number;
}

export interface TimeScale {
  timeMin: number; // ms epoch
  timeMax: number; // ms epoch
  xLeft: number;
  xRight: number;
}

export function priceToY(price: number, s: PriceScale): number {
  if (s.priceMax === s.priceMin) return s.yBottom;
  const ratio = (price - s.priceMin) / (s.priceMax - s.priceMin);
  return s.yBottom - ratio * (s.yBottom - s.yTop);
}

export function yToPrice(y: number, s: PriceScale): number {
  if (s.yBottom === s.yTop) return s.priceMin;
  const ratio = (s.yBottom - y) / (s.yBottom - s.yTop);
  return s.priceMin + ratio * (s.priceMax - s.priceMin);
}

export function timeToX(t: number, s: TimeScale): number {
  if (s.timeMax === s.timeMin) return s.xLeft;
  const ratio = (t - s.timeMin) / (s.timeMax - s.timeMin);
  return s.xLeft + ratio * (s.xRight - s.xLeft);
}

export function xToTime(x: number, s: TimeScale): number {
  if (s.xRight === s.xLeft) return s.timeMin;
  const ratio = (x - s.xLeft) / (s.xRight - s.xLeft);
  return s.timeMin + ratio * (s.timeMax - s.timeMin);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
