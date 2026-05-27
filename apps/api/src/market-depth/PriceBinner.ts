/**
 * Maps a price to a discrete bin index, given a reference price and a bin width.
 * Auto bin size: divide the requested price range by the target bin count.
 */

export type BinSizeMode = "auto" | "0.1%" | "0.25%" | "0.5%" | "1%";

const PERCENT_MAP: Record<Exclude<BinSizeMode, "auto">, number> = {
  "0.1%": 0.001,
  "0.25%": 0.0025,
  "0.5%": 0.005,
  "1%": 0.01,
};

export interface BinSpec {
  binWidth: number;
  midPrice: number;
}

/**
 * Pick a bin width.
 *
 * - For fixed percentage modes (e.g. "0.5%"): binWidth = midPrice × pct.
 * - For "auto": divide the visible price range into ~targetBins (default 120) bins.
 *   The visible range can be derived from the actual order book (priceMin/Max)
 *   to avoid producing bins so coarse that everything collapses onto a single row.
 */
export function chooseBinWidth(
  midPrice: number,
  mode: BinSizeMode,
  /** half-range in % above and below the mid, used as a fallback when explicit range absent */
  halfRangePct = 0.05,
  options?: { priceMin?: number; priceMax?: number; targetBins?: number },
): BinSpec {
  if (!Number.isFinite(midPrice) || midPrice <= 0) return { binWidth: 1, midPrice };

  if (mode !== "auto") {
    return { binWidth: midPrice * PERCENT_MAP[mode], midPrice };
  }

  const target = options?.targetBins ?? 120;
  const explicitRange =
    options?.priceMin !== undefined &&
    options?.priceMax !== undefined &&
    options.priceMax > options.priceMin
      ? options.priceMax - options.priceMin
      : null;
  const fullRange = explicitRange ?? midPrice * halfRangePct * 2;
  const raw = fullRange / target;
  if (!Number.isFinite(raw) || raw <= 0) return { binWidth: midPrice * 0.0005, midPrice };
  return { binWidth: raw, midPrice };
}

/** Map a price to its bin's lower bound. */
export function priceToBin(price: number, binWidth: number): number {
  if (binWidth <= 0 || !Number.isFinite(price)) return 0;
  return Math.floor(price / binWidth) * binWidth;
}
