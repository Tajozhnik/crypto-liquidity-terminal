import type { Alert, AlertConditionType, AlertOperator, ScreenerResult } from "@screener/shared";
import { logger } from "../logger.js";
import type { MarketDataStore } from "../state/MarketDataStore.js";
import { alertStore } from "../state/AlertStore.js";
import type { WebSocketHub } from "../ws/WebSocketHub.js";

const FUTURES_ONLY: AlertConditionType[] = ["FUNDING_RATE", "OPEN_INTEREST"];

function metricFor(result: ScreenerResult, type: AlertConditionType): number | null {
  switch (type) {
    case "PRICE_CHANGE_5M":
      return result.change5m;
    case "PRICE_CHANGE_15M":
      return result.change15m;
    case "PRICE_CHANGE_1H":
      return result.change1h;
    case "PRICE_CHANGE_24H":
      return result.change24h;
    case "RELATIVE_VOLUME":
      return result.relativeVolume;
    case "VOLATILITY":
      return result.volatility;
    case "SPREAD":
      return result.spreadPct;
    case "ORDER_BOOK_IMBALANCE":
      return result.orderBookImbalance;
    case "SIGNAL_SCORE":
      return result.signalScore;
    case "OPEN_INTEREST":
      return result.openInterest;
    case "FUNDING_RATE":
      return result.fundingRate;
  }
}

function applyOp(value: number, op: AlertOperator, threshold: number): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
  }
}

export class AlertEvaluator {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly store: MarketDataStore,
    private readonly hub: WebSocketHub,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.cycle()
        .catch((err) => logger.error({ err: (err as Error).message }, "AlertEvaluator cycle failed"))
        .finally(() => {
          this.busy = false;
        });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async cycle(): Promise<void> {
    const alerts = await alertStore.listEnabled();
    if (alerts.length === 0) return;
    const now = Date.now();

    for (const alert of alerts) {
      try {
        await this.evaluate(alert, now);
      } catch (err) {
        logger.warn({ err: (err as Error).message, alertId: alert.id }, "Alert evaluation failed");
      }
    }
  }

  private async evaluate(alert: Alert, now: number): Promise<void> {
    // Futures-only condition guard (defense in depth — UI and create endpoint already enforce)
    if (FUTURES_ONLY.includes(alert.conditionType) && alert.marketType !== "futures") return;

    const result = this.store.get(alert.symbol);
    if (!result) return;
    if (alert.exchange !== result.exchange) return;
    if (alert.marketType !== result.marketType) return;

    const metric = metricFor(result, alert.conditionType);
    if (metric === null || !Number.isFinite(metric)) return;

    if (!applyOp(metric, alert.operator, alert.threshold)) return;

    // Cooldown
    if (alert.lastTriggeredAt) {
      const elapsedMs = now - Date.parse(alert.lastTriggeredAt);
      if (elapsedMs < alert.cooldownSeconds * 1000) return;
    }

    const triggeredAtIso = new Date(now).toISOString();
    const event = await alertStore.createEvent({
      alertId: alert.id,
      symbol: alert.symbol,
      message: `${alert.symbol} ${alert.conditionType} ${alert.operator} ${alert.threshold} (current ${metric.toFixed(4)})`,
      value: metric,
      threshold: alert.threshold,
    });
    await alertStore.setLastTriggered(alert.id, triggeredAtIso);
    this.hub.broadcastAlert(event);
  }
}
