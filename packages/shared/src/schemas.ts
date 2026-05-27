import { z } from "zod";

// =============================================================================
// Enums / unions — see Requirement 22.1, 22.2
// =============================================================================

export const ExchangeName = z.enum(["binance", "bybit", "okx", "coinbase", "kraken", "mock"]);
export type ExchangeName = z.infer<typeof ExchangeName>;

export const MarketType = z.enum(["spot", "futures"]);
export type MarketType = z.infer<typeof MarketType>;

/** Exactly the 10 documented signal literals — see Requirement 22.2 */
export const SignalType = z.enum([
  "VOLUME_SPIKE",
  "PRICE_PUMP",
  "PRICE_DUMP",
  "VOLATILITY_EXPANSION",
  "SPREAD_WIDENING",
  "ORDER_BOOK_IMBALANCE",
  "OI_SPIKE",
  "FUNDING_ANOMALY",
  "BREAKOUT",
  "HOT_MARKET",
]);
export type SignalType = z.infer<typeof SignalType>;

export const ScoreBand = z.enum(["cold", "normal", "hot", "extreme"]);
export type ScoreBand = z.infer<typeof ScoreBand>;

/** Alert condition types — see Requirement 12.4 */
export const AlertConditionType = z.enum([
  "PRICE_CHANGE_5M",
  "PRICE_CHANGE_15M",
  "PRICE_CHANGE_1H",
  "PRICE_CHANGE_24H",
  "RELATIVE_VOLUME",
  "VOLATILITY",
  "SPREAD",
  "ORDER_BOOK_IMBALANCE",
  "SIGNAL_SCORE",
  "OPEN_INTEREST",
  "FUNDING_RATE",
]);
export type AlertConditionType = z.infer<typeof AlertConditionType>;

export const AlertOperator = z.enum([">", ">=", "<", "<=", "=="]);
export type AlertOperator = z.infer<typeof AlertOperator>;

// =============================================================================
// Core entities
// =============================================================================

export const Market = z.object({
  symbol: z.string().min(1),
  exchange: ExchangeName,
  marketType: MarketType,
  base: z.string().min(1),
  quote: z.string().min(1),
});
export type Market = z.infer<typeof Market>;

export const Ticker = z.object({
  symbol: z.string(),
  last: z.number(),
  bid: z.number(),
  ask: z.number(),
  volume24h: z.number(),
  change24h: z.number(), // percent
  ts: z.string(), // ISO 8601
});
export type Ticker = z.infer<typeof Ticker>;

