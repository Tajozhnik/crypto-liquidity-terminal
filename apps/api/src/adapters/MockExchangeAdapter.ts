import type {
  ExchangeName,
  FuturesMetrics,
  Kline,
  Market,
  MarketType,
  OrderBook,
  OrderBookLevel,
  Ticker,
  Trade,
} from "@screener/shared";
import type { AdapterHealth, ExchangeAdapter, Unsubscribe } from "./ExchangeAdapter.js";
import { mulberry32 } from "./prng.js";

const MAJORS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "TRXUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "ATOMUSDT",
  "NEARUSDT",
  "OPUSDT",
  "ARBUSDT",
  "FILUSDT",
  "INJUSDT",
];
const MEMES = ["SHIBUSDT", "PEPEUSDT", "FLOKIUSDT", "WIFUSDT", "BONKUSDT"];
const ALTS = [
  "APTUSDT",
  "SUIUSDT",
  "TIAUSDT",
  "SEIUSDT",
  "RNDRUSDT",
  "FETUSDT",
  "AGIXUSDT",
  "OCEANUSDT",
  "RUNEUSDT",
  "FTMUSDT",
  "GRTUSDT",
  "AAVEUSDT",
  "UNIUSDT",
  "MKRUSDT",
  "COMPUSDT",
  "SNXUSDT",
  "CRVUSDT",
  "1INCHUSDT",
  "STXUSDT",
  "IMXUSDT",
  "SANDUSDT",
  "MANAUSDT",
  "AXSUSDT",
  "GALAUSDT",
  "CHZUSDT",
  "ENJUSDT",
  "JTOUSDT",
  "PYTHUSDT",
  "JUPUSDT",
  "WLDUSDT",
  "BLURUSDT",
  "ORDIUSDT",
  "RDNTUSDT",
  "MAGICUSDT",
  "ICPUSDT",
  "ETCUSDT",
  "VETUSDT",
  "ALGOUSDT",
  "EOSUSDT",
  "XLMUSDT",
];

const ALL_SYMBOLS = [...MAJORS, ...MEMES, ...ALTS];

const MAX_KLINES = 1500; // ~25h of 1m
const MAX_TRADES = 500;
const ORDERBOOK_DEPTH = 25;

type MarketState = {
  market: Market;
  basePrice: number;
  lastPrice: number;
  klines: Kline[];
  trades: Trade[];
  orderBook: OrderBook;
  futures?: FuturesMetrics;
  openInterestHistory: { ts: number; value: number }[];
  // anomaly schedule
  anomalyEndsAt: number;
  anomalyType: "none" | "pump" | "dump" | "volume_spike" | "spread_widen";
};

export class MockExchangeAdapter implements ExchangeAdapter {
  readonly name = "mock" as const;
  readonly marketTypes: MarketType[] = ["spot", "futures"];
  private rng: () => number;
  private states = new Map<string, MarketState>();
  private timer: NodeJS.Timeout | null = null;
  private connected = false;
  private _lastSuccessAt: string | null = null;

  private tickerSubs = new Set<(t: Ticker) => void>();
  private bookSubs = new Map<string, Set<(ob: OrderBook) => void>>();
  private tradeSubs = new Map<string, Set<(t: Trade[]) => void>>();

  constructor(
    private readonly count: number,
    private readonly seed: number,
    private readonly intervalMs: number,
  ) {
    this.rng = mulberry32(seed);
  }

