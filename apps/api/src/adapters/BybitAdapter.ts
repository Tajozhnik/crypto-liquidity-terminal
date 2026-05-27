import type {
  FuturesMetrics,
  Kline,
  Market,
  MarketType,
  OrderBook,
  Ticker,
  Trade,
} from "@screener/shared";
import { logger } from "../logger.js";
import { BaseAdapter } from "./BaseAdapter.js";
import { intervalToMs } from "./normalize.js";
import { publicFetch } from "./publicFetch.js";

const BASE = "https://api.bybit.com";

interface AdapterDeps {
  ttlSeconds: number;
  timeoutMs: number;
}

/**
 * Bybit v5 public market data (no API key required).
 *
 * Bybit v5 distinguishes between "category=spot" and "category=linear" (USDT-perp).
 * This adapter exposes spot via getMarkets/getTicker/.../getKlines and futures
 * metrics via getFuturesMetrics for the same symbol on linear category.
 */
export class BybitAdapter extends BaseAdapter {
  readonly name = "bybit" as const;
  readonly marketTypes: MarketType[] = ["spot", "futures"];

  constructor(private readonly deps: AdapterDeps) {
    super();
  }

  async connect(): Promise<void> {
    const ping = await this.track(() =>
      publicFetch<{ retCode?: number }>({
        key: "bybit:time",
        url: `${BASE}/v5/market/time`,
        ttlSeconds: 60,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (ping !== null) {
      this.connected = true;
      logger.info("Bybit public REST reachable");
    } else {
      logger.warn("Bybit public REST unreachable; adapter idle");
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<{
        retCode: number;
        result: { list: { symbol: string; baseCoin: string; quoteCoin: string; status: string }[] };
      }>({
        key: "bybit:instruments:spot",
        url: `${BASE}/v5/market/instruments-info?category=spot`,
        ttlSeconds: 3600,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result?.list) return [];
    return data.result.list
      .filter((s) => s.status === "Trading" && s.quoteCoin === "USDT")
      .slice(0, 200)
      .map((s) => ({
        symbol: s.symbol,
        exchange: "bybit" as const,
        marketType: "spot" as const,
        base: s.baseCoin,
        quote: s.quoteCoin,
      }));
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (!this.connected) return null;
    const data = await this.track(() =>
      publicFetch<{
        result: {
          list: {
            symbol: string;
            lastPrice: string;
            bid1Price: string;
            ask1Price: string;
            volume24h: string;
            turnover24h: string;
            price24hPcnt: string;
          }[];
        };
      }>({
        key: `bybit:ticker:spot:${symbol}`,
        url: `${BASE}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const t = data?.result?.list?.[0];
    if (!t) return null;
    return {
      symbol,
      last: Number.parseFloat(t.lastPrice),
      bid: Number.parseFloat(t.bid1Price || t.lastPrice),
      ask: Number.parseFloat(t.ask1Price || t.lastPrice),
      volume24h: Number.parseFloat(t.turnover24h || t.volume24h),
      change24h: Number.parseFloat(t.price24hPcnt) * 100,
      ts: new Date().toISOString(),
    };
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!this.connected) return [];
    const interval2 = mapInterval(interval);
    const data = await this.track(() =>
      publicFetch<{
        result: { list: [string, string, string, string, string, string, string][] };
      }>({
        key: `bybit:klines:spot:${symbol}:${interval2}:${limit}`,
        url: `${BASE}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${interval2}&limit=${Math.min(limit, 1000)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result?.list) return [];
    const closeMs = intervalToMs(interval);
    // Bybit returns newest-first; reverse to oldest-first for engine compatibility
    return data.result.list
      .slice()
      .reverse()
      .map((r) => {
        const ot = Number.parseInt(r[0]!, 10);
        return {
          openTime: new Date(ot).toISOString(),
          closeTime: new Date(ot + closeMs).toISOString(),
          open: Number.parseFloat(r[1]!),
          high: Number.parseFloat(r[2]!),
          low: Number.parseFloat(r[3]!),
          close: Number.parseFloat(r[4]!),
          volume: Number.parseFloat(r[5]!),
        };
      });
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBook | null> {
    if (!this.connected) return null;
    const data = await this.track(() =>
      publicFetch<{
        result: { b: [string, string][]; a: [string, string][] };
      }>({
        key: `bybit:depth:spot:${symbol}:${limit}`,
        url: `${BASE}/v5/market/orderbook?category=spot&symbol=${encodeURIComponent(symbol)}&limit=${Math.min(limit, 50)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return null;
    const toLevel = (p: [string, string]): [number, number] => [Number.parseFloat(p[0]), Number.parseFloat(p[1])];
    return {
      symbol,
      bids: (data.result.b ?? []).map(toLevel),
      asks: (data.result.a ?? []).map(toLevel),
      ts: new Date().toISOString(),
    };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<Trade[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<{
        result: {
          list: { execId: string; price: string; size: string; side: string; time: string }[];
        };
      }>({
        key: `bybit:trades:spot:${symbol}:${limit}`,
        url: `${BASE}/v5/market/recent-trade?category=spot&symbol=${encodeURIComponent(symbol)}&limit=${Math.min(limit, 60)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result?.list) return [];
    return data.result.list.map((t) => ({
      id: t.execId,
      symbol,
      price: Number.parseFloat(t.price),
      qty: Number.parseFloat(t.size),
      side: t.side.toLowerCase() === "buy" ? ("buy" as const) : ("sell" as const),
      ts: new Date(Number.parseInt(t.time, 10)).toISOString(),
    }));
  }

  async getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null> {
    if (!this.connected) return null;
    // linear category = USDT-margined perpetuals
    const data = await this.track(() =>
      publicFetch<{
        result: {
          list: {
            symbol: string;
            openInterest: string;
            fundingRate: string;
            nextFundingTime: string;
          }[];
        };
      }>({
        key: `bybit:ticker:linear:${symbol}`,
        url: `${BASE}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const t = data?.result?.list?.[0];
    if (!t) return null;
    return {
      symbol,
      openInterest: Number.parseFloat(t.openInterest),
      fundingRate: Number.parseFloat(t.fundingRate),
      nextFundingTs: t.nextFundingTime ? new Date(Number.parseInt(t.nextFundingTime, 10)).toISOString() : null,
    };
  }
}

function mapInterval(interval: string): string {
  // Bybit accepts "1", "5", "15", "60", "240", "D"
  if (interval.endsWith("m")) return interval.replace("m", "");
  if (interval.endsWith("h")) {
    const h = Number.parseInt(interval.replace("h", ""), 10) || 1;
    return String(h * 60);
  }
  if (interval.toLowerCase().endsWith("d")) return "D";
  return interval;
}
