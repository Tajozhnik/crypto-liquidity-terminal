# Requirements Document

## Introduction

The Crypto Market Screener is a web-based market intelligence tool that helps a trader quickly discover crypto markets exhibiting unusual behavior such as volume spikes, sharp price moves (pump/dump), volatility expansion, spread widening, order book imbalance, futures metric anomalies (open interest, funding rate), and range breakouts. It is an analytical tool only; it does not execute trades, does not accept trading API keys, and does not provide financial advice.

The MVP must be production-ready and runnable locally with a single command (`docker compose up --build`). The system MUST start in a fully functional **mock mode** that does not depend on external exchanges, Redis, or PostgreSQL availability for screener output, so the application can be evaluated end-to-end without any third-party credentials. Real exchange connectivity (Binance, Bybit) is layered on top of the mock-first architecture through a pluggable adapter interface.

The system is delivered as a TypeScript monorepo with two applications (Next.js web frontend and Fastify backend API) and two shared packages (`shared` types/schemas and `screener-engine` business logic with unit tests).

## Glossary

- **System**: The Crypto Market Screener application as a whole, including frontend, backend, and supporting packages.
- **Web_App**: The Next.js frontend application served on port 3000.
- **API_Server**: The Fastify backend application served on port 4000, exposing REST and WebSocket endpoints.
- **Screener_Engine**: The pure-business-logic package (`packages/screener-engine`) that computes metrics, detects signals, and computes the hot-market score.
- **Shared_Package**: The TypeScript package (`packages/shared`) containing shared types, Zod schemas, and constants.
- **Exchange_Adapter**: An interface (`ExchangeAdapter`) implemented by per-exchange modules (Mock, Binance, Bybit) that provides market data through a uniform API.
- **Mock_Adapter**: The default `ExchangeAdapter` implementation that produces synthetic but realistic market data without external network calls.
- **Market_Data_Store**: The in-memory live snapshot maintained by the `API_Server` for active markets.
- **Cache_Layer**: The Redis-backed cache and pub/sub used by the `API_Server` when Redis is available.
- **Database**: The PostgreSQL database accessed through Prisma, holding alerts, alert events, signal events, and user settings.
- **Screener_Job**: The periodic backend job that recomputes metrics and detects signals across all tracked markets.
- **Alert_Evaluator**: The backend job that evaluates user-defined alert conditions against current market metrics.
- **WebSocket_Channel**: The single WebSocket endpoint exposed by the `API_Server` that streams typed events to connected clients.
- **Mock_Mode**: The runtime mode in which `USE_MOCK_DATA=true`, all data originates from `Mock_Adapter`, and external exchange connections are disabled.
- **Signal**: A typed event produced by the `Screener_Engine` indicating that a specific condition has been detected for a specific market.
- **Signal_Score**: An integer in the range 0–100 representing the aggregate "hotness" of a market.
- **Alert**: A user-configured rule stored in the `Database` that triggers an `Alert_Event` when its condition is satisfied.
- **Alert_Event**: A persisted record created when an `Alert` is triggered, also broadcast over the `WebSocket_Channel`.
- **Watchlist**: The set of symbols the user has starred, persisted on the client in `localStorage` for the MVP.
- **Quote_Asset**: The asset a market is priced in (for example USDT, USDC, BTC).
- **Market_Type**: The category of a market, either `spot` or `futures`.
- **Disclaimer**: The exact UI text "This tool is for market analysis only and does not provide financial advice."
- **Readiness_Endpoint**: The HTTP endpoint `GET /readiness` exposed by the `API_Server` that reports per-subsystem health.
- **In_Memory_Cache_Fallback**: A process-local LRU map used by the `API_Server` when the `Cache_Layer` is unreachable.
- **Single_User_MVP**: The MVP runs as a single, unauthenticated user. There is no login, no `userId` filtering, no session management.

## Configuration Defaults

The following constants are normative and apply across all requirements that reference "configured" values. They are exposed as environment variables documented in `.env.example`; the values listed are the defaults.

### Detector thresholds

| Detector | Default values |
|---|---|
| `VOLUME_SPIKE` | timeframe `5m`, `relativeVolumeThreshold` = `3.0` |
| `PRICE_PUMP` | timeframe `5m`, `thresholdPercent` = `+2.0` |
| `PRICE_DUMP` | timeframe `5m`, `thresholdPercent` = `-2.0` |
| `VOLATILITY_EXPANSION` | timeframe `5m`, `thresholdMultiplier` = `2.0` |
| `SPREAD_WIDENING` | `thresholdPercent` = `0.15` |
| `ORDER_BOOK_IMBALANCE` | `depthLevels` = `20`, `thresholdRatio` = `0.65` |
| `OI_SPIKE` | timeframe `15m`, `thresholdPercent` = `5.0` |
| `FUNDING_ANOMALY` | `absoluteThreshold` = `0.03` |
| `BREAKOUT` | `lookbackCandles` = `20`, timeframe `5m` |
| `HOT_MARKET` | `scoreThreshold` = `81` |

### Top-N (dashboard)

Top Gainers, Top Losers, Top Volume Spikes, Hottest Markets — **10 entries each**.

### Market detail defaults

Candles: interval `1m`, limit `200`. Order book: top `20` bids and top `20` asks. Recent trades: last `100`. Recent signals for selected symbol: last `50`.

### Cadence and SLAs

| Loop | Default |
|---|---|
| `SCREENER_INTERVAL_MS` | `1000` |
| `ALERT_INTERVAL_MS` | `2000` |
| `WS_BATCH_INTERVAL_MS` | `750` |
| Alert evaluator → emit SLA | `≤ 5000 ms` from condition becoming true to `alert:triggered` broadcast |
| Default alert `cooldownSeconds` | `300` (5 minutes) |

### Timestamp convention

