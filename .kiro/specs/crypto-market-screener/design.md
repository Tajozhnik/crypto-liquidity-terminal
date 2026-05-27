# Design Document

## Overview

The Crypto Market Screener is a self-contained, mock-first market intelligence tool delivered as a TypeScript monorepo. It is **analytical only**: it never accepts trading API keys, never places orders, and never offers financial advice. The product surfaces unusual market behavior (volume spikes, pumps, dumps, volatility expansion, spread widening, order-book imbalance, OI/funding anomalies, breakouts) and a unified 0–100 "hotness" score across many crypto markets in real time.

The core design tension this document addresses is **evaluability without dependencies**. A reviewer must be able to run a single command (`docker compose up --build`) and exercise every feature end to end — dashboard, screener, market detail, alerts, settings — even with no exchange credentials, no network, and a degraded Redis or Postgres. This is enforced by:

1. A **mock-first `ExchangeAdapter` abstraction** where `MockExchangeAdapter` is the default and is fully feature-complete (anomalies, futures metrics, order books, candles, trades).
2. A **graceful-degradation policy** in the API server: Redis and Postgres failures must not take down the live screener. Endpoints that require persistence return structured errors; endpoints that derive from the in-memory `Market_Data_Store` continue to serve.
3. A **pure `screener-engine` package** with no I/O, exhaustively unit-tested and property-tested, so the math behind signals and the Signal_Score is verifiable independently of HTTP, WebSocket, or database transport.

The system is composed of two applications and two libraries inside a pnpm workspace:

| Workspace | Role |
|---|---|
| `apps/web` | Next.js 14+ frontend (App Router) on port 3000 |
| `apps/api` | Fastify backend on port 4000 (REST + WebSocket) |
| `packages/shared` | TypeScript types, Zod schemas, constants |
| `packages/screener-engine` | Pure business logic: metrics, detectors, score |

Real exchange connectivity (Binance, Bybit) is layered on top of the mock-first foundation by registering additional `ExchangeAdapter` implementations. The Bybit adapter is delivered as a compiling skeleton; the Binance adapter is wired for live data when configured.

### Design Principles

- **Mock-first, not mock-shim.** The mock adapter is a peer of real adapters, not a stub. It produces order books, trades, candles, OI, funding rates, and seeds anomalies so every signal type can fire deterministically.
- **Pure logic at the core.** All math lives in `packages/screener-engine`. Transports (HTTP, WebSocket, DB, exchange clients) are at the edges and can be swapped or removed without touching correctness.
- **Schemas as the contract.** Zod schemas in `packages/shared` are the single source of truth for both runtime validation and TypeScript types (via `z.infer`). The frontend and backend import the same shapes.
- **Resilience over correctness-of-state.** When Redis or Postgres is down, the system reports the degradation but keeps the screener live. Live state is in process memory; persistence is for alerts, settings, and signal history.
- **Safety constraints are structural, not aspirational.** There is no code path that could place a trade because the surface area for it (API key fields, order endpoints, exchange trading clients) does not exist.

## Architecture

### High-Level Topology

```mermaid
flowchart LR
    subgraph Browser
      WebApp[Next.js Web App<br/>:3000]
    end

    subgraph Backend["API Server :4000 (Fastify)"]
      REST[REST Routes]
      WSHub[WebSocket Hub]
      MDS[(Market_Data_Store<br/>in-memory)]
      ScreenerJob[Screener Job]
      AlertEval[Alert Evaluator]
      AdapterReg[Adapter Registry]
    end

    subgraph Adapters["Exchange Adapters"]
      Mock[MockExchangeAdapter]
      Binance[BinanceAdapter]
      Bybit[BybitAdapter<br/>skeleton]
    end

    subgraph Engine["packages/screener-engine<br/>(pure)"]
      Metrics[Metric Calculators]
      Detectors[Signal Detectors]
      Score[Hot Market Score]
    end

    subgraph Infra
      Redis[(Redis<br/>cache + pubsub)]
      Postgres[(Postgres<br/>via Prisma)]
    end

    WebApp -- REST --> REST
    WebApp <-- WS --> WSHub

    AdapterReg --> Mock
    AdapterReg --> Binance
    AdapterReg --> Bybit

    Mock --> MDS
    Binance --> MDS
    Bybit --> MDS

    ScreenerJob --> MDS
    ScreenerJob --> Engine
    ScreenerJob --> WSHub
    ScreenerJob --> Postgres

    AlertEval --> MDS
    AlertEval --> Postgres
    AlertEval --> WSHub

    REST --> MDS
    REST --> Postgres
    REST -.optional.-> Redis
    WSHub -.optional.-> Redis
```

### Data Flow per Tick

```mermaid
sequenceDiagram
    participant Adapter as ExchangeAdapter
    participant Store as Market_Data_Store
    participant Job as Screener Job
    participant Engine as screener-engine
    participant WS as WebSocket Hub
    participant Client as Web App

    Adapter->>Store: ticker / trade / orderbook update
    Store->>Store: write latest snapshot
    Store-->>WS: queue per-market update
    Note over WS: coalesce 500–1000 ms<br/>max 500 entries / batch
    WS-->>Client: market:batch

    loop every screenerIntervalMs
      Job->>Store: read snapshots
      Job->>Engine: runScreener(snapshots, config)
      Engine-->>Job: ScreenerResult[] + Signal[]
      Job->>WS: signal:new (per signal)
      Job->>Postgres: persist SignalEvent rows
    end

    loop every alertIntervalMs
      AlertEval->>Postgres: load enabled Alerts
      AlertEval->>Store: read snapshots
      AlertEval->>AlertEval: evaluate condition + cooldown
      AlertEval->>Postgres: insert AlertEvent
      AlertEval->>WS: alert:triggered
    end
```

### Mock Mode vs Live Mode

```mermaid
flowchart TD
    Boot[API Server boot] --> ReadEnv{USE_MOCK_DATA?}
    ReadEnv -- true --> RegMock[Register MockExchangeAdapter only]
    ReadEnv -- false --> RegLive[Register configured live adapters<br/>Binance, Bybit]
    RegMock --> StartJobs[Start screener + alert jobs]
    RegLive --> StartJobs
    StartJobs --> Health{Probe Redis & DB}
    Health -- both ok --> FullMode[Full mode]
    Health -- Redis down --> DegradedRedis[Log warn; bypass cache]
    Health -- DB down --> DegradedDB[Serve live endpoints;<br/>persistence endpoints return 503]
    Health -- both down --> DegradedBoth[Live screener still works;<br/>alerts/settings unavailable]
```

### Module Dependencies

A strict dependency direction keeps the engine pure and the transports replaceable:

```
apps/web      ──depends on──▶  packages/shared
apps/api      ──depends on──▶  packages/shared
apps/api      ──depends on──▶  packages/screener-engine
packages/screener-engine  ──depends on──▶  packages/shared

(packages/screener-engine never depends on apps/api, apps/web, fastify, prisma, ioredis, or ws)
(packages/shared depends on zod only)
```

This is enforced by `package.json` boundaries and verified by lint/type-check across the workspace.

### Graceful Degradation Policy

