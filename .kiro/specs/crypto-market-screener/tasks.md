# Implementation Plan: Crypto Market Screener

## Tasks

### Done

- [x] **Monorepo skeleton** — pnpm workspace, base tsconfig, root scripts, .gitignore, .dockerignore.
- [x] **Docker stack** — compose with web/api/postgres/redis, persistent volume, two Dockerfiles. API starts even if DB is down (`prisma db push` is best-effort).
- [x] **Environment config** — `.env.example` with detector defaults, mock parameters, WS batching, rate limits, `HOT_MARKET_SCORE_THRESHOLD=81`.
- [x] **Shared package** — Zod schemas for every contract (markets, screener, alerts, settings, WS events, error envelope, readiness). Constants. `AlertInput` superRefine for futures-only conditions; `AlertPatch` separately.
- [x] **Engine** — pure metrics, 9 detectors + derived `detectHotMarket`, total `calculateHotMarketScore` returning `{ score, warnings }`, `classifyScoreBand`, `runScreener` orchestrator. **16/16 vitest tests pass.**
- [x] **Mock-first API** — `MockExchangeAdapter` (seeded mulberry32, ~80 markets, anomaly scheduler, futures OI/funding), `BybitAdapter` skeleton, `BinanceAdapter` (live REST, WS subscriptions stubbed).
- [x] **API server** — Fastify with CORS, rate limit, websocket, error envelope, graceful shutdown, request logging.
- [x] **Live state** — `MarketDataStore` plus rolling recent signal buffer.
- [x] **Persistence with fallback** — Prisma init is best-effort, with periodic 30s reconnect. `alertStore` abstracts Prisma vs in-memory backing for both alerts and alert events, so the alert evaluator works end-to-end without Postgres.
- [x] **WebSocket hub** — initial snapshot includes `markets ≤300`, `recentSignals ≤50`, `recentAlertEvents ≤50`, `serverTime`. Coalesced `market:batch` every 750 ms, overflow split (no drops). Immediate `signal:new` and `alert:triggered`.
- [x] **Screener job** — interval loop with overrun protection, runs `runScreener`, writes store before broadcast.
- [x] **Alert evaluator** — runs every 2 s, uses live `MarketDataStore` snapshots, enforces cooldown (default 300 s), cooldown reset on disable→enable, futures-only validation defense in depth, broadcasts `alert:triggered`. Works against in-memory or Prisma store.
- [x] **REST routes** — `/health`, `/readiness`, full `/markets*`, `/screener` (GET) and `/screener/query` (POST), `/signals*` with pagination, `/alerts` CRUD (with futures-only enforcement), `/alert-events`, `/settings` (GET falls back to defaults when DB is down).
- [x] **Frontend foundation** — Next.js 14 App Router, layout with Sidebar/TopBar/ConnectionStatus/persistent disclaimer, dark + light themes via local store.
- [x] **Frontend WS client** — exponential backoff (1 s → 30 s, factor 2), 250 ms throttle for `market:batch`, immediate signal/alert pass-through, 4-state machine.
- [x] **Frontend API client** — typed wrapper for every endpoint, structured `ApiError` with status/code/details.
- [x] **Dashboard** — cards (markets / active signals / recent signals / recent alerts / connection), 4 ranked Top-10 lists with clickable symbols, live signal feed, recent alert events panel, loading/disconnected/empty states.
- [x] **Screener** — full filter panel (exchange/marketType/quoteAsset chips, 9 numeric thresholds, search, "has signal", "watchlist only"), 7 presets, reset, sortable table on every numeric column, watchlist star per row, symbol → detail link, URL-synced filter state, Bybit empty-state notice.
- [x] **Market detail** — `/markets/[symbol]` with Sparkline chart over 200×1m candles, metric cards, top-20 order book, last 100 trades tape, last 50 signals for symbol, alerts-for-symbol panel, "+ New alert for SYMBOL" prefill, back link.
- [x] **Alerts page** — `AlertForm` with prefill from query, full enum coverage for `conditionType` (with futures-only options disabled for spot), `AlertList` with enable/disable/delete, `AlertEventList` updated live by `alert:triggered`, validation-error display.
- [x] **Settings** — server-side defaults (`PATCH /settings`) for default exchange/market type/quote asset/update frequency. Local-only theme + table density via `useLocalSettings` (zustand persist). Watchlist viewer + clear. Real-time runtime status (mode, WS, db, redis).
- [x] **Watchlist** — `useWatchlistStore` (zustand persist to localStorage v1), star button on screener rows and detail page, "watchlist only" filter integrated.
- [x] **Binance adapter** — public REST adapter with `getMarkets/getKlines/getOrderBook/getRecentTrades/getTicker/getFuturesMetrics`. WS subscriptions are intentionally no-ops in MVP. Always registered so the exchange filter works in both modes.
- [x] **README** — quick-start, structure, REST + WS surface, env vars, safety note.

### Verification commands run

- `pnpm typecheck` — green across `shared`, `screener-engine`, `api`, `web`.
- `pnpm test` — 16 engine tests pass.
- `pnpm --filter @screener/web build` — green; 7 routes (1 dynamic).
- `docker compose config` — valid.
- API smoke: `/health`, `/readiness`, `/markets`, `/screener` (GET + POST), `/markets/:symbol/{klines,orderbook,trades}`, alerts CRUD, `/alert-events`, alert evaluator producing live events.

### Not done (lower priority, listed for transparency)

- Property-based tests with `fast-check` for engine (P1, P4, P9, P14, P17). Engine is example-tested but not yet PBT-tested.
- Integration tests via `fastify.inject` for validation rejection / envelope conformance / DB-down behaviour. Smoke covered by hand.
- Component tests for `MarketRow` memoization render-counter and `ConnectionStatus` 4-state machine.
- Real Binance WebSocket subscriber feeding `MarketDataStore` (REST surface is wired). Mock mode remains default; switching via `USE_MOCK_DATA=false` keeps the screener alive (using Binance REST polling would require additional plumbing — not in scope of this milestone).
- Notification side channels (email/Telegram). Architecture is open: an observer over the `alertStore` event stream can be added without touching the evaluator.
