import { logger } from "../logger.js";
import { publicFetch } from "../adapters/publicFetch.js";
import { DepthSnapshotStore } from "./DepthSnapshotStore.js";
import {
  OrderBookReconstructor,
  type BinanceDepthDiff,
  type BinanceDepthSnapshot,
  type Level,
} from "./OrderBookReconstructor.js";
import { TradeBuffer, type AggTrade } from "./TradeBuffer.js";
import { RingBuffer } from "./RingBuffer.js";

/**
 * Live liquidity feed for a single (exchange, marketType, symbol). Connects to
 * Binance public depth + aggTrade WebSocket streams, applies diffs to the
 * `OrderBookReconstructor`, samples top-of-book into `DepthSnapshotStore` once
 * per second, and pushes recent trades into `TradeBuffer`.
 *
 * No API keys; honours backoff; never fabricates data.
 */

type WsLike = {
  on(ev: "open", cb: () => void): void;
  on(ev: "message", cb: (data: Buffer | string) => void): void;
  on(ev: "close", cb: () => void): void;
  on(ev: "error", cb: (err: Error) => void): void;
  close(): void;
};
type WsCtor = new (url: string) => WsLike;

export interface FeedDeps {
  /** Public REST timeout. */
  timeoutMs: number;
  /** Public REST cache TTL (used for the snapshot endpoint). */
  ttlSeconds: number;
  /** Maximum heatmap lookback in hours — drives ring buffer capacity. */
  maxLookbackHours?: number;
}

export interface FeedStatus {
  symbol: string;
  exchange: string;
  marketType: "spot" | "futures";
  connected: boolean;
  needsResync: boolean;
  snapshots: number;
  trades: number;
  lastEventMs: number;
  lastErrorMessage: string | null;
  /** ISO timestamp of when start() ran for this symbol/marketType. */
  startedAt: string | null;
  /** Milliseconds elapsed since the feed started (= live history age). */
  historyAgeMs: number;
}

export interface CandleRow {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SPOT_REST = "https://api.binance.com";
const FAPI_REST = "https://fapi.binance.com";
const SPOT_WS = "wss://stream.binance.com:9443/stream";
const FAPI_WS = "wss://fstream.binance.com/stream";
/** Top-of-book sampling interval. 250 ms ≈ 4× the visual density of 1 Hz
 *  sampling, matching what real liquidity terminals draw. */
const SNAPSHOT_INTERVAL_MS = 250;
/** Number of bid+ask levels we keep in each snapshot. 1000 lets distant
 *  walls live well outside the ±1 % corridor. */
const TOP_LEVELS = 1000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Default memory ceiling for the snapshot ring buffer in hours.
 *  Used when no explicit `maxLookbackHours` is supplied to the constructor. */
const DEFAULT_MAX_LOOKBACK_HOURS = 4;

function snapshotCapacityFor(hours: number): number {
  // hours × 60 min × 60 s × 1000 ms / SNAPSHOT_INTERVAL_MS
  return Math.max(60, Math.ceil((hours * 3_600_000) / SNAPSHOT_INTERVAL_MS));
}

export class LiquidityFeed {
  private reconstructor = new OrderBookReconstructor();
  // Capacity is derived from the configured `maxLookbackHours` (env-driven via
  // FeedDeps). Default 4 h * 60 min * 60 s @ 4 Hz = 57 600 entries.
  private snapshotStore: DepthSnapshotStore;
  // 250k trades buffers ~4 h of history on the busiest spot pairs (BTCUSDT
  // hits ~15 trades/s on average). Sized to mirror the heatmap lookback so
  // the delta histogram covers the same time range as the heatmap above it.
  private tradeBuffer = new TradeBuffer(250_000);
  private candleBuffer = new RingBuffer<CandleRow>(2_000);
  private ws: WsLike | null = null;
  private wsCtor: WsCtor | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connected = false;
  private stopped = false;
  private lastErrorMessage: string | null = null;
  /** Buffer of diffs received before the snapshot lands. */
  private pendingDiffs: BinanceDepthDiff[] = [];
  private snapshotInflight = false;
  /** ms epoch of when start() ran. Used to compute heatmap history age. */
  private startedAtMs: number | null = null;

  constructor(
    public readonly symbol: string,
    public readonly marketType: "spot" | "futures",
    private readonly deps: FeedDeps,
  ) {
    const hours = deps.maxLookbackHours && deps.maxLookbackHours > 0
      ? deps.maxLookbackHours
      : DEFAULT_MAX_LOOKBACK_HOURS;
    this.snapshotStore = new DepthSnapshotStore(snapshotCapacityFor(hours));
  }

