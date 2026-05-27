# Crypto Liquidity Terminal

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Tests](https://img.shields.io/badge/tests-295%20passing-22c55e)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A live crypto market intelligence terminal centered around an **interactive order book liquidity heatmap** for Binance plus a multi-exchange screener. The app surfaces unusual market behavior (volume spikes, sharp moves, volatility expansion, spread widening, order book imbalance, OI/funding anomalies, breakouts) and a unified 0–100 hotness score, all in real time over WebSocket.

> **Disclaimer.** This tool is for market analysis only. It does **not** place trades, does **not** accept exchange API keys, and is **not** affiliated with any exchange. Mock data is for tests/dev only — the default mode is live public data.

## Table of contents

- [Quick start](#quick-start)
- [What you'll see](#what-youll-see)
- [How the Liquidity Heatmap is built](#how-the-liquidity-heatmap-is-built)
- [Stack](#stack)
- [Local development](#local-development)
- [Tests](#tests)
- [Operating modes](#operating-modes)
- [No-subscription data policy](#no-subscription-data-policy)
- [Environment variables](#environment-variables)
- [REST endpoints](#rest-endpoints)
- [WebSocket events](#websocket-events)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Quick start

The app is fully containerized — Postgres, Redis, the Fastify API, and the Next.js web app all come up with one command. Docker Desktop must be running.

```bash
docker compose up -d --build
```

That's it. Wait ~30 seconds for `docker compose ps` to show all four services as `healthy`, then open:

| URL | Page |
|---|---|
| http://localhost:3000 | Dashboard (top gainers/losers, hottest markets, live signal feed) |
| http://localhost:3000/heatmap | **Liquidity Chart** — order book heatmap + candles + volume + order book panel |
| http://localhost:3000/screener | Multi-exchange screener with filters and a 0–100 score |
| http://localhost:3000/markets/BTCUSDT | Market detail (metrics, sparkline, top-20 book, recent trades, signals) |
| http://localhost:3000/alerts | Alert rule builder + active alerts + live events |
| http://localhost:3000/signals | Lightweight feed of all detected signals |
| http://localhost:3000/settings | Runtime mode, exchange status, DB/Redis state |
| http://localhost:4000/health | Static `{status:"ok"}` probe |
| http://localhost:4000/readiness | Operational mode + per-adapter status |

By default the API runs in **live public data** mode (`USE_MOCK_DATA=false`, `ENABLE_PUBLIC_API_ADAPTERS=true`), pulling from Binance, Bybit, OKX, Coinbase, and Kraken via public REST plus a Binance WebSocket for the heatmap. **No API keys are required, ever.**

> **First-load expectations.** The screener fills within ~2 s in mock mode and within ~60 s in live mode (the polling job ticks once a minute by default). The Liquidity Heatmap is **accumulated live** — public exchanges don't expose historical full-depth snapshots, so when you first open `/heatmap` for a symbol you'll see candles immediately (REST backfilled) but the heatmap walls fill in over the next few minutes. The DebugBar above the chart shows progress: `Heatmap age: 60s / 30m collected · 3%`.

Useful follow-up commands:

```bash
docker compose ps                    # health of every service
docker compose logs -f api           # tail API logs
docker compose logs -f web           # tail web logs
docker compose restart api           # restart only the API
docker compose down                  # stop everything
docker compose down -v               # stop and wipe Postgres volume
```

---

## What you'll see

Every screenshot below is from a real live-mode run against `binance-spot` BTCUSDT. The captions explain every control on screen so you know what each setting actually does.

### Liquidity Chart — full layout

![Liquidity Chart](docs/screenshots/01-liquidity-chart.png)

The main view at `/heatmap`. Everything you see is one symbol on one exchange — switching the symbol kicks off a fresh order book WebSocket subscription.

**Top control bar (left → right):**

- **Symbol** — pick any Binance USDT pair. The list comes from `GET /liquidity/symbols`. Switching kicks off a new WS subscription and resets the chart.
- **Market** — `Spot` or `Futures` (USDT-M perp).
- **Timeframe** — `1m / 5m / 15m`. Drives the **candle** interval (REST `klines`); the heatmap uses its own much finer time bucket (default 5 s, see [How it's built](#how-the-liquidity-heatmap-is-built)).
- **Bin size** — price bucket height. `auto` targets ~200 bins across the visible range; fixed `0.1% / 0.25% / 0.5% / 1%` snap to a percentage of mid price. Smaller bins show more detail; larger bins make walls more obvious.
- **Side** — `combined` (bids + asks), `bids` only, `asks` only, or `imbalance` (|bid − ask| per cell).
- **Intensity** — legacy linear multiplier; left over from the original colour pipeline. The new density pipeline (right side of the bar) overrides it whenever a preset is selected.
- **Log scale**, **Candles**, **Delta** — visibility toggles for the candle layer, log-scaled colour ramp, and the volume/delta panel below the chart.
- **Density** — normalization mode used to map raw liquidity → cell opacity. `raw` (linear), `log` (log-compressed), `percentile` (rank-based, robust to outliers), `zscore` (banded, makes walls pop). Default: `zscore`.
- **Preset** — a saved tuple of density settings. `Balanced` is the safe default; `Deep Liquidity` is what you see in the screenshots; `Strong Walls` keeps only top ~15% of cells; `Weak Liquidity` lifts the floor to inspect thin areas; `Clean` hides sub-noise without glow.
- **Depth** — top-N levels per side fed into the heatmap (`50 / 100 / 250 / 500 / 1000`). Higher values reveal walls farther from mid; the default is 500.
- **Lookback** — how far back into the live ring buffer the heatmap reads (`15m / 30m / 1h / 2h / 4h / max`). Capped by `MAX_HEATMAP_LOOKBACK_HOURS` env (default 4 h).
- **Gamma** — non-linear cell-opacity correction. `< 1` lifts weak cells (more visible thin liquidity), `> 1` flattens them.
- **Glow** — additive overlay on top-percentile cells; gives walls a soft halo.
- **Hide weak** / **Strong only** — drop sub-threshold cells (≥ 0.55 z-score) / keep only the strongest (≥ 0.85). Combine with `Strong Walls` preset to isolate iceberg orders.

**Chart toolbar (above the canvas):**

- **Cursor** — pan + select drawings. **Hand** — drag-to-pan only.
- **Horizontal Line / Trend Line / Ray / Rectangle / Text Label** — drawing tools. Drawings persist in `localStorage` per `exchange:marketType:symbol`.
- **Eraser** — click to remove a drawing.
- **Clear All** — drops every drawing for the current symbol.
- **+ / −** — zoom in/out (time axis).
- **Reset** — fit viewport to the timeframe-default visible range (1m → 15 min, 5m → 1 h, 15m → 4 h).
- **Fit** — same as Reset; uses the union of candle range and matrix range.

**Inside the canvas:**

- **Heatmap cells (cyan/teal = bid, magenta/pink = ask, lilac = balanced).** Brightness encodes liquidity at that price × time bucket. Stable walls show as horizontal bright streaks across many time slices; ephemeral spoofing flashes briefly.
- **Candles** — overlaid on top of the heatmap, aligned to candle body geometry pixel-for-pixel (the volume bar below sits exactly under each candle body).
- **Dashed white horizontal line** — current mid price from `bestBid` and `bestAsk`.
- **"heatmap collection started" marker** — vertical orange dashed line showing when the WS feed for this symbol opened. Anything to the left exists only as candles, not as heatmap.
- **Right axis** — price labels (decimals scale with magnitude). **Bottom axis** — local time HH:MM:SS.
- **Volume / delta histogram** below the chart. In `delta` mode green bars above the centre line are net taker buys, red below are net taker sells; falls back to per-candle volume when delta has < 2 buckets.

**Right-side panel:**

- **Order Book** — top 12 bids + top 12 asks live, refreshed each poll (~2 s). Spread and `bid-ask imbalance` (signed −1..+1) at the top.

**Below the chart:**

- **DebugBar** — every diagnostic the heatmap pipeline produces: stream status, time bucket size in ms, snapshot count, cell count, price bin count, completeness vs the timeframe's required history, oldest/newest snapshot timestamps, applied vs max lookback, the heatmap price window, and the visible-cells count after viewport clipping. Use it to confirm the heatmap is actually running, not stuck.

### Drawing tools in action

![Liquidity Chart with drawings](docs/screenshots/02-liquidity-drawings.png)

The same chart with a couple of horizontal levels and a trend line dropped on top. Drawings are pure client-side and don't affect the heatmap pipeline — they're stored in `localStorage` keyed by `exchange:marketType:symbol`, so switching back to BTCUSDT later restores them. The Eraser tool removes a single drawing on click; **Clear All** wipes them for the current symbol after a confirmation prompt.

Geometry note: drawings are anchored in **price/time domain coordinates**, not pixels. Zooming and panning move them with the chart instead of dragging them around. This is the same invariant that the heatmap cells follow — viewport changes are pure visual transforms, never a server refetch (the polling loop only refetches on symbol/market/timeframe change or an explicit "Rebuild for visible range" click).

### Screener

![Screener](docs/screenshots/03-screener.png)

The `/screener` page is the fast multi-exchange filter table. Every column is sortable; the URL stays in sync with the filter state so you can share a link.

- **Filter panel (top)** — exchange, market type (spot/futures), quote asset, signal types, watchlist-only toggle, plus min/max thresholds for `volume24h`, `change5m / 15m / 1h / 24h`, `relativeVolume`, `volatility`, `spreadPct`, `tradesPerMinute`, `signalScore`, and `OI change`.
- **Score column** — unified 0–100 from `screener-engine`. Bands: `cold (0–24)` / `normal (25–60)` / `hot (61–80)` / `extreme (81–100, default `HOT_MARKET` threshold)`.
- **Signals column** — colored badges for each active detector: volume spike, price pump/dump, volatility expansion, spread widening, order book imbalance, OI spike, funding anomaly, breakout, hot market.
- **Star (★)** — toggle watchlist; persisted in `localStorage`. Starred symbols can be filtered with the `Watchlist only` checkbox.
- **Sortable headers** — `Symbol` / `Exchange` / `Quote` use lexicographic ordering server-side (via `localeCompare`); numeric columns sort numerically.

Live updates flow over WebSocket: the API coalesces market changes into 750 ms `market:batch` messages so the table doesn't repaint every tick, but reactions to price moves still feel immediate.

### Market detail

![Market detail](docs/screenshots/04-market-detail.png)

`/markets/:symbol` shows everything for one market in one place. Header has the symbol, current price, 24 h change, score badge, and signal badges. Below:

- **Sparkline + headline metrics** — 60-min price miniature, `change5m / 15m / 1h / 24h`, `volume24h`, `relativeVolume`, `volatility`, `tradesPerMinute`, `spreadPct`, `orderBookImbalance`, plus `openInterest` and `fundingRate` for futures.
- **Order book** — top 20 bids / top 20 asks with cumulative volume bars, refreshed via `GET /markets/:symbol/orderbook`.
- **Recent trades** — last 100 trades from `GET /markets/:symbol/trades`, side-coloured.
- **Recent signals** — every signal the engine fired for this symbol with timestamp and message.
- **Alert this symbol** — shortcut to `/alerts?prefill={symbol,exchange,marketType}` so the form on the alerts page comes pre-filled.

### Alerts

![Alerts](docs/screenshots/05-alerts.png)

Three panels on `/alerts`:

- **Create Alert (left)** — pick `Symbol`, `Market type`, `Exchange`, `Condition` (one of 11: `PRICE_CHANGE_5M/15M/1H/24H`, `RELATIVE_VOLUME`, `VOLATILITY`, `SPREAD`, `ORDER_BOOK_IMBALANCE`, `SIGNAL_SCORE`, `OPEN_INTEREST`, `FUNDING_RATE`), `Operator` (`> >= < <= ==`), `Threshold`, and `Cooldown` (default 300 s = 5 min). `OPEN_INTEREST` and `FUNDING_RATE` are futures-only; the form disables them when `marketType=spot` and shows "(futures only)".
- **Active Alerts (right)** — every saved rule. Each row has an enabled/disabled toggle, last-fired time, and a delete button. `enabled: true` after `false` resets `lastTriggeredAt` so the cooldown doesn't suppress the next match.
- **Recent Alert Events (bottom)** — live feed of triggered events from the AlertEvaluator (runs every 2 s by default). Each row has the trigger time, symbol, observed value, the threshold it crossed, and the human-readable message.

The alert condition validation is enforced server-side via Zod, so a misuse like `FUNDING_RATE` on a spot market returns `400 validation_error` rather than silently saving.

### Settings + readiness

![Settings](docs/screenshots/06-settings-readiness.png)

`/settings` — split into four panels:

- **Runtime** — `Mode` (`Live Public Data` / `Hybrid` / `Mock`, derived from the registry's actual adapter set, not just env intent), `WebSocket` connection state, `Server status`, `Database` (`ok`/`unavailable`), `Redis` (`ok`/`fallback`), `Settings storage` (`database` / `memory fallback` / `browser localStorage`), `Enabled exchanges` (with `*` annotation for any in degraded state). `Retry` button refetches on demand.
- **Server-side defaults** — `defaultExchange / defaultMarketType / defaultQuoteAsset / screenerUpdateFrequencyMs`. Saved through `PATCH /settings`. If Postgres is unavailable, the API returns 200 with `storage: "memory"` and a warning banner appears explaining the choice will reset on API restart but is mirrored to your browser meanwhile.
- **Local preferences** — `Theme` (`dark`/`light`) and `Table density` (`comfortable`/`compact`). These are pure browser state, never sent to the server.
- **Watchlist** — chips for every starred symbol with a `Clear watchlist` action.

### Signals feed

![Signals](docs/screenshots/07-signals.png)

`/signals` is the lightweight, fast-scrolling feed of every signal the engine has fired recently across all tracked markets. It reuses the same store as the Dashboard's "Live Signal Feed" panel; each row links to that symbol's market detail page. Useful as a passive monitor in a side window while you trade in another tool.

---

## How the Liquidity Heatmap is built

The heatmap is the heart of this project. It is **not** a recording from a paid data provider; it is reconstructed live in your machine from Binance's free public WebSocket. Here's the full pipeline so you understand both what you're looking at and why some properties of a paid product (e.g. instant 24 h history) are physically impossible without a subscription.

### 1. Order book reconstruction

For each `(symbol, marketType)` the API spawns one `LiquidityFeed` (lazy, on first request to `/liquidity/:symbol/snapshot`). It does three things in parallel:

- **REST snapshot** — `GET /api/v3/depth?limit=1000` (or `/fapi/v1/depth` for perp). This gives the **initial book state with a `lastUpdateId`**. Diffs received earlier than this id are dropped; from this id forward the book is rebuilt incrementally.
- **WebSocket subscription** — `wss://stream.binance.com:9443/stream?streams=<sym>@depth@100ms/<sym>@aggTrade/<sym>@kline_1m`. The depth diff stream emits `{ U, u, b: [[price, qty], …], a: [[price, qty], …] }` every 100 ms.
- **Bridged-diff gap detection** — the first diff after the snapshot must straddle the snapshot id (`U <= lastUpdateId+1 <= u`). Every diff after that must be **strictly contiguous** (`U === lastUpdateId + 1`); any gap triggers an automatic resync (refetch the snapshot, replay buffered diffs). This is what protects the heatmap from silently rendering a desynced book.

`OrderBookReconstructor` keeps the live top-of-book in two sorted maps (bids descending, asks ascending) and exposes `topOfBook(N)`.

### 2. Top-of-book sampling

Every 250 ms the feed grabs `topOfBook(1000)` and pushes one `DepthSnapshot { t, bids, asks, midPrice }` into a fixed-capacity ring buffer (`DepthSnapshotStore`). At 4 Hz × 4 hours that's 57 600 samples — about 1.5 GB of in-memory state per symbol if you keep depth=1000, which is why `MAX_HEATMAP_LOOKBACK_HOURS` is bounded (default 4 h, configurable up to whatever your machine can hold).

### 3. Aggregation into a price × time grid

When the frontend asks for `GET /liquidity/:symbol/snapshot`, the API runs `LiquidityHeatmapBuilder.buildHeatmap()`:

- **Time bucket** — default 5 s, capped at 60 s. The frontend computes an adaptive value to target ~120 columns across the visible viewport, then sends it as `?heatmapBucketMs=`. The heatmap is therefore **decoupled from the candle timeframe** — on a 5-minute timeframe each candle still gets 60 / 300 = 0–60 heatmap columns inside it, so density isn't collapsed into one fat block.
- **Price bin** — chosen by `chooseBinWidth` from the `Bin size` control. Auto picks ~200 bins across the visible price corridor; fixed values snap to a percentage of mid.
- **Price window clamp** — heatmap range is hard-capped at ±2 % of mid by default. This is critical: the order book has thousand-level tails ($45k bids when mid is $77.9k) which would otherwise stretch the visible range and turn everything into a single column. The frontend can override the cap by passing explicit `priceMin`/`priceMax` (which only happens when you click "Rebuild for visible range").
- **Cell value** — for each bid/ask level inside the window, add `price × qty` (notional) to the matching `(timeBucket, priceBin)` cell. Bid contributions go to `bidLiquidity`, ask to `askLiquidity`, total to `totalLiquidity`.

The result is the `HeatmapMatrix` you see in the polling response: `{ cells: [{t, price, bidLiquidity, askLiquidity, totalLiquidity, intensity}, …], priceMin, priceMax, binWidth, debugStats, … }`.

### 4. Density normalization (frontend)

Raw notional values are skewed: one whale wall can be 100× the median, washing out everything else. The frontend runs each cell through a **density pipeline** before rendering:

- **Mode**: `raw` (linear), `log` (log1p compression), `percentile` (rank-based, robust), `zscore` (banded — 0.5 → 1.5σ → 2.5σ → 4σ — gives walls clearly defined visual classes). Default: `zscore`.
- **Cap percentile** (default `0.99`) — clamp normalization at the 99th percentile so a single outlier doesn't blow out the scale.
- **Gamma** (default `0.6`) — `intensity := pow(intensity, gamma)`. `< 1` lifts weak cells, `> 1` flattens them.
- **Min/max opacity** — alpha range applied to non-zero cells.
- **Hide weak / Strong only** — drop cells below thresholds.
- **Glow** — additive overlay on cells with raw normalized value `≥ 0.85`. Drawn in a second pass with `globalCompositeOperation = "lighter"`.

All five **Presets** (`Balanced` / `Deep Liquidity` / `Strong Walls` / `Weak Liquidity` / `Clean`) are just saved tuples of these values. Switching presets only changes appearance — the underlying matrix is unchanged.

### 5. Rendering invariants

- **Zoom and pan are pure client-side transforms.** Wheel zoom and drag pan update the viewport; the polling loop does not refetch the snapshot. The matrix is built server-side around mid (the stable corridor), the frontend clips cells to the viewport client-side.
- **Cells use absolute domain coordinates.** A cell stores `t` (ms epoch) and `price` (lower bound of the bin), not pixel positions or bin indices. Pan + zoom never move them visually relative to the candles.
- **Density changes don't move geometry.** Switching between `Balanced` and `Strong Walls` only changes alpha/visibility — never time or price.
- **Out-of-range banner.** If the viewport drifts so that less than 50 % of its price span overlaps the loaded matrix window, a banner appears with a `Rebuild for visible range` button. Click it once → next polling tick rebuilds the matrix server-side around the new range. A toast confirms the rebuild was applied.

### 6. Polling cadence and resilience

- The heatmap page polls `liquiditySnapshot + liquidityCandles + liquidityOrderBook + liquidityDelta` every 2 s.
- On consecutive failures the polling delay grows exponentially (2 s → 4 s → 8 s → 16 s → 30 s cap), recovering instantly on the first success — no DDoS-ing a struggling upstream.
- `binSize`, `depthLevels`, `heatmapLookback`, and `heatmapBucketMs` are read via refs so changing them does **not** clear the previous matrix or restart the polling loop. The next tick simply uses the new value.
- Public API failures fall through to the `publicFetch` cache (TTL 30 s). Adapter-level rate limits (429/418/5xx) trigger a backoff window honouring `Retry-After`.

### 7. Why "accumulated live"

Public exchanges do not expose historical full-depth snapshots — only the top-of-book ticker time-series and candles. The heatmap therefore starts empty and grows as long as the symbol's WebSocket stays connected. `/heatmap` is designed around this constraint:

- A vertical orange dashed line shows the moment the feed opened.
- The DebugBar shows live coverage (`Heatmap age: Xs / Ys collected · Z%`).
- The candle layer is REST-backfilled (last 500 candles for the chosen timeframe) so even at second 0 the chart isn't blank.
- After 5–15 minutes you'll have a usable heatmap; after 30+ minutes walls become statistically meaningful.

Per-feed buffers persist in API memory across page reloads, so revisiting the same symbol later resumes from the existing history. Switching containers (`docker compose down && up`) wipes everything.

---

## Stack

- **Frontend** — Next.js 14 (App Router) · React 18 · Zustand 4 · canvas-based liquidity renderer (no chart library — bars and cells are drawn pixel-aligned).
- **Backend** — Fastify 5 · Prisma 5 · ioredis 5 · `ws` via `@fastify/websocket`.
- **Shared** — Zod schemas + TypeScript types in `packages/shared`.
- **Engine** — pure detector + score logic in `packages/screener-engine`, no I/O.
- **Tests** — Vitest + fast-check property tests for the engine.
- **Infra** — Docker Compose (`web`, `api`, `postgres:16-alpine`, `redis:7-alpine`) with healthchecks and `depends_on: condition: service_healthy`.

## Local development

If you'd rather run things without Docker:

```bash
pnpm install
# In two terminals:
pnpm --filter @screener/api dev
pnpm --filter @screener/web dev
```

Postgres and Redis are optional. The API logs warnings if either is missing and continues — alerts and alert events fall back to in-memory storage, `PATCH /settings` returns 200 with `storage: "memory"`, and the UI mirrors the choice to `localStorage` so it survives reloads.

If you want only the data services in Docker and the apps locally:

```bash
docker compose up -d postgres redis
pnpm --filter @screener/api dev
pnpm --filter @screener/web dev
```

## Tests

```bash
pnpm typecheck                                # all 4 typed packages clean
pnpm test                                     # 295 tests across all packages
pnpm --filter @screener/engine test           # 28 unit + property tests
pnpm --filter @screener/api test              # 124 fastify.inject integration tests
pnpm --filter @screener/web test              # 143 frontend unit + interaction tests
pnpm --filter @screener/web build             # production Next.js build
docker compose config --quiet                 # validate compose
```

Property-based tests (fast-check) cover engine invariants. Integration tests cover health/readiness, markets, screener, alerts CRUD, settings fallback, multi-exchange aggregation, live polling, adapter health, operating modes, and the full liquidity heatmap pipeline including the strict-bridge gap detection and the order book reconstructor.

## Operating modes

The mode is determined by `USE_MOCK_DATA` and `ENABLE_PUBLIC_API_ADAPTERS`. `/readiness` reports `mode: "live" | "mock" | "hybrid"` based on the **actual registered adapters**, not just env intent — so the safety-net case (everything disabled → fallback to mock) correctly reports `mode: "mock"`.

### Live public mode (default)

```env
USE_MOCK_DATA=false
ENABLE_PUBLIC_API_ADAPTERS=true
ENABLED_EXCHANGES=binance,bybit,okx,coinbase,kraken
```

`MockExchangeAdapter` is **not** constructed. The `LivePollingJob` polls each adapter every `LIVE_POLLING_INTERVAL_MS` (default 60 s), fetches markets/tickers/klines/orderbook/trades/futures-metrics for the first `LIVE_POLLING_SYMBOL_LIMIT` symbols per exchange, and feeds the resulting `ScreenerResult` rows into `MarketDataStore`. The Liquidity Chart at `/heatmap` runs the dedicated Binance WebSocket pipeline described above.

### Mock-only mode (tests / dev)

```env
USE_MOCK_DATA=true
ENABLE_PUBLIC_API_ADAPTERS=false
```

Mock fixtures replace all live data. No outbound HTTP calls. Used for tests and offline dev — not the product mode.

### Hybrid mode

```env
USE_MOCK_DATA=true
ENABLE_PUBLIC_API_ADAPTERS=true
```

Both adapter sets run. The store key is `exchange:marketType:symbol`, so `BTCUSDT` on Binance and `BTCUSDT` on the mock adapter coexist as separate rows.

### Safety nets

- `ENABLE_PUBLIC_API_ADAPTERS=false` AND `USE_MOCK_DATA=false` → registry detects the empty set and falls back to mock so the app is never empty. `/readiness.mode` correctly reports `"mock"`.
- Unknown names in `ENABLED_EXCHANGES` are silently ignored.
- Public-adapter network failures do not crash the app — the affected adapter is marked `degraded` in `/readiness` and serves cached data.

## No-subscription data policy

This project is designed to run end-to-end **without any paid API subscriptions or required API keys**.

### Adapter capability matrix

| Exchange | Spot | Futures | Order book | Trades | Klines | Funding | OI | Requires key |
|---|---|---|---|---|---|---|---|---|
| binance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| bybit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| okx | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no |
| coinbase | ✓ | — | ✓ | ✓ | ✓ | — | — | no |
| kraken | ✓ | — | ✓ | ✓ | ✓ | — | — | no |
| mock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no |

WebSocket subscriptions in `ExchangeAdapter` are no-ops on every public adapter. Live screener data flows via REST polling. The Liquidity Chart pipeline at `/heatmap` is a separate path that does use Binance public WebSocket streams directly.

### Excluded by design

- No paid SaaS providers. `DISABLE_PAID_PROVIDERS=true` by default.
- No coin metadata provider. `MARKET_METADATA_PROVIDER=none`.
- No Authorization headers, ever, in `publicFetch`. Adapters never read API key env vars.

### Resilience

- Hard timeout on every `publicFetch` (`EXTERNAL_API_TIMEOUT_MS`, default 5 s).
- Successful responses are cached for `EXTERNAL_API_CACHE_TTL_SECONDS` (default 30 s).
- 429 / 418 / 403 / 5xx → backoff window honouring `Retry-After`, fallback 30 s; cached value is served meanwhile.
- Network errors fall through silently — the screener and WebSocket continue with whatever data is available.

## Environment variables

See `.env.example` for the full list. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `USE_MOCK_DATA` | `false` | Toggle the mock adapter (tests/dev). |
| `ENABLE_TEST_FIXTURES` | `false` | Alias of `USE_MOCK_DATA` used in tests. |
| `ENABLE_PUBLIC_API_ADAPTERS` | `true` | Toggle public-API adapters. |
| `ENABLED_EXCHANGES` | `binance,bybit,okx,coinbase,kraken` | Allowlist of public adapters. |
| `MOCK_MARKET_COUNT` | `80` | Number of mock markets (50–100). _Mock-mode only._ |
| `MOCK_UPDATE_INTERVAL_MS` | `750` | Mock tick rate. _Mock-mode only._ |
| `MOCK_SEED` | `42` | PRNG seed. _Mock-mode only._ |
| `SCREENER_INTERVAL_MS` | `1000` | Screener job cadence. |
| `ALERT_INTERVAL_MS` | `2000` | Alert evaluator cadence. |
| `LIVE_POLLING_INTERVAL_MS` | `60000` | Live REST polling cadence. |
| `LIVE_POLLING_SYMBOL_LIMIT` | `15` | Symbols per adapter per cycle. |
| `WS_BATCH_INTERVAL_MS` | `750` | WebSocket batch flush (500–1000). |
| `WS_BATCH_MAX_ENTRIES` | `500` | Max entries per `market:batch`. |
| `DATABASE_URL` | unset | Postgres connection (optional). |
| `REDIS_URL` | unset | Redis connection (optional). |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins. |
| `RATE_LIMIT_MAX` | `120` | Max requests per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window. |
| `HOT_MARKET_SCORE_THRESHOLD` | `81` | Score threshold for `HOT_MARKET` signal. |
| `EXTERNAL_API_TIMEOUT_MS` | `5000` | Per-call timeout. |
| `EXTERNAL_API_CACHE_TTL_SECONDS` | `30` | Cache TTL. |
| `MAX_HEATMAP_LOOKBACK_HOURS` | `4` | Memory cap for the depth-snapshot ring buffer. Drives both the per-feed buffer capacity and the `lookback=max` ceiling on `/liquidity/:symbol/snapshot`. |

## REST endpoints

Base routes:

| Endpoint | Description |
|---|---|
| `GET /health` | `{ status: "ok", serverTime }` (no I/O) |
| `GET /readiness` | `{ status, mode, mockEnabled, publicAdaptersEnabled, db, redis, exchangeAdapters[], serverTime }` |

Markets / screener / signals:

| Endpoint | Description |
|---|---|
| `GET /markets` | All tracked markets |
| `GET /markets/:symbol?exchange=&marketType=` | Single market (404 if unknown). Optional `exchange` / `marketType` disambiguate when the same symbol exists on multiple venues. |
| `GET /markets/:symbol/klines?limit=200&interval=1m&exchange=&marketType=` | Recent candles |
| `GET /markets/:symbol/orderbook?exchange=&marketType=` | Top N bids and asks (N from `MARKET_DETAIL`) |
| `GET /markets/:symbol/trades?limit=100&exchange=&marketType=` | Recent trades |
| `GET /screener?...` | Filtered screener (query params); `sortColumn` accepts both numeric and string columns (`symbol`/`exchange`/`quoteAsset` use `localeCompare`). |
| `POST /screener/query` | Filtered screener (JSON body) |
| `GET /signals?symbol=&type=&limit=50` | Recent signals |
| `GET /signals/:symbol` | Recent signals for one symbol |

Alerts / settings:

| Endpoint | Description |
|---|---|
| `POST /alerts` | Create alert; 400 with `validation_error` for FUNDING_RATE/OPEN_INTEREST on spot |
| `GET /alerts` | List alerts |
| `GET /alerts/:id` | Get alert (404 if unknown) |
| `PATCH /alerts/:id` | Update alert; `enabled: true` after `false` resets `lastTriggeredAt` |
| `DELETE /alerts/:id` | Delete alert (204) |
| `GET /alert-events?limit=100&alertId=...` | Triggered alert events |
| `GET /settings` | Server-side defaults; returns `storage: "database" \| "memory"` and `persisted` |
| `PATCH /settings` | Update settings; **returns 200** with `storage: "memory"` and a `warning` when DB is unavailable (in-memory fallback) |

Liquidity (Binance-only):

| Endpoint | Description |
|---|---|
| `GET /liquidity/symbols?marketType=spot\|futures` | Common Binance USDT pairs |
| `GET /liquidity/:symbol/snapshot?marketType=&timeframe=1m\|5m\|15m&binSize=&lookbackMinutes=&heatmapBucketMs=&levels=&priceMin=&priceMax=` | Heatmap matrix + `debugStats` + `lookback` echo + `status` |
| `GET /liquidity/:symbol/orderbook?levels=` | Live top-of-book + spread/imbalance |
| `GET /liquidity/:symbol/trades?limit=` | Recent aggregated trades |
| `GET /liquidity/:symbol/delta?timeframe=&limit=` | Bucketed delta (buy/sell volume + cumulative) |
| `GET /liquidity/:symbol/candles?interval=1m\|5m\|15m&limit=` | Klines at the requested interval |

### Error envelope

```
{
  "error": "validation_error" | "not_found" | "RATE_LIMITED" | "service_unavailable" | ...,
  "message": "<human readable, ≤ 500 chars>",
  "statusCode": 400 | 404 | 429 | 503 | ...,
  "details"?: <field-level info>,
  "retryAfterSeconds"?: <number, only on 429>
}
```

Rate-limited responses also carry a `Retry-After` header.

## WebSocket events

Channel: `ws://localhost:4000/ws`

| Event | When | Payload |
|---|---|---|
| `snapshot` | On connect | `{ markets ≤300, recentSignals ≤50, recentAlertEvents ≤50, serverTime }` |
| `market:batch` | Every `WS_BATCH_INTERVAL_MS` (default 750 ms) | `{ results: ScreenerResult[] (≤500), ts }` |
| `signal:new` | Within 500 ms of detection | `{ signal: Signal }` |
| `alert:triggered` | When AlertEvaluator fires | `{ event: AlertEvent }` |

Frontend WebSocket client uses exponential backoff (1 s → 30 s, factor 2) and a 250 ms `market:batch` throttle. Multiple components share one connection via refcount, so navigating between pages doesn't reconnect.

## Project structure

```
.
├── apps/
│   ├── api/                          # Fastify backend
│   │   ├── prisma/schema.prisma      # Postgres schema
│   │   └── src/
│   │       ├── adapters/             # AdapterRegistry, Mock, Binance, Bybit, OKX, Coinbase, Kraken, normalize, publicFetch
│   │       ├── cache/                # Redis client wrapper
│   │       ├── config/               # Env Zod schema
│   │       ├── db/                   # Prisma client w/ best-effort connect + reconnect
│   │       ├── jobs/                 # ScreenerJob, AlertEvaluator, LivePollingJob
│   │       ├── market-depth/         # OrderBookReconstructor, DepthSnapshotStore, LiquidityFeed,
│   │       │                         # LiquidityFeedManager, LiquidityHeatmapBuilder,
│   │       │                         # PriceBinner, DeltaCalculator, TradeBuffer, RingBuffer
│   │       ├── plugins/              # Error handler
│   │       ├── routes/               # health, markets, screener, signals, alerts, settings, liquidity
│   │       ├── state/                # MarketDataStore, AlertStore (DB or in-memory)
│   │       ├── ws/                   # WebSocketHub
│   │       ├── __tests__/            # fastify.inject integration + adapter + policy tests
│   │       ├── server.ts             # buildServer (with startJobs flag for tests)
│   │       └── index.ts              # Boot + graceful shutdown
│   └── web/                          # Next.js 14 frontend
│       ├── src/
│       │   ├── app/                  # App Router pages
│       │   ├── components/           # Sidebar, FilterPanel, liquidity/*, heatmap/*, …
│       │   ├── lib/                  # api, ws, filters, presets, format, chart/*, liquidity/*
│       │   ├── state/                # zustand stores
│       │   └── __tests__/            # vitest unit + interaction tests
│       └── Dockerfile
├── packages/
│   ├── shared/                       # Zod schemas + TS types (the contract)
│   └── screener-engine/              # Pure metrics, detectors, score
├── docs/screenshots/                 # Screenshots used in this README
├── scripts/take-screenshots.ts       # Playwright screenshot tool
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
├── .env.example
└── README.md
```

## Known limitations

- **Liquidity Chart is Binance-only.** Other public adapters (Bybit / OKX / Coinbase / Kraken) feed the screener but not the heatmap, because their depth-diff protocols differ.
- **Historical heatmap is accumulated live.** Public exchanges don't expose historical full-depth snapshots; the heatmap starts populating from the moment the WS connects. The DebugBar shows progress.
- **WebSocket subscriptions on screener-side adapters are no-ops.** Live screener data is REST-polled at `LIVE_POLLING_INTERVAL_MS`. The dedicated Binance liquidity feed is the only WS subscription that does real work.
- **Single-user MVP.** No authentication or session management.
- **Notification channels.** Only WebSocket broadcasts. Email / Telegram are out of scope.

## Troubleshooting

### `pnpm` not found

Install via npm: `npm install -g pnpm@9.7.0`. The repo also ships an `.nvmrc` pinning Node `20.16.0` (LTS); run `nvm use` if you have nvm-windows or fnm.

### `next/dist/...processChild.js` missing after install

Known Windows + Node 24 + pnpm interaction. Fix:

```powershell
Remove-Item -Recurse -Force node_modules
pnpm install --force
```

### `docker compose up` fails on `dockerDesktopLinuxEngine`

Docker Desktop is not running. Start Docker Desktop and retry.

### `db: unavailable` even though Postgres is healthy

Symptom: `/readiness` reports `redis: ok`, Postgres container is `healthy`, but `db: unavailable` and the API logs `Error loading shared library libssl.so.1.1`.

This is the Prisma 5 + Alpine query-engine + missing OpenSSL combination. The API `Dockerfile` installs `apk add --no-cache openssl libc6-compat` to fix it. If you still see the error, rebuild without cache: `docker compose build --no-cache api && docker compose up -d`.

### `RATE_LIMITED` 429 responses

Default limit is 120 requests / 60 s per IP. Tune `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`.

### Heatmap looks empty right after page load

By design — see [How the Liquidity Heatmap is built → Why "accumulated live"](#7-why-accumulated-live). Candles backfill from REST instantly; depth walls fill in over the next 5–15 minutes. The DebugBar shows live progress.

### Heatmap walls disappear when I zoom

They shouldn't — zoom and pan are pure client-side transforms. If you do see this:

1. Check the DebugBar's `Visible cells` count. If it stays high but you don't see them, it's a rendering issue worth filing.
2. If you see the "Viewport drifted outside the loaded heatmap price window" banner, your viewport is mostly outside the matrix range. Click `Rebuild for visible range` once.
3. If the matrix itself emptied out, the WebSocket might have dropped — check `/readiness` for the Binance adapter status and `docker compose logs -f api` for `LiquidityFeed WS` lines.

### Screenshots / re-generating screenshots

Screenshots used here live under `docs/screenshots/`. To re-generate them automatically with Playwright after running the stack:

```bash
pnpm install -D playwright
npx playwright install chromium
pnpm tsx scripts/take-screenshots.ts
```

For ad-hoc shots: `Win + Shift + S` (Windows Snipping Tool), save under the same path, or attach inline in a PR.

## Safety note

This project explicitly does not implement order placement or position management. There is no API surface for trading API keys. Code paths that could be confused for trading do not exist.

## License

[MIT](LICENSE) © Crypto Liquidity Terminal contributors.
