# Audit Triage — round 1

Дата: 2026-05-27
Источник: `.kiro/audit/audit.md` (раздел "Resolution log").
Цель этого файла: явное журналирование решений по каждому findings-у плюс
независимая верификация, что заявленные FIX реально живут в коде.

---

## Подход

Прежде чем что-то править, я перепроверил каждый заявленный FIX из
`audit.md → Resolution log` против актуального состояния файлов и тестов.
Все 14 FIX действительно реализованы. Поэтому вклад этого раунда —
**подтверждение** (а не повторная имплементация), плюс прогон полного
verification matrix.

## Independent verification of FIX claims

| FIX | Файл / тест-доказательство | Статус |
|---|---|---|
| B-001 cell height anchor | `apps/web/src/lib/liquidity/canvasRenderer.ts:78–79` (`priceToY(priceMin,…)` и `priceMin+binWidth`) | ✅ in code |
| B-002 closeTime adapters | `BybitAdapter.ts:12,132,141`, `OkxAdapter.ts:12,133,142`, helper `normalize.ts:150` (`intervalToMs`) | ✅ in code |
| B-003 store disambiguation | `MarketDataStore.get(symbol, exchange?, marketType?)`, `routes/markets.ts:56–60` | ✅ in code |
| B-004 strict bridged-diff | `OrderBookReconstructor.ts:44,73,87,98,118,146,156` (`bridged: boolean`) | ✅ in code |
| B-005 ring-buffer doc | `LiquidityFeed.ts:80–84,115–118` (`DEFAULT_MAX_LOOKBACK_HOURS`, `snapshotCapacityFor`) | ✅ in code |
| B-006 env honoured | `env.ts:67`, `LiquidityFeed.ts:37,115–118`, `server.ts:136` | ✅ in code |
| B-008 banner threshold | `app/heatmap/page.tsx:544` ("less than 50 %") | ✅ in code |
| B-012 startedAt reset | `LiquidityFeed.ts:127` (`this.startedAtMs = Date.now()`) | ✅ in code |
| B-015 levels 50 → 20 | `app/heatmap/page.tsx:204` (`levels: 20`) | ✅ in code |
| B-016 cursor stub | `routes/signals.ts:22,27` (`nextCursor: null`) | ✅ in code |
| B-017 readiness mode | `routes/health.ts:44–53` (derived from registry) | ✅ in code |
| B-018 Kraken allowlist | `KrakenAdapter.ts:233–257` + `normalize.ts:90–104` | ✅ in code |
| I-003 candleLimit fallback | `routes/markets.ts:57` (`String(MARKET_DETAIL.candleLimit)`) | ✅ in code |
| I-004 README badge | `README.md:9` (`tests-273%20passing`) | ✅ in code |
| I-005 README MOCK rows | `README.md:254–256` (`_Mock-mode only._`) | ✅ in code |
| I-009 Sidebar branding | `Sidebar.tsx:22` (`Crypto Market Screener`) | ✅ in code |
| R-001 env Zod | `env.ts:67` (`MAX_HEATMAP_LOOKBACK_HOURS`) | ✅ in code |

Test files claimed as new and confirmed present:
- `apps/api/src/__tests__/marketDepth.test.ts` — содержит `re-applying a snapshot resets the bridged flag` (B-004).
- `apps/api/src/__tests__/normalize.test.ts` — содержит `Kraken normalize: legacy Z-prefix only mangles known quotes (B-018)` + XTZUSD ассерт.
- `apps/api/src/__tests__/readinessMode.test.ts` — содержит `safety-net case ... still reports mode=mock (B-017)`.
- `apps/api/src/__tests__/modes.test.ts` — содержит safety-net проверку.
- API test count прыгнул с 102 → 117 (+15), что согласуется с заявленными "+11 от B-002/B-003/B-017/B-018" плюс несколько от B-004.

## Decisions

Все решения совпадают с теми, что уже зафиксированы в
`audit.md → Resolution log` (раздел "Updated audit log entries"). Здесь —
тот же список в формате Decision/Rationale/Plan для удобства следующего
раунда.

### FIX (14, все уже выполнены — проверены в этом раунде)

- **B-001, B-002, B-003, B-004, B-005, B-006, B-008, B-012, B-015, B-016,
  B-017, B-018** — корректность данных или контракта; effort small/trivial,
  risk low. Реализация подтверждена.
- **I-003, I-004, I-005, I-009** — мелкий drift (доки/branding); trivial.
- **R-001** — `MAX_HEATMAP_LOOKBACK_HOURS` в Zod-схеме env; объединено с
  B-006 (одним патчем).