| Dependency down | API behavior |
|---|---|
| Redis | `WARN` log; cache bypassed; `Market_Data_Store` still serves live data; cross-process pubsub disabled (single-process mode is fine for MVP) |
| Postgres | Live endpoints (`/markets`, `/markets/:symbol`, `/screener`, `GET /signals` from in-memory rolling buffer) keep working; persistence endpoints (`/alerts*`, `/alert-events`, `/settings`) return HTTP 503 with the standard error body |
| Exchange adapter | Adapter reconnects with exponential backoff; existing snapshots remain in `Market_Data_Store` and gradually go stale; `updatedAt` timestamps surface staleness |

### Configuration Surface

All runtime configuration is via environment variables, validated at boot with a Zod schema. Documented defaults are committed in `.env.example`. Highlights:

- `USE_MOCK_DATA` (default `true`) — selects mock vs live adapters.
- `MOCK_MARKET_COUNT` (default `80`, clamped 50–100).
- `MOCK_UPDATE_INTERVAL_MS` (default `750`).
- `MOCK_SEED` — seeds the mock adapter PRNG so runs are reproducible.
- `SCREENER_INTERVAL_MS` (default `1000`) — screener evaluation cadence.
- `ALERT_INTERVAL_MS` (default `1000`) — alert evaluator cadence.
- `WS_BATCH_INTERVAL_MS` (default `750`, validated 500–1000).
- `WS_BATCH_MAX_ENTRIES` (default `500`).
- `DATABASE_URL`, `REDIS_URL` — connection strings.
- `CORS_ORIGINS` — comma-separated allowed origins.
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`.
- Threshold tunables for each detector (e.g. `VOLUME_SPIKE_MULTIPLIER`, `PRICE_PUMP_PCT`, `PRICE_PUMP_WINDOW_MIN`).

## Components and Interfaces

### `packages/shared`

The shared package owns the **data contract**. Every shape that crosses a process boundary (HTTP request, HTTP response, WebSocket payload) is defined here as a Zod schema, and TypeScript types are derived via `z.infer`. This guarantees runtime validation and compile-time types stay in sync.

Exports (non-exhaustive):

```ts
// enums / unions
export const ExchangeName = z.enum(["binance", "bybit", "mock"]);
export const MarketType  = z.enum(["spot", "futures"]);
export const SignalType  = z.enum([
  "VOLUME_SPIKE", "PRICE_PUMP", "PRICE_DUMP", "VOLATILITY_EXPANSION",
  "SPREAD_WIDENING", "ORDER_BOOK_IMBALANCE", "OI_SPIKE", "FUNDING_ANOMALY",
  "BREAKOUT", "HOT_MARKET",
]);

// core entities
export const Market         = z.object({ /* symbol, exchange, marketType, quoteAsset, … */ });
export const Ticker         = z.object({ /* symbol, last, bid, ask, ts, … */ });
export const Kline          = z.object({ /* openTime, o, h, l, c, v, closeTime */ });
export const Trade          = z.object({ /* id, symbol, price, qty, side, ts */ });
export const OrderBookLevel = z.tuple([z.number(), z.number()]); // [price, qty]
export const OrderBook      = z.object({ symbol, bids: OrderBookLevel.array(), asks: OrderBookLevel.array(), ts });
export const FuturesMetrics = z.object({ symbol, openInterest: z.number().nullable(), fundingRate: z.number().nullable(), nextFundingTs: z.number().nullable() });

export const Signal         = z.object({ id, symbol, exchange, marketType, type: SignalType, score: z.number(), message: z.string(), payload: z.record(z.unknown()), createdAt: z.number() });
export const ScreenerResult = z.object({ /* symbol + all metrics + score + active signal types */ });
export const Alert          = z.object({ /* see Data Models */ });
export const AlertEvent     = z.object({ /* see Data Models */ });
export const ScreenerQuery  = z.object({ /* filters: exchange, marketType, quoteAsset, thresholds, hasActiveSignal, watchlistOnly, sort */ });

// API envelope
export const ApiError = z.object({ error: z.string(), message: z.string().max(500), statusCode: z.number().int(), details: z.unknown().optional() });
```

The package is dependency-light (zod only) and is consumed verbatim by both `apps/api` and `apps/web`.

### `packages/screener-engine`

A **pure** library: no `fetch`, no `fs`, no `pino`, no Prisma, no `ws`. Its only dependency is `packages/shared` for types. Time is passed in as `nowMs: number` rather than read from `Date.now()`, which makes detectors deterministic and testable.

Exposed functions (matches Requirement 18.1):

```ts
// metric calculators (pure)
calculatePriceChange(prevPrice: number, currentPrice: number): number;
calculateRelativeVolume(recentVolume: number, baselineAvgVolume: number): number;
calculateVolatility(klines: Kline[]): number;
calculateSpread(bid: number, ask: number): number;            // (ask - bid) / mid * 100
calculateOrderBookImbalance(bids: OrderBookLevel[], asks: OrderBookLevel[], depth?: number): number; // (bidVol - askVol) / (bidVol + askVol) ∈ [-1, 1]
calculateTradesPerMinute(trades: Trade[], windowMs: number): number;
calculateAverageVolume(klines: Kline[], lookback: number): number;
calculateRangeBreakout(klines: Kline[], lookback: number): { brokeHigh: boolean; brokeLow: boolean };
normalizeScore(value: number, min: number, max: number): number; // → [0, 100]

// detectors (pure → Signal | null)
detectVolumeSpike(input, cfg): Signal | null;
detectPricePump(input, cfg): Signal | null;
detectPriceDump(input, cfg): Signal | null;
detectVolatilityExpansion(input, cfg): Signal | null;
detectSpreadWidening(input, cfg): Signal | null;
detectOrderBookImbalance(input, cfg): Signal | null;
detectBreakout(input, cfg): Signal | null;
detectOpenInterestSpike(input, cfg): Signal | null;
detectFundingAnomaly(input, cfg): Signal | null;

// scoring (total function — never throws, always returns numeric score)
calculateHotMarketScore(subScores: Partial<SubScores>): { score: number; warnings: string[] };
// HOT_MARKET is derived from the score; threshold default 81.
detectHotMarket(input: { snapshot: MarketSnapshot; score: number }, cfg: ScreenerConfig): Signal | null;