  async connect(): Promise<void> {
    this.bootstrap();
    this.connected = true;
    this._lastSuccessAt = new Date().toISOString();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  health(): AdapterHealth {
    return {
      enabled: true,
      status: this.connected ? "ok" : "degraded",
      lastSuccessAt: this._lastSuccessAt,
      lastErrorAt: null,
      lastErrorMessage: null,
    };
  }

  // -------------------------------------------------------------------- public

  async getMarkets(): Promise<Market[]> {
    return [...this.states.values()].map((s) => s.market);
  }
  async getTicker(symbol: string): Promise<Ticker | null> {
    const st = this.states.get(symbol);
    return st ? this.makeTicker(st) : null;
  }
  async getKlines(symbol: string, _interval: string, limit: number): Promise<Kline[]> {
    return this.states.get(symbol)?.klines.slice(-limit) ?? [];
  }
  async getOrderBook(symbol: string, _limit?: number): Promise<OrderBook | null> {
    return this.states.get(symbol)?.orderBook ?? null;
  }
  async getRecentTrades(symbol: string, limit = 200): Promise<Trade[]> {
    return this.states.get(symbol)?.trades.slice(-limit) ?? [];
  }
  async getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null> {
    return this.states.get(symbol)?.futures ?? null;
  }

  /** Internal access for the screener job: snapshot all markets in one pass. */
  getAllStates(): MarketState[] {
    return [...this.states.values()];
  }

  subscribeTickers(_symbols: string[], cb: (t: Ticker) => void): Unsubscribe {
    this.tickerSubs.add(cb);
    return () => this.tickerSubs.delete(cb);
  }
  subscribeOrderBook(symbol: string, cb: (ob: OrderBook) => void): Unsubscribe {
    let set = this.bookSubs.get(symbol);
    if (!set) {
      set = new Set();
      this.bookSubs.set(symbol, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }
  subscribeTrades(symbol: string, cb: (t: Trade[]) => void): Unsubscribe {
    let set = this.tradeSubs.get(symbol);
    if (!set) {
      set = new Set();
      this.tradeSubs.set(symbol, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  // -------------------------------------------------------------------- setup

  private bootstrap(): void {
    const symbols = this.pickSymbols(this.count);
    const now = Date.now();
    for (const symbol of symbols) {
      const isFutures = this.rng() < 0.45;
      const basePrice = this.priceFor(symbol);
      const market: Market = {
        symbol,
        exchange: "mock",
        marketType: isFutures ? "futures" : "spot",
        base: symbol.replace("USDT", ""),
        quote: "USDT",
      };
      const klines = this.seedKlines(now, basePrice, MAX_KLINES);
      const lastPrice = klines[klines.length - 1]!.close;
      const state: MarketState = {
        market,
        basePrice,
        lastPrice,
        klines,
        trades: this.seedTrades(symbol, now, lastPrice),
        orderBook: this.makeOrderBook(symbol, lastPrice, now),
        anomalyEndsAt: 0,
        anomalyType: "none",
        openInterestHistory: [],
      };
      if (isFutures) {
        const oi = lastPrice * (10_000 + Math.floor(this.rng() * 50_000));
        state.futures = {
          symbol,
          openInterest: oi,
          fundingRate: (this.rng() - 0.5) * 0.001,
          nextFundingTs: new Date(now + 4 * 3_600_000).toISOString(),
        };
        state.openInterestHistory.push({ ts: now, value: oi });
      }
      this.states.set(symbol, state);
    }
  }

  private pickSymbols(n: number): string[] {
    const required = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const pool = ALL_SYMBOLS.filter((s) => !required.includes(s));
    // Deterministic shuffle with seeded PRNG
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    return [...required, ...pool.slice(0, Math.max(0, n - required.length))];
  }

  private priceFor(symbol: string): number {
    if (symbol === "BTCUSDT") return 60_000 + this.rng() * 5000;
    if (symbol === "ETHUSDT") return 3000 + this.rng() * 500;
    if (symbol === "SOLUSDT") return 140 + this.rng() * 30;
    if (MEMES.includes(symbol)) return 0.000001 + this.rng() * 0.001;
    return 0.5 + this.rng() * 200;
  }

  private seedKlines(nowMs: number, basePrice: number, n: number): Kline[] {
    const klines: Kline[] = [];
    let price = basePrice;
    for (let i = n - 1; i >= 0; i--) {
      const open = price;
      const drift = (this.rng() - 0.5) * 0.002;
      const high = open * (1 + Math.abs(drift) + this.rng() * 0.001);
      const low = open * (1 - Math.abs(drift) - this.rng() * 0.001);
      const close = open * (1 + drift);
      const volume = 1000 + this.rng() * 50_000;
      const ot = nowMs - i * 60_000;
      const ct = ot + 60_000;
      klines.push({
        openTime: new Date(ot).toISOString(),
        closeTime: new Date(ct).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });
      price = close;
    }
    return klines;
  }

  private seedTrades(symbol: string, nowMs: number, price: number): Trade[] {
    const trades: Trade[] = [];
    for (let i = 0; i < 50; i++) {
      const side = this.rng() > 0.5 ? "buy" : "sell";
      const ts = new Date(nowMs - (50 - i) * 200).toISOString();
      trades.push({
        id: `t_${symbol}_${i}`,
        symbol,
        price: price * (1 + (this.rng() - 0.5) * 0.001),
        qty: 0.1 + this.rng() * 5,
        side,
        ts,
      });
    }
    return trades;
  }

  private makeOrderBook(symbol: string, price: number, nowMs: number): OrderBook {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    for (let i = 0; i < ORDERBOOK_DEPTH; i++) {
      bids.push([price * (1 - (i + 1) * 0.0005), 1 + this.rng() * 50]);
      asks.push([price * (1 + (i + 1) * 0.0005), 1 + this.rng() * 50]);
    }
    return { symbol, bids, asks, ts: new Date(nowMs).toISOString() };
  }

  /** Build a ticker for a single market state. Exposed `public static`
   *  so jobs (e.g. ScreenerJob) can derive identical tickers without
   *  duplicating the math. */
  static makeTickerForState(st: MarketState): Ticker {
    const klines = st.klines;
    const last = st.lastPrice;
    const dayAgoIdx = Math.max(0, klines.length - 1440);
    const open24h = klines[dayAgoIdx]!.open;
    const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
    const volume24h = klines.slice(-1440).reduce((acc, k) => acc + k.volume, 0);
    return {
      symbol: st.market.symbol,
      last,
      bid: st.orderBook.bids[0]?.[0] ?? last,
      ask: st.orderBook.asks[0]?.[0] ?? last,
      volume24h,
      change24h,
      ts: new Date().toISOString(),
    };
  }

  private makeTicker(st: MarketState): Ticker {
    return MockExchangeAdapter.makeTickerForState(st);
  }

  // -------------------------------------------------------------------- tick

  private tick(): void {
    const now = Date.now();
    for (const st of this.states.values()) {
      this.advanceMarket(st, now);
    }
  }

  private advanceMarket(st: MarketState, nowMs: number): void {
    // Roll anomaly maybe
    if (st.anomalyType === "none" && this.rng() < 0.005) {
      const r = this.rng();
      st.anomalyType = r < 0.25 ? "pump" : r < 0.5 ? "dump" : r < 0.75 ? "volume_spike" : "spread_widen";
      st.anomalyEndsAt = nowMs + 30_000 + this.rng() * 60_000;
    } else if (st.anomalyType !== "none" && nowMs > st.anomalyEndsAt) {
      st.anomalyType = "none";
    }

    // Compute next price
    let drift = (this.rng() - 0.5) * 0.0015;
    if (st.anomalyType === "pump") drift += 0.0035;
    if (st.anomalyType === "dump") drift -= 0.0035;
    const newPrice = Math.max(1e-12, st.lastPrice * (1 + drift));
    st.lastPrice = newPrice;

    // Append/extend latest 1m kline
    const latest = st.klines[st.klines.length - 1]!;
    const latestCloseMs = Date.parse(latest.closeTime);
    if (nowMs >= latestCloseMs) {
      const open = newPrice;
      const ot = latestCloseMs;
      st.klines.push({
        openTime: new Date(ot).toISOString(),
        closeTime: new Date(ot + 60_000).toISOString(),
        open,
        high: open,
        low: open,
        close: open,
        volume: 0,
      });
      if (st.klines.length > MAX_KLINES) st.klines.shift();
    }
    const cur = st.klines[st.klines.length - 1]!;
    cur.close = newPrice;
    if (newPrice > cur.high) cur.high = newPrice;
    if (newPrice < cur.low) cur.low = newPrice;
    let volBump = 100 + this.rng() * 5_000;
    if (st.anomalyType === "volume_spike") volBump *= 6;
    cur.volume += volBump;

    // Trades
    const tradeCount = st.anomalyType === "volume_spike" ? 8 : 2 + Math.floor(this.rng() * 4);
    const newTrades: Trade[] = [];
    for (let i = 0; i < tradeCount; i++) {
      newTrades.push({
        id: `t_${st.market.symbol}_${nowMs}_${i}`,
        symbol: st.market.symbol,
        price: newPrice * (1 + (this.rng() - 0.5) * 0.0008),
        qty: 0.1 + this.rng() * (st.anomalyType === "volume_spike" ? 50 : 5),
        side: this.rng() > 0.5 ? "buy" : "sell",
        ts: new Date(nowMs).toISOString(),
      });
    }
    st.trades.push(...newTrades);
    if (st.trades.length > MAX_TRADES) st.trades.splice(0, st.trades.length - MAX_TRADES);

    // Order book
    const spreadBoost = st.anomalyType === "spread_widen" ? 0.004 : 0;
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    const obImbalance = (this.rng() - 0.5) * 0.4;
    for (let i = 0; i < ORDERBOOK_DEPTH; i++) {
      const step = (i + 1) * 0.0005 + spreadBoost / ORDERBOOK_DEPTH;
      const bidQty = (1 + this.rng() * 50) * (1 + obImbalance);
      const askQty = (1 + this.rng() * 50) * (1 - obImbalance);
      bids.push([newPrice * (1 - step - spreadBoost), Math.max(0.1, bidQty)]);
      asks.push([newPrice * (1 + step + spreadBoost), Math.max(0.1, askQty)]);
    }
    st.orderBook = { symbol: st.market.symbol, bids, asks, ts: new Date(nowMs).toISOString() };

    // Futures metrics
    if (st.futures) {
      const oiNew = (st.futures.openInterest ?? 0) * (1 + (this.rng() - 0.5) * 0.01 + (st.anomalyType === "pump" ? 0.005 : 0));
      st.futures = {
        ...st.futures,
        openInterest: oiNew,
        fundingRate: (st.futures.fundingRate ?? 0) * 0.99 + (this.rng() - 0.5) * 0.001,
      };
      st.openInterestHistory.push({ ts: nowMs, value: oiNew });
      // keep ~30 minutes
      const cutoff = nowMs - 30 * 60_000;
      while (st.openInterestHistory.length > 0 && st.openInterestHistory[0]!.ts < cutoff) {
        st.openInterestHistory.shift();
      }
    }

    // Notify subscribers
    const ticker = this.makeTicker(st);
    this.tickerSubs.forEach((cb) => cb(ticker));
    this.bookSubs.get(st.market.symbol)?.forEach((cb) => cb(st.orderBook));
    this.tradeSubs.get(st.market.symbol)?.forEach((cb) => cb(newTrades));
  }
}
