import { z } from "zod";
import {
  AlertEvent,
  OrderBook,
  ScreenerResult,
  Signal,
  Trade,
} from "./schemas";

/** WebSocket event names — see Requirement 19.1 */
export const WS_EVENTS = {
  snapshot: "snapshot",
  marketUpdate: "market:update",
  marketBatch: "market:batch",
  signalNew: "signal:new",
  alertTriggered: "alert:triggered",
  orderbookUpdate: "orderbook:update",
  tradesUpdate: "trades:update",
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// =============================================================================
// Initial snapshot — see Requirement 19.4
// =============================================================================

export const SnapshotPayload = z.object({
  type: z.literal(WS_EVENTS.snapshot),
  markets: z.array(ScreenerResult),
  recentSignals: z.array(Signal),
  recentAlertEvents: z.array(AlertEvent),
  serverTime: z.string(),
});
export type SnapshotPayload = z.infer<typeof SnapshotPayload>;

// =============================================================================
// Market update / batch
// =============================================================================

export const MarketUpdatePayload = z.object({
  type: z.literal(WS_EVENTS.marketUpdate),
  result: ScreenerResult,
});
export type MarketUpdatePayload = z.infer<typeof MarketUpdatePayload>;

export const MarketBatchPayload = z.object({
  type: z.literal(WS_EVENTS.marketBatch),
  results: z.array(ScreenerResult),
  ts: z.string(),
});
export type MarketBatchPayload = z.infer<typeof MarketBatchPayload>;

// =============================================================================
// Signal / alert
// =============================================================================

export const SignalNewPayload = z.object({
  type: z.literal(WS_EVENTS.signalNew),
  signal: Signal,
});
export type SignalNewPayload = z.infer<typeof SignalNewPayload>;

export const AlertTriggeredPayload = z.object({
  type: z.literal(WS_EVENTS.alertTriggered),
  event: AlertEvent,
});
export type AlertTriggeredPayload = z.infer<typeof AlertTriggeredPayload>;

// =============================================================================
// Orderbook / trades
// =============================================================================

export const OrderBookUpdatePayload = z.object({
  type: z.literal(WS_EVENTS.orderbookUpdate),
  orderBook: OrderBook,
});
export type OrderBookUpdatePayload = z.infer<typeof OrderBookUpdatePayload>;

export const TradesUpdatePayload = z.object({
  type: z.literal(WS_EVENTS.tradesUpdate),
  symbol: z.string(),
  trades: z.array(Trade),
});
export type TradesUpdatePayload = z.infer<typeof TradesUpdatePayload>;

// =============================================================================
// Discriminated union of all WS messages
// =============================================================================

export const WsMessage = z.discriminatedUnion("type", [
  SnapshotPayload,
  MarketUpdatePayload,
  MarketBatchPayload,
  SignalNewPayload,
  AlertTriggeredPayload,
  OrderBookUpdatePayload,
  TradesUpdatePayload,
]);
export type WsMessage = z.infer<typeof WsMessage>;
