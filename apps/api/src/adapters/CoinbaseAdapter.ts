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

const BASE = "https://api.exchange.coinbase.com";

interface AdapterDeps {
  ttlSeconds: number;
  timeoutMs: number;
}

/**
 * Coinbase Exchange public market data. No API keys required.
 *
 * Coinbase is spot-only — getFuturesMetrics always returns null.
 * Symbols use BASE-QUOTE format ("BTC-USD"). Internal form is BTCUSD.
 */
export class CoinbaseAdapter extends BaseAdapter {
  readonly name = "coinbase" as const;
  readonly marketTypes: MarketType[] = ["spot"];

  constructor(private readonly deps: AdapterDeps) {
    super();
  }

  async connect(): Promise<void> {
    const ping = await this.track(() =>
      publicFetch<{ iso?: string }>({
        key: "coinbase:time",
        url: `${BASE}/time`,
        ttlSeconds: 60,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (ping !== null) {
      this.connected = true;
      logger.info("Coinbase public REST reachable");
    } else {
      logger.warn("Coinbase public REST unreachable; adapter idle");
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<
        { id: string; base_currency: string; quote_currency: string; status: string; trading_disabled?: boolean }[]
      >({
        key: "coinbase:products",
        url: `${BASE}/products`,
        ttlSeconds: 3600,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data) return [];
    return data
      .filter((p) => p.status === "online" && !p.trading_disabled && p.quote_currency === "USD")
      .slice(0, 200)
      .map((p) => ({
        symbol: `${p.base_currency}${p.quote_currency}`, // BTCUSD internal
        exchange: "coinbase" as const,
        marketType: "spot" as const,
        base: p.base_currency,
        quote: p.quote_currency,
      }));
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (!this.connected) return null;
    const productId = toProductId(symbol);
    const t = await this.track(() =>
      publicFetch<{ price: string; bid: string; ask: string; volume: string; time: string }>({
        key: `coinbase:ticker:${productId}`,
        url: `${BASE}/products/${encodeURIComponent(productId)}/ticker`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!t) return null;
    // Coinbase ticker doesn't return 24h change; compute later from candles when needed.
    return {
      symbol,
      last: Number.parseFloat(t.price),
      bid: Number.parseFloat(t.bid || t.price),
      ask: Number.parseFloat(t.ask || t.price),
      volume24h: Number.parseFloat(t.volume),
      change24h: 0,
      ts: t.time ?? new Date().toISOString(),
    };
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!this.connected) return [];
    const productId = toProductId(symbol);
    const granularity = mapInterval(interval);
    // Coinbase /candles returns max 300 entries
    const data = await this.track(() =>
      publicFetch<[number, number, number, number, number, number][]>({
        key: `coinbase:candles:${productId}:${granularity}:${limit}`,
        url: `${BASE}/products/${encodeURIComponent(productId)}/candles?granularity=${granularity}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data) return [];
    // [time, low, high, open, close, volume]; time is seconds (Unix); newest-first
    return data
      .slice()
      .reverse()
      .slice(-limit)
      .map((r) => {
        const tMs = (r[0] as number) * 1000;
        return {
          openTime: new Date(tMs).toISOString(),
          closeTime: new Date(tMs + granularity * 1000).toISOString(),
          open: r[3] as number,
          high: r[2] as number,
          low: r[1] as number,
          close: r[4] as number,
          volume: r[5] as number,
        };
      });
  }

  async getOrderBook(symbol: string, _limit = 50): Promise<OrderBook | null> {
    if (!this.connected) return null;
    const productId = toProductId(symbol);
    // level=2 returns top 50 aggregated levels per side
    const data = await this.track(() =>
      publicFetch<{ bids: [string, string, number][]; asks: [string, string, number][]; time?: string }>({
        key: `coinbase:book:${productId}`,
        url: `${BASE}/products/${encodeURIComponent(productId)}/book?level=2`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data) return null;
    const toLevel = (p: [string, string, number]): [number, number] => [
      Number.parseFloat(p[0]),
      Number.parseFloat(p[1]),
    ];
    return {
      symbol,
      bids: (data.bids ?? []).map(toLevel),
      asks: (data.asks ?? []).map(toLevel),
      ts: data.time ?? new Date().toISOString(),
    };
  }

  async getRecentTrades(symbol: string, limit = 100): Promise<Trade[]> {
    if (!this.connected) return [];
    const productId = toProductId(symbol);
    const data = await this.track(() =>
      publicFetch<{ trade_id: number; price: string; size: string; side: string; time: string }[]>({
        key: `coinbase:trades:${productId}:${limit}`,
        url: `${BASE}/products/${encodeURIComponent(productId)}/trades?limit=${Math.min(limit, 100)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data) return [];
    return data.map((t) => ({
      id: String(t.trade_id),
      symbol,
      price: Number.parseFloat(t.price),
      qty: Number.parseFloat(t.size),
      // Coinbase reports the maker side; "buy" means maker was a buyer (taker sold)
      side: t.side === "buy" ? ("sell" as const) : ("buy" as const),
      ts: t.time,
    }));
  }

  async getFuturesMetrics(_symbol: string): Promise<FuturesMetrics | null> {
    // Coinbase Exchange (this base) is spot-only.
    return null;
  }
}

function toProductId(internal: string): string {
  // BTCUSD → BTC-USD
  const i = internal.toUpperCase();
  for (const q of ["USDT", "USDC", "USD", "EUR", "BTC", "ETH"]) {
    if (i.endsWith(q) && i.length > q.length) return `${i.slice(0, -q.length)}-${q}`;
  }
  return i;
}
function mapInterval(interval: string): number {
  // Coinbase accepts seconds: 60, 300, 900, 3600, 21600, 86400
  if (interval === "1m") return 60;
  if (interval === "5m") return 300;
  if (interval === "15m") return 900;
  if (interval === "1h") return 3600;
  if (interval === "6h") return 21600;
  if (interval === "1d") return 86400;
  return 60;
}
