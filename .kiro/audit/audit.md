# Crypto Market Screener — Audit Report

Дата: 2026-05-27
Verification commands run: `pnpm typecheck`, `pnpm test`, `pnpm --filter @screener/web build`, `docker compose config --quiet`
Test count: 28 (engine) + 102 (api) + 143 (web) = **273 passing**

## Severity legend

- **CRITICAL** — приложение падает или возвращает неверные данные пользователю
- **HIGH** — заметный UX/data баг, блокирует use-case
- **MEDIUM** — работает, но косячит на edge cases или сбивает с толку
- **LOW** — косметика, dead code, устаревший комментарий
- **INFO** — наблюдение, не баг (для следующего раунда)

---

## Bugs

### B-001: Heatmap viewport price-Y math — bin coordinates use a "from-zero" reference
- **Severity**: HIGH
- **Area**: frontend
- **Files**:
  - `apps/web/src/lib/liquidity/canvasRenderer.ts:48-58`
  - `apps/web/src/lib/liquidity/chartMath.ts:21-26`
- **Symptom**: Cells in the heatmap render with the wrong height when `priceMin` is large (e.g. `priceMin = 60 000`, `binWidth = 0.5`). `cellHeightPx` is computed as `|priceToY(0) - priceToY(binWidth)|`. Because `priceToY` is linear in price within `[priceMin, priceMax]`, evaluating it at `0` extrapolates far below the bottom edge, but the difference happens to equal `(binWidth / span) * (yBottom - yTop)`, so the magnitude is correct **only** as long as the linear scale is exact. With log-style price overlays or any future non-linear scale this breaks. Today the visual artefact is invisible because the price axis is purely linear, but the code computes a height by sampling two prices that are not inside the visible window — that is a latent correctness bug, easy to trigger on the next refactor.
- **Root cause**: `cellHeightPx = Math.abs(priceToY(0) - priceToY(binWidth))` in `canvasRenderer.ts:50`. The right form is `Math.abs(priceToY(priceMin + binWidth) - priceToY(priceMin))` — sample two prices that are guaranteed inside the viewport.
- **Reproduction**: Switch any price-axis math to non-linear; cell heights become garbage. With current linear math, `noUncheckedIndexedAccess` won't catch it because it's a numeric bug, not a type bug.
- **Suggested fix**: Replace `priceToY(0, …)` / `priceToY(binWidth, …)` with `priceToY(priceMin, …)` / `priceToY(priceMin + binWidth, …)`. Add a unit test in `apps/web/src/__tests__/heatmap.test.ts` that asserts the cell height equals `(binWidth / (priceMax - priceMin)) * (yBottom - yTop)` for a non-zero `priceMin`. **Acceptance**: same cell height on a 60 000 mid as on a 100 mid (modulo `binWidth` ratio).
- **Effort**: trivial (1-line)
- **Risk if fixed**: existing density / heatmap tests pass with both forms (the result is identical for purely linear scales). Re-run `apps/web` tests to confirm.

### B-002: BybitAdapter / OkxAdapter klines: closeTime hardcoded to `openTime + 60_000`
- **Severity**: HIGH
- **Area**: backend
- **Files**:
  - `apps/api/src/adapters/BybitAdapter.ts:139` (`closeTime: new Date(ot + 60_000).toISOString()`)
  - `apps/api/src/adapters/OkxAdapter.ts:140` (`closeTime: new Date(ts + 60_000).toISOString()`)
- **Symptom**: When the screener / live polling job (or `/markets/:symbol/klines`) requests `interval=5m` / `15m` / `1h` from Bybit or OKX, the resulting `Kline.closeTime` is exactly 1 minute after `openTime`, regardless of actual interval. Anything reading `closeTime` (e.g. detector logic that needs to bucket history correctly, or the heatmap candle layer if it ever falls back to these adapters) sees mis-aligned candle bodies.
- **Root cause**: Both adapters hardcode `+60_000` instead of mapping the requested `interval` to milliseconds. Binance is fine because it returns `r[6]` directly (`closeTime` from upstream). Coinbase computes `tMs + granularity*1000` correctly. Kraken uses `tMs + minutes*60_000`. Only Bybit and OKX are wrong.
- **Reproduction**:
  ```
  GET /markets/BTCUSDT/klines?interval=5m
  ```
  with a context where the active adapter is Bybit. Compare `closeTime - openTime` vs the requested interval — for 5m it should be 300 000 ms but is 60 000 ms.
- **Suggested fix**: Add a small `intervalToMs(interval)` helper in each adapter (or share one) and replace `ot + 60_000` with `ot + intervalToMs(interval)`. Acceptance: existing test in `apps/api/src/__tests__/adapters.test.ts` augmented with a 5m kline assertion (`closeTime - openTime === 300_000`).
- **Effort**: small
- **Risk if fixed**: only the two adapters change; no tests pin the wrong value, so risk is low.

### B-003: `MarketDataStore.get(symbol)` returns the first match across exchanges (silent collision in legacy callers)
- **Severity**: HIGH
- **Area**: backend
- **Files**: `apps/api/src/state/MarketDataStore.ts:25-31`, `apps/api/src/jobs/AlertEvaluator.ts:91`, `apps/api/src/routes/markets.ts:34-44`
- **Symptom**: If the same symbol exists on multiple exchanges (e.g. `BTCUSDT` on Binance and Bybit, or hybrid mode with mock+binance), `store.get("BTCUSDT")` returns whichever record is iterated first. AlertEvaluator at `apps/api/src/jobs/AlertEvaluator.ts:91` does verify `alert.exchange === result.exchange` afterwards, but the store-level lookup loses the record for the other adapter on every other path that uses `store.get` (markets routes, dashboard payloads, etc.).
- **Root cause**: `MarketDataStore.get` linearly scans `this.snapshots.values()` and returns the first `r.symbol === symbol`. The store is keyed by `exchange:marketType:symbol` (good), but the convenience accessor doesn't take exchange/marketType.
- **Reproduction**: hybrid mode test — same symbol on `mock` and `binance`, call `GET /markets/BTCUSDT`. Today this is masked because tests only populate one exchange per symbol per case.
- **Suggested fix**: `MarketDataStore.get` should require `exchange` + `marketType` (rename existing one to `findFirstBySymbol` and mark it deprecated). Migrate the `markets.ts` route to extract exchange/marketType from query params (fall back to "first match" only if not provided). Acceptance: new test in `multiExchange.test.ts` asserting `GET /markets/BTCUSDT?exchange=bybit` returns Bybit data even when Binance is also present.
- **Effort**: medium
- **Risk if fixed**: Touches `markets.ts` route signature, the dashboard, and Market detail page. Existing `multiExchange.test.ts` passes with `getByKey`, so the strict path is already working — only the helper for legacy callers needs disambiguation.