All timestamps in REST responses, WebSocket event payloads, and persisted records that are exposed externally SHALL be **UTC ISO 8601** strings (e.g. `2026-05-25T14:30:00.000Z`). Internal in-memory representations MAY use epoch milliseconds; conversion happens at the serialization boundary.

## Requirements

### Requirement 1: One-Command Local Bootstrap

**User Story:** As a developer, I want to start the entire stack with one command, so that I can evaluate the MVP without manual setup.

#### Acceptance Criteria

1. THE System SHALL provide a `docker-compose.yml` at the repository root that defines services for `web`, `api`, `postgres`, and `redis`.
2. WHEN a developer runs `docker compose up --build` from the repository root with default `.env` values, THE System SHALL build all images and start all four services without manual intervention.
3. WHEN all services have started in default configuration, THE Web_App SHALL be reachable at `http://localhost:3000`.
4. WHEN all services have started in default configuration, THE API_Server SHALL respond to `GET http://localhost:4000/health` with HTTP status 200 and a JSON body containing a `status` field equal to `"ok"`.
5. THE System SHALL provide a `.env.example` file at the repository root listing every environment variable consumed by the `API_Server` and the `Web_App`, each with a safe default value or a documented placeholder.
6. THE System SHALL declare a persistent Docker volume for the `postgres` service so that data survives container restarts.
7. WHEN the `api` container starts in development configuration, THE API_Server SHALL execute Prisma client generation and a Prisma `db push` against the configured `Database` on a best-effort basis, and SHALL start the HTTP server even if either operation fails.
8. IF the `Database` is unreachable at startup, THEN THE API_Server SHALL log a structured warning, mark the database subsystem as `unavailable` in `Readiness_Endpoint`, and continue startup so the screener and WebSocket continue to function.

### Requirement 2: Monorepo Structure and TypeScript Configuration

**User Story:** As a developer, I want a clean monorepo structure with shared types and strict TypeScript, so that code is consistent and type-safe across apps and packages.

#### Acceptance Criteria

1. THE System SHALL be organized as a pnpm workspaces monorepo with the following workspace roots: `apps/web`, `apps/api`, `packages/shared`, and `packages/screener-engine`.
2. THE System SHALL provide a `pnpm-workspace.yaml` file at the repository root that includes all four workspaces.
3. THE System SHALL provide a `tsconfig.base.json` at the repository root with `"strict": true` enabled.
4. THE System SHALL configure each workspace's `tsconfig.json` to extend `tsconfig.base.json`.
5. THE System SHALL target Node.js version 20 or later for the `API_Server` and for all build scripts.
6. THE System SHALL provide a top-level `package.json` exposing scripts to build, lint, type-check, and run unit tests across all workspaces.
7. THE System SHALL provide a `.gitignore` file that excludes `node_modules`, build outputs, `.env` files, and Prisma generated artifacts.

### Requirement 3: Disclaimer and Safety Constraints

**User Story:** As a product owner, I want explicit safety constraints enforced in the product, so that the tool cannot be confused with a trading bot or financial advisor.

#### Acceptance Criteria

1. THE Web_App SHALL render the Disclaimer text "This tool is for market analysis only and does not provide financial advice." in a persistent banner or footer that is visible on every route.
2. THE System SHALL NOT expose any endpoint, form, or configuration field for entering trading API secret keys or private keys.
3. THE System SHALL NOT implement order placement, order cancellation, position management, or any other trading action against an exchange.
4. THE Web_App SHALL NOT display predictions of future profit, guaranteed returns, or financial recommendations in any UI copy.
5. THE System SHALL function in `Mock_Mode` without requiring any paid external API subscription.

### Requirement 4: Mock Data Mode (Foundational)

**User Story:** As a developer, I want a fully working mock mode, so that the entire product can be exercised end-to-end without any external exchange or paid API.

#### Acceptance Criteria

1. WHEN the environment variable `USE_MOCK_DATA` is set to `true`, THE API_Server SHALL select `Mock_Adapter` as the active `Exchange_Adapter` and SHALL NOT establish outbound connections to real exchanges.
2. THE Mock_Adapter SHALL generate between 50 and 100 markets, with the count controlled by the `MOCK_MARKET_COUNT` environment variable (default 80).
3. THE Mock_Adapter SHALL produce realistic crypto symbols including at minimum `BTCUSDT`, `ETHUSDT`, and `SOLUSDT`, mixing both `spot` and `futures` market types.
4. THE Mock_Adapter SHALL update market data on a fixed interval controlled by the `MOCK_UPDATE_INTERVAL_MS` environment variable (default 750 ms).
5. THE Mock_Adapter SHALL generate price movements using a seeded pseudo-random number generator so that runs are reproducible for a given seed.
6. THE Mock_Adapter SHALL periodically inject synthetic anomalies including price pumps, price dumps, volume spikes, and spread expansions across a subset of markets.
7. THE Mock_Adapter SHALL generate order book snapshots, recent trades, candles, open interest, and funding rate values for each market it owns.
8. WHILE the System is running in Mock_Mode, IF Redis is unreachable, THEN THE API_Server SHALL continue to serve REST and WebSocket requests using the in-memory Market_Data_Store without crashing.
9. WHILE the System is running in Mock_Mode, IF the Database is unreachable, THEN THE API_Server SHALL continue to serve REST endpoints that do not require persistence (markets, screener, signals derived from live state) and SHALL return a structured error for endpoints that require the Database.

### Requirement 5: Dashboard Page

**User Story:** As a trader, I want a dashboard summarizing market activity, so that I can see the overall state of the market at a glance.

#### Acceptance Criteria

