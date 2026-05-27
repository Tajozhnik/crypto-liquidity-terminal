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
import { publicFetch } from "./publicFetch.js";

const SPOT_REST = "https://api.binance.com";
const FAPI_REST = "https://fapi.binance.com";

interface AdapterDeps {
  ttlSeconds: number;
  timeoutMs: number;
}

export class BinanceAdapter extends BaseAdapter {
  readonly name = "binance" as const;
  readonly marketTypes: MarketType[] = ["spot", "futures"];

  constructor(private readonly deps: AdapterDeps) {
    super();
  }

  async connect(): Promise<void> {
    const ping = await this.track(() =>
      publicFetch<Record<string, unknown>>({
        key: "binance:ping",
        url: `${SPOT_REST}/api/v3/ping`,
        ttlSeconds: 60,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (ping !== null) {
      this.connected = true;
      logger.info("Binance public REST reachable");
    } else {
      logger.warn("Binance public REST unreachable; adapter idle");
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<{ symbols?: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }>({
        key: "binance:exchangeInfo",
        url: `${SPOT_REST}/api/v3/exchangeInfo`,
        ttlSeconds: 3600,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.symbols) return [];
    return data.symbols
      .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT")
      .slice(0, 200)
      .map((s) => ({
        symbol: s.symbol,
        exchange: "binance" as const,
        marketType: "spot" as const,
        base: s.baseAsset,
        quote: s.quoteAsset,
      }));
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (!this.connected) return null;
    const t = await this.track(() =>
      publicFetch<{
        lastPrice: string;
        bidPrice: string;
        askPrice: string;
        volume: string;
        priceChangePercent: string;
        closeTime: number;
      }>({
        key: `binance:ticker:${symbol}`,
        url: `${SPOT_REST}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!t) return null;
    return {
      symbol,
      last: Number.parseFloat(t.lastPrice),
      bid: Number.parseFloat(t.bidPrice),
      ask: Number.parseFloat(t.askPrice),
      volume24h: Number.parseFloat(t.volume),
      change24h: Number.parseFloat(t.priceChangePercent),
      ts: new Date(t.closeTime).toISOString(),
    };
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!this.connected) return [];
    const url = `${SPOT_REST}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const rows = await this.track(() =>
      publicFetch<[number, string, string, string, string, string, number, ...unknown[]][]>({
        key: `binance:klines:${symbol}:${interval}:${limit}`,
        url,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!rows) return [];
    return rows.map((r) => ({
      openTime: new Date(r[0]).toISOString(),
      closeTime: new Date(r[6]).toISOString(),
      open: Number.parseFloat(r[1]),
      high: Number.parseFloat(r[2]),
      low: Number.parseFloat(r[3]),
      close: Number.parseFloat(r[4]),
      volume: Number.parseFloat(r[5]),
    }));
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBook | null> {
    if (!this.connected) return null;
    const ob = await this.track(() =>
      publicFetch<{ bids: [string, string][]; asks: [string, string][] }>({
        key: `binance:depth:${symbol}:${limit}`,
        url: `${SPOT_REST}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!ob) return null;
    const toLevel = (p: [string, string]): [number, number] => [
      Number.parseFloat(p[0]),
      Number.parseFloat(p[1]),
    ];
    return { symbol, bids: ob.bids.map(toLevel), asks: ob.asks.map(toLevel), ts: new Date().toISOString() };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<Trade[]> {
    if (!this.connected) return [];
    const rows = await this.track(() =>
      publicFetch<{ id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[]>({
        key: `binance:trades:${symbol}:${limit}`,
        url: `${SPOT_REST}/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!rows) return [];
    return rows.map((t) => ({
      id: String(t.id),
      symbol,
      price: Number.parseFloat(t.price),
      qty: Number.parseFloat(t.qty),
      side: t.isBuyerMaker ? ("sell" as const) : ("buy" as const),
      ts: new Date(t.time).toISOString(),
    }));
  }

  async getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null> {
    if (!this.connected) return null;
    const oi = await this.track(() =>
      publicFetch<{ openInterest: string }>({
        key: `binance:fapi:oi:${symbol}`,
        url: `${FAPI_REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const pr = await this.track(() =>
      publicFetch<{ lastFundingRate: string; nextFundingTime: number }>({
        key: `binance:fapi:premium:${symbol}`,
        url: `${FAPI_REST}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!oi || !pr) return null;
    return {
      symbol,
      openInterest: Number.parseFloat(oi.openInterest),
      fundingRate: Number.parseFloat(pr.lastFundingRate),
      nextFundingTs: pr.nextFundingTime ? new Date(pr.nextFundingTime).toISOString() : null,
    };
  }
}