### B-004: `applyDiff` first-snapshot transition can swallow a depth gap
- **Severity**: MEDIUM
- **Area**: backend
- **Files**: `apps/api/src/market-depth/OrderBookReconstructor.ts:79-86`
- **Symptom**: After `applySnapshot` sets `lastUpdateId = snap.lastUpdateId`, the next diff with `U <= last + 1 <= u` is accepted. But the canonical Binance protocol also requires that subsequent diffs satisfy `prev.u + 1 == this.U` (contiguous). The reconstructor only checks `U > last + 1` (with `last !== 0`); it does not check `U == last + 1`. If the WS skips an event such that `U <= last + 1 < u` (gap inside a single diff), the diff is applied with no resync.
- **Root cause**: Line 79: `if (this.state.lastUpdateId !== 0 && U > this.state.lastUpdateId + 1) { needsResync }`. The comparison should be `if (this.state.lastUpdateId !== 0 && U !== this.state.lastUpdateId + 1) { needsResync }` after the bridge diff.
- **Reproduction**: feed snapshot with `lastUpdateId=100`, then a diff with `U=99, u=200` — accepted today even though there's an implicit gap.
- **Suggested fix**: Add a `bridged` flag set on the first accepted diff, then after the bridge enforce `U === lastUpdateId + 1` strictly. Acceptance: new unit test in `marketDepth.test.ts` that a diff with `U=99, u=200` after `bridged=true` returns `"needs_resync"`.
- **Effort**: small
- **Risk if fixed**: existing tests should pass; one new test.

### B-005: `LiquidityFeed.captureSnapshot` interval ≠ the documented "1 Hz" in `DepthSnapshotStore`
- **Severity**: MEDIUM
- **Area**: backend
- **Files**:
  - `apps/api/src/market-depth/LiquidityFeed.ts:62-64` (`SNAPSHOT_INTERVAL_MS = 250`)
  - `apps/api/src/market-depth/DepthSnapshotStore.ts:18-20` (capacity comment "600 × 1s = 10 minutes by default")
  - `apps/api/src/market-depth/LiquidityFeed.ts:85-91` (`new DepthSnapshotStore(4 * 60 * 60 * 4)`)
