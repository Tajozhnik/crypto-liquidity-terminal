import {
  DEFAULT_CONFIG,
  type MarketSnapshot,
  type ScreenerConfig,
  runScreener,
} from "@screener/engine";
import type { ExchangeAdapter } from "../adapters/ExchangeAdapter.js";
import { logger } from "../logger.js";
import type { MarketDataStore } from "../state/MarketDataStore.js";
import type { WebSocketHub } from "../ws/WebSocketHub.js";

/**
 * Polls public-API adapters at a low cadence and pushes a ScreenerResult into
 * the MarketDataStore. One pass = at most `symbolsPerAdapter` symbols per
 * adapter so we never exceed reasonable rate limits.
 *
 * This is the live-mode counterpart to ScreenerJob (which pulls from the mock
 * adapter's in-memory state).
 */
export class LivePollingJob {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly adapters: ExchangeAdapter[],
    private readonly store: MarketDataStore,
    private readonly hub: WebSocketHub,
    private readonly cfg: ScreenerConfig,
    private readonly intervalMs: number,
    private readonly symbolsPerAdapter: number,
  ) {}

  start(): void {
    if (this.intervalMs <= 0 || this.adapters.length === 0) return;
    // Run once shortly after start, then on the interval.
    setTimeout(() => void this.cycle(), 2_000);
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void this.cycle().finally(() => {
        this.busy = false;
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async cycle(): Promise<void> {
    for (const a of this.adapters) {
      if (!a.isConnected()) continue;
      try {
        await this.pollAdapter(a);
      } catch (err) {
        logger.warn({ adapter: a.name, err: (err as Error).message }, "live polling cycle failed");
      }
    }
  }

  private async pollAdapter(a: ExchangeAdapter): Promise<void> {
    const markets = await a.getMarkets();
    if (markets.length === 0) return;
    // Always include majors when available
    const majors = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BTCUSD", "ETHUSD"];
    const sorted = [
      ...markets.filter((m) => majors.includes(m.symbol)),
      ...markets.filter((m) => !majors.includes(m.symbol)),
    ];
    const subset = sorted.slice(0, this.symbolsPerAdapter);
    const snapshots: MarketSnapshot[] = [];
    for (const m of subset) {
      const [ticker, klines, orderBook, trades] = await Promise.all([
        a.getTicker(m.symbol),
        a.getKlines(m.symbol, "1m", 60),
        a.getOrderBook(m.symbol, 20),
        a.getRecentTrades(m.symbol, 50),
      ]);
      if (!ticker || !orderBook || klines.length === 0) continue;
      const futures =
        m.marketType === "futures" || a.marketTypes.includes("futures")
          ? await a.getFuturesMetrics(m.symbol)
          : null;
      snapshots.push({
        market: m,
        ticker,
        klines1m: klines,
        recentTrades: trades,
        orderBook,
        ...(futures ? { futures } : {}),
      });
    }
    if (snapshots.length === 0) return;
    const { results, signals } = runScreener(snapshots, this.cfg, Date.now());
    this.store.setSnapshots(results);
    this.store.pushSignals(signals);
    this.hub.queueMarketUpdates(results);
    for (const s of signals) this.hub.broadcastSignal(s);
  }
}

export function defaultLivePollingConfig(): ScreenerConfig {
  return DEFAULT_CONFIG;
}
