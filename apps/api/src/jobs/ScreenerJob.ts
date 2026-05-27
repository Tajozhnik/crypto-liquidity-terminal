import type { MarketSnapshot, ScreenerConfig } from "@screener/engine";
import { runScreener } from "@screener/engine";
import { MockExchangeAdapter } from "../adapters/MockExchangeAdapter.js";
import { logger } from "../logger.js";
import type { MarketDataStore } from "../state/MarketDataStore.js";
import type { WebSocketHub } from "../ws/WebSocketHub.js";

export class ScreenerJob {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly mock: MockExchangeAdapter,
    private readonly store: MarketDataStore,
    private readonly hub: WebSocketHub,
    private readonly cfg: ScreenerConfig,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.busy) return; // overrun protection
      this.busy = true;
      try {
        this.cycle();
      } catch (err) {
        logger.error({ err: (err as Error).message }, "ScreenerJob tick failed");
      } finally {
        this.busy = false;
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private cycle(): void {
    const states = this.mock.getAllStates();
    const snapshots: MarketSnapshot[] = states.map((st) => ({
      market: st.market,
      ticker: MockExchangeAdapter.makeTickerForState(st),
      klines1m: st.klines,
      recentTrades: st.trades.slice(-200),
      orderBook: st.orderBook,
      ...(st.futures ? { futures: st.futures } : {}),
      openInterestHistory: st.openInterestHistory,
    }));

    const { results, signals } = runScreener(snapshots, this.cfg, Date.now());

    // Latest-write-wins: store BEFORE broadcast
    this.store.setSnapshots(results);
    this.store.pushSignals(signals);

    // Broadcast — signals immediately, market batches coalesced by hub
    this.hub.queueMarketUpdates(results);
    for (const sig of signals) this.hub.broadcastSignal(sig);
  }
}
