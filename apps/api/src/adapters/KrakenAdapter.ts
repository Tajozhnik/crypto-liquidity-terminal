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

const BASE = "https://api.kraken.com";

interface AdapterDeps {
  ttlSeconds: number;
  timeoutMs: number;
}

/**
 * Kraken public market data. No API keys required.
 *
 * Kraken's REST returns asset pairs with legacy "wsname" like "XBT/USD"; modern
 * `altname` is closer to BTCUSD. We use altname as the canonical symbol and
 * normalize XBT→BTC at the boundary so internal form remains BASEQUOTE.
 *
 * Kraken Exchange (this base) is spot-only here. Kraken Futures lives at a
 * separate base URL (futures.kraken.com) which would require a separate adapter
 * — left out to keep the no-subscription scope tight.
 */
export class KrakenAdapter extends BaseAdapter {
  readonly name = "kraken" as const;
  readonly marketTypes: MarketType[] = ["spot"];

  /** Map internal symbol (BTCUSD) -> Kraken pair id (XXBTZUSD or XBTUSD). */
  private symbolMap = new Map<string, string>();

  constructor(private readonly deps: AdapterDeps) {
    super();
  }

  async connect(): Promise<void> {
    const ping = await this.track(() =>
      publicFetch<{ result?: { unixtime: number } }>({
        key: "kraken:time",
        url: `${BASE}/0/public/Time`,
        ttlSeconds: 60,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (ping !== null) {
      this.connected = true;
      logger.info("Kraken public REST reachable");
    } else {
      logger.warn("Kraken public REST unreachable; adapter idle");
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.connected) return [];
    const data = await this.track(() =>
      publicFetch<{
        result: Record<string, { altname: string; wsname: string; base: string; quote: string; status: string }>;
      }>({
        key: "kraken:assetpairs",
        url: `${BASE}/0/public/AssetPairs`,
        ttlSeconds: 3600,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return [];
    const out: Market[] = [];
    for (const [krakenId, info] of Object.entries(data.result)) {
      if (info.status !== "online") continue;
      const rawBase = info.wsname?.split("/")[0] ?? info.base;
      const rawQuote = info.wsname?.split("/")[1] ?? info.quote;
      const wsBase = aliasKrakenAsset(rawBase);
      const wsQuote = aliasKrakenAsset(rawQuote);
      if (wsQuote !== "USD") continue;
      const internal = `${wsBase}${wsQuote}`;
      this.symbolMap.set(internal, krakenId);
      if (info.altname) this.symbolMap.set(internal, info.altname);
      out.push({
        symbol: internal,
        exchange: "kraken" as const,
        marketType: "spot" as const,
        base: wsBase,
        quote: wsQuote,
      });
      if (out.length >= 200) break;
    }
    return out;
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (!this.connected) return null;
    const pair = this.symbolMap.get(symbol) ?? toAltname(symbol);
    const data = await this.track(() =>
      publicFetch<{
        result: Record<string, { c: string[]; b: string[]; a: string[]; v: string[]; o: string }>;
      }>({
        key: `kraken:ticker:${pair}`,
        url: `${BASE}/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return null;
    const k = Object.values(data.result)[0];
    if (!k) return null;
    const last = Number.parseFloat(k.c[0] ?? "0");
    const open = Number.parseFloat(k.o ?? "0");
    const change24h = open > 0 ? ((last - open) / open) * 100 : 0;
    return {
      symbol,
      last,
      bid: Number.parseFloat(k.b[0] ?? `${last}`),
      ask: Number.parseFloat(k.a[0] ?? `${last}`),
      volume24h: Number.parseFloat(k.v[1] ?? k.v[0] ?? "0"),
      change24h,
      ts: new Date().toISOString(),
    };
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!this.connected) return [];
    const pair = this.symbolMap.get(symbol) ?? toAltname(symbol);
    const minutes = mapInterval(interval);
    const data = await this.track(() =>
      publicFetch<{
        result: Record<string, [number, string, string, string, string, string, string, number][]> & {
          last?: number;
        };
      }>({
        key: `kraken:ohlc:${pair}:${minutes}:${limit}`,
        url: `${BASE}/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${minutes}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return [];
    const rows = Object.entries(data.result).find(([k]) => k !== "last")?.[1] as
      | [number, string, string, string, string, string, string, number][]
      | undefined;
    if (!rows) return [];
    return rows.slice(-limit).map((r) => {
      const tMs = (r[0] as number) * 1000;
      return {
        openTime: new Date(tMs).toISOString(),
        closeTime: new Date(tMs + minutes * 60_000).toISOString(),
        open: Number.parseFloat(r[1]!),
        high: Number.parseFloat(r[2]!),
        low: Number.parseFloat(r[3]!),
        close: Number.parseFloat(r[4]!),
        volume: Number.parseFloat(r[6]!),
      };
    });
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBook | null> {
    if (!this.connected) return null;
    const pair = this.symbolMap.get(symbol) ?? toAltname(symbol);
    const data = await this.track(() =>
      publicFetch<{ result: Record<string, { bids: [string, string, number][]; asks: [string, string, number][] }> }>({
        key: `kraken:depth:${pair}:${limit}`,
        url: `${BASE}/0/public/Depth?pair=${encodeURIComponent(pair)}&count=${Math.min(limit, 100)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return null;
    const ob = Object.values(data.result)[0];
    if (!ob) return null;
    const toLevel = (p: [string, string, number]): [number, number] => [
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
    const pair = this.symbolMap.get(symbol) ?? toAltname(symbol);
    const data = await this.track(() =>
      publicFetch<{ result: Record<string, [string, string, number, string, string, string][]> }>({
        key: `kraken:trades:${pair}:${limit}`,
        url: `${BASE}/0/public/Trades?pair=${encodeURIComponent(pair)}`,
        ttlSeconds: this.deps.ttlSeconds,
        timeoutMs: this.deps.timeoutMs,
      }),
    );
    if (!data?.result) return [];
    const rows = Object.entries(data.result).find(([k]) => k !== "last")?.[1] as
      | [string, string, number, string, string, string][]
      | undefined;
    if (!rows) return [];
    return rows.slice(-Math.min(limit, 1000)).map((r, i) => ({
      id: `kraken-${r[2]}-${i}`,
      symbol,
      price: Number.parseFloat(r[0]!),
      qty: Number.parseFloat(r[1]!),
      side: r[3] === "b" ? ("buy" as const) : ("sell" as const),
      ts: new Date((r[2] as number) * 1000).toISOString(),
    }));
  }

  async getFuturesMetrics(_symbol: string): Promise<FuturesMetrics | null> {
    return null;
  }
}

function toAltname(internal: string): string {
  // BTCUSD → XBTUSD; ETHUSD → ETHUSD
  if (internal.startsWith("BTC")) return `XBT${internal.slice(3)}`;
  return internal;
}

/**
 * Convert Kraken's legacy asset codes (XXBT, ZUSD, ...) to canonical asset symbols.
 * Specific aliases take precedence; the generic prefix strip is restricted to
 * a closed allowlist so real tickers that happen to start with `X` or `Z`
 * (XTZ, XEM, ZRX, ZEC) are NOT mangled.
 */
const KRAKEN_X_PREFIXED = new Set(["XBT", "XXBT", "XETH", "XLTC", "XXRP", "XXLM", "XZEC", "XREP", "XXMR", "XDG"]);
const KRAKEN_Z_PREFIXED_QUOTES = new Set(["ZUSD", "ZEUR", "ZGBP", "ZJPY", "ZCAD", "ZAUD", "ZCHF"]);
function aliasKrakenAsset(raw: string): string {
  const u = raw.toUpperCase();
  if (u === "XBT" || u === "XXBT") return "BTC";
  if (u === "ZUSD") return "USD";
  if (u === "ZEUR") return "EUR";
  if (u === "ZGBP") return "GBP";
  if (u === "ZJPY") return "JPY";
  if (u === "ZCAD") return "CAD";
  if (u === "ZAUD") return "AUD";
  if (u === "ZCHF") return "CHF";
  if (u === "XETH") return "ETH";
  if (u === "XLTC") return "LTC";
  if (u === "XXRP") return "XRP";
  if (u === "XXLM") return "XLM";
  if (u === "XZEC") return "ZEC";
  if (u === "XREP") return "REP";
  if (u === "XXMR") return "XMR";
  if (u === "XDG") return "DOGE";
  // Restricted generic strip: only strip a leading X/Z when the full code is
  // a known legacy form. Plain tickers like XTZ, XEM, ZRX, ZEC must pass
  // through unchanged.
  if (KRAKEN_X_PREFIXED.has(u)) return u.slice(1);
  if (KRAKEN_Z_PREFIXED_QUOTES.has(u)) return u.slice(1);
  return u;
}
function mapInterval(interval: string): number {
  if (interval === "1m") return 1;
  if (interval === "5m") return 5;
  if (interval === "15m") return 15;
  if (interval === "30m") return 30;
  if (interval === "1h") return 60;
  if (interval === "4h") return 240;
  if (interval === "1d") return 1440;
  return 1;
}
