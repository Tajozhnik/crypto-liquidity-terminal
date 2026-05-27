import type { ScreenerResult } from "@screener/shared";
import { buildServer, shutdownContext, type AppContext } from "../server.js";

export async function buildTestContext(): Promise<AppContext> {
  // Tests run on mock fixtures only; do not require any external HTTP.
  process.env.USE_MOCK_DATA = "true";
  process.env.ENABLE_TEST_FIXTURES = "true";
  process.env.ENABLE_PUBLIC_API_ADAPTERS = "false";
  process.env.LOG_LEVEL = "error";
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const ctx = await buildServer({ startJobs: false });
  // Stop the mock adapter's internal tick interval — store will be filled manually.
  await ctx.registry.shutdown();
  return ctx;
}

export async function teardownTestContext(ctx: AppContext): Promise<void> {
  await shutdownContext(ctx);
}

export function makeResult(overrides: Partial<ScreenerResult> = {}): ScreenerResult {
  const now = new Date().toISOString();
  return {
    symbol: "BTCUSDT",
    exchange: "mock",
    marketType: "futures",
    quoteAsset: "USDT",
    price: 60000,
    change5m: 1,
    change15m: 0.5,
    change1h: 2,
    change24h: 3,
    volume24h: 100_000_000,
    relativeVolume: 2,
    volatility: 1.5,
    tradesPerMinute: 100,
    spreadPct: 0.05,
    orderBookImbalance: 0.1,
    openInterest: 1_000_000,
    fundingRate: 0.0001,
    signalScore: 75,
    scoreBand: "hot",
    activeSignals: ["VOLUME_SPIKE"],
    lastSignalAt: now,
    updatedAt: now,
    ...overrides,
  };
}