// orchestrator (still pure)
runScreener(snapshots: MarketSnapshot[], cfg: ScreenerConfig, nowMs: number): { results: ScreenerResult[]; signals: Signal[] };
```

`MarketSnapshot` (engine-internal type) bundles per-market input: latest ticker, recent klines, recent trades, current order book, optional futures metrics. The engine never reaches outside this struct.

`HOT_MARKET` is a **derived signal**: `runScreener` computes the score, then calls `detectHotMarket` which returns the signal when `score >= cfg.hotMarketScoreThreshold` (default 81). A standalone exported `detectHotMarket` keeps the symmetry with the other detectors and lets unit tests target it directly.

`calculateHotMarketScore` is a **total function**: it always returns `{ score, warnings }`. When a sub-score is missing or non-finite, the function substitutes 0 for that sub-score and appends a warning string identifying the offending field. The `score` is always an integer in [0, 100].

### `apps/api` (Fastify)

Top-level structure:

```
apps/api/src/
  index.ts                     # boot, env load, server.listen
  server.ts                    # buildServer(): registers plugins, routes
  config/env.ts                # Zod env schema, parsed once
  plugins/
    cors.ts
    rate-limit.ts
    error-handler.ts           # maps thrown errors → ApiError envelope
    request-logging.ts         # pino with request id
  adapters/
    ExchangeAdapter.ts         # interface
    AdapterRegistry.ts
    MockExchangeAdapter.ts
    BinanceAdapter.ts
    BybitAdapter.ts            # skeleton
  state/
    MarketDataStore.ts         # in-memory snapshots
    SignalBuffer.ts            # rolling recent-signals buffer (in-memory)
  cache/
    RedisClient.ts             # optional; lazy connect, soft-fail
  db/
    prisma.ts                  # PrismaClient singleton
  jobs/
    ScreenerJob.ts             # interval loop calling screener-engine
    AlertEvaluator.ts          # interval loop evaluating alerts
  ws/
    WebSocketHub.ts            # connection registry, batching, broadcast
    events.ts                  # event name constants
  routes/
    health.ts
    markets.ts
    screener.ts
    signals.ts
    alerts.ts
    alert-events.ts
    settings.ts
```

#### `ExchangeAdapter` interface

```ts
export interface ExchangeAdapter {
  readonly name: ExchangeName;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribeTickers(symbols: string[], cb: (t: Ticker) => void): Unsubscribe;
  subscribeTrades(symbol: string, cb: (t: Trade) => void): Unsubscribe;
  subscribeOrderBook(symbol: string, cb: (ob: OrderBook) => void): Unsubscribe;
  getMarkets(): Promise<Market[]>;
  getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;
  // Optional, for futures-capable adapters:
  getFuturesMetrics?(symbol: string): Promise<FuturesMetrics>;
}
```

#### `MockExchangeAdapter`

- Generates `MOCK_MARKET_COUNT` markets at construction. Always includes `BTCUSDT`, `ETHUSDT`, `SOLUSDT`. Mixes spot and futures.
- Owns a seeded PRNG (mulberry32 keyed by `MOCK_SEED`). All randomness flows from it, so a given seed reproduces the same run.
- A single internal tick on `MOCK_UPDATE_INTERVAL_MS` updates each market's price (geometric Brownian motion-like step), trades, and order book; rolls a candle every minute; updates OI/funding for futures markets.
- An **anomaly scheduler** picks a random subset of markets at varying intervals to inject pumps, dumps, volume spikes, and spread expansions. This guarantees the UI shows signals firing during evaluation.
- All callbacks fire synchronously from a `setInterval`; subscribers are managed via `Map<string, Set<callback>>`.

#### `MarketDataStore`

In-memory `Map<symbol, MarketSnapshot>`. Writers: adapters. Readers: routes, jobs. Updates are O(1). The store also maintains short rolling buffers per symbol (last N klines, last M trades, latest order book) so the engine never has to query an exchange.

#### `WebSocketHub`

- Single endpoint at `/ws`. On connect, sends an initial snapshot message of shape `{ type: "snapshot", markets: ScreenerResult[] (latest 300), recentSignals: Signal[] (latest 50), recentAlertEvents: AlertEvent[] (latest 50), serverTime: ISO8601 }` within the 2 s budget.
- A coalescing queue holds per-market updates. A timer flushes every `WS_BATCH_INTERVAL_MS` (default 750, validated to be in [500, 1000]) into a single `market:batch` message of at most `WS_BATCH_MAX_ENTRIES` per flush. **Overflow is split across consecutive batches; updates are never dropped except for clients that have disconnected.**
- Signal events (`signal:new`) and alert events (`alert:triggered`) are sent immediately, not coalesced, to meet the 500 ms latency requirement.
- Each socket has its own queue so a slow client cannot stall the hub.
- All timestamp fields in event payloads are UTC ISO 8601 strings.

Event payload schemas live in `packages/shared`.

#### `ScreenerJob` and `AlertEvaluator`

Both run on `setInterval` loops, with overrun protection: if a tick is still running when the next tick fires, the next tick is skipped (no overlapping evaluations).

`ScreenerJob`:
1. Snapshot `MarketDataStore` keys (defensive copy of references, not deep clones).
2. Build `MarketSnapshot[]` and call `runScreener(...)` from the engine.
3. Push new signals to `SignalBuffer`, broadcast `signal:new`, and persist to `SignalEvent` (best-effort — DB failure is logged but doesn't abort the loop).
4. Update each socket-bound `screener` view via `market:batch`.

`AlertEvaluator`:
1. Load enabled alerts (with simple in-memory cache invalidated on alerts CRUD).
2. For each alert, look up the live snapshot, compute the relevant metric (delegating to `screener-engine`), and check the operator+threshold.
3. If satisfied **and** `now - lastTriggeredAt >= cooldownSeconds * 1000`, insert `AlertEvent`, update `lastTriggeredAt`, and broadcast `alert:triggered`.

The Alert_Evaluator has no notification side effects beyond persistence and WebSocket broadcast. Future channels (email, Telegram) are a separate observer that subscribes to the persisted `AlertEvent` stream — the evaluator does not need to change.

#### REST surface

All routes use Fastify's typed schema validation against the shared Zod schemas (via `fastify-type-provider-zod` or equivalent). Handlers are thin: they parse, call into a service, return JSON. The error handler plugin maps thrown errors to the `ApiError` envelope.

| Route | Notes |
|---|---|
| `GET /health` | `{ status: "ok", serverTime: ISO8601 }`. Lightweight; no DB or cache I/O. |
| `GET /readiness` | `{ status, db, redis, exchangeAdapters[], serverTime }`. Probes subsystems. Returns 200 even when degraded. |
| `GET /markets` | reads from `MarketDataStore` |
| `GET /markets/:symbol` | 404 if not in store |
| `GET /markets/:symbol/klines`, `/orderbook`, `/trades` | reads rolling buffers; falls back to adapter `getKlines` for older candles |
| `GET /screener` | accepts simple scalar/CSV query parameters; same response shape as `POST /screener/query` |
| `POST /screener/query` | accepts a JSON body shaped like `ScreenerQuery`; same response shape as `GET /screener` |
| `GET /signals` | `?symbol=&type=&limit=50&cursor=...`, ordered by `createdAt` desc, max limit 200; returns `{ items, nextCursor }` |
| `GET /signals/:symbol` | shorthand for `GET /signals?symbol=...` |
| `POST/GET/PATCH/DELETE /alerts*`, `GET /alert-events` | requires DB; 503 if DB down |
| `GET/PATCH /settings` | requires DB; falls back to defaults if `key` not found |

### `apps/web` (Next.js)

App Router structure:

```
apps/web/src/
  app/
    layout.tsx                 # AppLayout wrapper, DisclaimerBanner
    page.tsx                   # Dashboard
    screener/page.tsx
    markets/[symbol]/page.tsx
    signals/page.tsx
    alerts/page.tsx
    settings/page.tsx
  components/
    AppLayout.tsx
    Sidebar.tsx
    TopBar.tsx
    ConnectionStatus.tsx
    DisclaimerBanner.tsx
    MarketTable.tsx
    MarketTableFilters.tsx
    MarketRow.tsx              # React.memo
    SignalBadge.tsx
    ScoreBadge.tsx
    PriceChange.tsx
    MiniSparkline.tsx
    MarketChart.tsx
    OrderBook.tsx
    TradesTape.tsx
    AlertForm.tsx
    AlertList.tsx
    AlertEventList.tsx
    PresetFilters.tsx
    StatCard.tsx
    ErrorBoundary.tsx
    LoadingSkeleton.tsx
    EmptyState.tsx
  state/
    useMarketStore.ts          # zustand
    useAlertStore.ts           # zustand
    useWatchlistStore.ts       # zustand + persist(localStorage)
    useConnectionStore.ts
  lib/
    api.ts                     # typed fetch using shared zod schemas
    ws.ts                      # WebSocket client with reconnect + throttling
    presets.ts                 # filter preset definitions
    theme.ts
