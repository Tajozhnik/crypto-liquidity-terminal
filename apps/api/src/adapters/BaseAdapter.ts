import type {
  ExchangeName,
  FuturesMetrics,
  Kline,
  Market,
  MarketType,
  OrderBook,
  Ticker,
  Trade,
} from "@screener/shared";
import type { AdapterHealth, ExchangeAdapter, Unsubscribe } from "./ExchangeAdapter.js";

/**
 * Base class for public-API adapters. Tracks lastSuccess / lastError metadata
 * so readiness can report per-adapter health.
 *
 * Subclasses override the public REST methods. `track(...)` is the wrapper that
 * updates health based on the result.
 */
export abstract class BaseAdapter implements ExchangeAdapter {
  abstract readonly name: ExchangeName;
  abstract readonly marketTypes: MarketType[];

  protected connected = false;
  protected enabled = true;
  protected _lastSuccessAt: string | null = null;
  protected _lastErrorAt: string | null = null;
  protected _lastErrorMessage: string | null = null;

  isConnected(): boolean {
    return this.connected && this.enabled;
  }

  health(): AdapterHealth {
    if (!this.enabled) {
      return {
        enabled: false,
        status: "disabled",
        lastSuccessAt: this._lastSuccessAt,
        lastErrorAt: this._lastErrorAt,
        lastErrorMessage: this._lastErrorMessage,
      };
    }
    let status: "ok" | "degraded" | "disabled";
    if (!this._lastSuccessAt && this._lastErrorAt) status = "degraded";
    else if (this._lastSuccessAt && this._lastErrorAt) {
      // If most recent event is an error → degraded, else ok
      status =
        Date.parse(this._lastErrorAt) > Date.parse(this._lastSuccessAt) ? "degraded" : "ok";
    } else if (this._lastSuccessAt) status = "ok";
    else status = "degraded";
    return {
      enabled: true,
      status,
      lastSuccessAt: this._lastSuccessAt,
      lastErrorAt: this._lastErrorAt,
      lastErrorMessage: this._lastErrorMessage,
    };
  }

  /** Wrap an upstream call so we can record health from the result. */
  protected async track<T>(op: () => Promise<T | null>): Promise<T | null> {
    try {
      const v = await op();
      if (v !== null) {
        this._lastSuccessAt = new Date().toISOString();
      } else {
        // null = upstream returned no usable data (cached miss / 429 / network)
        this._lastErrorAt = new Date().toISOString();
        this._lastErrorMessage = this._lastErrorMessage ?? "no data returned";
      }
      return v;
    } catch (err) {
      this._lastErrorAt = new Date().toISOString();
      this._lastErrorMessage = (err as Error).message;
      return null;
    }
  }

  // Default concrete subscribe* fall to no-ops; subclasses override if they
  // implement live streams. This keeps the signature stable across adapters.
  subscribeTickers(_symbols: string[], _cb: (t: Ticker) => void): Unsubscribe {
    return () => {};
  }
  subscribeOrderBook(_symbol: string, _cb: (ob: OrderBook) => void): Unsubscribe {
    return () => {};
  }
  subscribeTrades(_symbol: string, _cb: (t: Trade[]) => void): Unsubscribe {
    return () => {};
  }

  // Subclasses MUST implement these
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getMarkets(): Promise<Market[]>;
  abstract getTicker(symbol: string): Promise<Ticker | null>;
  abstract getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;
  abstract getOrderBook(symbol: string, limit?: number): Promise<OrderBook | null>;
  abstract getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
  abstract getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null>;
}
