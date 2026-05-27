import {
  WS_EVENTS,
  WS_SNAPSHOT_MARKETS_LIMIT,
  WS_SNAPSHOT_RECENT_ALERT_EVENTS_LIMIT,
  WS_SNAPSHOT_RECENT_SIGNALS_LIMIT,
  type AlertEvent,
  type ScreenerResult,
  type Signal,
} from "@screener/shared";
import type { WebSocket } from "@fastify/websocket";
import { logger } from "../logger.js";
import type { MarketDataStore } from "../state/MarketDataStore.js";

type Client = {
  socket: WebSocket;
  pending: Map<string, ScreenerResult>; // exchange:marketType:symbol -> latest result
  alive: boolean;
};

export class WebSocketHub {
  private clients = new Set<Client>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: MarketDataStore,
    private readonly batchIntervalMs: number,
    private readonly batchMaxEntries: number,
    private readonly recentAlertEventsProvider: () => Promise<AlertEvent[]>,
  ) {}

  start(): void {
    this.flushTimer = setInterval(() => this.flushAll(), this.batchIntervalMs);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    for (const c of this.clients) {
      try {
        c.socket.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  attachClient(socket: WebSocket): void {
    const client: Client = { socket, pending: new Map(), alive: true };
    this.clients.add(client);

    void this.sendInitialSnapshot(client);
  }

  private async sendInitialSnapshot(client: Client): Promise<void> {
    try {
      const recentAlertEvents = await this.recentAlertEventsProvider();
      const snapshot = {
        type: WS_EVENTS.snapshot,
        markets: this.store.list().slice(0, WS_SNAPSHOT_MARKETS_LIMIT),
        recentSignals: this.store.getRecentSignals(WS_SNAPSHOT_RECENT_SIGNALS_LIMIT),
        recentAlertEvents: recentAlertEvents.slice(0, WS_SNAPSHOT_RECENT_ALERT_EVENTS_LIMIT),
        serverTime: new Date().toISOString(),
      };
      this.safeSend(client, JSON.stringify(snapshot));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Failed to send initial snapshot");
    }
    client.socket.on("close", () => {
      client.alive = false;
      this.clients.delete(client);
    });
    client.socket.on("error", (err: Error) => {
      logger.warn({ err: err.message }, "WS error");
      client.alive = false;
      try {
        client.socket.close();
      } catch {
        /* ignore */
      }
      this.clients.delete(client);
    });
  }

  queueMarketUpdates(results: ScreenerResult[]): void {
    for (const c of this.clients) {
      for (const r of results) {
        const k = `${r.exchange}:${r.marketType}:${r.symbol}`;
        c.pending.set(k, r);
      }
    }
  }

  /** Immediate broadcast — bypasses coalescing. */
  broadcastSignal(signal: Signal): void {
    const msg = JSON.stringify({ type: WS_EVENTS.signalNew, signal });
    for (const c of this.clients) this.safeSend(c, msg);
  }

  broadcastAlert(event: AlertEvent): void {
    const msg = JSON.stringify({ type: WS_EVENTS.alertTriggered, event });
    for (const c of this.clients) this.safeSend(c, msg);
  }

  private flushAll(): void {
    const ts = new Date().toISOString();
    for (const c of this.clients) {
      if (c.pending.size === 0) continue;
      const items = [...c.pending.values()];
      c.pending.clear();
      // Split into chunks of batchMaxEntries
      for (let i = 0; i < items.length; i += this.batchMaxEntries) {
        const chunk = items.slice(i, i + this.batchMaxEntries);
        const msg = JSON.stringify({ type: WS_EVENTS.marketBatch, results: chunk, ts });
        this.safeSend(c, msg);
      }
    }
  }

  private safeSend(c: Client, payload: string): void {
    if (!c.alive) return;
    try {
      c.socket.send(payload);
    } catch {
      c.alive = false;
      this.clients.delete(c);
    }
  }
}
