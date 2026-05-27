import { RingBuffer } from "./RingBuffer.js";

/**
 * Live aggregator of recent trades for a single symbol. Drives the bottom
 * delta histogram on the liquidity heatmap page.
 */

export interface AggTrade {
  /** ms epoch */
  t: number;
  price: number;
  qty: number;
  /** Whether the trade was a buyer-was-maker (i.e. the taker sold). */
  buyerIsMaker: boolean;
}

export class TradeBuffer {
  private buf: RingBuffer<AggTrade>;
  constructor(capacity = 5000) {
    this.buf = new RingBuffer<AggTrade>(capacity);
  }

  push(t: AggTrade): void {
    this.buf.push(t);
  }

  pushMany(trades: AggTrade[]): void {
    this.buf.pushMany(trades);
  }

  /** Return trades within [t0, t1]. */
  range(t0: number, t1: number): AggTrade[] {
    return this.buf.filter((t) => t.t >= t0 && t.t <= t1);
  }

  recent(limit: number): AggTrade[] {
    const all = this.buf.toArray();
    return all.slice(-limit);
  }

  size(): number {
    return this.buf.size();
  }

  clear(): void {
    this.buf.clear();
  }
}
