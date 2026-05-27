/**
 * Maintains an in-memory L2 order book by combining a REST snapshot with diff
 * updates from the Binance depth WebSocket stream. Detects gaps in the
 * `lastUpdateId` sequence and signals that a resync is required — it never
 * silently fabricates data.
 *
 * This implementation is exchange-shaped around Binance's depth diff format
 * (`U`, `u` update IDs). For a different exchange a sibling reconstructor can
 * implement the same `applySnapshot` / `applyDiff` API.
 */

export type Level = [number, number]; // [price, qty]

export interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceDepthDiff {
  /** event time in ms */
  E: number;
  /** first update ID in event */
  U: number;
  /** final update ID in event */
  u: number;
  /** previous final update ID (futures only) */
  pu?: number;
  b: [string, string][];
  a: [string, string][];
}

export interface ReconstructorState {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
  /** Last event time, ms epoch */
  lastEventMs: number;
  /** Whether the next diff requires a fresh snapshot */
  needsResync: boolean;
  /** Whether the first post-snapshot ("bridge") diff has been accepted. After
   *  the bridge, every subsequent diff must be strictly contiguous
   *  (`U === lastUpdateId + 1`). */
  bridged: boolean;
}

export class OrderBookReconstructor {
  private state: ReconstructorState = {
    lastUpdateId: 0,
    bids: new Map(),
    asks: new Map(),
    lastEventMs: 0,
    needsResync: true,
    bridged: false,
  };

  applySnapshot(snap: BinanceDepthSnapshot): void {
    this.state.bids = new Map();
    this.state.asks = new Map();
    for (const [p, q] of snap.bids) {
      const price = Number.parseFloat(p);
      const qty = Number.parseFloat(q);
      if (qty > 0) this.state.bids.set(price, qty);
    }
    for (const [p, q] of snap.asks) {
      const price = Number.parseFloat(p);
      const qty = Number.parseFloat(q);
      if (qty > 0) this.state.asks.set(price, qty);
    }
    this.state.lastUpdateId = snap.lastUpdateId;
    this.state.needsResync = false;
    // Force the next diff to be the bridge again.
    this.state.bridged = false;
  }

  /**
   * Apply a Binance diff event. Returns:
   *   - "applied"     — successful update
   *   - "stale"       — diff older than current state, ignored
   *   - "needs_resync" — gap detected; caller must fetch a fresh snapshot
   */
  applyDiff(diff: BinanceDepthDiff): "applied" | "stale" | "needs_resync" {
    const { U, u, b, a } = diff;
    if (this.state.needsResync) return "needs_resync";
    if (u <= this.state.lastUpdateId) return "stale";
    if (this.state.lastUpdateId !== 0) {
      if (!this.state.bridged) {
        // First diff after a snapshot: must straddle the snapshot id
        // (`U <= lastUpdateId + 1 <= u`). The `u <= lastUpdateId` case is
        // already handled above as "stale".
        if (U > this.state.lastUpdateId + 1) {
          this.state.needsResync = true;
          return "needs_resync";
        }
      } else {
        // Post-bridge: every diff must be strictly contiguous to avoid silent
        // gaps where U <= lastUpdateId + 1 but u jumps far ahead.
        if (U !== this.state.lastUpdateId + 1) {
          this.state.needsResync = true;
          return "needs_resync";
        }
      }
    }
    for (const [p, q] of b) {
      const price = Number.parseFloat(p);
      const qty = Number.parseFloat(q);
      if (qty === 0) this.state.bids.delete(price);
      else this.state.bids.set(price, qty);
    }
    for (const [p, q] of a) {
      const price = Number.parseFloat(p);
      const qty = Number.parseFloat(q);
      if (qty === 0) this.state.asks.delete(price);
      else this.state.asks.set(price, qty);
    }
    this.state.lastUpdateId = u;
    if (diff.E) this.state.lastEventMs = diff.E;
    this.state.bridged = true;
    return "applied";
  }

  /** Returns top N levels per side, sorted (bids desc, asks asc). */
  topOfBook(levels: number): { bids: Level[]; asks: Level[] } {
    const bids = [...this.state.bids.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, levels)
      .map(([p, q]) => [p, q] as Level);
    const asks = [...this.state.asks.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, levels)
      .map(([p, q]) => [p, q] as Level);
    return { bids, asks };
  }

  needsResync(): boolean {
    return this.state.needsResync;
  }

  lastUpdateId(): number {
    return this.state.lastUpdateId;
  }

  /** Force a resync requirement (e.g. after a long disconnect). */
  markStale(): void {
    this.state.needsResync = true;
    this.state.bridged = false;
  }

  reset(): void {
    this.state = {
      lastUpdateId: 0,
      bids: new Map(),
      asks: new Map(),
      lastEventMs: 0,
      needsResync: true,
      bridged: false,
    };
  }
}