```

#### State stores (Zustand)

- `useMarketStore` — keyed by symbol, holds the latest `ScreenerResult`. Updates are applied from `market:batch` events. Selectors are designed so consumers subscribe to a single market, enabling `MarketRow` memoization.
- `useAlertStore` — alerts list + alert events (capped buffer of latest N).
- `useWatchlistStore` — `Set<string>` of symbols persisted to `localStorage` via Zustand's `persist` middleware. Schema is versioned for forward compat.
- `useConnectionStore` — discrete state machine: `connected | connecting | reconnecting | disconnected`.

#### WebSocket client (`lib/ws.ts`)

- Single connection. Reconnect: exponential backoff starting at 1000 ms, doubling, capped at 30000 ms, minimum 10 attempts before surfacing a persistent error.
- **UI throttle:** the client buffers incoming `market:batch` events and applies them to the store at most every 250 ms via a leading+trailing throttle. Signal and alert events bypass the throttle.

#### Presets (`lib/presets.ts`)

A static map from preset name to a `Partial<ScreenerQuery>`:

```ts
export const PRESETS = {
  Scalping:    { marketType: "futures", minVolume24h: 10_000_000, maxSpreadPercent: 0.08, minTradesPerMinute: 50 },
  HighVolume:  { quoteAsset: "USDT", minVolume24h: 50_000_000 },
  Volatility:  { minVolatility: 2.0, minChange5mAbs: 1.5 },
  FuturesOI:   { marketType: "futures", minOpenInterestChange15m: 3.0 },
  LowSpread:   { maxSpreadPercent: 0.05, minVolume24h: 20_000_000 },
  MemeCoins:   { symbols: ["DOGEUSDT","SHIBUSDT","PEPEUSDT","FLOKIUSDT","WIFUSDT","BONKUSDT"], minRelativeVolume: 1.5 },
  Breakout:    { signalTypes: ["BREAKOUT"], minSignalScore: 70 },
} as const;
```

Selecting a preset replaces the active query. Manual edits set a `customized` flag on the active filter UI so the preset chip no longer reads as "active".

### Build, Lint, Test Commands

Top-level `package.json` exposes:

```
pnpm build         # build all workspaces
pnpm lint          # eslint across all workspaces
pnpm typecheck     # tsc --noEmit across all workspaces
pnpm test          # vitest --run in all workspaces that have tests
pnpm --filter screener-engine test --run
pnpm --filter api dev
pnpm --filter web dev
```

## Data Models

### Engine-internal types (in `screener-engine`, not persisted)

```ts
type SubScores = {
  momentumScore: number;     // 0..100
  volumeScore: number;       // 0..100
  volatilityScore: number;   // 0..100
  liquidityScore: number;    // 0..100
  orderBookScore: number;    // 0..100
};

type ScoreBand = "cold" | "normal" | "hot" | "extreme";

type MarketSnapshot = {
  market: Market;
  ticker: Ticker;
  klines1m: Kline[];     // most recent first or last; convention documented
  recentTrades: Trade[];
  orderBook: OrderBook;
  futures?: FuturesMetrics;
};

type ScreenerConfig = {
  // detector defaults — see Requirements "Configuration Defaults"
  volumeSpike: { timeframe: string; relativeVolumeThreshold: number };       // 5m, 3.0
  pricePump:   { timeframe: string; thresholdPercent: number };              // 5m, +2.0
  priceDump:   { timeframe: string; thresholdPercent: number };              // 5m, -2.0
  volatilityExpansion: { timeframe: string; thresholdMultiplier: number };   // 5m, 2.0
  spreadWidening:      { thresholdPercent: number };                         // 0.15
  orderBookImbalance:  { depthLevels: number; thresholdRatio: number };      // 20, 0.65
  openInterestSpike:   { timeframe: string; thresholdPercent: number };      // 15m, 5.0
  fundingAnomaly:      { absoluteThreshold: number };                        // 0.03
  breakout:            { lookbackCandles: number; timeframe: string };       // 20, 5m
  hotMarket:           { scoreThreshold: number };                           // 81
};
```

### Wire / API types (in `shared`)

```ts
type ScreenerResult = {
  symbol: string;
  exchange: ExchangeName;
  marketType: MarketType;
  quoteAsset: string;
  price: number;
  change5m: number; change15m: number; change1h: number; change24h: number;
  volume24h: number;
  relativeVolume: number;
  volatility: number;
  tradesPerMinute: number;
  spreadPct: number;
  orderBookImbalance: number;     // [-1, 1]
  openInterest: number | null;
  fundingRate: number | null;
  signalScore: number;            // integer 0..100
  scoreBand: ScoreBand;
  activeSignals: SignalType[];
  lastSignalAt: number | null;    // epoch ms
  updatedAt: number;              // epoch ms
};

type ScreenerQuery = {
  exchange?: ExchangeName[];
  marketType?: MarketType[];
  quoteAsset?: string[];
  minVolume24h?: number;
  minChange5m?: number;
  minChange15m?: number;
  minRelativeVolume?: number;
  minVolatility?: number;
  maxSpreadPct?: number;
  minSignalScore?: number;
  hasActiveSignal?: boolean;
  watchlistSymbols?: string[];    // when watchlistOnly is true
  sort?: { column: string; direction: "asc" | "desc" };
  search?: string;
};
```

### Database schema (Prisma)

```prisma
model Alert {
  id              String   @id @default(cuid())
  symbol          String
  exchange        String
  marketType      String
  conditionType   String
  operator        String
  threshold       Float
  timeframe       String?
  enabled         Boolean  @default(true)
  cooldownSeconds Int      @default(60)
  lastTriggeredAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          AlertEvent[]

  @@index([enabled])
}

model AlertEvent {
  id          String   @id @default(cuid())
  alertId     String
  alert       Alert    @relation(fields: [alertId], references: [id], onDelete: Cascade)
  symbol      String
  message     String
  value       Float
  threshold   Float
  triggeredAt DateTime @default(now())

  @@index([alertId])
  @@index([triggeredAt])
}

model SignalEvent {
  id         String   @id @default(cuid())
  symbol     String
  exchange   String
  marketType String
  signalType String
  score      Float
  message    String
  payload    Json
  createdAt  DateTime @default(now())

  @@index([symbol])
  @@index([signalType])
  @@index([createdAt])
}