1. THE Web_App SHALL serve a Dashboard at the route `/`.
2. THE Dashboard SHALL display the total number of tracked markets.
3. THE Dashboard SHALL display the count of currently active signals.
4. THE Dashboard SHALL display a Top Gainers list of exactly the 10 markets with the highest 24h price change percentage, ordered descending.
5. THE Dashboard SHALL display a Top Losers list of exactly the 10 markets with the lowest (most negative) 24h price change percentage, ordered ascending.
6. THE Dashboard SHALL display a Top Volume Spikes list of exactly the 10 markets with the highest relative volume, ordered descending.
7. THE Dashboard SHALL display a Hottest Markets list of exactly the 10 markets with the highest Signal_Score, ordered descending.
8. THE Dashboard SHALL display a real-time signal feed that updates as new signals arrive over the WebSocket_Channel.

### Requirement 6: Screener Table

**User Story:** As a trader, I want a screener table showing all tracked markets and their key metrics, so that I can scan many markets at once.

#### Acceptance Criteria

1. THE Web_App SHALL serve the screener at the route `/screener`.
2. THE Screener SHALL display one row per tracked market with the following columns in this order: Symbol, Exchange, Market Type, Price, 24h Change %, 5m Change %, 15m Change %, 1h Change %, 24h Volume, Relative Volume, Volatility, Trades/min, Spread %, Bid/Ask Imbalance, Open Interest, Funding Rate, Signal Score, Last Signal, Updated At, Watchlist toggle.
3. WHERE a market has Market Type `spot`, THE Screener SHALL render the Open Interest and Funding Rate cells as empty or a defined placeholder rather than zero.
4. THE Screener SHALL apply color coding such that positive numeric changes render in green, negative numeric changes render in red, and neutral values render in a neutral color.
5. THE Screener SHALL render a Signal_Badge for each active signal type on the corresponding row.
6. THE Screener SHALL render a Score_Badge whose label is `cold` for scores 0–30, `normal` for 31–60, `hot` for 61–80, and `extreme` for 81–100.
7. THE Screener SHALL allow the user to sort rows ascending or descending by any numeric column.
8. THE Screener SHALL provide a free-text search input that filters rows by symbol substring match (case-insensitive).
9. WHILE the Screener is loading initial data, THE Screener SHALL render a loading skeleton state.
10. IF the Screener fails to load data from the API_Server, THEN THE Screener SHALL render an error state with a retry control.
11. WHEN the filtered result set is empty, THE Screener SHALL render an empty state with guidance text.
12. THE Screener SHALL keep input/filter latency under 100 ms while displaying between 100 and 300 markets on a typical laptop (defined as 8-core CPU, 16 GB RAM). THE Web_App SHALL achieve this through `MarketRow` memoization and per-symbol selectors so that updating one market does not re-render unrelated rows.

### Requirement 7: Screener Filters

**User Story:** As a trader, I want to narrow the screener by exchange, market type, and metric thresholds, so that I can focus on markets that match my strategy.

#### Acceptance Criteria

1. THE Screener SHALL provide a filter for Exchange with selectable values `Binance`, `Bybit`, and `Mock`. WHERE the user selects `Bybit` in MVP builds, THE Screener SHALL render an empty state with the text "Bybit adapter is not enabled in this MVP build." instead of attempting to fetch data.
2. THE Screener SHALL provide a filter for Market_Type with selectable values `spot` and `futures`.
3. THE Screener SHALL provide a filter for Quote_Asset with selectable values including at minimum `USDT`, `USDC`, and `BTC`.
4. THE Screener SHALL provide numeric threshold filters for: minimum 24h volume, minimum 5m change %, minimum 15m change %, minimum relative volume, minimum volatility, maximum spread %, and minimum Signal_Score.
5. THE Screener SHALL provide a boolean filter "has active signal" that hides rows without an active signal when enabled.
6. THE Screener SHALL provide a boolean filter "watchlist only" that restricts rows to symbols in the user's Watchlist when enabled.
7. WHEN the user changes any filter value, THE Screener SHALL re-evaluate the displayed rows without a full page reload.
8. WHEN the user submits a screener query to `POST /screener/query` with a JSON body, THE API_Server SHALL validate the body against a Zod schema and SHALL return HTTP 400 with the `ApiError` envelope if validation fails. WHEN the user issues `GET /screener` with query parameters, THE API_Server SHALL accept the same filter fields as scalar or comma-separated query parameters and SHALL return the same response shape as `POST /screener/query`.

### Requirement 8: Screener Presets

**User Story:** As a trader, I want one-click filter presets, so that I can switch between common screening strategies quickly.

#### Acceptance Criteria

1. THE Screener SHALL expose presets with these exact filter values:

| Preset | Filter values |
|---|---|
| `Scalping` | `marketType=futures`, `minVolume24h=10_000_000`, `maxSpreadPercent=0.08`, `minTradesPerMinute=50` |
| `High Volume` | `quoteAsset=USDT`, `minVolume24h=50_000_000` |
| `Volatility` | `minVolatility=2.0`, `minChange5mAbs=1.5` |
| `Futures OI` | `marketType=futures`, `minOpenInterestChange15m=3.0` |
| `Low Spread` | `maxSpreadPercent=0.05`, `minVolume24h=20_000_000` |
| `Meme Coins` | `symbols={DOGEUSDT, SHIBUSDT, PEPEUSDT, FLOKIUSDT, WIFUSDT, BONKUSDT}`, `minRelativeVolume=1.5` |
| `Breakout` | `signalTypes={BREAKOUT}`, `minSignalScore=70` |

2. WHEN the user selects a preset, THE Screener SHALL set the active filter values to the preset's defined values, replacing any previously set filters.
3. WHEN a preset is active and the user manually edits any filter, THE Screener SHALL mark the preset as customized so that the UI does not falsely indicate an unmodified preset is in use.
4. THE Screener SHALL allow the user to clear all filters and return to an unfiltered view.

### Requirement 9: Market Detail Page

**User Story:** As a trader, I want a detail page per market, so that I can drill into a specific symbol's price action, order book, trades, and signals.

