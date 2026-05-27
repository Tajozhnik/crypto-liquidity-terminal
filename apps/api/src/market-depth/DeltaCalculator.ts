import type { AggTrade } from "./TradeBuffer.js";

export interface DeltaBucket {
  /** Bucket start ms epoch */
  t: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
}

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

/**
 * Bucket recent trades into delta histograms. Pure function over the input.
 *
 * `buyerIsMaker = false` → taker bought (aggressive buy), counts towards buyVolume.
 * `buyerIsMaker = true`  → taker sold, counts towards sellVolume.
 */
export function bucketDelta(
  trades: AggTrade[],
  timeframe: keyof typeof TIMEFRAME_MS | string,
): DeltaBucket[] {
  const ms = TIMEFRAME_MS[timeframe] ?? 60_000;
  const map = new Map<number, DeltaBucket>();
  for (const t of trades) {
    const bucketStart = Math.floor(t.t / ms) * ms;
    let row = map.get(bucketStart);
    if (!row) {
      row = { t: bucketStart, buyVolume: 0, sellVolume: 0, delta: 0, cumulativeDelta: 0 };
      map.set(bucketStart, row);
    }
    if (t.buyerIsMaker) row.sellVolume += t.qty * t.price;
    else row.buyVolume += t.qty * t.price;
  }
  const out = [...map.values()].sort((a, b) => a.t - b.t);
  let cum = 0;
  for (const r of out) {
    r.delta = r.buyVolume - r.sellVolume;
    cum += r.delta;
    r.cumulativeDelta = cum;
  }
  return out;
}
