import { RingBuffer } from "./RingBuffer.js";
import type { Level } from "./OrderBookReconstructor.js";

/**
 * Periodic in-memory ring buffer of order book snapshots (top N per side).
 * One entry per LiquidityFeed sample tick (default every 250 ms = 4 Hz).
 * Capacity is set by the caller — typically derived from the configured
 * `MAX_HEATMAP_LOOKBACK_HOURS` env value. Older entries are pruned by
 * capacity.
 */

export interface DepthSnapshot {
  /** ms epoch */
  t: number;
  bids: Level[];
  asks: Level[];
  midPrice: number;
}

export class DepthSnapshotStore {
  private buf: RingBuffer<DepthSnapshot>;
  /**
   * @param capacity number of snapshots to retain. The LiquidityFeed sets this
   * to `MAX_HEATMAP_LOOKBACK_HOURS × 3 600 000 / SNAPSHOT_INTERVAL_MS`. The
   * `600` default is only meaningful for direct/test usage of this class.
   */
  constructor(capacity = 600) {
    this.buf = new RingBuffer<DepthSnapshot>(capacity);
  }

  push(snap: DepthSnapshot): void {
    this.buf.push(snap);
  }

  /** Return all snapshots (oldest first). */
  all(): DepthSnapshot[] {
    return this.buf.toArray();
  }

  /** Return snapshots within [t0, t1] (inclusive). */
  range(t0: number, t1: number): DepthSnapshot[] {
    return this.buf.filter((s) => s.t >= t0 && s.t <= t1);
  }

  size(): number {
    return this.buf.size();
  }

  clear(): void {
    this.buf.clear();
  }
}