#### Acceptance Criteria

1. THE Web_App SHALL serve the market detail page at the route `/markets/[symbol]`.
2. THE Market Detail Page SHALL render a price chart with the latest 200 candles at 1-minute interval for the selected symbol.
3. THE Market Detail Page SHALL render a recent trades tape showing the latest 100 trades.
4. THE Market Detail Page SHALL render an order book showing the top 20 bids, top 20 asks, the current spread percentage, and the bid/ask imbalance.
5. THE Market Detail Page SHALL render the calculated metrics for the symbol: 5m / 15m / 1h / 24h price change %, 24h volume, relative volume, volatility, trades per minute, spread %, bid/ask imbalance, and Signal_Score.
6. WHERE the market is futures, THE Market Detail Page SHALL render Open Interest and Funding Rate values.
7. THE Market Detail Page SHALL display the latest 50 signals for the symbol in reverse chronological order.
8. THE Market Detail Page SHALL provide a control to create an Alert pre-filled with the current symbol, exchange, and market type.
9. WHILE the System is in Mock_Mode, THE Market Detail Page SHALL display live-updating chart, order book, and trades tape data sourced from the Mock_Adapter.

### Requirement 10: Signal Detection

**User Story:** As a trader, I want the system to detect ten distinct types of market signals, so that I can be alerted to specific patterns.

#### Acceptance Criteria

1. THE Screener_Engine SHALL implement detection for the signal types `VOLUME_SPIKE`, `PRICE_PUMP`, `PRICE_DUMP`, `VOLATILITY_EXPANSION`, `SPREAD_WIDENING`, `ORDER_BOOK_IMBALANCE`, `OI_SPIKE`, `FUNDING_ANOMALY`, `BREAKOUT`, and `HOT_MARKET`.
2. WHEN the volume of the most recent short window exceeds the average volume of the previous N windows by a configured multiplier, THE Screener_Engine SHALL emit a `VOLUME_SPIKE` signal for that market.
3. WHEN the price of a market increases by more than a configured percentage X over the most recent Y minutes, THE Screener_Engine SHALL emit a `PRICE_PUMP` signal for that market.
4. WHEN the price of a market decreases by more than a configured percentage X over the most recent Y minutes, THE Screener_Engine SHALL emit a `PRICE_DUMP` signal for that market.
5. WHEN the recent range or ATR-equivalent of a market expands beyond a configured multiplier of its baseline, THE Screener_Engine SHALL emit a `VOLATILITY_EXPANSION` signal for that market.
6. WHEN the spread percentage of a market exceeds a configured threshold, THE Screener_Engine SHALL emit a `SPREAD_WIDENING` signal for that market.
7. WHEN the bid/ask imbalance ratio of a market exceeds a configured threshold in either direction, THE Screener_Engine SHALL emit an `ORDER_BOOK_IMBALANCE` signal for that market.
8. WHERE a market is futures, WHEN open interest increases by more than a configured percentage over a configured window, THE Screener_Engine SHALL emit an `OI_SPIKE` signal for that market.
9. WHERE a market is futures, WHEN the funding rate exceeds a configured positive threshold or falls below a configured negative threshold, THE Screener_Engine SHALL emit a `FUNDING_ANOMALY` signal for that market.
10. WHEN the price of a market closes above the high or below the low of the previous N candles, THE Screener_Engine SHALL emit a `BREAKOUT` signal for that market.
11. THE Screener_Engine SHALL emit a `HOT_MARKET` signal for a market when `calculateHotMarketScore(...).score >= 81`. The `HOT_MARKET` signal is derived from the score; it is not produced by an independent detector function. THE Screener_Engine SHALL expose a function `detectHotMarket(input)` that returns the `HOT_MARKET` `Signal` when the score crosses the threshold and `null` otherwise.

### Requirement 11: Signal Score Calculation

**User Story:** As a trader, I want a single 0–100 score per market, so that I can rank markets by overall hotness.

#### Acceptance Criteria

1. WHEN computing market signals for a market, THE Screener_Engine SHALL compute the Signal_Score using the formula `score = momentumScore*0.25 + volumeScore*0.25 + volatilityScore*0.20 + liquidityScore*0.15 + orderBookScore*0.15`.
2. THE Screener_Engine SHALL compute each sub-score (momentumScore, volumeScore, volatilityScore, liquidityScore, orderBookScore) as a numeric value on the closed range 0 to 100 inclusive.
3. THE Screener_Engine SHALL clamp the raw weighted Signal_Score to the closed range 0 to 100 inclusive prior to rounding.
4. THE Screener_Engine SHALL round the clamped Signal_Score to the nearest integer, rounding values with a fractional part of 0.5 or greater upward.
5. THE Screener_Engine SHALL classify the final Signal_Score as `cold` for integer values 0 through 30 inclusive, `normal` for 31 through 60 inclusive, `hot` for 61 through 80 inclusive, and `extreme` for 81 through 100 inclusive.
6. THE function `calculateHotMarketScore` SHALL be a total function returning an object of shape `{ score: integer in [0, 100], warnings: string[] }`. WHEN any sub-score is missing, `NaN`, or non-finite, THE function SHALL substitute a safe fallback value of `0` for that sub-score, append a human-readable warning string identifying the offending field to `warnings`, and continue computation. THE returned `score` SHALL always satisfy `Number.isInteger(score) && 0 <= score <= 100`.

### Requirement 12: Alerts CRUD

**User Story:** As a trader, I want to define metric-based alerts, so that I am notified when a market crosses a threshold I care about.

#### Acceptance Criteria

