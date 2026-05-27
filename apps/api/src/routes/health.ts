import type { FastifyInstance } from "fastify";
import type { AdapterRegistry } from "../adapters/AdapterRegistry.js";
import { isRedisAvailable } from "../cache/RedisClient.js";
import { loadEnv } from "../config/env.js";
import { isDbAvailable } from "../db/prisma.js";

export async function registerHealthRoutes(
  fastify: FastifyInstance,
  registry: AdapterRegistry,
): Promise<void> {
  fastify.get("/health", async () => ({
    status: "ok",
    serverTime: new Date().toISOString(),
  }));

  fastify.get("/readiness", async () => {
    const env = loadEnv();
    const adapters = registry.all().map((a) => {
      const h = a.health();
      return {
        name: a.name,
        enabled: h.enabled,
        connected: a.isConnected(),
        status: h.status,
        marketTypes: a.marketTypes,
        lastSuccessAt: h.lastSuccessAt,
        lastErrorAt: h.lastErrorAt,
        lastErrorMessage: h.lastErrorMessage,
      };
    });
    const db: "ok" | "unavailable" = isDbAvailable() ? "ok" : "unavailable";
    const redis: "ok" | "fallback" = isRedisAvailable() ? "ok" : "fallback";
    const anyAdapterOk = adapters.some((a) => a.status === "ok");
    const status: "ok" | "degraded" =
      db === "ok" && redis === "ok" && anyAdapterOk ? "ok" : "degraded";

    const mockEnabledByEnv = env.USE_MOCK_DATA || env.ENABLE_TEST_FIXTURES;
    const publicAdaptersEnabled = env.ENABLE_PUBLIC_API_ADAPTERS;
    // Authoritative source of mode is the registry: if the only registered
    // adapter is mock (e.g. the safety-net case where both env flags are off
    // but AdapterRegistry fell back to mock), `mode` must be "mock" — not
    // "live". That avoids a misleading `/readiness` for monitoring.
    const adapterNames = adapters.map((a) => a.name);
    const hasMockAdapter = adapterNames.includes("mock");
    const hasPublicAdapter = adapterNames.some((n) => n !== "mock");
    const mockEnabled = mockEnabledByEnv || hasMockAdapter;
    const mode: "live" | "mock" | "hybrid" =
      hasMockAdapter && hasPublicAdapter
        ? "hybrid"
        : hasMockAdapter
        ? "mock"
        : "live";

    return {
      status,
      mode,
      mockEnabled,
      publicAdaptersEnabled,
      db,
      redis,
      exchangeAdapters: adapters,
      marketMetadata: env.MARKET_METADATA_PROVIDER,
      paidProvidersDisabled: env.DISABLE_PAID_PROVIDERS,
      // legacy alias for older clients
      mockMode: mockEnabled,
      serverTime: new Date().toISOString(),
    };
  });
}