  async start(): Promise<void> {
    this.stopped = false;
    // start() is one-shot per LiquidityFeed instance. If a caller calls it
    // again after stop() — e.g. on a manager hot-reset — bump `startedAtMs`
    // so the heatmap-collection-started marker reflects the new session
    // instead of the original construction time.
    this.startedAtMs = Date.now();
    // Lazy-load 'ws' so that test environments without it can still import this module.
    try {
      const mod = (await import("ws")) as unknown as { default: WsCtor; WebSocket?: WsCtor };
      this.wsCtor = mod.default ?? mod.WebSocket ?? (mod as unknown as WsCtor);
    } catch (err) {
      this.lastErrorMessage = `'ws' module not available: ${(err as Error).message}`;
      logger.warn({ err: this.lastErrorMessage, symbol: this.symbol }, "ws not available; LiquidityFeed idle");
      return;
    }
    await this.fetchInitialCandles();
    await this.fetchSnapshot();
    this.openSocket();
    this.snapshotTimer = setInterval(() => this.captureSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.snapshotTimer = null;
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.connected = false;
  }

  status(): FeedStatus {
    const startedAt = this.startedAtMs ? new Date(this.startedAtMs).toISOString() : null;
    const historyAgeMs = this.startedAtMs ? Date.now() - this.startedAtMs : 0;
    return {
      symbol: this.symbol,
      exchange: "binance",
      marketType: this.marketType,
      connected: this.connected,
      needsResync: this.reconstructor.needsResync(),
      snapshots: this.snapshotStore.size(),
      trades: this.tradeBuffer.size(),
      lastEventMs: 0,
      lastErrorMessage: this.lastErrorMessage,
      startedAt,
      historyAgeMs,
    };
  }

  snapshots(): ReadonlyArray<{ t: number; bids: Level[]; asks: Level[]; midPrice: number }> {
    return this.snapshotStore.all();
  }
  recentTrades(limit: number): AggTrade[] {
    return this.tradeBuffer.recent(limit);
  }
  candles(limit: number): CandleRow[] {
    return this.candleBuffer.toArray().slice(-limit);
  }
  /**
   * One-shot REST fetch for candles at an arbitrary interval (used when the
   * UI selects 5m/15m). Cached via publicFetch; does not pollute the live 1m
   * candle buffer.
   */
  async fetchCandlesAtInterval(interval: string, limit: number): Promise<CandleRow[]> {
    const path = this.marketType === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
    const url = `${this.restBase()}${path}?symbol=${encodeURIComponent(this.symbol)}&interval=${encodeURIComponent(interval)}&limit=${Math.min(limit, 1000)}`;
    const rows = await publicFetch<[number, string, string, string, string, string, number, ...unknown[]][]>({
      key: `liquidity:klines:${this.marketType}:${this.symbol}:${interval}:${limit}`,
      url,
      ttlSeconds: this.deps.ttlSeconds,
      timeoutMs: this.deps.timeoutMs,
    });
    if (!rows) return [];
    return rows.map((r) => ({
      t: r[0] as number,
      open: Number.parseFloat(r[1]!),
      high: Number.parseFloat(r[2]!),
      low: Number.parseFloat(r[3]!),
      close: Number.parseFloat(r[4]!),
      volume: Number.parseFloat(r[5]!),
    }));
  }
  topOfBook(levels: number): { bids: Level[]; asks: Level[] } {
    return this.reconstructor.topOfBook(levels);
  }

  // ----------------------------------------------------------------- internals

  private streamUrl(): string {
    const lower = this.symbol.toLowerCase();
    const base = this.marketType === "spot" ? SPOT_WS : FAPI_WS;
    const streams = [`${lower}@depth@100ms`, `${lower}@aggTrade`, `${lower}@kline_1m`];
    return `${base}?streams=${streams.join("/")}`;
  }

  private restBase(): string {
    return this.marketType === "spot" ? SPOT_REST : FAPI_REST;
  }

  private async fetchInitialCandles(): Promise<void> {
    const path = this.marketType === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
    const url = `${this.restBase()}${path}?symbol=${encodeURIComponent(this.symbol)}&interval=1m&limit=500`;
    const rows = await publicFetch<[number, string, string, string, string, string, number, ...unknown[]][]>({
      key: `liquidity:klines:${this.marketType}:${this.symbol}`,
      url,
      ttlSeconds: this.deps.ttlSeconds,
      timeoutMs: this.deps.timeoutMs,
    });
    if (!rows) return;
    for (const r of rows) {
      this.candleBuffer.push({
        t: r[0] as number,
        open: Number.parseFloat(r[1]!),
        high: Number.parseFloat(r[2]!),
        low: Number.parseFloat(r[3]!),
        close: Number.parseFloat(r[4]!),
        volume: Number.parseFloat(r[5]!),
      });
    }
  }

  private async fetchSnapshot(): Promise<void> {
    if (this.snapshotInflight) return;
    this.snapshotInflight = true;
    try {
      const path = this.marketType === "spot" ? "/api/v3/depth" : "/fapi/v1/depth";
      // Spot allows up to 5000; futures up to 1000. We ask for 1000 to stay under both.
      const url = `${this.restBase()}${path}?symbol=${encodeURIComponent(this.symbol)}&limit=1000`;
      const snap = await publicFetch<BinanceDepthSnapshot>({
        key: `liquidity:depth:${this.marketType}:${this.symbol}`,
        url,
        ttlSeconds: 1, // snapshot is intentionally short-lived
        timeoutMs: this.deps.timeoutMs,
      });
      if (!snap) {
        this.lastErrorMessage = "depth snapshot unavailable";
        return;
      }
      this.reconstructor.applySnapshot(snap);
      // Replay any diffs that arrived during the fetch window.
      for (const d of this.pendingDiffs) {
        if (d.u <= snap.lastUpdateId) continue;
        this.reconstructor.applyDiff(d);
      }
      this.pendingDiffs = [];
    } finally {
      this.snapshotInflight = false;
    }
  }

  private openSocket(): void {
    if (!this.wsCtor || this.stopped) return;
    try {
      this.ws = new this.wsCtor(this.streamUrl());
    } catch (err) {
      this.lastErrorMessage = (err as Error).message;
      this.scheduleReconnect();
      return;
    }
    this.ws.on("open", () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      logger.info({ symbol: this.symbol, marketType: this.marketType }, "LiquidityFeed WS connected");
    });
    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("close", () => {
      this.connected = false;
      if (!this.stopped) this.scheduleReconnect();
    });
    this.ws.on("error", (err) => {
      this.lastErrorMessage = err.message;
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_INITIAL_MS * 2 ** Math.min(this.reconnectAttempt - 1, 5),
    );
    this.reconstructor.markStale();
    this.reconnectTimer = setTimeout(() => {
      void this.fetchSnapshot().then(() => this.openSocket());
    }, delay);
  }

  private handleMessage(raw: Buffer | string): void {
    let parsed: { stream?: string; data?: unknown };
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      return;
    }
    const stream = parsed.stream ?? "";
    const data = parsed.data as Record<string, unknown> | undefined;
    if (!data) return;
    if (stream.includes("@depth")) {
      this.onDepthDiff(data as unknown as BinanceDepthDiff);
    } else if (stream.includes("@aggTrade")) {
      this.onAggTrade(data);
    } else if (stream.includes("@kline_")) {
      this.onKline(data);
    }
  }