1. THE Web_App SHALL serve an alerts page at the route `/alerts`.
2. THE API_Server SHALL expose REST endpoints to create, read, update, and delete Alerts: `POST /alerts`, `GET /alerts`, `GET /alerts/:id`, `PATCH /alerts/:id`, and `DELETE /alerts/:id`.
3. THE API_Server SHALL persist each Alert with the fields `id`, `symbol`, `exchange`, `marketType`, `conditionType`, `operator`, `threshold`, `timeframe` (optional), `enabled`, `cooldownSeconds` (default 300), `lastTriggeredAt` (optional, UTC ISO8601), `createdAt` (UTC ISO8601), and `updatedAt` (UTC ISO8601).
4. THE API_Server SHALL accept the following values for `conditionType`: `PRICE_CHANGE_5M`, `PRICE_CHANGE_15M`, `PRICE_CHANGE_1H`, `PRICE_CHANGE_24H`, `RELATIVE_VOLUME`, `VOLATILITY`, `SPREAD`, `ORDER_BOOK_IMBALANCE`, `SIGNAL_SCORE`, `OPEN_INTEREST`, and `FUNDING_RATE`.
5. THE API_Server SHALL accept the following values for `operator`: `>`, `>=`, `<`, `<=`, and `==`.
6. WHEN an Alert payload fails Zod validation, THE API_Server SHALL respond with HTTP 400 and the `ApiError` envelope.
7. WHERE an Alert payload has `conditionType` equal to `FUNDING_RATE` or `OPEN_INTEREST`, IF `marketType` is not `futures`, THEN THE API_Server SHALL reject the payload with HTTP 400 and the `ApiError` envelope identifying the conflict.
8. THE Web_App SHALL provide a form to create and edit Alerts with all fields above.
9. THE Web_App SHALL provide a list view that displays existing Alerts and allows enabling, disabling, and deleting them.

### Requirement 13: Alert Evaluation and Triggering

**User Story:** As a trader, I want enabled alerts to fire automatically when their condition holds, so that I do not have to watch the screener manually.

#### Acceptance Criteria

1. THE Alert_Evaluator SHALL evaluate every enabled Alert against the current market metrics on each evaluation cycle. THE evaluator cycle SHALL run on a fixed interval of 2000 ms by default (configurable via `ALERT_INTERVAL_MS`).
2. WHEN an Alert's metric satisfies its operator-and-threshold condition, THE Alert_Evaluator SHALL create a new Alert_Event record in the Database with fields `id`, `alertId`, `symbol`, `message`, `value`, `threshold`, and `triggeredAt` (UTC ISO 8601).
3. WHEN an Alert_Event is created, THE API_Server SHALL emit an `alert:triggered` event over the WebSocket_Channel containing the Alert_Event payload within 5000 ms of the underlying condition first becoming true.
4. WHEN an Alert is triggered, THE Alert_Evaluator SHALL update the Alert's `lastTriggeredAt` field to the trigger time.
5. WHILE the time elapsed since an Alert's `lastTriggeredAt` is less than its `cooldownSeconds`, THE Alert_Evaluator SHALL NOT create another Alert_Event for that Alert.
6. WHEN an Alert is disabled and subsequently re-enabled, THE Alert_Evaluator SHALL clear the Alert's `lastTriggeredAt` so that the cooldown is reset.
7. THE Web_App SHALL display new Alert_Events in the alerts page when received over the WebSocket_Channel.
8. THE API_Server SHALL expose `GET /alert-events` returning a paginated list of Alert_Events ordered by `triggeredAt` descending.
9. THE System SHALL be designed so that additional notification channels (for example email or Telegram) can be added without modifying the Alert_Evaluator's evaluation logic.

### Requirement 14: Watchlist

**User Story:** As a trader, I want to star markets I follow, so that I can quickly filter the screener to just those markets.

#### Acceptance Criteria

1. THE Screener SHALL display a Watchlist toggle control on each row.
2. WHEN the user toggles the Watchlist control on a row, THE Web_App SHALL add or remove that symbol from the Watchlist.
3. THE Web_App SHALL persist the Watchlist in `localStorage` so that it survives page reloads on the same browser.
4. WHEN the "watchlist only" filter is enabled, THE Screener SHALL render only rows whose symbol is in the Watchlist.
5. THE Database schema SHALL include a `Watchlist` table with columns `id`, `userId` (nullable for MVP single-user mode), `exchange`, `marketType`, `symbol`, `createdAt`. THE Database SHALL define a unique index on `(userId, exchange, marketType, symbol)` and SHALL NOT define a unique index on `symbol` alone, so that future per-user watchlists can be added without breaking changes.

### Requirement 15: Settings Page

**User Story:** As a user, I want a settings page to configure defaults and inspect runtime status, so that I can tailor the tool to my workflow.

#### Acceptance Criteria

1. THE Web_App SHALL serve a settings page at the route `/settings`.
2. THE Settings page SHALL allow the user to configure the default exchange, default market type, and default quote asset used by the Screener; these fields SHALL be persisted to the backend `UserSetting` table.
3. THE Settings page SHALL allow the user to configure the screener update frequency; this field SHALL be persisted to the backend `UserSetting` table.
4. THE Settings page SHALL allow the user to switch between light and dark themes; the chosen theme SHALL be persisted to browser `localStorage` only and SHALL NOT be sent to the backend.
5. THE Settings page SHALL allow the user to configure table layout preferences (column visibility, density); these SHALL be persisted to browser `localStorage` only.
6. WHILE Mock_Mode is active, THE Settings page SHALL display a clearly labeled "Mock Mode" indicator.
7. THE Settings page SHALL display the current WebSocket connection status.
8. THE API_Server SHALL expose `GET /settings` and `PATCH /settings` to read and update server-persisted settings stored in the `UserSetting` table keyed by string `key`.
9. THE MVP SHALL operate in Single_User_MVP mode: there is no authentication, no login form, and no `userId` filtering; all server settings are global.

### Requirement 16: Exchange Adapter Abstraction

**User Story:** As a developer, I want a stable adapter interface for exchanges, so that I can add or swap exchanges without touching screener or API logic.

