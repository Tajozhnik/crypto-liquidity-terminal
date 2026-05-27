import type { Env } from "../config/env.js";
import { logger } from "../logger.js";
import { BinanceAdapter } from "./BinanceAdapter.js";
import { BybitAdapter } from "./BybitAdapter.js";
import { CoinbaseAdapter } from "./CoinbaseAdapter.js";
import type { ExchangeAdapter } from "./ExchangeAdapter.js";
import { KrakenAdapter } from "./KrakenAdapter.js";
import { MockExchangeAdapter } from "./MockExchangeAdapter.js";
import { OkxAdapter } from "./OkxAdapter.js";

const FACTORIES: Record<string, (deps: { ttlSeconds: number; timeoutMs: number }) => ExchangeAdapter> = {
  binance: (d) => new BinanceAdapter(d),
  bybit: (d) => new BybitAdapter(d),
  okx: (d) => new OkxAdapter(d),
  coinbase: (d) => new CoinbaseAdapter(d),
  kraken: (d) => new KrakenAdapter(d),
};

/**
 * Constructs the active set of ExchangeAdapter instances based on env policy.
 *
 * Default policy (no-subscription, live-first):
 *  - USE_MOCK_DATA=false (default): MockExchangeAdapter is NOT constructed.
 *    Set USE_MOCK_DATA=true (or ENABLE_TEST_FIXTURES=true) to enable it for
 *    tests/dev.
 *  - ENABLE_PUBLIC_API_ADAPTERS=true (default): public-API adapters listed in
 *    ENABLED_EXCHANGES are constructed and connected.
 *  - DISABLE_PAID_PROVIDERS=true (default): no paid providers are constructed.
 *  - MARKET_METADATA_PROVIDER="none": metadata adapter is omitted.
 *
 * Safety net: if both flags resolve to "no adapters", the registry falls back
 * to the mock adapter so the app is never empty.
 */
export class AdapterRegistry {
  private adapters: ExchangeAdapter[] = [];

  constructor(private readonly env: Env) {}

  async init(): Promise<void> {
    const deps = {
      ttlSeconds: this.env.EXTERNAL_API_CACHE_TTL_SECONDS,
      timeoutMs: this.env.EXTERNAL_API_TIMEOUT_MS,
    };

    if (this.env.USE_MOCK_DATA || this.env.ENABLE_TEST_FIXTURES) {
      const mock = new MockExchangeAdapter(
        this.env.MOCK_MARKET_COUNT,
        this.env.MOCK_SEED,
        this.env.MOCK_UPDATE_INTERVAL_MS,
      );
      await mock.connect();
      this.adapters.push(mock);
    }

    if (this.env.ENABLE_PUBLIC_API_ADAPTERS) {
      // Connect public adapters in parallel; failures are logged inside the adapter.
      const enabled = new Set(this.env.ENABLED_EXCHANGES);
      const constructed: ExchangeAdapter[] = [];
      for (const name of enabled) {
        const factory = FACTORIES[name];
        if (factory) constructed.push(factory(deps));
      }
      await Promise.all(
        constructed.map((a) =>
          a.connect().catch((err) => logger.warn({ err: (err as Error).message, adapter: a.name }, "adapter connect failed")),
        ),
      );
      this.adapters.push(...constructed);
    }

    if (this.adapters.length === 0) {
      logger.warn("No adapters enabled; falling back to mock");
      const mock = new MockExchangeAdapter(
        this.env.MOCK_MARKET_COUNT,
        this.env.MOCK_SEED,
        this.env.MOCK_UPDATE_INTERVAL_MS,
      );
      await mock.connect();
      this.adapters.push(mock);
    }

    if (this.env.DISABLE_PAID_PROVIDERS) {
      logger.info("Paid providers disabled (DISABLE_PAID_PROVIDERS=true)");
    }
    if (this.env.MARKET_METADATA_PROVIDER === "none") {
      logger.info("Market metadata provider: none (market cap data unavailable)");
    }
  }

  all(): ExchangeAdapter[] {
    return this.adapters;
  }

  /** Public-API adapters only (excludes mock). */
  publicAdapters(): ExchangeAdapter[] {
    return this.adapters.filter((a) => a.name !== "mock");
  }

  primary(): ExchangeAdapter {
    const a = this.adapters[0];
    if (!a) throw new Error("No adapter registered");
    return a;
  }

  byName(name: string): ExchangeAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.adapters.map((a) => a.disconnect()));
    this.adapters = [];
  }
}
