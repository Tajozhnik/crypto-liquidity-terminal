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

const BASE = "https://www.okx.com";

interface AdapterDeps {
  ttlSeconds: number;
  timeoutMs: number;
}

/**
 * OKX public market data v5. No API keys required.
 *
 * Symbols are formatted as `BASE-QUOTE` (spot) or `BASE-QUOTE-SWAP` (perpetual swaps).
 * The adapter accepts either internal (BTCUSDT) or native (BTC-USDT) symbols and
 * converts internally for outbound requests using the local helper.
 */
export class OkxAdapter extends BaseAdapter {
  readonly name = "okx" as const;
  readonly marketTypes: MarketType[] = ["spot", "futures"];

  constructor(private readonly deps: AdapterDeps) {
    super();
  }

  async connect(): Promise<void> {
    const ping = await this.track(() =>
      publicFetch<{ code?: string }>({
        key: "okx:time",
        url: `${BASE}/api/v5/public/time`,
        ttlSeconds: 60,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (ping !== null) {
      this.connected = true;
      logger.info("OKX public REST reachable");
    } else {
      logger.warn("OKX public REST unreachable; adapter idle");
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<{
        code: string;
        data: { instId: string; baseCcy: string; quoteCcy: string; state: string; instType: string }[];
      }>({
        key: "okx:instruments:spot",
        url: `${BASE}/api/v5/public/instruments?instType=SPOT`,
        ttlSeconds: 3600,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.data) return [];
    return data.data
      .filter((s) => s.state === "live" && s.quoteCcy === "USDT")
      .slice(0, 200)
      .map((s) => ({
        symbol: s.instId.replace("-", ""), // BTC-USDT → BTCUSDT (internal form)
        exchange: "okx" as const,
        marketType: "spot" as const,
        base: s.baseCcy,
        quote: s.quoteCcy,
      }));
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (!this.connected) return null;
    const instId = toInstId(symbol);
    const data = await this.track(() =>
      publicFetch<{
        data: {
          instId: string;
          last: string;
          bidPx: string;
          askPx: string;
          vol24h: string;
          volCcy24h: string;
          open24h: string;
        }[];
      }>({
        key: `okx:ticker:${instId}`,
        url: `${BASE}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const t = data?.data?.[0];
    if (!t) return null;
    const last = Number.parseFloat(t.last);
    const open24h = Number.parseFloat(t.open24h);
    const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
    return {
      symbol,
      last,
      bid: Number.parseFloat(t.bidPx || t.last),
      ask: Number.parseFloat(t.askPx || t.last),
      volume24h: Number.parseFloat(t.volCcy24h || t.vol24h),
      change24h,
      ts: new Date().toISOString(),
    };
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!this.connected) return [];
    const instId = toInstId(symbol);
    const bar = mapInterval(interval);
    const data = await this.track(() =>
      publicFetch<{ data: string[][] }>({
        key: `okx:klines:${instId}:${bar}:${limit}`,
        url: `${BASE}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.data) return [];
    const closeMs = intervalToMs(interval);
    // OKX returns [ts, o, h, l, c, vol, volCcy, ...] newest-first
    return data.data
      .slice()
      .reverse()
      .map((r) => {
        const ts = Number.parseInt(r[0]!, 10);
        return {
          openTime: new Date(ts).toISOString(),
          closeTime: new Date(ts + closeMs).toISOString(),
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
    const instId = toInstId(symbol);
    const data = await this.track(() =>
      publicFetch<{
        data: { bids: [string, string, string, string][]; asks: [string, string, string, string][] }[];
      }>({
        key: `okx:depth:${instId}:${limit}`,
        url: `${BASE}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=${Math.min(limit, 50)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const ob = data?.data?.[0];
    if (!ob) return null;
    const toLevel = (p: [string, string, string, string]): [number, number] => [
      Number.parseFloat(p[0]),
      Number.parseFloat(p[1]),
    ];
    return {
      symbol,
      bids: ob.bids.map(toLevel),
      asks: ob.asks.map(toLevel),
      ts: new Date().toISOString(),
    };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<Trade[]> {
    if (!this.connected) return [];
    const instId = toInstId(symbol);
    const data = await this.track(() =>
      publicFetch<{
        data: { tradeId: string; px: string; sz: string; side: string; ts: string }[];
      }>({
        key: `okx:trades:${instId}:${limit}`,
        url: `${BASE}/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=${Math.min(limit, 100)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.data) return [];
    return data.data.map((t) => ({
      id: t.tradeId,
      symbol,
      price: Number.parseFloat(t.px),
      qty: Number.parseFloat(t.sz),
      side: t.side === "buy" ? ("buy" as const) : ("sell" as const),
      ts: new Date(Number.parseInt(t.ts, 10)).toISOString(),
    }));
  }

  async getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null> {
    if (!this.connected) return null;
    const instId = toSwapInstId(symbol);
    const oi = await this.track(() =>
      publicFetch<{
        data: { instId: string; oi: string; oiCcy: string }[];
      }>({
        key: `okx:oi:${instId}`,
        url: `${BASE}/api/v5/public/open-interest?instId=${encodeURIComponent(instId)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const fr = await this.track(() =>
      publicFetch<{
        data: { instId: string; fundingRate: string; nextFundingTime: string }[];
      }>({
        key: `okx:funding:${instId}`,
        url: `${BASE}/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    const oiVal = oi?.data?.[0];
    const frVal = fr?.data?.[0];
    if (!oiVal && !frVal) return null;
    return {
      symbol,
      openInterest: oiVal ? Number.parseFloat(oiVal.oi) : null,
      fundingRate: frVal ? Number.parseFloat(frVal.fundingRate) : null,
      nextFundingTs:
        frVal?.nextFundingTime
          ? new Date(Number.parseInt(frVal.nextFundingTime, 10)).toISOString()
          : null,
    };
  }
}

function toInstId(internal: string): string {
  // BTCUSDT → BTC-USDT
  const i = internal.toUpperCase();
  // Simple split on common quote suffixes:
  for (const q of ["USDT", "USDC", "USD", "EUR", "BTC", "ETH"]) {
    if (i.endsWith(q) && i.length > q.length) return `${i.slice(0, -q.length)}-${q}`;
  }
  return i;
}
function toSwapInstId(internal: string): string {
  return `${toInstId(internal)}-SWAP`;
}
function mapInterval(interval: string): string {
  if (interval === "1m") return "1m";
  if (interval === "5m") return "5m";
  if (interval === "15m") return "15m";
  if (interval === "1h") return "1H";
  if (interval === "4h") return "4H";
  if (interval === "1d") return "1D";
  if (interval.endsWith("m")) return interval;
  if (interval.endsWith("h")) return interval.replace("h", "H");
  return interval;
}