#### Acceptance Criteria

1. THE API_Server SHALL define a TypeScript interface `ExchangeAdapter` exposing at minimum the methods `connect`, `disconnect`, `subscribeTickers`, `subscribeTrades`, `subscribeOrderBook`, `getMarkets`, and `getKlines`.
2. THE API_Server SHALL provide a `MockExchangeAdapter` implementing `ExchangeAdapter` and used as the default adapter in Mock_Mode.
3. THE API_Server SHALL provide a `BinanceAdapter` implementing `ExchangeAdapter` for live Binance market data.
4. THE API_Server SHALL provide a `BybitAdapter` skeleton implementing `ExchangeAdapter` with method stubs that compile and clearly indicate they are not yet implemented.
5. THE API_Server SHALL select the active set of `Exchange_Adapter` instances based on environment configuration and SHALL expose the adapter abstraction to the rest of the backend through a single registration point.

### Requirement 17: Market Data Module

**User Story:** As a developer, I want a clear separation between live in-memory state, cache, and persistent storage, so that the system stays responsive and resilient.

#### Acceptance Criteria

1. THE API_Server SHALL maintain a Market_Data_Store in process memory containing the latest snapshot of every tracked market.
2. WHERE Redis is configured and reachable, THE API_Server SHALL use the Cache_Layer for caching aggregate views and for cross-process pub/sub.
3. THE API_Server SHALL persist Alerts, Alert_Events, signal events, and user settings only in the Database, not in the Cache_Layer.
4. IF the Cache_Layer becomes unreachable while the API_Server is running, THEN THE API_Server SHALL log a structured warning, switch reads and writes to an In_Memory_Cache_Fallback (a process-local LRU map), and continue serving requests from the Market_Data_Store.
5. WHEN the API_Server receives a market data update from an `Exchange_Adapter`, THE API_Server SHALL update the Market_Data_Store before broadcasting downstream events.
6. WHILE the Cache_Layer is unreachable, THE API_Server SHALL attempt periodic reconnection using exponential backoff with the same parameters as Requirement 25.1 (initial 1000 ms, factor 2, capped at 30000 ms). WHEN the connection is restored, THE API_Server SHALL resume using the Cache_Layer for caching and pub/sub without restarting the process and without dropping in-flight requests.

### Requirement 18: Screener Engine Package and Unit Tests

**User Story:** As a developer, I want pure business logic isolated in a tested package, so that screener correctness can be verified independently of HTTP and WebSocket transport.

#### Acceptance Criteria

1. THE Screener_Engine package SHALL expose the functions `calculatePriceChange`, `calculateRelativeVolume`, `calculateVolatility`, `calculateSpread`, `calculateOrderBookImbalance`, `calculateTradesPerMinute`, `calculateAverageVolume`, `calculateRangeBreakout`, `normalizeScore`, `detectVolumeSpike`, `detectPricePump`, `detectPriceDump`, `detectVolatilityExpansion`, `detectSpreadWidening`, `detectOrderBookImbalance`, `detectBreakout`, `detectOpenInterestSpike`, `detectFundingAnomaly`, `detectHotMarket`, `calculateHotMarketScore`, and `runScreener`.
2. THE Screener_Engine package SHALL contain no I/O, no HTTP, no WebSocket, no database, and no logging side effects.
3. THE Screener_Engine package SHALL document each formula in code comments with input definitions and the produced output.
4. THE Screener_Engine package SHALL include Vitest unit tests covering at minimum: price change calculation, relative volume calculation, spread calculation, order book imbalance calculation, volatility calculation, pump and dump detection, volume spike detection, breakout detection, and Signal_Score range bounds.
5. WHEN the unit test suite for `packages/screener-engine` is executed via `pnpm --filter screener-engine test --run`, THE test suite SHALL exit with status code 0 on a passing build.
6. FOR ALL inputs accepted by `calculateHotMarketScore`, THE returned object SHALL be of shape `{ score: integer in [0, 100], warnings: string[] }` with `Number.isInteger(score) === true` and `warnings` a (possibly empty) array of strings naming any sub-score that required fallback substitution.

### Requirement 19: WebSocket Channel and Event Batching

**User Story:** As a frontend developer, I want a typed WebSocket channel with batched updates, so that the UI stays in sync without overwhelming the browser.

#### Acceptance Criteria

1. THE API_Server SHALL expose a WebSocket_Channel that supports the events `market:update`, `market:batch`, `signal:new`, `alert:triggered`, `orderbook:update`, and `trades:update`, where each event carries a typed payload conforming to a documented schema.
2. THE API_Server SHALL coalesce per-market price and metric updates into `market:batch` messages emitted on a fixed interval of 750 ms by default (configurable via `WS_BATCH_INTERVAL_MS`, validated to fall within the closed interval [500, 1000] ms), with each batch containing at most 500 per-market update entries (`WS_BATCH_MAX_ENTRIES`). WHEN more than 500 updates are pending at flush time, THE API_Server SHALL split them across consecutive batches and SHALL NOT drop updates unless the receiving client is disconnected.
3. WHEN a new Signal is produced by the Screener_Engine, THE API_Server SHALL emit a `signal:new` event over the WebSocket_Channel within 500 ms of the Signal's production timestamp.
4. WHEN a client connects to the WebSocket_Channel, THE API_Server SHALL deliver an initial state snapshot within 2000 ms of the connection being established. THE snapshot SHALL be a single message of shape `{ markets: ScreenerResult[], recentSignals: Signal[], recentAlertEvents: AlertEvent[], serverTime: ISO8601 string }` containing the latest 300 markets, the latest 50 signals, and the latest 50 alert events.
5. IF the WebSocket connection drops on the client, THEN THE Web_App SHALL attempt to reconnect using exponential backoff starting at 1000 ms, doubling on each failed attempt up to a maximum delay of 30000 ms, for at least 10 attempts before surfacing a persistent connection error to the user.
6. WHEN the WebSocket connection state changes, THE Web_App SHALL update the connection status indicator to exactly one of the states: connected, connecting, reconnecting, or disconnected.