  private onDepthDiff(diff: BinanceDepthDiff): void {
    if (this.reconstructor.lastUpdateId() === 0) {
      // snapshot still inflight; buffer.
      this.pendingDiffs.push(diff);
      if (this.pendingDiffs.length > 500) this.pendingDiffs.shift();
      return;
    }
    const status = this.reconstructor.applyDiff(diff);
    if (status === "needs_resync") {
      // Out-of-sync; refetch snapshot.
      void this.fetchSnapshot();
    }
  }

  private onAggTrade(d: Record<string, unknown>): void {
    const t = Number(d.T ?? d.E ?? Date.now());
    const price = Number.parseFloat(String(d.p ?? "0"));
    const qty = Number.parseFloat(String(d.q ?? "0"));
    const buyerIsMaker = Boolean(d.m);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
    this.tradeBuffer.push({ t, price, qty, buyerIsMaker });
  }

  private onKline(d: Record<string, unknown>): void {
    const k = d.k as Record<string, unknown> | undefined;
    if (!k) return;
    const candle: CandleRow = {
      t: Number(k.t ?? Date.now()),
      open: Number.parseFloat(String(k.o ?? "0")),
      high: Number.parseFloat(String(k.h ?? "0")),
      low: Number.parseFloat(String(k.l ?? "0")),
      close: Number.parseFloat(String(k.c ?? "0")),
      volume: Number.parseFloat(String(k.v ?? "0")),
    };
    // Replace last open candle if same minute, else append.
    const arr = this.candleBuffer.toArray();
    const last = arr[arr.length - 1];
    if (last && last.t === candle.t) {
      // mutate in place — RingBuffer is array-backed
      last.open = candle.open;
      last.high = candle.high;
      last.low = candle.low;
      last.close = candle.close;
      last.volume = candle.volume;
    } else {
      this.candleBuffer.push(candle);
    }
  }

  private captureSnapshot(): void {
    if (this.reconstructor.needsResync()) return;
    const { bids, asks } = this.reconstructor.topOfBook(TOP_LEVELS);
    if (bids.length === 0 || asks.length === 0) return;
    const midPrice = (bids[0]![0] + asks[0]![0]) / 2;
    this.snapshotStore.push({ t: Date.now(), bids, asks, midPrice });
  }
}