model UserSetting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Notes:
- `conditionType` and `operator` are stored as strings but constrained at the API edge by Zod enums (Requirement 12.4, 12.5). This avoids tight coupling between the DB and the enum domain.
- Watchlist is intentionally **persisted** for the MVP (Requirement 14.5). The `Watchlist` table has a nullable `userId` so a future per-user mode adds the user filter without altering the schema. The MVP frontend keeps a `localStorage` mirror for fast UX, but a future REST surface (`GET/POST/DELETE /watchlist`) can use the same table.

```prisma
model Watchlist {
  id         String   @id @default(cuid())
  userId     String?  // nullable for MVP single-user
  exchange   String
  marketType String
  symbol     String
  createdAt  DateTime @default(now())

  @@unique([userId, exchange, marketType, symbol])
}
```

### `.env.example` (representative)

```
USE_MOCK_DATA=true
MOCK_MARKET_COUNT=80
MOCK_UPDATE_INTERVAL_MS=750
MOCK_SEED=42
SCREENER_INTERVAL_MS=1000
ALERT_INTERVAL_MS=2000
WS_BATCH_INTERVAL_MS=750
WS_BATCH_MAX_ENTRIES=500
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/screener
REDIS_URL=redis://redis:6379
CORS_ORIGINS=http://localhost:3000
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
# Detector defaults
VOLUME_SPIKE_REL_VOL_THRESHOLD=3.0
VOLUME_SPIKE_TIMEFRAME=5m
PRICE_PUMP_PCT=2.0
PRICE_PUMP_TIMEFRAME=5m
PRICE_DUMP_PCT=-2.0
PRICE_DUMP_TIMEFRAME=5m
VOLATILITY_MULTIPLIER=2.0
VOLATILITY_TIMEFRAME=5m
SPREAD_PCT_THRESHOLD=0.15
OB_IMBALANCE_DEPTH=20
OB_IMBALANCE_RATIO=0.65
OI_SPIKE_PCT=5.0
OI_SPIKE_TIMEFRAME=15m
FUNDING_ABS_THRESHOLD=0.03
BREAKOUT_LOOKBACK=20
BREAKOUT_TIMEFRAME=5m
HOT_MARKET_SCORE_THRESHOLD=81
LOG_LEVEL=info
```


## Acceptance Criteria Testing Prework

The full per-criterion classification (PROPERTY / EXAMPLE / EDGE_CASE / INTEGRATION / SMOKE) was produced via the `prework` tool and is stored in context. The summary below records the consolidations that produced the property list in the next section, so the trace from acceptance criterion → property is explicit. Each criterion was classified by asking: does it test our code's logic, does behavior vary meaningfully with input, and is it cost-effective to run 100+ iterations?