### Requirement 20: REST API Endpoints and Error Format

**User Story:** As an integrator, I want a documented REST surface with consistent validation and error responses, so that I can call the API predictably.

#### Acceptance Criteria

1. THE API_Server SHALL expose `GET /health`, `GET /readiness`, `GET /markets`, `GET /markets/:symbol`, `GET /markets/:symbol/klines`, `GET /markets/:symbol/orderbook`, `GET /markets/:symbol/trades`, `GET /screener`, `POST /screener/query`, `GET /signals`, `GET /signals/:symbol`, `POST /alerts`, `GET /alerts`, `GET /alerts/:id`, `PATCH /alerts/:id`, `DELETE /alerts/:id`, `GET /alert-events`, `GET /settings`, and `PATCH /settings`, each returning `application/json` responses.
2. THE API_Server SHALL validate every request payload and query parameter against Zod schemas defined in the Shared_Package before executing handler logic.
3. IF a request fails Zod validation, THEN THE API_Server SHALL respond with HTTP status 400 and an error body whose `details` field enumerates each failing field with its validation message, without executing handler logic or mutating any persisted state.
4. IF a request targets a resource identifier (such as `:symbol` or `:id`) that does not exist in the system, THEN THE API_Server SHALL respond with HTTP status 404 and an error body identifying the missing resource type and identifier.
5. IF an unhandled exception occurs during request processing, THEN THE API_Server SHALL respond with HTTP status 500 and an error body containing a generic message, without exposing stack traces, internal file paths, or database details to the caller.
6. THE API_Server SHALL format every error response as a JSON object matching the shape `{ "error": string, "message": string, "statusCode": number, "details"?: unknown }`, where `error` is a stable machine-readable code, `message` is a human-readable description no longer than 500 characters, and `statusCode` equals the HTTP status code of the response.
7. WHEN any error response is produced, THE API_Server SHALL emit a structured pino log entry that includes the request id, HTTP method, route path, status code, and error code, at log level `warn` for 4xx responses and `error` for 5xx responses.
8. IF a request body on `POST` or `PATCH` endpoints exceeds 1 MB or is sent with a `Content-Type` other than `application/json`, THEN THE API_Server SHALL reject the request with HTTP status 413 or 415 respectively and the standard error body, without invoking handler logic.
9. THE `GET /signals` endpoint SHALL accept the query parameters `symbol`, `type`, `limit` (default 50, max 200), and `cursor`, SHALL order results by `createdAt` descending, and SHALL return a response of shape `{ items: Signal[], nextCursor: string | null }`.
10. WHEN the rate limiter rejects a request, THE API_Server SHALL respond with HTTP status 429, set the `Retry-After` header to the suggested wait time in seconds, and return the body `{ "error": "RATE_LIMITED", "message": string, "statusCode": 429, "retryAfterSeconds": number }`.
11. THE `GET /health` endpoint SHALL return a body of shape `{ "status": "ok", "serverTime": ISO8601 string }` and SHALL be lightweight (no database or cache I/O).
12. THE `GET /readiness` endpoint SHALL return a body of shape `{ "status": "ok" | "degraded", "db": "ok" | "unavailable", "redis": "ok" | "fallback", "exchangeAdapters": Array<{ name, connected: boolean }>, "serverTime": ISO8601 string }`. The endpoint SHALL probe each subsystem and SHALL return HTTP 200 in both `ok` and `degraded` states.
13. ALL timestamp fields in REST response bodies SHALL be UTC ISO 8601 strings.

### Requirement 21: Database Schema

**User Story:** As a developer, I want a Prisma schema with the right tables and indexes, so that persistence is correct and queries are efficient.

#### Acceptance Criteria

1. THE Database SHALL contain a table `Alert` with columns `id`, `symbol`, `exchange`, `marketType`, `conditionType`, `operator`, `threshold`, `timeframe` (nullable), `enabled`, `cooldownSeconds` (default 300), `lastTriggeredAt` (nullable), `createdAt`, and `updatedAt`.
2. THE Database SHALL contain a table `AlertEvent` with columns `id`, `alertId`, `symbol`, `message`, `value`, `threshold`, and `triggeredAt`.
3. THE Database SHALL contain a table `SignalEvent` with columns `id`, `symbol`, `exchange`, `marketType`, `signalType`, `score`, `message`, `payload` (JSON), and `createdAt`.
4. THE Database SHALL contain a table `UserSetting` with columns `id`, `key` (unique), `value` (JSON), `createdAt`, and `updatedAt`.
5. THE Database SHALL contain a table `Watchlist` with columns `id`, `userId` (nullable), `exchange`, `marketType`, `symbol`, and `createdAt`, with a unique index on `(userId, exchange, marketType, symbol)`.
6. THE Database SHALL define indexes on `Alert.enabled`, `AlertEvent.alertId`, `AlertEvent.triggeredAt`, `SignalEvent.symbol`, `SignalEvent.signalType`, and `SignalEvent.createdAt`.
7. THE API_Server SHALL access the Database exclusively through Prisma client APIs.

### Requirement 22: Shared Types Package

**User Story:** As a developer, I want shared types and Zod schemas, so that frontend and backend agree on data shapes without duplication.

#### Acceptance Criteria