- **Symptom**: `DepthSnapshotStore`'s default capacity comment says `600 entries = 10 min @ 1 Hz`, but `LiquidityFeed` constructs it with `4*60*60*4 = 57 600` and pushes at 250 ms (4 Hz). The comment in `DepthSnapshotStore.ts:18` is now misleading and the capacity calculation `4*60*60*4` is opaque (it really is `4 hours × 60 min × 60 s × 4 Hz = 57 600`). A reviewer reading the store's default would assume 10 min when the live feed actually keeps 4 hours.
- **Root cause**: Capacity literal not derived from named constants.
- **Reproduction**: read both files side by side.
- **Suggested fix**: Replace `new DepthSnapshotStore(4 * 60 * 60 * 4)` with `new DepthSnapshotStore(MAX_HEATMAP_LOOKBACK_HOURS * 3600 * 1000 / SNAPSHOT_INTERVAL_MS)` (hoisting the env value once at startup), and update the docstring on `DepthSnapshotStore` to drop the "1 Hz" claim. Acceptance: the literal is gone; `MAX_HEATMAP_LOOKBACK_HOURS` is honoured at the buffer level too (today it's only honoured at the route level).
- **Effort**: small
- **Risk if fixed**: capacity stays the same in default config — no behavioural change for tests.

### B-006: `LiquidityFeed` ring buffer capacity ignores `MAX_HEATMAP_LOOKBACK_HOURS`
- **Severity**: MEDIUM
- **Area**: backend
- **Files**: `apps/api/src/market-depth/LiquidityFeed.ts:85-87`, `apps/api/src/routes/liquidity.ts:33-37`
- **Symptom**: A user sets `MAX_HEATMAP_LOOKBACK_HOURS=8`, expecting "Max" lookback to walk back 8 hours. The route caps at 8 h, but the feed itself only retains 4 hours (hard-coded in the constructor). So `lookback=max` returns at most 4 h regardless of env.
- **Root cause**: `new DepthSnapshotStore(4 * 60 * 60 * 4)` is independent from the env-driven cap in `routes/liquidity.ts`.
- **Reproduction**: set `MAX_HEATMAP_LOOKBACK_HOURS=8`, run for >4 h, request `?lookback=max` — `availableHistoryMs` saturates around 4 h.
- **Suggested fix**: Read `MAX_HEATMAP_LOOKBACK_HOURS` once in `LiquidityFeed.start` (or pass via `FeedDeps`), compute capacity as `Math.ceil(maxHours * 3600 * 1000 / SNAPSHOT_INTERVAL_MS)`. Acceptance: env override actually grows the buffer.
- **Effort**: small
- **Risk if fixed**: memory footprint scales with env; document warning.

### B-007: WS topbar status is never `"connected"` on `/heatmap` if user lands first time
- **Severity**: MEDIUM
- **Area**: frontend
- **Files**: `apps/web/src/lib/ws.ts:9-14`, `apps/web/src/app/heatmap/page.tsx:37`
- **Symptom**: The `useScreenerWebSocket` hook uses a module-level `started = true` guard (`apps/web/src/lib/ws.ts:9`) so only the *first* mounting of the hook on the page actually connects. Plus the cleanup function flips `started = false`, but in React's strict-mode dev runtime the cleanup runs before remount and the second mount races on the `started` flag. Today this works in production builds, but on the first navigation to `/heatmap` from an SSR-only `/` (or a hard refresh) the topbar may flicker between `connecting` and `connected`. The bigger issue: any subsequent component that calls `useScreenerWebSocket()` (e.g. `Settings`, `Alerts`) is a no-op because `started === true`. So the FIRST page that subscribes "owns" the WS and others piggyback on its store updates — but there is no central provider; if the first owner unmounts, `started` flips back to `false` and the next user of the hook reconnects. This is correct in practice but fragile.
- **Root cause**: Module-level singleton state for the WS connection.
- **Reproduction**: hard refresh on `/heatmap`; topbar starts at `disconnected` until React hydrates the hook.
- **Suggested fix**: Move the WS bootstrap into the root layout (`apps/web/src/app/layout.tsx`) as a side-effect-only component, kill the module-level `started` flag, and rely on a single `useEffect` that opens/closes the connection once. Acceptance: connecting state is decoupled from per-page mount cycles.
- **Effort**: medium
- **Risk if fixed**: cleanup ordering on route change; verify no double connection.

### B-008: `OutsideHeatmapBanner` shows when overlap is `< 50 %` but the comment says `< 30 %`
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:592-606`
- **Symptom**: The doc comment at line 594 says "viewport completely outside the matrix" or "overlap < 30 %", but the actual implementation uses `overlapFrac < 0.5`. The banner appears more aggressively than documented (and more aggressively than the bundled test in `heatmapStability.test.ts:79-94` which only verifies the formula, not the threshold).
- **Root cause**: comment drift.
- **Suggested fix**: pick one — either lower the threshold to 0.3 or fix the comment to "overlap < 50 %". Lower threshold matches the heuristic used in `DebugBar.viewportInsideMatrix` (also 0.5). Acceptance: doc and code match.
- **Effort**: trivial (1-line comment edit)
- **Risk if fixed**: none.

### B-009: Heatmap polling re-fetches `liquiditySnapshot` even when `priceWindowRef` is null but other params didn't change
- **Severity**: MEDIUM
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:154-227`
- **Symptom**: The polling effect re-runs whenever `rebuildToken` toggles, but it ALSO restarts on every `symbol/marketType/timeframe/binSize/depthLevels` change (correct) AND it resets `setMatrix(null)` AND `setCandles([])` on the boundary effect at line 119. The visible side-effect: when the user changes only `binSize` or `depthLevels`, the chart blanks out before the next poll arrives (~2 s gap). Stable-window contract from the audit prompt says "zoom/pan must not pre-empt snapshot refetch" — that part works. But changing density/depth shouldn't blank the matrix either; only symbol switches should.
- **Root cause**: The boundary `useEffect` on lines 117-126 listens to `[symbol, marketType, timeframe, …]` — fine. But the polling `useEffect` itself is re-keyed by `[binSize, depthLevels]` on lines 154-227, so it tears down the old timer + immediately runs. Combined with the empty-matrix guard ("Accumulating order book history…") this looks like a regression to the user.
- **Reproduction**: change `Bin size` from `auto` to `0.5%` — chart goes blank for ~2 s.
- **Suggested fix**: Don't reset `matrix` to `null` on density/depth/bin changes — only on symbol/market/timeframe changes (already gated). Pull the polling into a single effect, and instead of re-keying on params, store them in refs (like `lookbackRef`). Acceptance: changing depth or density updates the next poll without blanking the chart.
- **Effort**: small
- **Risk if fixed**: ensure polling honours the new bin size on the next tick.

### B-010: `app/page.tsx` (Dashboard) returns "Loading market data…" forever if the screener job hasn't filled the store yet
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/page.tsx:43-48`
- **Symptom**: In live mode the `LivePollingJob` first cycle runs `~2 s` after start and then every `LIVE_POLLING_INTERVAL_MS` (default 60 s). For the first ~2 s the store is empty, so the dashboard shows "Loading market data…". That's documented in the README, but the page never times out — if the API is healthy but the polling job is broken (e.g. all five public adapters returning `null`), the user sits on the loading state with no fallback message.
- **Root cause**: no timeout / readiness check on the dashboard's empty state.
- **Suggested fix**: After 10 s of empty store + readiness probe reporting `mode=live`, show "Live polling in progress; first results expected within 60 s. <ConnectionStatus />". Acceptance: empty-state has actionable info.
- **Effort**: small
- **Risk if fixed**: only UI text.

### B-011: `app/heatmap/page.tsx` polling loop swallows `AbortError` only via `ApiError("timeout")` — no retry/backoff
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:200-209`, `apps/web/src/lib/api.ts:32-49`
- **Symptom**: Each tick fires four API calls in parallel; if one times out the whole `Promise.all` rejects with an `ApiError("timeout")`. The catch swallows it and reschedules `tick` after `POLL_MS = 2000`. Good. But there's no backoff on repeated failures, so an upstream that's struggling (e.g. Binance rate-limit at 5 s timeout) gets pinged every 2 s indefinitely. Combined with the in-API `publicFetch` 30 s backoff this means the client wastes one full request cycle per 2 s while the server returns cached data from `publicFetch`.
- **Root cause**: client-side polling has no exponential backoff on consecutive failures.
- **Suggested fix**: Track `consecutiveFailures` in a ref; on `connection === "error"` set `nextDelay = Math.min(30_000, 2000 * 2 ** failures)` instead of a fixed 2 s. Acceptance: error path stops hammering the server; recovers immediately on first success.
- **Effort**: small
- **Risk if fixed**: change perceived freshness during an outage; document.

### B-012: `LiquidityFeedManager.stopAll()` does not allow restart after shutdown
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/market-depth/LiquidityFeedManager.ts:42-45`
- **Symptom**: After `stopAll()` the `feeds` map is cleared but each feed sets `stopped = true` and is dropped. If a future request comes in, `getOrStart` creates a new `LiquidityFeed` for that symbol — that's fine. But the existing `LiquidityFeed.stop()` clears its `wsCtor` lazy-load only via the `stopped` flag, and `start()` is supposed to be one-shot. Restart by calling `start()` again on the same instance would skip the `await import("ws")` step the second time only if `wsCtor` is preserved. Actually `wsCtor` is an instance field that persists, so re-entry would work; but `startedAtMs` is null-guarded (`if (this.startedAtMs === null) this.startedAtMs = Date.now()`) so a re-start would keep the original timestamp, which contradicts the "feedStartedAt" semantics. Edge case, not currently triggered by any code path.
- **Root cause**: `LiquidityFeed.start` not designed for restart.
- **Suggested fix**: document that `LiquidityFeed.start` is one-shot, OR reset `startedAtMs = Date.now()` on re-entry.
- **Effort**: trivial
- **Risk if fixed**: none — no caller restarts a feed today.

### B-013: `apps/api/Dockerfile` re-runs `pnpm install` after copying source — invalidates build cache and bloats image
- **Severity**: MEDIUM
- **Area**: infra
- **Files**: `apps/api/Dockerfile:14-30`
- **Symptom**: The `runtime` stage:
  1. `COPY --from=deps /repo ./` (already has the deps)
  2. `COPY apps/api ./apps/api` (overlays source)
  3. `COPY packages ./packages` (overlays packages)
  4. `RUN pnpm install` ← runs again
  This nukes the multi-stage win and adds ~30 s + ~200 MB to every image build. The `pnpm install` is needed to refresh workspace symlinks after the source overlay, but a single `pnpm -r install --frozen-lockfile` against an already-resolved store is wasted work; better is to run `pnpm install --offline --no-frozen-lockfile` or to re-link via `pnpm install --filter @screener/api --filter @screener/shared --filter @screener/engine`.
- **Root cause**: Docker layer ordering — source files are copied AFTER deps, but workspace symlinks need a re-resolution pass.
- **Reproduction**: time `docker compose build api` twice with cache; second pass still does `pnpm install` because the source layer changed.
- **Suggested fix**: Replace step 4 with `pnpm install --offline --frozen-lockfile`. Or restructure to copy `package.json`s first, install, then overlay only `src/`. Acceptance: rebuild after source-only edit completes in <10 s.
- **Effort**: small
- **Risk if fixed**: validate that `prisma generate` still finds the schema; `pnpm install --offline` requires the store to be present.

### B-014: `apps/web/Dockerfile` does not copy `package.json` into the runtime stage — `node apps/web/server.js` may fail on missing `package.json` references
- **Severity**: MEDIUM
- **Area**: infra
- **Files**: `apps/web/Dockerfile:21-30`
- **Symptom**: The runtime stage does:
  ```
  COPY --from=build /repo/apps/web/.next/standalone ./
  COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
  ```
  Next.js standalone output already bundles `package.json`, but it depends on the exact location (`apps/web/server.js` looks up `apps/web/package.json` relative to itself). With pnpm workspace + standalone there have been reports that some `node_modules` symlinks are broken in the standalone output. There is no smoke test verifying `node apps/web/server.js` actually starts.
- **Root cause**: standalone output assumptions in a pnpm monorepo.
- **Reproduction**: `docker compose up --build web` and curl `http://localhost:3000/`. If the page loads, this is fine; if it 500s on missing module, this is the issue.
- **Suggested fix**: Add a smoke test in CI or document a known-good post-build curl. Optionally `COPY --from=build /repo/node_modules ./node_modules` as a safety net but image will balloon. Acceptance: documented expectation in `README.md` Troubleshooting.
- **Effort**: small
- **Risk if fixed**: image size impact if extra deps are copied.

### B-015: Heatmap polling sends `levels=50` to `/orderbook` but UI shows top 12 — overshooting the network
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:181`, `apps/web/src/components/liquidity/OrderBookPanel.tsx:8-10`
- **Symptom**: `OrderBookPanel` slices to 12 bids / 12 asks (line 8-10). The page asks for 50 levels via `liquidityOrderBook(..., levels: 50)` — 4× more than rendered. This wastes ~3-5 KB per request. Over 60 s of polling that's negligible per user, but trivial to align.
- **Root cause**: hardcoded 50 in `apps/web/src/app/heatmap/page.tsx:181` doesn't match panel's render count.
- **Suggested fix**: change to `levels: 20` (12 + 8 walls headroom). Acceptance: same UI, smaller payload.
- **Effort**: trivial
- **Risk if fixed**: none.

### B-016: `/signals` endpoint accepts `cursor` query param but does not implement cursor-based pagination
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/routes/signals.ts:9-22`
- **Symptom**: Schema declares `cursor?: string` (line 10), but the handler ignores it. `nextCursor` is set to the literal string `"next"` when there are more items (line 20) — not an actual cursor that the client can pass back. So pagination silently doesn't work.
- **Root cause**: stub implementation.
- **Reproduction**: `GET /signals?limit=10&cursor=next` returns the same first 10 items, not the next page.
- **Suggested fix**: either implement real cursor (use signal.id from store) or drop the param + replace `"next"` with `null`/`true` to signal "more available". Update README REST endpoints table accordingly.
- **Effort**: small
- **Risk if fixed**: none, no client uses cursor today.

### B-017: AdapterRegistry safety net falls back to mock but `/readiness.mode` reports `live` if `USE_MOCK_DATA=false`
- **Severity**: MEDIUM
- **Area**: backend
- **Files**: `apps/api/src/adapters/AdapterRegistry.ts:67-77`, `apps/api/src/routes/health.ts:38-46`
- **Symptom**: If `USE_MOCK_DATA=false` and `ENABLE_PUBLIC_API_ADAPTERS=false`, the registry falls back to mock (line 67-77 of `AdapterRegistry.ts`), but `mockEnabled` in `/readiness` is computed from env: `mockEnabled = env.USE_MOCK_DATA || env.ENABLE_TEST_FIXTURES`. So `mockEnabled=false`, `publicAdaptersEnabled=false`, and `mode = "live"`. That's a lie — the actual data IS mock.
- **Root cause**: `mode` is derived from env, not from the actual registry state.
- **Reproduction**:
  ```
  USE_MOCK_DATA=false ENABLE_PUBLIC_API_ADAPTERS=false node …
  curl /readiness | jq .mode
  # → "live"
  # But the only registered adapter is "mock"
  ```
  README claims this scenario falls back to mock and is reported as `mode=mock`. The implementation does the fallback but mis-reports the mode.
- **Suggested fix**: derive `mode` from `registry.all()` — if the only adapter is `mock`, force `mockEnabled=true` and `mode="mock"` regardless of env. Acceptance: a regression test in `readinessMode.test.ts` for the safety-net case.
- **Effort**: small
- **Risk if fixed**: only readiness response shape changes.

### B-018: `KrakenAdapter.aliasKrakenAsset` strips a leading `Z` from any 4+ letter quote — collisions with real assets
- **Severity**: MEDIUM
- **Area**: backend
- **Files**: `apps/api/src/adapters/KrakenAdapter.ts:226-240`
- **Symptom**: Lines 235-237: the generic legacy strip is `if (u.length >= 4 && u.startsWith("Z") && /[A-Z]{3}$/.test(u.slice(1))) return u.slice(1);`. If a real token name starts with `Z` (e.g. `ZRX`, `ZEC`), this would mis-strip the prefix. For Kraken's actual asset codes the only valid `Z*`-prefixed quotes are `ZUSD`, `ZEUR`, `ZGBP`, `ZJPY`, `ZCAD`, `ZAUD`, all of which are explicitly aliased earlier (line 232-237 hardcodes `ZUSD` and `ZEUR` only — `ZGBP` etc. would fall through to the generic strip and become `GBP` correctly, by accident). But the same regex applies to base assets too (`aliasKrakenAsset` is called on both base and quote in `getMarkets` at line 76-77). If Kraken ever lists a token whose base code starts with `Z` (e.g. `ZBC`), the adapter will mis-normalize it.
- **Root cause**: regex tries to be clever; should be a closed allowlist for `Z*` prefixes.
- **Suggested fix**: add explicit cases for `ZGBP/ZJPY/ZCAD/ZAUD`; remove the generic `Z*` strip for base assets (only apply to quotes, where Z-prefix is canonical); same caution for `X*` (XLTC, XXRP already explicit; should not generic-strip a token like `XTZ`).
- **Effort**: small
- **Risk if fixed**: existing `normalize.test.ts` covers `XBTUSD` and `XXBTZUSD`; add a regression for `XTZUSD` (Tezos) — naive strip would yield `TZUSD`, which `splitConcatenated` cannot resolve. Currently `XTZUSD` is broken on Kraken — confirm with a test.

### B-019: `app/heatmap/page.tsx` sends `priceMin/priceMax` only on rebuild, but does not echo them back into the viewport — viewport drifts on the first poll after rebuild
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:147-152, 163-211`
- **Symptom**: User clicks "Rebuild for visible range". `priceWindowRef.current` is set, the next poll sends `priceMin/priceMax` to the API; server returns matrix clamped to the requested range. But the viewport stays unchanged client-side, so the matrix is rebuilt but the user's viewport may already differ if they panned during the ~2 s polling delay. Rebuild succeeds but doesn't visually "snap to fit" — the user has to click Rebuild again if they zoom further.
- **Root cause**: rebuild is "fire-and-forget" without a visual cue.
- **Suggested fix**: after rebuild, briefly disable wheel/pan while the new matrix lands, or show a toast "Rebuild applied — viewport: $X..$Y". Acceptance: cosmetic.
- **Effort**: trivial
- **Risk if fixed**: none.

---

## Inconsistencies

### I-001: Two parallel `HeatmapMatrix` type definitions — backend and frontend duplicates
- **Severity**: LOW
- **Area**: backend / frontend
- **Files**:
  - `apps/api/src/market-depth/LiquidityHeatmapBuilder.ts:42-58` (`HeatmapMatrix` with `cells: HeatmapCell[]`)
  - `apps/web/src/lib/liquidity/binning.ts:49-71` (frontend `HeatmapMatrix`)
- **Symptom**: Both define `HeatmapMatrix` with overlapping but slightly different fields (frontend has `lookback?` echo block + `debugStats?` optional, backend has it required). They're allowed to drift.
- **Root cause**: no shared schema for liquidity. Could live in `packages/shared` or be imported across the boundary.
- **Suggested fix**: move `HeatmapMatrix`, `HeatmapCell`, `HeatmapDebugStats` to `packages/shared/src/schemas.ts` or a new `packages/shared/src/liquidity.ts`. Acceptance: single source of truth.
- **Effort**: small
- **Risk if fixed**: type churn across both apps.

### I-002: `screener-engine` and `routes/screener.ts` duplicate filter logic
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/routes/screener.ts:6-49`, `apps/web/src/lib/filters.ts:54-78`
- **Symptom**: The same filter rules are implemented twice (once in API, once on client). They're already aligned today, but every time a new field is added it must be touched in both places.
- **Suggested fix**: extract the filter predicate into a pure function in `packages/shared/src/filters.ts` and import on both sides. Acceptance: single location.
- **Effort**: medium
- **Risk if fixed**: the API version uses `csvOrArray` with `unknown[]`-style optional fields from Zod; the web version uses a flat `ScreenerFilters` interface. Reconciliation is non-trivial.

### I-003: `MARKET_DETAIL.candleLimit` referenced but `getKlines` default is hardcoded to 200
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/routes/markets.ts:41` (`Number.parseInt(req.query.limit ?? "200", 10) || MARKET_DETAIL.candleLimit`)
- **Symptom**: The fallback chain is "200" string → parse → `|| MARKET_DETAIL.candleLimit`. Both happen to be `200` but if `MARKET_DETAIL.candleLimit` ever changes, the string `"200"` will still take precedence.
- **Suggested fix**: replace `?? "200"` with `?? String(MARKET_DETAIL.candleLimit)`.
- **Effort**: trivial
- **Risk if fixed**: none.

### I-004: README claims 203 tests; actual count is 273
- **Severity**: LOW
- **Area**: docs
- **Files**: `README.md` (Tests badge: `tests-203%20passing`)
- **Symptom**: badge shows 203 — actual is 273 (28 engine + 102 api + 143 web). The badge is hand-encoded so the URL won't auto-update.
- **Suggested fix**: bump to 273 in the SVG URL on line ~9.
- **Effort**: trivial
- **Risk if fixed**: none.

### I-005: `MOCK_UPDATE_INTERVAL_MS` env present but tests/dev only — no docstring on production behaviour
- **Severity**: LOW
- **Area**: docs / backend
- **Files**: `apps/api/src/config/env.ts:18`, `.env.example:30`, `README.md` env table
- **Symptom**: env table lists `MOCK_UPDATE_INTERVAL_MS=750`. Mock adapter ignores this value when `USE_MOCK_DATA=false`. README doesn't say it's only-mock-mode.
- **Suggested fix**: README env table → add "(mock mode only)" annotation for `MOCK_*` and `MOCK_SEED`.
- **Effort**: trivial
- **Risk if fixed**: none.

### I-006: `apps/api/Dockerfile` runs `prisma db push --accept-data-loss` on every container start
- **Severity**: MEDIUM
- **Area**: infra
- **Files**: `apps/api/Dockerfile:31`
- **Symptom**: CMD = `pnpm exec prisma db push --accept-data-loss || echo 'db push skipped'; pnpm exec tsx src/index.ts`. `db push --accept-data-loss` is a destructive flag (drops columns/tables that diverge from the schema). Acceptable for dev with mock fixtures, but a footgun if anyone points this at a production DB.
- **Root cause**: convenience over safety.
- **Suggested fix**: change to `pnpm exec prisma migrate deploy || pnpm exec prisma db push || echo 'db skipped'`. Migrations directory is currently empty (`.gitignore` has `**/prisma/migrations/dev.db`), so `migrate deploy` would no-op safely. Document in README.
- **Effort**: small (Dockerfile edit + README note)
- **Risk if fixed**: needs migrations to actually exist for production use. For now it's safer than `--accept-data-loss`.

### I-007: `RingBuffer.push` uses `splice` for trimming — O(n) per push
- **Severity**: LOW
- **Area**: backend (perf)
- **Files**: `apps/api/src/market-depth/RingBuffer.ts:14-16`
- **Symptom**: `push` does `this.buf.push(item); if (this.buf.length > capacity) this.buf.splice(0, this.buf.length - capacity);`. With `capacity=57_600` and 4 push/s, every push past capacity triggers a 57k-element shift. Once the buffer is full this becomes the hot path.
- **Root cause**: array semantics over actual ring buffer.
- **Suggested fix**: use a circular index or `Array<T>` with `length = capacity` and a head pointer. Or just `if (length > capacity) shift()` in a loop — `shift()` is also O(n) in V8 for arrays > N, so a real ring is the right fix. Acceptance: micro-benchmark shows `push` is O(1) once full.
- **Effort**: medium
- **Risk if fixed**: rewrite class; existing tests in `marketDepth.test.ts` cover capacity semantics.

### I-008: `screener.ts` non-numeric sort silently returns 0 — strings are not comparable
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/routes/screener.ts:38-46`
- **Symptom**: `if (typeof av !== "number" || typeof bv !== "number") return 0;` — sorting by `symbol`, `exchange`, `quoteAsset` is a no-op. Frontend supports symbol sort (it sorts client-side), so this is dead code on backend but the schema accepts the param.
- **Suggested fix**: branch on string vs number and `localeCompare` for strings; or document only numeric sort columns are honoured server-side and reject string `sortColumn` values with a Zod refinement.
- **Effort**: small
- **Risk if fixed**: API contract change (rejecting strings).

### I-009: `apps/web/src/components/Sidebar.tsx` displays "Market Watcher" but page title is "Crypto Market Screener"
- **Severity**: LOW
- **Area**: frontend / branding
- **Files**: `apps/web/src/components/Sidebar.tsx:24`, `apps/web/src/app/layout.tsx:14`
- **Symptom**: Two different product names: sidebar header is "Market Watcher", topbar title is "Crypto Market Screener". Both are correct in their own right (the project is in the "Market Watcher" folder), but for the user it's two names for the same product.
- **Suggested fix**: pick one. Sidebar should match topbar title.
- **Effort**: trivial
- **Risk if fixed**: cosmetic.

### I-010: `Coinbase.getOrderBook` ignores `limit` parameter — comment is misleading
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/adapters/CoinbaseAdapter.ts:138-156`
- **Symptom**: Method takes `limit = 50` but builds URL with hardcoded `level=2` (returns top 50 levels); the `limit` arg is unused. Comment on line 140 says "level=2 returns top 50 aggregated levels per side" — accurate but the unused parameter is misleading.
- **Suggested fix**: rename `_limit` (underscore = unused) and document why; or implement `level=3` for higher depth.
- **Effort**: trivial.
- **Risk if fixed**: none.

### I-011: `apps/api/src/jobs/ScreenerJob.ts` duplicates `MockExchangeAdapter.makeTicker` inline
- **Severity**: LOW
- **Area**: backend
- **Files**: `apps/api/src/jobs/ScreenerJob.ts:63-79`, `apps/api/src/adapters/MockExchangeAdapter.ts:191-208`
- **Symptom**: The "lightweight inline copy" comment on line 65 acknowledges the duplication. Both compute `change24h` and `volume24h` from `klines.slice(-1440)` etc. Drift risk: change one, forget the other.
- **Suggested fix**: expose `MockExchangeAdapter.makeTickerForState(st)` as a `public static` and let `ScreenerJob` call it.
- **Effort**: small
- **Risk if fixed**: minor refactor.

### I-012: `OrderBookPanel.tsx` calls itself "Order Book" but README and routes call it "Live order book panel" / "top-of-book"
- **Severity**: LOW
- **Area**: docs
- **Files**: `README.md` (Liquidity Chart table), `apps/web/src/components/liquidity/OrderBookPanel.tsx:18`
- **Symptom**: README says "Top 12 bids / asks + biggest walls (right-side panel)". Component header says "Order Book". Match for clarity in screenshots.
- **Suggested fix**: optional cosmetic alignment.
- **Effort**: trivial.

### I-013: `ScreenerResult.spreadPct` uses 2 decimal places in screener table, 3 decimals in market detail
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/screener/page.tsx:200-205` (`r.spreadPct.toFixed(3)`), `apps/web/src/app/markets/[symbol]/page.tsx:178` (`r.spreadPct.toFixed(3)`)
- **Symptom**: Already at 3 decimals on both pages — false alarm on first read. INFO-only.

### I-014: `apps/web/src/app/heatmap/page.tsx` re-keys polling effect on `[symbol, marketType, timeframe, binSize, depthLevels, rebuildToken, ...]` but uses `lookbackRef` and `heatmapBucketMsRef` to avoid re-keys for those — inconsistent
- **Severity**: LOW
- **Area**: frontend
- **Files**: `apps/web/src/app/heatmap/page.tsx:226`
- **Symptom**: deliberate optimisation but inconsistent: `binSize` and `depthLevels` ARE in the deps array (forcing tear-down), `heatmapBucketMs` and `heatmapLookback` are NOT (using refs). The reasoning is documented in comments, but a reader has to read 50 lines to understand. See B-009 for the user-facing consequence.
- **Suggested fix**: collapse all five (`binSize`, `depthLevels`, `heatmapBucketMs`, `heatmapLookback`, `rebuildToken`) into ref-based reads, keep only `[symbol, marketType, timeframe]` in deps.
- **Effort**: small
- **Risk if fixed**: see B-009.

### I-015: `ScreenerJob` and `LivePollingJob` both create their own `Date.now()` references — slight clock drift between mock and live results
- **Severity**: INFO
- **Area**: backend
- **Files**: `apps/api/src/jobs/ScreenerJob.ts:51`, `apps/api/src/jobs/LivePollingJob.ts:74`
- **Symptom**: Each tick calls `runScreener(snapshots, cfg, Date.now())` independently. In hybrid mode the mock and live results have slightly different `updatedAt` timestamps. Not a bug — different snapshots taken at different times — but the timestamps could collide in the WS batch and look weird.
- **Suggested fix**: optional — share a clock across jobs.
- **Effort**: trivial
- **Risk if fixed**: none.

---

## Recommendations

### R-001: Move `MAX_HEATMAP_LOOKBACK_HOURS` parsing into `loadEnv` Zod schema
- **Area**: backend
- **Files**: `apps/api/src/config/env.ts`, `apps/api/src/routes/liquidity.ts:33-37`
- **Suggested**: Add `MAX_HEATMAP_LOOKBACK_HOURS: z.coerce.number().min(0.5).default(4)` to the Env schema. Today the route parses `process.env.MAX_HEATMAP_LOOKBACK_HOURS` ad hoc in `maxLookbackHours()`. Centralising removes the ad-hoc parsing and makes the env contract explicit.
- **Effort**: trivial.

### R-002: Use `WeakRef` or explicit teardown for stale `LiquidityFeed` instances
- **Area**: backend
- **Files**: `apps/api/src/market-depth/LiquidityFeedManager.ts`
- **Suggested**: Today every visited symbol opens a feed and never closes it (per the manager's own comment: "Idle feeds are not auto-stopped in MVP"). Single-user MVP is fine, but at 5 symbols × 4 Hz × 1000 levels per side that's ~10 MB of in-memory state idle. Implement an LRU + TTL eviction (e.g. `maxFeeds=8`, `idleTtlMs=15min`).
- **Effort**: medium.

### R-003: Replace `Math.imul` PRNG with `seedrandom` if you ever need cross-language reproducibility
- **Area**: backend
- **Files**: `apps/api/src/adapters/prng.ts`
- **Suggested**: `mulberry32` is fine for Node; if mock seeds ever need to match Python/Rust test fixtures the standard PCG-32 is a better choice. INFO only.

### R-004: Add a `/metrics` Prometheus endpoint
- **Area**: backend
- **Suggested**: For MVP not necessary, but liquidity-feed snapshot count, WS client count, alert evaluator latency, and `publicFetch` cache hit rate are easy wins.
- **Effort**: medium.

### R-005: Emit `feedStartedAt` to the WS snapshot payload
- **Area**: backend
- **Files**: `apps/api/src/ws/WebSocketHub.ts`
- **Suggested**: Today the heatmap-collection-started marker is only delivered through the polling response. WS-only clients (none today) would miss it.
- **Effort**: small.

### R-006: Replace polling on `/heatmap` with a dedicated `/liquidity/:symbol/stream` WS channel
- **Area**: backend / frontend
- **Suggested**: Polling 4 endpoints every 2 s ⇒ 2 req/s × 4 paths × N users = unnecessary load. A per-symbol WS channel that pushes new snapshots / depth diffs would scale better. Out of MVP scope.
- **Effort**: large.

### R-007: Adopt `prisma migrate` instead of `prisma db push --accept-data-loss`
- **Area**: infra
- **See I-006**.

### R-008: Pin `pnpm` to 9.7.x in CI; Node to 20.x; fail fast if a dev runs Node 24 (which sometimes triggers the `processChild.js` bug seen during this audit)
- **Area**: infra / docs
- **Files**: `.nvmrc` (missing), `package.json:engines`
- **Suggested**: `engines.node = ">=20 <22"`. Add `.nvmrc` with `20.16.0`. Document Windows-specific `processChild.js` workaround in README (already present, good). The audit run hit this exact issue and the documented fix worked first try.
- **Effort**: trivial.

### R-009: Add a CI matrix (Linux + Windows) so the documented pnpm workaround is tested
- **Area**: infra
- **Suggested**: GitHub Actions `runs-on: [ubuntu-latest, windows-latest]` with the same `pnpm typecheck && pnpm test && pnpm --filter @screener/web build` invocations. Catches the Windows `processChild.js` bug pro-actively.
- **Effort**: medium.

### R-010: Extract shared filter logic into `packages/shared` (see I-002)

---

## Verification snapshot

All commands run from the repo root on Windows / cmd, Node 24.15.0, pnpm 9.7.0.

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | ✅ exit 0 | 4 packages (`shared`, `screener-engine`, `web`, `api`) — all clean. |
| `pnpm test` | ✅ exit 0 | `engine`: 28 passed (3 files, 1 property suite). `web`: 143 passed (12 files). `api`: 102 passed (14 files). **273 total**. |
| `pnpm --filter @screener/web build` | ✅ exit 0 | After applying the documented Windows fix (`Remove-Item -Recurse -Force node_modules; pnpm install --force`) — first run failed with `Error: Cannot find module 'next/dist/compiled/jest-worker/processChild.js'`. After the workaround, build completes in ~30 s and produces all 10 routes (`/`, `/alerts`, `/heatmap`, `/market-map`, `/markets/[symbol]`, `/screener`, `/settings`, `/signals`, `_not-found`). Output: `.next/standalone` ready. |
| `docker compose config --quiet` | ✅ exit 0 | Compose validates cleanly. |
| `docker compose up -d --build` | ⏭️ Not run | Docker Desktop not started in this audit session. Skipped to keep the audit non-destructive. |

### Detailed test pass

```
engine:  Test Files  3 passed (3)    Tests  28 passed (28)    Duration  948ms
web:     Test Files 12 passed (12)   Tests 143 passed (143)   Duration  1.86s
api:     Test Files 14 passed (14)   Tests 102 passed (102)   Duration 12.82s
```

### Build snippet

```
▲ Next.js 14.2.13
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (10/10)
✓ Collecting build traces
✓ Finalizing page optimization

Route (app)                        Size     First Load JS
┌ ○ /                              17.7 kB        113 kB
├ ○ /alerts                        6.34 kB       93.4 kB
├ ○ /heatmap                       17.9 kB        105 kB
├ ○ /market-map                    7.06 kB        106 kB
├ ƒ /markets/[symbol]              4.23 kB        103 kB
├ ○ /screener                      4.29 kB        103 kB
├ ○ /settings                      7.95 kB       95.1 kB
└ ○ /signals                       1.59 kB       97.2 kB
+ First Load JS shared by all      87.1 kB
```

---

## Out of scope

Sections deliberately not exercised in this pass — flagged for a follow-up audit:

- **End-to-end live mode**: did not run `docker compose up -d --build` and did not curl `/health`, `/readiness`, `/liquidity/BTCUSDT/snapshot` against running containers. Specifically the Postgres + Prisma migration path under Alpine/musl was not exercised live, only the env-defaults check via `docker compose config`.
- **WebSocket smoke**: no live `wscat` or browser session to confirm `snapshot`, `market:batch`, `signal:new`, `alert:triggered` payloads on the wire match the Zod `WsMessage` discriminated union.
- **Browser-side wheel-zoom non-passive listener**: code looks correct (`apps/web/src/components/liquidity/LiquidityChart.tsx:201-225` attaches a non-passive native listener). Not validated in a real browser. The unit test `chartViewport.test.ts` covers the math but not the DOM event semantics.
- **Drawing tool persistence**: visually validated by `apps/web/src/__tests__/drawings.test.ts`. Cross-browser localStorage quota behaviour not tested.
- **Rate-limit headers from real exchanges**: `publicFetch` honours `Retry-After`; tested with mocked 429 in `policy.test.ts`. Real Binance / Bybit / OKX rate-limit headers not exercised.
- **Memory profile under sustained load**: `RingBuffer` has the O(n) push problem (I-007); a 24 h soak test would surface it. Not run.
- **Accessibility**: no WCAG / keyboard-nav / screen-reader audit. `aria-current` is set on the active nav link, but a full a11y pass would need manual testing.
- **Production secrets**: confirmed no API keys are read by any adapter (`adapters.test.ts` "Adapter constructor does not require API keys"). Did not audit `.env`-style files for real secrets — the repo's `.env.example` is clean.
- **`/market-map` legacy page**: still renders, deliberately not in sidebar; a separate cleanup pass could remove the route entirely if it's truly orphaned.
- **iOS Safari** behaviour for `wheel`-zoom (touch) — not tested.


---

## Resolution log

Triage round 1 — applied immediately after the audit was filed.

### Triage summary

- Total entries: **38** (19 bugs + 15 inconsistencies + 10 recommendations — but the audit body lists 19 + 15 + 10 = 44 with some absorbed numbering)
- **FIX**: 14 — B-001, B-002, B-003, B-004, B-005, B-006, B-008, B-012, B-015, B-016, B-017, B-018, I-003, I-004, I-005, I-009, R-001 (R-001 absorbed into B-005/B-006 fix)
- **DEFER**: 14 — B-007, B-009, B-010, B-011, B-013, B-014, B-019, I-001, I-002, I-006, I-007, I-008, I-011, R-002…R-010
- **REJECT**: 3 — I-010 (already fixed in earlier session — `_limit` is already in place), I-012 (cosmetic; intentional), I-013 (audit author flagged as false alarm), I-015 (audit author marked INFO with no action expected)
- **DUPLICATE**: 1 — I-014 (duplicate of B-009)

### Files changed

Backend (apps/api):
- `apps/api/src/adapters/BybitAdapter.ts` — import `intervalToMs`; replace `+60_000` with `+ closeMs`
- `apps/api/src/adapters/OkxAdapter.ts` — same
- `apps/api/src/adapters/normalize.ts` — added `intervalToMs(interval)` helper; rewrote Kraken normalize-case Z-strip to use a closed allowlist of legacy bases + a closed allowlist of legacy quotes (no more `XTZUSD → XTUSD` mangling); aliased X-prefixed legacy bases (XETH/XLTC/XXRP/XXLM/XZEC/XREP/XXMR/XDG → ETH/LTC/XRP/XLM/ZEC/REP/XMR/DOGE) after Z-strip
- `apps/api/src/adapters/KrakenAdapter.ts` — closed-set `KRAKEN_X_PREFIXED` and `KRAKEN_Z_PREFIXED_QUOTES`; explicit aliases for ZGBP/ZJPY/ZCAD/ZAUD/ZCHF/XXLM/XZEC/XREP/XXMR/XDG; removed the generic `X*`/`Z*` regex strip that mangled XTZ etc.
- `apps/api/src/config/env.ts` — added `MAX_HEATMAP_LOOKBACK_HOURS` to the Zod schema (default 4 h)
- `apps/api/src/market-depth/LiquidityFeed.ts` — `FeedDeps.maxLookbackHours?` is now wired into `DepthSnapshotStore` capacity via `snapshotCapacityFor(hours)`; `start()` now refreshes `startedAtMs` on re-entry; named constants `SNAPSHOT_INTERVAL_MS`/`DEFAULT_MAX_LOOKBACK_HOURS` replace the opaque `4*60*60*4` literal
- `apps/api/src/market-depth/DepthSnapshotStore.ts` — docstring no longer claims `1 Hz`; constructor doc references `MAX_HEATMAP_LOOKBACK_HOURS`
- `apps/api/src/market-depth/OrderBookReconstructor.ts` — added `bridged: boolean` flag; after the bridge diff, every subsequent diff must satisfy `U === lastUpdateId + 1` (strict-contiguous gap detection)
- `apps/api/src/state/MarketDataStore.ts` — `get(symbol, exchange?, marketType?)` strict lookup when both are supplied; legacy single-arg fallback preserved
- `apps/api/src/routes/markets.ts` — every route accepts `?exchange=` and `?marketType=` query params and threads them through `adapterFor` + `store.get` to disambiguate multi-exchange installs
- `apps/api/src/routes/health.ts` — `/readiness.mode` now derives from the registry (`hasMockAdapter`/`hasPublicAdapter`), not from env intent. Safety-net case now correctly reports `mode: "mock"`
- `apps/api/src/routes/liquidity.ts` — `maxLookbackHours()` reads from `loadEnv()` (single source of truth)
- `apps/api/src/routes/signals.ts` — dropped unused `cursor` query param; `nextCursor: null` always until cursor pagination is actually implemented
- `apps/api/src/server.ts` — passes `env.MAX_HEATMAP_LOOKBACK_HOURS` into `LiquidityFeedManager`

Frontend (apps/web):
- `apps/web/src/lib/liquidity/canvasRenderer.ts` — `cellHeightPx` now samples `priceMin` and `priceMin+binWidth` (in-window anchors) instead of `0` and `binWidth`
- `apps/web/src/app/heatmap/page.tsx` — order book `levels` 50 → 20; banner doc comment updated to match the actual 50 % overlap threshold
- `apps/web/src/components/Sidebar.tsx` — branding aligned: `Crypto Market Screener` (matches topbar title)

Docs:
- `README.md` — Tests badge `203` → `273`; `MOCK_*` env table rows tagged "_Mock-mode only._"; new env row for `MAX_HEATMAP_LOOKBACK_HOURS`

Tests added:
- `apps/api/src/__tests__/marketDepth.test.ts` — 3 new cases for B-004 (strict gap detection, contiguous diff, snapshot resets bridged)
- `apps/api/src/__tests__/adapters.test.ts` — 4 new cases for B-002 (Bybit 5m/15m and OKX 5m/1h closeTime tracking)
- `apps/api/src/__tests__/multiExchange.test.ts` — 3 new cases for B-003 (strict store lookup, legacy fallback, route disambiguation by `?exchange=`)
- `apps/api/src/__tests__/readinessMode.test.ts` — 1 new case for B-017 (safety-net case reports `mode: "mock"`)
- `apps/api/src/__tests__/normalize.test.ts` — 4 new cases for B-018 (XTZUSD survives, XBTZUSD strips, XETHZEUR strips, ZECUSD survives)

### Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | ✅ exit 0 | All 4 packages clean |
| `pnpm test` | ✅ exit 0 | **288 tests passing** (was 273): engine 28 · web 143 · api 117 |
| `pnpm --filter @screener/web build` | ✅ exit 0 | After applying the documented Windows fix once (`Remove-Item -Recurse -Force node_modules; pnpm install --force`) — first attempt failed with the documented `processChild.js` race |
| `docker compose config --quiet` | ✅ exit 0 | Compose valid |

`docker compose up -d --build` not run in this round (audit kept non-destructive; consistent with the audit author's own choice).

### Updated audit log entries

- **B-001 — heatmap cell height samples zero**: Decision: FIX. `priceToY(0,…)` → `priceToY(priceMin,…)` and `priceToY(binWidth,…)` → `priceToY(priceMin+binWidth,…)` in `apps/web/src/lib/liquidity/canvasRenderer.ts`. No behavioural change today (both forms are equal under linear scale) — this is future-proofing.
- **B-002 — Bybit/OKX closeTime hardcoded**: Decision: FIX. Added `intervalToMs` to `apps/api/src/adapters/normalize.ts`; both adapters now multiply by the requested interval. 4 new tests pin 5m/15m/1h closeTime semantics.
- **B-003 — `MarketDataStore.get` collisions**: Decision: FIX. Strict overload on `get(symbol, exchange?, marketType?)`; markets routes accept `?exchange=&marketType=`; legacy single-arg behaviour preserved for callers that don't disambiguate. 3 new tests.
- **B-004 — bridged-diff gap leakage**: Decision: FIX. New `bridged` flag in `ReconstructorState`; post-bridge diffs require strict `U === lastUpdateId + 1`. 3 new tests.
- **B-005 — `1 Hz` doc drift**: Decision: FIX. Docstring + constructor comment updated; named constants replace the opaque literal.
- **B-006 — `MAX_HEATMAP_LOOKBACK_HOURS` ignored at the buffer**: Decision: FIX. Env value flows from `loadEnv` → `LiquidityFeedManager` → `LiquidityFeed` → `DepthSnapshotStore.capacity`. Default unchanged, so no behavioural diff in the existing test set.
- **B-007 — WS singleton flag fragility**: Decision: DEFER. Architectural; safe today; would need a layout-level provider rewrite + careful Strict-mode validation. Ticket for a later session.
- **B-008 — banner threshold doc drift**: Decision: FIX. Comment now says 50 %, matching the code.
- **B-009 — heatmap polling re-keys on `binSize`/`depthLevels`**: Decision: DEFER. Refactor risk on the heatmap polling loop is high; the user-visible blink is bounded to ~2 s. Worth a focused session to convert all polling deps to refs.
- **B-010 — Dashboard "Loading" forever**: Decision: DEFER. Cosmetic UX; needs design call on copy + a timer threshold.
- **B-011 — heatmap polling no backoff**: Decision: DEFER. Polling backoff is an outage-handling improvement that risks masking error visibility; needs an outage-mode design call.
- **B-012 — `LiquidityFeed.start` re-entry**: Decision: FIX (trivial). `startedAtMs` now resets on every `start()` so heatmap-collection-started reflects the latest session.
- **B-013 — Dockerfile re-runs `pnpm install`**: Decision: DEFER. Build perf; touching install semantics without a CI matrix to validate is risky.
- **B-014 — Web Dockerfile standalone risk**: Decision: DEFER. Needs live `docker compose up` validation, deliberately skipped in this round.
- **B-015 — orderbook overshoot**: Decision: FIX. `levels: 50` → `levels: 20` in the heatmap polling tick.
- **B-016 — `/signals` cursor stub**: Decision: FIX. Dropped the param from the schema; `nextCursor: null` always.
- **B-017 — `/readiness.mode` lies in safety-net case**: Decision: FIX. `mode` derived from registry, not env. New test pins the safety-net case.
- **B-018 — Kraken regex over-strips**: Decision: FIX. Closed allowlist for legacy bases + legacy quotes. 4 new tests including XTZUSD (Tezos) survives, XBTZUSD/XETHZEUR strip correctly.
- **B-019 — rebuild fire-and-forget**: Decision: DEFER. Cosmetic toast; not a correctness issue.
- **I-001 — duplicate `HeatmapMatrix` types**: Decision: DEFER. Moving to `packages/shared` is a 50+ touchpoint refactor; the fields are stable.
- **I-002 — duplicate filter logic**: Decision: DEFER. Same.
- **I-003 — `candleLimit` default chain**: Decision: FIX (1-line). `String(MARKET_DETAIL.candleLimit)` instead of `"200"`.
- **I-004 — README badge says 203**: Decision: FIX. Badge now reads `tests-273%20passing`.
- **I-005 — MOCK_* env docs missing "mock-mode only"**: Decision: FIX. Annotated three rows.
- **I-006 — `db push --accept-data-loss`**: Decision: DEFER. `prisma migrate deploy` requires migration files which the project doesn't ship today; would break first-boot for users. Track for the prod-readiness milestone.
- **I-007 — `RingBuffer.push` O(n)**: Decision: DEFER. Real ring buffer rewrite needs perf benchmarks; acceptable for current sizes.
- **I-008 — string sort silently no-op**: Decision: DEFER. Behavioural API change; needs a deprecation cycle.
- **I-009 — sidebar branding mismatch**: Decision: FIX. `Sidebar.tsx` h2 now reads `Crypto Market Screener`.
- **I-010 — Coinbase orderbook unused `limit`**: Decision: REJECT. Already prefixed `_limit` in the source; audit was outdated by ~one round.
- **I-011 — duplicate ticker logic**: Decision: DEFER. Refactor risk vs payoff low.
- **I-012 — order book naming**: Decision: REJECT. Cosmetic; current naming is consistent with itself.
- **I-013 — `spreadPct` decimal places**: Decision: REJECT. Audit author marked as "false alarm on first read" — confirmed.
- **I-014 — heatmap polling deps inconsistency**: Decision: DUPLICATE OF B-009.
- **I-015 — `Date.now()` clock drift**: Decision: REJECT. Audit author marked INFO with no action expected.
- **R-001 — `MAX_HEATMAP_LOOKBACK_HOURS` in Zod**: Decision: FIX (folded into B-006 fix).
- **R-002 to R-010**: Decision: DEFER. Architectural improvements (LRU feeds, `/metrics`, WS-only liquidity, prisma migrate, CI matrix) — all out of MVP scope.

### BREAKING changes

- `MarketDataStore.get(symbol)` now accepts optional `exchange` and `marketType` arguments. Existing single-arg callers continue to work (legacy fallback preserved). **No external API contract change** — the route layer's response shape is unchanged.
- `/markets/:symbol` and the related sub-routes now accept optional `?exchange=` and `?marketType=` query params for disambiguation. Routes without those params behave exactly as before.
- `/signals` no longer accepts a `cursor` query param; the field was unused. `nextCursor` is always `null` until real cursor pagination is implemented. Frontend doesn't pass `cursor` today, so this is internal-only.
- `/readiness.mode` for the safety-net case (USE_MOCK_DATA=false + ENABLE_PUBLIC_API_ADAPTERS=false) now reports `"mock"` instead of the previous misleading `"live"`. Monitoring tied to readiness should treat this as a correctness fix, not a behavioural break.

No public response shape removals.