**Consolidations applied (criterion → final Property #):**

| Criteria | Final Property |
|---|---|
| 11.1, 11.3, 11.4, 18.6 | Property 1 — Score formula, bounds, rounding |
| 6.6, 11.5 | Property 2 — Score band classification |
| 11.6 | Property 3 — Sub-score validity |
| 10.2, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11 | Property 4 — Threshold detector iff (incl. HOT_MARKET) |
| 10.3, 10.4 | Property 5 — Directional pump/dump |
| 4.2, 4.3, 4.7 | Property 6 — Mock adapter market invariants |
| 4.5 | Property 7 — Seeded reproducibility |
| 5.4, 5.5, 5.6, 5.7, 6.7 | Property 8 — Ranked list correctness |
| 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 14.4 | Property 9 — ScreenerQuery filter correctness |
| 17.1, 17.5 | Property 10 — Latest-write-wins (incl. ordering before broadcast) |
| 12.3, 13.7, 14.3, 15.7 | Property 11 — Persistence round trip + ordered list |
| 13.1, 13.2, 13.3, 13.4, 13.5 | Property 12 — Cooldown-bounded firing |
| 19.2, 19.3, 24.2 | Property 13 — WS batch invariants (incl. signal latency) |
| 19.5, 19.6, 25.1, 25.6 | Property 14 — Exponential backoff sequence + 4-state machine |
| 7.8, 12.6, 20.2, 20.3, 20.8, 25.3, 26.4 | Property 15 — Validation rejection |
| 20.4, 20.5, 20.6 | Property 16 — Error envelope conformance |
| 19.1, 22.1, 22.2, 22.3 | Property 17 — Schema round trip |
| 24.3, 24.4 | Property 18 — UI throttle and row memoization |

**Criteria classified as EXAMPLE** (concrete unit/component tests, not properties): 1.4, 3.1, 4.1, 4.8, 4.9, 5.1, 5.2, 5.3, 5.8, 6.1, 6.2, 6.9, 6.10, 6.11, 7.7, 8.1, 8.3, 8.4, 9.1–9.9, 12.1, 12.2, 12.7, 12.8, 13.6, 14.1, 15.1–15.6, 16.5, 17.2, 17.4, 18.4, 19.4, 20.1, 20.7, 23.1–23.7, 25.2, 25.4, 25.5, 26.2, 26.3.

**Criteria classified as SMOKE / structural** (single static or boot check): 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1–2.7, 3.2, 3.3, 3.4, 3.5, 10.1, 13.8, 14.5, 16.1, 16.2, 16.3, 16.4, 17.3, 18.1, 18.2, 18.3, 18.5, 21.1–21.6, 22.4, 22.5, 26.1, 26.5, 26.6, 27.1–27.6.

**Criteria classified as INTEGRATION** (cost-prohibitive for PBT): 6.12, 24.1.

**Criterion classified as EDGE_CASE** absorbed into property generators: 11.2 (each sub-score calculator's output ∈ [0, 100]) is enforced by the input-domain contract of Property 1 plus a one-line example check per calculator. 4.6 (anomaly injection coverage) is asserted as an example check over a fixed simulated time window rather than as a property to keep the test deterministic.

**Property reflection** eliminated redundancy in the following ways:
- Sort invariants for the four dashboard ranked lists and the screener column sort all reduce to one universal claim, captured in Property 8.
- Filter predicates across exchange / market type / quote asset / numeric thresholds / `hasActiveSignal` / `watchlistOnly` / `search` all share the same "subset = predicate" invariant, captured in Property 9.
- Backoff for both adapter reconnect (25.1) and WS reconnect (19.5) is the same formula; Property 14 covers both, with the WS-specific minimums called out in the property body.
- The error envelope rule applies to every non-2xx response across the API, so 16 and 25.3 collapse into Property 16 (envelope) plus Property 15 (validation specifically).
- Schema round trip handles all type-shape correctness across `shared`, including the `SignalType` literal exhaustiveness, in a single Property 17.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

PBT applies to this feature because the core of the system — `packages/screener-engine`, the `ScreenerQuery` filter logic, the `MarketDataStore`, the WebSocket batching/backoff state machines, and the shared Zod schemas — are pure or near-pure functions over varied inputs (price series, order books, sub-scores, query payloads, event sequences). 100+ randomized iterations per property meaningfully exercise the input space in ways a handful of examples cannot.

The properties below are derived directly from the Acceptance Criteria Testing Prework above. Each property has been reviewed for redundancy and consolidates several related criteria where they share the same underlying universal claim.

### Property 1: Score formula, bounds, and integer rounding

*For any* tuple of sub-scores `(momentumScore, volumeScore, volatilityScore, liquidityScore, orderBookScore)` where each sub-score is a finite real number in the closed interval `[0, 100]`, the value returned by `calculateHotMarketScore` SHALL be an integer in the closed interval `[0, 100]`, equal to the result of clamping `0.25*momentumScore + 0.25*volumeScore + 0.20*volatilityScore + 0.15*liquidityScore + 0.15*orderBookScore` to `[0, 100]` and then rounding to the nearest integer with values having a fractional part of `0.5` or greater rounded upward.

**Validates: Requirements 11.1, 11.3, 11.4, 18.6**

### Property 2: Score band classification

*For any* integer `s` in `[0, 100]`, the score-band classification function SHALL return `"cold"` when `0 ≤ s ≤ 30`, `"normal"` when `31 ≤ s ≤ 60`, `"hot"` when `61 ≤ s ≤ 80`, and `"extreme"` when `81 ≤ s ≤ 100`, and the `ScoreBadge` component SHALL render the same label for the same input score.

**Validates: Requirements 6.6, 11.5**

### Property 3: Score requires complete sub-scores

*For any* sub-scores input where at least one of the five required sub-scores is `undefined`, `NaN`, or non-numeric, `calculateHotMarketScore` SHALL NOT return a numeric score and SHALL instead produce an error indication that names the missing or invalid sub-score; *for any* input where all five sub-scores are finite numbers in `[0, 100]`, the function SHALL produce a numeric result satisfying Property 1.

**Validates: Requirements 11.6**

### Property 4: Threshold detector correctness

*For any* threshold-based detector among `detectVolumeSpike`, `detectVolatilityExpansion`, `detectSpreadWidening`, `detectOrderBookImbalance`, `detectBreakout`, `detectOpenInterestSpike`, `detectFundingAnomaly`, and the `HOT_MARKET` emission rule, and *for any* input snapshot and configured threshold, the detector SHALL emit a `Signal` of its corresponding `SignalType` if and only if the snapshot's relevant metric crosses the configured threshold in the configured direction (with futures-only detectors emitting only when `marketType === "futures"`).

**Validates: Requirements 10.2, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11**

### Property 5: Directional price-move detector

*For any* recent price series and *for any* configured percent threshold `X` and window `Y`, `detectPricePump` SHALL emit a `PRICE_PUMP` signal if and only if the percentage change over the most recent `Y` minutes is strictly greater than `+X`, and `detectPriceDump` SHALL emit a `PRICE_DUMP` signal if and only if the percentage change over the most recent `Y` minutes is strictly less than `-X`.

**Validates: Requirements 10.3, 10.4**

### Property 6: Mock adapter market invariants

*For any* `MOCK_MARKET_COUNT` value in `[50, 100]` and *for any* PRNG seed, the `MockExchangeAdapter` SHALL produce exactly that count of `Market` records, the produced set SHALL contain `BTCUSDT`, `ETHUSDT`, and `SOLUSDT`, the set SHALL contain at least one market with `marketType === "spot"` and at least one with `marketType === "futures"`, and every produced market SHALL have a populated order book (non-empty bids and asks), at least one recent trade, at least one kline, and (when `marketType === "futures"`) finite numeric values for `openInterest` and `fundingRate`.

**Validates: Requirements 4.2, 4.3, 4.7**

### Property 7: Mock adapter seeded reproducibility

*For any* PRNG seed `S` and *for any* tick count `N`, two independently constructed `MockExchangeAdapter` instances initialized with seed `S` and advanced through `N` synchronous update ticks SHALL produce deeply equal sequences of ticker updates, trade events, order book snapshots, kline updates, and futures metrics for every market.

**Validates: Requirements 4.5**

### Property 8: Ranked list correctness

*For any* set of markets and *for any* numeric column `K` and direction `D ∈ {"asc", "desc"}`, the rendered ranked list (Top Gainers, Top Losers, Top Volume Spikes, Hottest Markets, or any sortable Screener column) SHALL equal the input set sorted by `K` in direction `D`, optionally truncated to the displayed Top-`N`, with no missing or duplicated entries.

**Validates: Requirements 5.4, 5.5, 5.6, 5.7, 6.7**

### Property 9: ScreenerQuery filter and projection correctness

*For any* set of `ScreenerResult` rows and *for any* `ScreenerQuery` (including any combination of exchange, market type, quote asset, numeric thresholds, `hasActiveSignal`, `watchlistOnly`, and case-insensitive `search` substring), the filtered output SHALL equal exactly the subset of input rows for which every active filter predicate evaluates to true; *for any* row rendered in the screener, a `SignalBadge` SHALL be present for each `SignalType` in the row's `activeSignals` (and only those), the price-change cell SHALL render with the green / red / neutral class corresponding to the sign of the change value, and rows whose `marketType === "spot"` SHALL render the `openInterest` and `fundingRate` cells as the documented placeholder rather than zero.

**Validates: Requirements 6.3, 6.4, 6.5, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 14.4**

### Property 10: MarketDataStore latest-write-wins and update-before-broadcast

*For any* sequence of market updates `(symbol, snapshot, ts)` applied to the `MarketDataStore`, after the sequence has been processed the store entry for each symbol SHALL equal the snapshot from the update with the largest `ts` for that symbol, reads of `getMarkets()` SHALL contain exactly one entry per symbol observed in the sequence, and *for any* update event observed by the `WebSocketHub`, the `MarketDataStore` write for that symbol SHALL be ordered strictly before the broadcast of the corresponding event.

**Validates: Requirements 17.1, 17.5**

### Property 11: Persistence round trip and ordered listing

*For any* valid `Alert` payload, *for any* valid `(key, value)` settings pair, and *for any* watchlist symbol set, performing the documented persistence operation (`POST /alerts` then `GET /alerts/:id`; `PATCH /settings` then `GET /settings`; saving the watchlist store then reloading it from `localStorage`) SHALL return a value structurally equal to the input (modulo server-assigned `id`, `createdAt`, `updatedAt`); *for any* set of persisted `AlertEvent` rows, the response from `GET /alert-events` SHALL be sorted strictly descending by `triggeredAt` and SHALL contain exactly the rows produced by the requested page parameters.

**Validates: Requirements 12.3, 13.7, 14.3, 15.7**

### Property 12: Alert evaluator cooldown-bounded firing

*For any* enabled `Alert` with `cooldownSeconds = C`, *for any* sequence of evaluation cycles within a window of duration `< C` during which the underlying metric continuously satisfies the alert's operator-and-threshold condition, exactly one `AlertEvent` SHALL be created, exactly one `alert:triggered` event SHALL be broadcast, and the alert's `lastTriggeredAt` SHALL be updated exactly once to the time of that single firing.

**Validates: Requirements 13.1, 13.2, 13.4, 13.5**

### Property 13: WebSocket batch invariants

*For any* burst of per-market update events fed into the `WebSocketHub`, every emitted `market:batch` message SHALL contain at most `WS_BATCH_MAX_ENTRIES` (default 500) per-market entries, and the time interval between consecutive flushes SHALL fall within the closed interval `[500, 1000]` milliseconds whenever there are pending updates; *for any* `Signal` produced by the `Screener_Engine` at time `t`, the corresponding `signal:new` event SHALL be dispatched to every connected client within 500 ms of `t`, bypassing the per-market coalescing queue.

**Validates: Requirements 19.2, 19.3, 24.2**

### Property 14: Exponential backoff sequence and connection states

*For any* configured initial delay `D₀`, multiplicative factor `F ≥ 1`, and maximum cap `Dmax`, the sequence of reconnection delays produced by both the Web App's WebSocket reconnector and the `Exchange_Adapter` reconnector SHALL satisfy `delay(k) = min(Dmax, D₀ · F^(k-1))` for every attempt `k ≥ 1`, with the WebSocket reconnector specifically using `D₀ = 1000`, `F = 2`, `Dmax = 30000`, and producing at least 10 attempts before surfacing a persistent error; *for any* WebSocket lifecycle transition, the value reported by `useConnectionStore` SHALL be exactly one of `connected`, `connecting`, `reconnecting`, or `disconnected`, and a connection drop SHALL trigger an immediate transition to `reconnecting` followed by automatic reconnection attempts.

**Validates: Requirements 19.5, 19.6, 25.1, 25.6**

### Property 15: API validation rejects invalid payloads

*For any* REST endpoint accepting a request body or query parameters, *for any* payload that fails the endpoint's Zod schema, *for any* request body exceeding 1 MB, and *for any* `POST` or `PATCH` request whose `Content-Type` is not `application/json`, the API SHALL respond with HTTP status `400`, `413`, or `415` respectively, the response body SHALL conform to the `ApiError` envelope (with a `details` field enumerating each failing field's validation message when applicable), the route handler SHALL NOT be invoked, and no persisted state in the `Database`, `Cache_Layer`, or `Market_Data_Store` SHALL be mutated.

**Validates: Requirements 7.8, 12.6, 20.2, 20.3, 20.8, 25.3, 26.4**

### Property 16: API error envelope conformance

*For any* HTTP response with a status code `≥ 400` produced by the API server (validation error, missing resource, unhandled exception, oversize body, or unsupported content type), the response body SHALL parse successfully against the `ApiError` Zod schema with shape `{ error: string, message: string, statusCode: number, details?: unknown }`, the `statusCode` field SHALL equal the response's HTTP status code, the `message` field SHALL be at most 500 characters, and the `message` field SHALL NOT contain any stack trace, file path, or database identifier.

**Validates: Requirements 20.4, 20.5, 20.6**

### Property 17: Schema round trip

*For any* value generated by a Zod schema exported from `packages/shared` (any `Market`, `Ticker`, `Kline`, `Trade`, `OrderBook`, `Signal`, `ScreenerResult`, `ScreenerQuery`, `Alert`, `AlertEvent`, or any documented WebSocket event payload), serializing the value to JSON and re-parsing it through the same schema SHALL yield a value structurally equal to the original, and parsing SHALL succeed for every value the schema produced.

**Validates: Requirements 19.1, 22.1, 22.2, 22.3**

### Property 18: UI update throttle and row memoization

*For any* sequence of incoming `market:batch` events on the Web App, the per-store apply rate SHALL NOT exceed one update per 250 milliseconds (last-write-wins coalescing applies between flushes), and *for any* update that affects a strict subset `S` of currently rendered market symbols, only the `MarketRow` components keyed by symbols in `S` SHALL re-render.

**Validates: Requirements 24.3, 24.4**

## Error Handling

The system uses a small number of consistent error patterns rather than scattering ad-hoc handling across modules.

### REST error envelope

Every error response from `apps/api` is shaped by a single Fastify error-handler plugin that maps thrown errors to the `ApiError` envelope:

```ts
type ApiError = {
  error: string;        // stable machine-readable code, e.g. "validation_error"
  message: string;      // human-readable, ≤ 500 chars, no stack/path/sql
  statusCode: number;   // mirrors HTTP status
  details?: unknown;    // for validation errors: array of { path, code, message }
};
```

Mapping rules:

| Source | HTTP | `error` code |
|---|---|---|
| Zod parse failure (body/query/params) | 400 | `validation_error` |
| Unknown route param (`:symbol` or `:id` not found) | 404 | `not_found` |
| Body > 1 MB | 413 | `payload_too_large` |
| Content-Type ≠ `application/json` on POST/PATCH | 415 | `unsupported_media_type` |
| Rate limit exceeded | 429 | `RATE_LIMITED` (body: `{ error, message, statusCode, retryAfterSeconds }`; header: `Retry-After`) |
| Service degraded (DB down for persistence endpoints) | 503 | `service_unavailable` |
| Anything else (unhandled throw) | 500 | `internal_error` (generic message; details suppressed in production) |

In production, stack traces, file paths, and SQL fragments are stripped from the response body and only emitted to the pino log stream.

### Logging

A single pino logger is bound to each request via `request.id`. The error handler emits exactly one log entry per error response with `{ reqId, method, path, statusCode, errorCode }`, at level `warn` for 4xx and `error` for 5xx (Requirement 20.7). Caught exceptions inside jobs (`ScreenerJob`, `AlertEvaluator`) are logged at `error` and the loop continues — a single bad market does not stop the screener.

### Adapter resilience

`ExchangeAdapter` implementations expose `connect`/`disconnect` and own their own reconnection logic. The base class (or shared mixin) implements exponential backoff with `min(maxDelay, base * 2^attempt)` per Property 14 / Requirement 25.1. While disconnected, snapshots in `MarketDataStore` go stale; consumers see the staleness via `updatedAt` timestamps. The `MockExchangeAdapter` cannot disconnect (it has no network) and therefore cannot enter backoff.

### Cache and DB degradation

- **Redis down at boot**: log `warn`; do not attempt reconnect on every request; periodic background reconnect attempts.
- **Redis down mid-run**: the cache wrapper catches errors and returns `null` (cache-miss semantics); `MarketDataStore` continues to serve.
- **DB down at boot**: API still starts. Routes that require persistence (`/alerts*`, `/alert-events`, `/settings`) return `503` with the standard envelope. `/health` reports `db: "down"`.
- **DB down mid-run**: `AlertEvaluator` skips the cycle with a warning. `ScreenerJob` continues to broadcast signals even if `SignalEvent` persistence fails (best-effort, logged).

### WebSocket client resilience

The Web App's WebSocket client never throws to consumers. State transitions go through `useConnectionStore` (`connected | connecting | reconnecting | disconnected`) and the UI reacts. Reconnect attempts follow Property 14. If the maximum attempt count is exceeded, the client surfaces a persistent connection error in the UI and waits for a manual retry from the `ConnectionStatus` indicator.

### Graceful shutdown

`SIGTERM` / `SIGINT` triggers, in order: (1) stop accepting new HTTP and WebSocket connections, (2) cancel `ScreenerJob` and `AlertEvaluator` interval timers, (3) flush any pending WebSocket batches, (4) call `disconnect()` on every registered adapter, (5) close the Redis client, (6) `prisma.$disconnect()`, (7) exit. A timeout of 10 s forces exit if any step hangs.

### Frontend error states

Every page-level data load is wrapped in an `ErrorBoundary` plus a typed loading/error/empty state machine:

- **Loading** → `<LoadingSkeleton />`
- **Error** → `<ErrorState onRetry={...} />`
- **Empty** → `<EmptyState />` with guidance text
- **Success** → page content

The same machine is reused across Dashboard, Screener, Market Detail, Signals, Alerts, and Settings.

## Testing Strategy

The test plan combines unit tests, property-based tests, integration tests, and smoke checks. The dual approach (examples for specific scenarios; properties for universal claims) is essential because the engine math, filter logic, and protocol invariants are too varied to cover by examples alone, while route wiring, configuration, and UI presence are best verified by direct examples.

### Tooling

| Layer | Tool |
|---|---|
| Unit + property tests in TS packages | Vitest + `fast-check` |
| Frontend component tests | Vitest + React Testing Library |
| API route integration tests | Vitest + `fastify.inject()` (no real HTTP) |
| End-to-end smoke (optional) | Playwright against `docker compose up` |
| Lint / type | ESLint + `tsc --noEmit` |

`fast-check` is the chosen PBT library because it integrates with Vitest, supports shrinking, and runs fully in-process.

### `packages/screener-engine` — pure logic

This is where the bulk of the property-based tests live (Requirement 18.4–18.6). The package is a hard unit-test target: pure inputs, pure outputs, no mocks needed.

Properties (mapped from the Correctness Properties section):

- **Property 1**: `fc.tuple(fc.double({min:0, max:100, noNaN:true}) × 5)` → assert `Number.isInteger(score)`, `0 ≤ score ≤ 100`, `score === Math.round(clamp(weightedSum))`. Includes targeted boundary cases at `0.5` to confirm rounds-up.
- **Property 2**: `fc.integer({min:0, max:100})` → assert correct band partition.
- **Property 3**: `fc.tuple(...).chain(t => oneOf(undefined, NaN))` injecting an invalid sub-score → assert error indication and no numeric output.
- **Property 4 / 5**: For each detector, generate `Kline[]` (or order book / OI / funding) plus a threshold; compute the metric directly, then assert detector emission iff metric crosses threshold. Uses `fc.commands` to compose sequences of klines.
- **Property 8**: Generate `ScreenerResult[]` and `(column, direction)` → assert `runRanked` output equals reference sort.
- **Property 9**: Generate `ScreenerResult[]` and `ScreenerQuery` → assert filter equals direct predicate.

Per Requirement 18.4, the package also has example unit tests for: price change calculation, relative volume, spread, order-book imbalance, volatility, pump/dump detection, volume spike, breakout, and Signal_Score range bounds (covered by Property 1 plus a dedicated example test for the rounded-integer return type).

Property test configuration:
- `numRuns: 100` minimum per property.
- Each property test is tagged with a comment in the form **`Feature: crypto-market-screener, Property {n}: {short property text}`**.

### `packages/shared` — schemas

- **Property 17 (schema round trip)**: For each exported schema, use `fast-check` arbitraries derived from the schema (`zod-fast-check` or hand-written arbitraries) → `JSON.parse(JSON.stringify(value))` → re-parse against the schema → assert deep equality.
- Example tests assert: every documented `SignalType` literal parses; random unrelated strings fail; `ApiError.message.length ≤ 500` is enforced.

### `apps/api` — route + state + jobs

Route tests run via `fastify.inject()` for speed and determinism.

- **Property 13 (batch invariants)**: With Vitest fake timers, push synthetic update bursts at varying rates → assert every flushed batch satisfies size and cadence bounds.
- **Property 10 (latest-write-wins)**: Generate update sequences `(symbol, value, ts)` with random shuffling → apply → assert final store entries match sort-by-ts argmax per symbol.
- **Property 12 (cooldown)**: With a fake clock, drive the evaluator across simulated minutes; assert exactly one `AlertEvent` per cooldown window even when the condition holds continuously.
- **Property 14 (backoff)**: Replace the underlying socket with a stub that always rejects; assert delay sequence equals the formula for the first 12 attempts.
- **Property 15 (validation rejection)**: For each route, generate random invalid payloads with `fast-check`; assert `400` + envelope; assert via spies that the handler body did not run and Prisma was not called.
- **Property 16 (envelope conformance)**: Capture every error response across all route fixtures; parse against `ApiError` schema; check no stack/path/sql substrings.
- **Property 11 (persistence round trip)**: For alerts and settings, generate valid payloads; POST/PATCH then GET; assert structural equality. Runs against an ephemeral Postgres (via `docker compose` test profile or `pg-mem` for fastest cycles).

Example tests:
- `/health` returns `{status:"ok", mode, redis, db}`.
- Each route exists and returns `application/json` (Requirement 20.1).
- Boot with `USE_MOCK_DATA=true` registers only `MockExchangeAdapter`.
- Boot with bad `DATABASE_URL` still serves `/markets` and returns 503 from `/alerts`.

Smoke / static tests:
- `docker-compose.yml` parses and contains `web`, `api`, `postgres`, `redis` services and a postgres volume.
- `pnpm-workspace.yaml` lists all four workspaces.
- `tsconfig.base.json` has `strict: true`.
- `.env.example` lists every key referenced by `config/env.ts`.
- A static check forbids `screener-engine` from importing `fastify`, `prisma`, `ws`, `pino`, `node:fs`, `node:net`.
- A static grep verifies no route patterns matching `apiKey|secretKey|tradingKey` exist (Requirement 3.2).

### `apps/web` — UI + stores

- **Property 18 (throttle + memoization)**: With fake timers, push high-frequency `market:batch` events; assert store updates occur ≤ once per 250 ms and only `MarketRow`s for changed symbols re-render (using a render counter via `React.Profiler`).
- **Property 11 (watchlist round trip)**: Generate random watchlist sets, persist via store, reload from `localStorage`, assert equality.
- **Property 14 (WS reconnect backoff)**: Mock the WebSocket constructor, force drops, advance fake timers, assert delay sequence matches formula.
- **Property 8 (ranked lists)**: Render dashboard with random market sets; assert each ranked list equals reference sort.
- **Property 9 (filter correctness)**: Render Screener with random data and random `ScreenerQuery`; assert visible rows equal predicate evaluation.

Example tests:
- Each route renders without crashing under a mocked WebSocket.
- `DisclaimerBanner` is present on every page.
- Loading / error / empty states render under each branch.
- `ConnectionStatus` indicator shows the correct label for each of the four states.
- Theme toggle flips between light and dark and persists.

### Performance / integration (out of unit-test scope)

- Screener evaluation cycle benchmark (Requirement 24.1) — Vitest microbench or a dedicated `bench.ts` measuring max sync block under 80 markets.
- Visual layout snapshot at 1024 px width (Requirement 23.7).
- Optional Playwright smoke run against `docker compose up --build`.

### Test commands

```
pnpm test                                  # everything
pnpm --filter screener-engine test --run   # engine unit + property tests (Requirement 18.5)
pnpm --filter shared test --run
pnpm --filter api test --run
pnpm --filter web test --run
```

Each property-based test file carries a header comment listing the design properties it implements, e.g.:

```ts
// Feature: crypto-market-screener
// Property 1: Score formula, bounds, and integer rounding
// Property 2: Score band classification
// Property 3: Score requires complete sub-scores
```

This makes the link from acceptance criterion → design property → executable test traceable in both directions.
