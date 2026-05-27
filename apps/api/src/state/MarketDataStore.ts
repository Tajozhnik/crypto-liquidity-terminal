import type { ScreenerResult, Signal } from "@screener/shared";

export function makeMarketKey(exchange: string, marketType: string, symbol: string): string {
  return `${exchange}:${marketType}:${symbol}`;
}

/**
 * In-memory snapshot store keyed by `exchange:marketType:symbol` so that the
 * same symbol on different exchanges does not collide.
 */
export class MarketDataStore {
  private snapshots = new Map<string, ScreenerResult>();
  private recentSignals: Signal[] = [];
  private readonly maxRecentSignals = 500;

  setSnapshot(result: ScreenerResult): void {
    this.snapshots.set(makeMarketKey(result.exchange, result.marketType, result.symbol), result);
  }

  setSnapshots(results: ScreenerResult[]): void {
    for (const r of results) this.setSnapshot(r);
  }

  /**
   * Lookup by symbol with optional disambiguation.
   * - When `exchange` and `marketType` are supplied, performs a strict key
   *   lookup (no scan).
   * - When only the symbol is supplied, falls back to the legacy "first match
   *   across exchanges" behaviour. Prefer the strict form on routes that take
   *   an `exchange` query param so multi-exchange installs don't silently
   *   collapse the same symbol from two venues.
   */
  get(symbol: string, exchange?: string, marketType?: string): ScreenerResult | undefined {
    if (exchange && marketType) {
      return this.snapshots.get(makeMarketKey(exchange, marketType, symbol));
    }
    for (const r of this.snapshots.values()) {
      if (r.symbol === symbol) return r;
    }
    return undefined;
  }

  /** Strict lookup by full market key. */
  getByKey(exchange: string, marketType: string, symbol: string): ScreenerResult | undefined {
    return this.snapshots.get(makeMarketKey(exchange, marketType, symbol));
  }

  list(): ScreenerResult[] {
    return [...this.snapshots.values()];
  }

  size(): number {
    return this.snapshots.size;
  }

  pushSignals(signals: Signal[]): void {
    if (signals.length === 0) return;
    this.recentSignals.push(...signals);
    if (this.recentSignals.length > this.maxRecentSignals) {
      this.recentSignals.splice(0, this.recentSignals.length - this.maxRecentSignals);
    }
  }

  getRecentSignals(limit = 50): Signal[] {
    return this.recentSignals.slice(-limit).reverse();
  }

  getRecentSignalsForSymbol(symbol: string, limit = 50): Signal[] {
    const out: Signal[] = [];
    for (let i = this.recentSignals.length - 1; i >= 0 && out.length < limit; i--) {
      const sig = this.recentSignals[i]!;
      if (sig.symbol === symbol) out.push(sig);
    }
    return out;
  }
}