### DEFER (16)

- **B-007** — WS singleton flag fragility. Архитектурно: нужен
  layout-level provider, валидация в Strict-mode. Не входит в этот раунд.
- **B-009** — heatmap polling re-keys на `binSize/depthLevels`. Refactor
  риск выше пользы; пользовательский blink ≤ 2 s.
- **B-010** — Dashboard "Loading" forever. Cosmetic UX, нужен дизайн-
  call по copy + threshold.
- **B-011** — heatmap polling без backoff. Нужен outage-mode дизайн,
  риск замаскировать ошибки.
- **B-013** — Dockerfile `pnpm install` повтор. Build-perf, требует CI
  matrix для валидации.
- **B-014** — web Dockerfile standalone risk. Нужно реальный
  `docker compose up` smoke; в этом раунде намеренно не запускался.
- **B-019** — rebuild fire-and-forget. Косметика, не correctness.
- **I-001** — duplicate `HeatmapMatrix` types. 50+ touchpoint refactor.
- **I-002** — duplicate filter logic. То же.
- **I-006** — `db push --accept-data-loss`. `prisma migrate deploy`
  сломает first-boot, пока миграций нет. Tracking в prod-readiness.
- **I-007** — `RingBuffer.push` O(n). Нужен perf-bench.
- **I-008** — string sort silently no-op. API breaking; нужен deprecation.
- **I-011** — duplicate ticker logic. Refactor risk vs payoff низкий.
- **R-002…R-010** — архитектурные улучшения (LRU feeds, `/metrics`,
  WS-only liquidity, prisma migrate, CI matrix). Out of MVP scope.

### REJECT (4)

- **I-010** Coinbase `_limit` уже стоит с подчёркиванием — auditor работал
  на старом снапшоте.
- **I-012** Order book naming consistent сам с собой.
- **I-013** Audit-author сам пометил как false alarm.
- **I-015** Audit-author сам пометил как INFO без действий.

### DUPLICATE (1)

- **I-014** — дубликат B-009.

## Verification (rerun in this triage round)

| Команда | Результат | Подробности |
|---|---|---|
| `pnpm typecheck` | ✅ exit 0 | 4 пакета (`shared`, `screener-engine`, `web`, `api`) — все clean. |
| `pnpm test` | ✅ exit 0 | 28 engine + 143 web + 117 api = **288 passing** (повышение с 273 → 288 от 15 новых API-тестов). |
| `pnpm --filter @screener/web build` | ✅ exit 0 | Первый запуск — известный Node 24 / jest-worker `processChild.js` баг на Windows; задокументированный фикс (`Remove-Item -Recurse -Force node_modules; pnpm install --force`) сработал с первого раза. После фикса build генерирует все 10 routes (`/`, `/alerts`, `/heatmap`, `/market-map`, `/markets/[symbol]`, `/screener`, `/settings`, `/signals`, `/_not-found`). |
| `docker compose config --quiet` | ✅ exit 0 | Compose валидируется. |
| `docker compose up -d --build` | ⏭️ не запускался | Намеренно non-destructive раунд (Docker Desktop не поднят). |

## Чего этот раунд НЕ делал

