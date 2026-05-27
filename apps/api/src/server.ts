import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { DEFAULT_CONFIG, type ScreenerConfig } from "@screener/engine";
import Fastify, { type FastifyInstance } from "fastify";
import { AdapterRegistry } from "./adapters/AdapterRegistry.js";
import type { MockExchangeAdapter } from "./adapters/MockExchangeAdapter.js";
import { initRedis, shutdownRedis } from "./cache/RedisClient.js";
import { loadEnv } from "./config/env.js";
import { initDatabase, shutdownDatabase, scheduleDbReconnect } from "./db/prisma.js";
import { AlertEvaluator } from "./jobs/AlertEvaluator.js";
import { LivePollingJob } from "./jobs/LivePollingJob.js";
import { ScreenerJob } from "./jobs/ScreenerJob.js";
import { logger } from "./logger.js";
import { LiquidityFeedManager } from "./market-depth/LiquidityFeedManager.js";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { registerAlertsRoutes } from "./routes/alerts.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLiquidityRoutes } from "./routes/liquidity.js";
import { registerMarketsRoutes } from "./routes/markets.js";
import { registerScreenerRoutes } from "./routes/screener.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSignalsRoutes } from "./routes/signals.js";
import { alertStore } from "./state/AlertStore.js";
import { MarketDataStore } from "./state/MarketDataStore.js";
import { WebSocketHub } from "./ws/WebSocketHub.js";

export type AppContext = {
  fastify: FastifyInstance;
  registry: AdapterRegistry;
  store: MarketDataStore;
  hub: WebSocketHub;
  job: ScreenerJob | null;
  livePollingJob: LivePollingJob | null;
  alertEvaluator: AlertEvaluator;
  liquidityFeeds: LiquidityFeedManager;
};

export type BuildOptions = {
  /** When true, don't start timers (screener/alert/ws batch). Tests should set this. */
  startJobs?: boolean;
};

export async function buildServer(opts: BuildOptions = {}): Promise<AppContext> {
  const env = loadEnv();

  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(process.env.NODE_ENV !== "production"
        ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
        : {}),
    },
    bodyLimit: 1_048_576, // 1 MB — Requirement 20.8
    trustProxy: true,
  });

  await fastify.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });

  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => req.ip ?? "unknown",
  });

  await fastify.register(websocket);

  registerErrorHandler(fastify);

  // Best-effort infra
  await initDatabase();
  scheduleDbReconnect(); // periodic retry if DB came up later
  await initRedis(env.REDIS_URL);

  // Adapters
  const registry = new AdapterRegistry(env);
  await registry.init();

  const store = new MarketDataStore();
  const hub = new WebSocketHub(
    store,
    env.WS_BATCH_INTERVAL_MS,
    env.WS_BATCH_MAX_ENTRIES,
    () => alertStore.listEvents(50),
  );
  if (opts.startJobs !== false) hub.start();

  // Detector config from env (with defaults from engine)
  const cfg: ScreenerConfig = {
    ...DEFAULT_CONFIG,
    hotMarket: { scoreThreshold: env.HOT_MARKET_SCORE_THRESHOLD },
  };

  // Mock-first: if mock is registered, drive the screener job from it.
  const mock = registry.byName("mock") as MockExchangeAdapter | undefined;

  let job: ScreenerJob | null = null;
  if (mock) {
    job = new ScreenerJob(mock, store, hub, cfg, env.SCREENER_INTERVAL_MS);
    if (opts.startJobs !== false) job.start();
  }

  // Live polling job: feeds public REST adapters into the same store.
  const publicAdapters = registry.publicAdapters();
  const livePollingJob =
    publicAdapters.length > 0
      ? new LivePollingJob(
          publicAdapters,
          store,
          hub,
          cfg,
          env.LIVE_POLLING_INTERVAL_MS,
          env.LIVE_POLLING_SYMBOL_LIMIT,
        )
      : null;
  if (livePollingJob && opts.startJobs !== false) livePollingJob.start();

  const alertEvaluator = new AlertEvaluator(store, hub, env.ALERT_INTERVAL_MS);
  if (opts.startJobs !== false) alertEvaluator.start();

  // Routes
  await registerHealthRoutes(fastify, registry);
  await registerMarketsRoutes(fastify, store, registry);
  await registerScreenerRoutes(fastify, store);
  await registerSignalsRoutes(fastify, store);
  await registerAlertsRoutes(fastify);
  await registerSettingsRoutes(fastify);

  const liquidityFeeds = new LiquidityFeedManager({
    ttlSeconds: env.EXTERNAL_API_CACHE_TTL_SECONDS,
    timeoutMs: env.EXTERNAL_API_TIMEOUT_MS,
    maxLookbackHours: env.MAX_HEATMAP_LOOKBACK_HOURS,
  });
  await registerLiquidityRoutes(fastify, liquidityFeeds);

  // WebSocket route
  fastify.get("/ws", { websocket: true }, (socket /* WebSocket */) => {
    hub.attachClient(socket);
  });

  return { fastify, registry, store, hub, job, livePollingJob, alertEvaluator, liquidityFeeds };
}

export async function shutdownContext(ctx: AppContext): Promise<void> {
  ctx.alertEvaluator.stop();
  ctx.job?.stop();
  ctx.livePollingJob?.stop();
  ctx.hub.stop();
  await ctx.liquidityFeeds.stopAll();
  await ctx.registry.shutdown();
  await ctx.fastify.close();
  await shutdownRedis();
  await shutdownDatabase();
}