1. THE Shared_Package SHALL export TypeScript types for `ExchangeName`, `MarketType`, `SignalType`, `Market`, `Ticker`, `Kline`, `Trade`, `OrderBookLevel`, `OrderBook`, `FuturesMetrics`, `Signal`, `ScreenerResult`, `Alert`, `AlertEvent`, and `ScreenerQuery`.
2. THE Shared_Package SHALL define `SignalType` as a union of exactly the ten string literals `VOLUME_SPIKE`, `PRICE_PUMP`, `PRICE_DUMP`, `VOLATILITY_EXPANSION`, `SPREAD_WIDENING`, `ORDER_BOOK_IMBALANCE`, `OI_SPIKE`, `FUNDING_ANOMALY`, `BREAKOUT`, and `HOT_MARKET`.
3. THE Shared_Package SHALL export Zod schemas for every API request and response shape used by the API_Server.
4. THE Web_App SHALL import shared types and schemas from the Shared_Package rather than redeclaring them.
5. THE API_Server SHALL import shared types and schemas from the Shared_Package rather than redeclaring them.

### Requirement 23: Frontend Layout, Components, and State

**User Story:** As a user, I want a clean, responsive crypto-terminal-style UI, so that the tool feels professional and is easy to use on different screen sizes.

#### Acceptance Criteria

1. THE Web_App SHALL render an `AppLayout` composed of a `Sidebar`, a `TopBar`, and a main content area.
2. THE Sidebar SHALL provide navigation links to Dashboard, Screener, Signals, Alerts, and Settings.
3. THE TopBar SHALL render a `ConnectionStatus` indicator reflecting the current WebSocket connection state.
4. THE Web_App SHALL implement at minimum the following components: `AppLayout`, `Sidebar`, `TopBar`, `ConnectionStatus`, `MarketTable`, `MarketTableFilters`, `MarketRow`, `SignalBadge`, `ScoreBadge`, `PriceChange`, `MiniSparkline`, `MarketChart`, `OrderBook`, `TradesTape`, `AlertForm`, `AlertList`, `AlertEventList`, `PresetFilters`, `StatCard`, `ErrorBoundary`, `LoadingSkeleton`, `EmptyState`, and `DisclaimerBanner`.
5. THE Web_App SHALL implement Zustand stores `useMarketStore`, `useAlertStore`, and `useWatchlistStore`, with `useWatchlistStore` persisted to `localStorage`.
6. THE Web_App SHALL render with a dark theme by default and SHALL support a light theme switchable from the Settings page.
7. THE Web_App SHALL render a usable layout on viewport widths from 1024 px and above.

### Requirement 24: Performance

**User Story:** As a user, I want the app to remain responsive under realistic load, so that scanning many markets is comfortable.

#### Acceptance Criteria

1. THE API_Server SHALL not perform synchronous CPU-blocking work that exceeds 50 ms on the main event loop during a single screener evaluation cycle for the default Mock_Mode market count.
2. THE API_Server SHALL emit batched market updates over the WebSocket_Channel at an interval between 500 ms and 1000 ms rather than per-tick.
3. THE Web_App SHALL memoize row components in the `MarketTable` so that updating one market does not re-render unrelated rows.
4. THE Web_App SHALL throttle inbound `market:batch` updates so that the UI does not re-render more frequently than once per 250 ms.

### Requirement 25: Error Handling and Resilience

**User Story:** As an operator, I want graceful error handling and reconnection, so that transient failures do not require restarting the stack.

#### Acceptance Criteria

1. WHEN an `Exchange_Adapter` connection drops, THE API_Server SHALL attempt to reconnect using exponential backoff with a configured maximum interval.
2. WHEN the API_Server process receives `SIGTERM` or `SIGINT`, THE API_Server SHALL initiate graceful shutdown by stopping new connections, draining in-flight requests, disconnecting adapters, and closing Database and Cache_Layer connections before exit.
3. IF a Zod validation error occurs in any handler, THEN THE API_Server SHALL respond with HTTP 400 and a structured error body that does not leak internal stack traces in production.
4. THE API_Server SHALL log every caught exception through pino at an appropriate level rather than swallowing it silently.
5. WHEN the Web_App fails to load data on any page, THE Web_App SHALL render an error state that informs the user and offers a retry control.
6. WHEN the WebSocket connection drops on the Web_App, THE Web_App SHALL update the `ConnectionStatus` indicator and attempt automatic reconnection.

### Requirement 26: Security and Configuration

**User Story:** As an operator, I want sane security defaults and no trading credentials, so that running the tool does not put any account at risk.

#### Acceptance Criteria

1. THE API_Server SHALL read all secrets and tunable parameters from environment variables and SHALL NOT hard-code them in source.
2. THE API_Server SHALL apply CORS configuration sourced from an environment variable specifying allowed origins.
3. THE API_Server SHALL apply a rate limit to its REST endpoints with limits configurable by environment variables. WHEN the rate limit is exceeded, the response SHALL conform to Requirement 20.10.
4. THE API_Server SHALL validate every external input through Zod before passing it to business logic.
5. THE System SHALL NOT accept, store, or transmit exchange trading API secret keys or private keys.
6. THE System SHALL provide a `.env.example` file documenting every supported environment variable without exposing real secrets.

### Requirement 27: README and Documentation

**User Story:** As a new contributor, I want a thorough README, so that I can understand, run, and extend the project without external help.

#### Acceptance Criteria

1. THE System SHALL provide a `README.md` at the repository root that includes the following sections in order: project overview, Disclaimer, features, architecture, stack, file structure, environment variables, quick start, Docker start, local development, tests, mock mode, REST API endpoints, WebSocket events, troubleshooting, roadmap, and a safety note.
2. THE README.md SHALL state that the tool is for analysis only and does not provide financial advice.
3. THE README.md SHALL document the exact command sequence for running the stack locally with Docker and for running it without Docker.
4. THE README.md SHALL list every environment variable defined in `.env.example` with a one-line description of its purpose.
5. THE README.md SHALL document how to run the Screener_Engine unit tests.
6. THE README.md SHALL document the WebSocket event names defined in Requirement 19 and the REST endpoints defined in Requirement 20.