- Не правил код — все необходимые FIX уже были на месте после прошлого
  раунда. Любое дополнительное вмешательство без явного запроса было бы
  out-of-scope (промпт №2 говорит "Минимально-достаточные. Не делай
  рефакторинг 'заодно'").
- Не запускал `docker compose up -d --build`. Это нужно для подтверждения
  B-014 (web Dockerfile standalone) и I-006 (prisma db push); их статус
  остаётся DEFER до отдельного live-run раунда.
- Не трогал DEFER-список. Они помечены и ждут отдельных focused-сессий.

## Следующие кандидаты на FIX-раунд (если понадобится)

В порядке value/effort:

1. **B-009** (~1 час) — собрать `binSize/depthLevels/heatmapBucketMs`/
   `heatmapLookback` в refs, оставить в polling-deps только
   `[symbol, marketType, timeframe, rebuildToken]`. Уберёт ~2-секундный
   blink при смене bin/depth. Тест уже описан в audit (B-009 acceptance).
2. **B-013** (~30 мин) — Dockerfile API: заменить `pnpm install` на
   `pnpm install --offline --frozen-lockfile` после COPY-overlay. Smoke-
   test `docker compose build api` дважды и сравнить wall-clock.
3. **I-001** + **I-002** в одном refactor-патче — переместить
   `HeatmapMatrix` / `HeatmapCell` / `ScreenerFilters` в `packages/shared`,
   обновить импорты с обеих сторон. ~50 файлов, но typecheck выловит всё.
4. **B-014** — отдельный live-run раунд с `docker compose up -d --build`,
   curl-ами на `/health`, `/readiness`, `/liquidity/BTCUSDT/snapshot`.
   Это закроет сразу несколько out-of-scope пунктов из аудита.


---

# Audit Triage — round 2

Дата: 2026-05-27 (continuation)
Источник: `.kiro/audit/triage.md` round 1 (DEFER list).
Цель: пройтись по DEFER-пунктам и реализовать всё, что реалистично без
архитектурного риска / live-docker-окружения.

## Pre-fix verification (state of code at start of this round)

Та же, что в конце round 1: typecheck/test/build все зелёные, 288 тестов.

## Decisions made in this round

### FIX (10)

| # | Файл | Что |
|---|---|---|
| **B-007** | `apps/web/src/lib/ws.ts` | Заменил `started: boolean` на refcount. Множественные подписчики теперь шарят один WebSocket, последний unmount закрывает сокет. Strict-mode mount/unmount-race больше не теряет соединение. |
| **B-009 + I-014** | `apps/web/src/app/heatmap/page.tsx` | `binSize` и `depthLevels` теперь идут через refs (`binSizeRef`, `depthLevelsRef`), polling-effect перекеивается только на `[symbol, marketType, timeframe]`. Смена bin/depth больше не блэнкит чарт на ~2 с. Единый источник истины для polling-зависимостей: refs, как и `lookbackRef` / `heatmapBucketMsRef`. |
| **B-010** | `apps/web/src/app/page.tsx` | Empty-state получил таймаут: первые 10 с показывается "Loading market data…", далее переключается на actionable hint с состоянием WebSocket и ссылкой на Settings. |
| **B-011** | `apps/web/src/app/heatmap/page.tsx` | Heatmap polling получил exponential backoff на consecutive failures (2 s → 4 s → 8 s → 16 s → 30 s cap). Recovery — мгновенный (счётчик сбрасывается на первом успехе). |
| **B-013** | `apps/api/Dockerfile` | `RUN pnpm install` в runtime-stage заменён на `pnpm install --offline --frozen-lockfile`. Source-only rebuild теперь не ходит в сеть и не пересоздаёт workspace symlinks с нуля. |
| **B-019** | `apps/web/src/app/heatmap/page.tsx` + `globals.css` | После клика "Rebuild for visible range" показывается toast "Rebuilding heatmap for X – Y…", затем "Rebuild applied" на 1.5 с. Раньше rebuild был fire-and-forget без визуального подтверждения. Связано: epoch-flag (`rebuildEpochRef`) заменил `rebuildToken` state, чтобы не тригерить полный teardown polling-effect-а. |
| **I-007** | `apps/api/src/market-depth/RingBuffer.ts` | Полноценный circular buffer с head-pointer-ом: `push` теперь O(1) (раньше — O(n) на splice после переполнения). `toArray`, `filter`, `prune` сохраняют семантику. Добавлены 5 новых тестов. **Важное замечание о контракте**: `toArray()` возвращает прямые ссылки на хранимые объекты (а не клоны) — `LiquidityFeed.onKline` мутирует last candle in-place, и это поведение сохранено. |
| **I-008** | `apps/api/src/routes/screener.ts` | `sortColumn=symbol`/`exchange`/`quoteAsset` теперь работают через `localeCompare` вместо silent-no-op. Числовая сортировка не изменена. Добавлены 2 новых теста. Не breaking — только расширяет работающее множество значений. |
| **I-011** | `apps/api/src/adapters/MockExchangeAdapter.ts` + `apps/api/src/jobs/ScreenerJob.ts` | Дубликат `makeTicker`/`deriveTicker` устранён. `MockExchangeAdapter.makeTickerForState(st)` — public static; ScreenerJob импортирует его и больше не дублирует math. |
| **R-008** | `package.json` (root) + `.nvmrc` | Добавил `.nvmrc` с `20.16.0` (LTS) — phpv-баг processChild.js на Node 24+Windows документирован как known quirk. `engines.node` оставил `>=20` (не сужал, чтобы существующая dev-установка пользователя не ругалась). |

### Не FIX-нул в этом раунде

- **B-014** — нужен реальный `docker compose up -d --build` + curl. Стэйл DEFER до live-docker раунда.
- **I-006** — `prisma migrate deploy` требует наличия миграций, которые проект не шипает. DEFER.
- **I-001** + **I-002** — refactor `HeatmapMatrix` / `ScreenerFilters` в `packages/shared`. Это 50+ touchpoint, большой PR; отложено на отдельный рефактор-раунд, чтобы случайно не поломать typecheck-цепочку.
- **R-002…R-007, R-009, R-010** — feature work / архитектурные улучшения out of scope (LRU feeds, `/metrics`, WS-only liquidity stream, prisma migrate, CI matrix).

## Tests added in this round (+7)

- `apps/api/src/__tests__/marketDepth.test.ts` — 5 RingBuffer тестов (chronological order across wraps, filter после wrap, prune до empty/partial, mutation via toArray).
- `apps/api/src/__tests__/screener.test.ts` — 2 теста локального sort by symbol (asc, desc).

## Verification (after round 2 changes)

| Команда | Результат | Подробности |
|---|---|---|
| `pnpm typecheck` | ✅ exit 0 | 4 пакета чистые. |
| `pnpm test` | ✅ exit 0 | **295 tests passing** (28 engine + 143 web + 124 api). +7 от round 2. |
| `pnpm --filter @screener/web build` | ✅ exit 0 | Первый прогон опять упал на known Windows `processChild.js`; задокументированный фикс (`Remove-Item -Recurse -Force node_modules; pnpm install --force`) вылечил с первой попытки. После — build генерирует все 10 routes. |
| `docker compose config --quiet` | ✅ exit 0 | Compose валиден (Dockerfile-патч не сломал синтаксис). |
| `docker compose up -d --build` | ⏭️ намеренно skipped | Round non-destructive; B-014/I-006 остаются DEFER. |

## BREAKING / behavioural changes

Все changes — backwards-compatible для внешних API:

- WS-singleton refactor: внешний контракт `useScreenerWebSocket()` идентичен; меняется только под-капотный лайфцикл соединения. Strict-mode безопасен.
- Polling backoff: при healthy upstream поведение прежнее (POLL_MS = 2 s); при error tail задержка растёт геометрически до 30 s. Recovery мгновенный.
- Sort by string: новые валидные значения для `sortColumn`. Прежние числовые поведения не изменены, прежние string-sort вызовы перестают молча no-op-ить и возвращают отсортированный список.
- RingBuffer rewrite: контракт `push/toArray/filter/prune/clear/size` идентичен; **критично**: `toArray()` возвращает прямые ссылки (mutation in-place у вызывающего видна на следующих `toArray()` — это поведение сохранено и покрыто тестом, потому что `LiquidityFeed.onKline` на это рассчитывает).
- API Dockerfile: cache-friendly perf improvement; functional behaviour прежнее.

## Что осталось из исходного DEFER-списка

- B-014 (live-docker)
- I-001, I-002 (shared types refactor)
- I-006 (prisma migrate)
- R-002…R-007, R-009, R-010 (architectural / feature work)

Все они помечены и ждут отдельных focused-сессий, как и было.


---

# Audit Triage — round 3 (live-docker)

Дата: 2026-05-27 (continuation, со стэком в Docker Desktop)
Источник: round 2 DEFER list + live observations on `docker compose up -d --build`.
Цель: закрыть пункты, которые требовали реального live-окружения (B-014, I-006, плюс
docker compose smoke), и дополнить healthcheck-ами, которых раньше не было.

## Pre-fix state

Все 4 контейнера up: postgres + redis + api + web. WS, REST endpoints отвечают.
В round 2 закрыто все unit-test-able; round 3 — только инфра.

## Live smoke (before any fixes this round)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /health` | 200 | static "ok" |
| `GET /readiness` | 200 | mode=live, all 5 adapters connected, db ok, redis ok |
| `GET /markets` | 200 | 42 KB payload |
| `GET /screener?sortColumn=symbol&sortDirection=asc&limit=3` | 200 | I-008 fix verified live: `0GUSD < 1INCHUSD < 1INCHUSDT` lex-sorted |
| `GET /liquidity/BTCUSDT/snapshot?marketType=spot&...` | 200 | 51 cells после ~60 s истории, mid ~$75k, 237 snapshots, 1326 trades |
| `GET /` (web 3000) | 200 | 7 KB HTML |
| `GET /heatmap` (web 3000) | 200 | 15 KB HTML |
| `B-014 (web standalone risk)` | ✅ verified | Web standalone серверу не нужен полный node_modules — Next.js build артефакт самодостаточен. **REJECT/CLOSED**: гипотеза auditor-а не подтвердилась. |

## Decisions made in this round

### FIX (3)

| # | Файл | Что |
|---|---|---|
| **I-006** | `apps/api/Dockerfile` | Заменил `prisma db push --accept-data-loss` на безопасную цепочку: `migrate deploy` → `db push --skip-generate` (без `--accept-data-loss`) → echo+continue. Теперь Dockerfile НЕ может молча уронить колонки в проде. Verified: API контейнер чисто стартует на свежем postgres (нет миграций → migrate deploy no-op → db push поднимает таблицы из schema.prisma). |
| **infra (docker-compose)** | `docker-compose.yml` | Добавил healthcheck-блоки для api (на `/health`) и web (на `/`) через `node -e require('http').get(...)`. `depends_on` теперь использует `condition: service_healthy` — web стартует только когда api готов отвечать на запросы. До этого web-контейнер мог стартовать до api и получать 502 на первых запросах. |
| **infra (next standalone)** | `docker-compose.yml` (env) | `HOSTNAME=0.0.0.0` для web. Без этой переменной Next.js standalone bind-ит на конкретный internal IP контейнера (`172.x.x.x`), и in-container healthcheck через `127.0.0.1` упирается в ECONNREFUSED. С `HOSTNAME=0.0.0.0` сервер слушает на всех интерфейсах, port mapping `3000:3000` не меняется. |

### REJECT / CLOSED (1)

- **B-014** (web Dockerfile standalone risk) — гипотеза auditor-а: pnpm + Next.js standalone могут оставить broken symlinks. Live-проверка: web image поднимается, отдаёт все routes 200, healthcheck зелёный. **Hypothesis disproved**.

## Verification (after round 3 changes)

```
docker compose up -d --build api web
... (5 s offline install, faster than the ~30 s pre-B-013)

docker compose ps:
  marketwatcher-api-1        Up (healthy)
  marketwatcher-postgres-1   Up (healthy)
  marketwatcher-redis-1      Up (healthy)
  marketwatcher-web-1        Up (healthy)   ← was "starting" without HOSTNAME=0.0.0.0
```

| Команда | Результат |
|---|---|
| `pnpm typecheck` | ✅ exit 0 (no source code touched in this round, sanity check only) |
| `docker compose config --quiet` | ✅ exit 0 |
| `docker compose up -d --build api web` | ✅ all services Built + Healthy in <10 s |
| Live `/readiness.mode` | "live" — all 5 adapters connected |
| Live `/health` | 200 |
| Live `/liquidity/BTCUSDT/snapshot` | 200, 51 cells, feed accumulating |

## Что осталось из исходного DEFER-списка после round 3

Только архитектурные / feature workstreams:

- **I-001, I-002** — shared types/filters refactor в `packages/shared` (50+ touchpoint).
- **R-002** — LRU+TTL eviction для idle LiquidityFeeds.
- **R-003** — PRNG cross-language reproducibility.
- **R-004** — `/metrics` Prometheus endpoint.
- **R-005** — `feedStartedAt` в WS snapshot payload.
- **R-006** — `/liquidity/:symbol/stream` WS channel вместо polling.
- **R-007** — заменить `db push` на полноценные миграции (требует написания самих миграций).
- **R-009** — CI matrix (Linux + Windows).
- **R-010** — duplicate of I-002.

## Cumulative state across all 3 rounds

- **Bugs**: 19 — 17 FIX, 1 DEFER (B-007 → FIX in round 2), 1 CLOSED in round 3 (B-014).
  - Wait: re-check round 1 said 14 FIX из 19 bugs. Round 2 добавил FIX к B-007/B-009/B-010/B-011/B-019 (5). Итого 19/19 bugs закрыто.

- **Inconsistencies**: 15 — 9 FIX (round 1: I-003, I-004, I-005, I-009; round 2: I-007, I-008, I-011, I-014 dup; round 3: I-006), 4 REJECT (I-010, I-012, I-013, I-015), 2 DEFER (I-001, I-002 — большой refactor).

- **Recommendations**: 10 — 2 FIX (R-001 в round 1, R-008 в round 2), 8 DEFER (R-002 до R-007, R-009, R-010 — feature/architectural).

**Total findings: 44. FIX: 28. REJECT/CLOSED: 5. DEFER (feature/architectural): 11.**

Test count: 295 passing (engine 28 + web 143 + api 124).

## Cleanup

Удалил временные smoke-файлы (`liq-snap.json`, `markets.json`, `screener.json`, `.tmp-hc.js`).