export const Kline = z.object({
  openTime: z.string(),
  closeTime: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type Kline = z.infer<typeof Kline>;

export const Trade = z.object({
  id: z.string(),
  symbol: z.string(),
  price: z.number(),
  qty: z.number(),
  side: z.enum(["buy", "sell"]),
  ts: z.string(),
});
export type Trade = z.infer<typeof Trade>;

export const OrderBookLevel = z.tuple([z.number(), z.number()]); // [price, qty]
export type OrderBookLevel = z.infer<typeof OrderBookLevel>;

export const OrderBook = z.object({
  symbol: z.string(),
  bids: z.array(OrderBookLevel),
  asks: z.array(OrderBookLevel),
  ts: z.string(),
});
export type OrderBook = z.infer<typeof OrderBook>;

export const FuturesMetrics = z.object({
  symbol: z.string(),
  openInterest: z.number().nullable(),
  fundingRate: z.number().nullable(),
  nextFundingTs: z.string().nullable(),
});
export type FuturesMetrics = z.infer<typeof FuturesMetrics>;

export const Signal = z.object({
  id: z.string(),
  symbol: z.string(),
  exchange: ExchangeName,
  marketType: MarketType,
  type: SignalType,
  score: z.number(),
  message: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string(), // ISO 8601
});
export type Signal = z.infer<typeof Signal>;

export const ScreenerResult = z.object({
  symbol: z.string(),
  exchange: ExchangeName,
  marketType: MarketType,
  quoteAsset: z.string(),
  price: z.number(),
  change5m: z.number(),
  change15m: z.number(),
  change1h: z.number(),
  change24h: z.number(),
  volume24h: z.number(),
  relativeVolume: z.number(),
  volatility: z.number(),
  tradesPerMinute: z.number(),
  spreadPct: z.number(),
  orderBookImbalance: z.number(), // [-1, 1]
  openInterest: z.number().nullable(),
  fundingRate: z.number().nullable(),
  signalScore: z.number().int().min(0).max(100),
  scoreBand: ScoreBand,
  activeSignals: z.array(SignalType),
  lastSignalAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ScreenerResult = z.infer<typeof ScreenerResult>;

// =============================================================================
// Screener query — accepts both GET and POST
// =============================================================================

const csvOrArray = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([schema, z.array(schema), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (Array.isArray(v)) return v;
      if (typeof v === "string") return v.split(",").map((s: string) => s.trim()).filter(Boolean);
      return [v];
    });

export const ScreenerQuery = z.object({
  exchange: csvOrArray(ExchangeName),
  marketType: csvOrArray(MarketType),
  quoteAsset: csvOrArray(z.string()),
  symbols: csvOrArray(z.string()),
  signalTypes: csvOrArray(SignalType),
  minVolume24h: z.coerce.number().optional(),
  minChange5m: z.coerce.number().optional(),
  minChange5mAbs: z.coerce.number().optional(),
  minChange15m: z.coerce.number().optional(),
  minRelativeVolume: z.coerce.number().optional(),
  minVolatility: z.coerce.number().optional(),
  maxSpreadPercent: z.coerce.number().optional(),
  minTradesPerMinute: z.coerce.number().optional(),
  minOpenInterestChange15m: z.coerce.number().optional(),
  minSignalScore: z.coerce.number().int().min(0).max(100).optional(),
  hasActiveSignal: z.coerce.boolean().optional(),
  watchlistSymbols: csvOrArray(z.string()),
  search: z.string().optional(),
  sortColumn: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type ScreenerQuery = z.infer<typeof ScreenerQuery>;

// =============================================================================
// Alerts
// =============================================================================

const AlertCore = z.object({
  symbol: z.string().min(1),
  exchange: ExchangeName,
  marketType: MarketType,
  conditionType: AlertConditionType,
  operator: AlertOperator,
  threshold: z.number(),
  timeframe: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  cooldownSeconds: z.number().int().min(1).default(300),
});

export const AlertInput = AlertCore.superRefine((val, ctx) => {
  // FUNDING_RATE / OPEN_INTEREST require futures — see Requirement 12.7
  const futuresOnly: AlertConditionType[] = ["FUNDING_RATE", "OPEN_INTEREST"];
  if (futuresOnly.includes(val.conditionType) && val.marketType !== "futures") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conditionType"],
      message: `Condition '${val.conditionType}' requires marketType='futures'`,
    });
  }
});
export type AlertInput = z.infer<typeof AlertInput>;

/** Patch shape — no cross-field validation, accepts subset of AlertCore */
export const AlertPatch = AlertCore.partial();
export type AlertPatch = z.infer<typeof AlertPatch>;

export const Alert = z.object({
  id: z.string(),
  symbol: z.string(),
  exchange: ExchangeName,
  marketType: MarketType,
  conditionType: AlertConditionType,
  operator: AlertOperator,
  threshold: z.number(),
  timeframe: z.string().nullable(),
  enabled: z.boolean(),
  cooldownSeconds: z.number().int(),
  lastTriggeredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Alert = z.infer<typeof Alert>;

export const AlertEvent = z.object({
  id: z.string(),
  alertId: z.string(),
  symbol: z.string(),
  message: z.string(),
  value: z.number(),
  threshold: z.number(),
  triggeredAt: z.string(),
});
export type AlertEvent = z.infer<typeof AlertEvent>;

// =============================================================================
// API envelope
// =============================================================================

export const ApiError = z.object({
  error: z.string(),
  message: z.string().max(500),
  statusCode: z.number().int(),
  details: z.unknown().optional(),
  retryAfterSeconds: z.number().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

// =============================================================================
// Health / Readiness — see Requirement 20.11, 20.12
// =============================================================================

export const HealthResponse = z.object({
  status: z.literal("ok"),
  serverTime: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadinessResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["ok", "unavailable"]),
  redis: z.enum(["ok", "fallback"]),
  exchangeAdapters: z.array(
    z.object({
      name: ExchangeName,
      enabled: z.boolean(),
      connected: z.boolean(),
      status: z.enum(["ok", "degraded", "disabled"]),
      marketTypes: z.array(MarketType),
      lastSuccessAt: z.string().nullable(),
      lastErrorAt: z.string().nullable(),
      lastErrorMessage: z.string().nullable(),
    }),
  ),
  marketMetadata: z.string().optional(),
  paidProvidersDisabled: z.boolean().optional(),
  mockMode: z.boolean().optional(),
  serverTime: z.string(),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;

// =============================================================================
// Signals listing — see Requirement 20.9
// =============================================================================

export const SignalsListResponse = z.object({
  items: z.array(Signal),
  nextCursor: z.string().nullable(),
});
export type SignalsListResponse = z.infer<typeof SignalsListResponse>;

// =============================================================================
// Settings (server-side, see Requirement 15.8)
// =============================================================================

export const ServerSettings = z.object({
  defaultExchange: ExchangeName.default("mock"),
  defaultMarketType: MarketType.default("spot"),
  defaultQuoteAsset: z.string().default("USDT"),
  screenerUpdateFrequencyMs: z.number().int().min(250).default(1000),
});
export type ServerSettings = z.infer<typeof ServerSettings>;
