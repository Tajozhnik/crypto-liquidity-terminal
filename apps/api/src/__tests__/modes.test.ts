import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../adapters/AdapterRegistry.js";
import { loadEnv } from "../config/env.js";

/**
 * Verifies the three operating modes documented in README → "How to switch live":
 *   1) Mock-only      — only MockExchangeAdapter is constructed.
 *   2) Live public    — only the public-API adapters are constructed (no mock).
 *   3) Hybrid         — both mock and public adapters coexist.
 *
 * Plus the safety net: if everything is disabled, the registry falls back to mock
 * so the app is never empty.
 */

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  // Aggressive reset: drop every env key that the registry / env loader reads.
  const keys = [
    "USE_MOCK_DATA",
    "ENABLE_TEST_FIXTURES",
    "ENABLE_PUBLIC_API_ADAPTERS",
    "ENABLED_EXCHANGES",
    "DISABLE_PAID_PROVIDERS",
    "MARKET_METADATA_PROVIDER",
    "EXTERNAL_API_TIMEOUT_MS",
    "EXTERNAL_API_CACHE_TTL_SECONDS",
    "LIVE_POLLING_INTERVAL_MS",
    "LIVE_POLLING_SYMBOL_LIMIT",
  ];
  for (const k of keys) delete process.env[k];
}

beforeEach(() => {
  resetEnv();
});
afterEach(() => {
  resetEnv();
});

describe("operating modes", () => {
  it("mock-only mode: USE_MOCK_DATA=true, ENABLE_PUBLIC_API_ADAPTERS=false", async () => {
    process.env.USE_MOCK_DATA = "true";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "false";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name);
      expect(names).toEqual(["mock"]);
      expect(registry.publicAdapters()).toEqual([]);
    } finally {
      await registry.shutdown();
    }
  });

  it("live public mode: USE_MOCK_DATA=false, ENABLE_PUBLIC_API_ADAPTERS=true", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance,bybit,okx,coinbase,kraken";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name).sort();
      expect(names).toEqual(["binance", "bybit", "coinbase", "kraken", "okx"]);
      expect(registry.byName("mock")).toBeUndefined();
      expect(registry.publicAdapters().length).toBe(5);
    } finally {
      await registry.shutdown();
    }
  });

  it("live public mode respects ENABLED_EXCHANGES allowlist", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance,coinbase";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name).sort();
      expect(names).toEqual(["binance", "coinbase"]);
    } finally {
      await registry.shutdown();
    }
  });

  it("hybrid mode: both mock and public adapters coexist", async () => {
    process.env.USE_MOCK_DATA = "true";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance,bybit";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name).sort();
      expect(names).toEqual(["binance", "bybit", "mock"]);
      expect(registry.byName("mock")).toBeDefined();
      expect(registry.publicAdapters().map((a) => a.name).sort()).toEqual(["binance", "bybit"]);
    } finally {
      await registry.shutdown();
    }
  });

  it("safety net: USE_MOCK_DATA=false + ENABLE_PUBLIC_API_ADAPTERS=false falls back to mock", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "false";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name);
      expect(names).toEqual(["mock"]);
    } finally {
      await registry.shutdown();
    }
  });

  it("unknown exchange names in ENABLED_EXCHANGES are silently dropped", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance,unknown_one,coinbase";
    const env = loadEnv();
    const registry = new AdapterRegistry(env);
    await registry.init();
    try {
      const names = registry.all().map((a) => a.name).sort();
      expect(names).toEqual(["binance", "coinbase"]);
    } finally {
      await registry.shutdown();
    }
  });
});
