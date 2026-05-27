import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeAdapter } from "../adapters/ExchangeAdapter.js";
import { LivePollingJob } from "../jobs/LivePollingJob.js";
import { MarketDataStore } from "../state/MarketDataStore.js";
import { _resetPublicFetchState } from "../adapters/publicFetch.js";
import type { WebSocketHub } from "../ws/WebSocketHub.js";

const cfg = {
  volumeSpike: { timeframe: "5m", relativeVolumeThreshold: 3 },
  pricePump: { timeframe: "5m", thresholdPercent: 2 },
  priceDump: { timeframe: "5m", thresholdPercent: -2 },
  volatilityExpansion: { timeframe: "5m", thresholdMultiplier: 2 },
  spreadWidening: { thresholdPercent: 0.15 },
  orderBookImbalance: { depthLevels: 20, thresholdRatio: 0.65 },
  openInterestSpike: { timeframe: "15m", thresholdPercent: 5 },
  fundingAnomaly: { absoluteThreshold: 0.03 },
  breakout: { lookbackCandles: 20, timeframe: "5m" },
  hotMarket: { scoreThreshold: 81 },
};

function makeFakeHub(): WebSocketHub {
  return {
    queueMarketUpdates: vi.fn(),
    broadcastSignal: vi.fn(),
  } as unknown as WebSocketHub;
}

beforeEach(() => {
  _resetPublicFetchState();
});
afterEach(() => {
  vi.useRealTimers();
});

function makeFakeAdapter(): ExchangeAdapter {
  const ts = (i: number) => new Date(1_700_000_000_000 + i * 60_000).toISOString();
  return {
    name: "binance",
    marketTypes: ["spot", "futures"],
    isConnected: () => true,
    health: () => ({ enabled: true, status: "ok", lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null }),
    connect: async () => {},
    disconnect: async () => {},
    getMarkets: async () => [
      { symbol: "BTCUSDT", exchange: "binance", marketType: "spot", base: "BTC", quote: "USDT" },
      { symbol: "ETHUSDT", exchange: "binance", marketType: "spot", base: "ETH", quote: "USDT" },
    ],
    getTicker: async (s) => ({
      symbol: s,
      last: 100,
      bid: 99.95,
      ask: 100.05,
      volume24h: 1_000_000,
      change24h: 1.2,
      ts: ts(50),
    }),
    getKlines: async () =>
      Array.from({ length: 30 }, (_, i) => ({
        openTime: ts(i),
        closeTime: ts(i + 1),
        open: 100 + i * 0.1,
        high: 101 + i * 0.1,
        low: 99 + i * 0.1,
        close: 100 + i * 0.1,
        volume: 1000,
      })),
    getOrderBook: async (s) => ({
      symbol: s,
      bids: [[99.95, 5]],
      asks: [[100.05, 5]],
      ts: ts(50),
    }),
    getRecentTrades: async () => [],
    getFuturesMetrics: async () => null,
    subscribeTickers: () => () => {},
    subscribeOrderBook: () => () => {},
    subscribeTrades: () => () => {},
  };
}

describe("LivePollingJob", () => {
  it("populates the store with ScreenerResult rows from a public adapter", async () => {
    const store = new MarketDataStore();
    const hub = makeFakeHub();
    const adapter = makeFakeAdapter();
    const job = new LivePollingJob([adapter], store, hub, cfg, 0, 5);
    await (job as unknown as { cycle(): Promise<void> }).cycle();
    expect(store.size()).toBe(2);
    const r = store.getByKey("binance", "spot", "BTCUSDT");
    expect(r).toBeDefined();
    expect(r!.exchange).toBe("binance");
    expect(r!.marketType).toBe("spot");
  });

  it("does not crash if an adapter throws inside getMarkets", async () => {
    const store = new MarketDataStore();
    const hub = makeFakeHub();
    const broken: ExchangeAdapter = {
      ...makeFakeAdapter(),
      getMarkets: async () => {
        throw new Error("boom");
      },
    };
    const job = new LivePollingJob([broken], store, hub, cfg, 0, 5);
    await expect((job as unknown as { cycle(): Promise<void> }).cycle()).resolves.toBeUndefined();
    expect(store.size()).toBe(0);
  });
});
