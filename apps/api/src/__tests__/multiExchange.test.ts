import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, makeResult, teardownTestContext } from "./helpers.js";

describe("multi-exchange aggregation", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("BTCUSDT on binance and BTCUSDT on bybit do not collide in the store", () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance", price: 60000 }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit", price: 60100 }));
    expect(ctx.store.size()).toBe(2);
    expect(ctx.store.getByKey("binance", "futures", "BTCUSDT")?.price).toBe(60000);
    expect(ctx.store.getByKey("bybit", "futures", "BTCUSDT")?.price).toBe(60100);
  });

  it("/markets returns rows from multiple exchanges", async () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance" }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit" }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSD", exchange: "coinbase", marketType: "spot", openInterest: null, fundingRate: null }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSD", exchange: "kraken", marketType: "spot", openInterest: null, fundingRate: null }));
    const res = await ctx.fastify.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(4);
    const names = body.map((r: { exchange: string }) => r.exchange).sort();
    expect(names).toEqual(["binance", "bybit", "coinbase", "kraken"]);
  });

  it("screener exchange filter actually narrows by exchange", async () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance" }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit" }));
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/screener/query",
      headers: { "content-type": "application/json" },
      payload: { exchange: ["binance"] },
    });
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].exchange).toBe("binance");
  });

  it("readiness reports per-adapter status with marketTypes", async () => {
    const fresh = await (await import("../server.js")).buildServer({ startJobs: false });
    try {
      const res = await fresh.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      const mock = body.exchangeAdapters.find((a: { name: string }) => a.name === "mock");
      expect(mock).toBeDefined();
      expect(mock.marketTypes).toEqual(["spot", "futures"]);
      // Each adapter has the new fields
      for (const a of body.exchangeAdapters) {
        expect(a.status).toBeDefined();
        expect(a.enabled).toBeDefined();
        expect("lastSuccessAt" in a).toBe(true);
        expect("lastErrorAt" in a).toBe(true);
      }
    } finally {
      await (await import("../server.js")).shutdownContext(fresh);
    }
  });
});


describe("MarketDataStore.get with explicit exchange/marketType (B-003)", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("strict lookup disambiguates BTCUSDT across binance and bybit", () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance", price: 60000 }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit", price: 60100 }));
    expect(ctx.store.get("BTCUSDT", "binance", "futures")?.price).toBe(60000);
    expect(ctx.store.get("BTCUSDT", "bybit", "futures")?.price).toBe(60100);
  });

  it("legacy single-arg lookup returns one of the two (no guarantee which)", () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance", price: 60000 }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit", price: 60100 }));
    const r = ctx.store.get("BTCUSDT");
    expect(r).toBeDefined();
    // either 60000 or 60100 — order depends on Map insertion semantics
    expect([60000, 60100]).toContain(r!.price);
  });

  it("/markets/:symbol?exchange=bybit returns bybit row even when binance is also present", async () => {
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "binance", price: 60000 }));
    ctx.store.setSnapshot(makeResult({ symbol: "BTCUSDT", exchange: "bybit", price: 60100 }));
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/markets/BTCUSDT?exchange=bybit&marketType=futures",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().exchange).toBe("bybit");
    expect(res.json().price).toBe(60100);
  });
});
