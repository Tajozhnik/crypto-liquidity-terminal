import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, makeResult, teardownTestContext } from "./helpers.js";

describe("screener routes", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
    ctx.store.setSnapshots([
      makeResult({ symbol: "BTCUSDT", marketType: "futures", signalScore: 90, volume24h: 200_000_000 }),
      makeResult({
        symbol: "ETHUSDT",
        marketType: "spot",
        signalScore: 30,
        volume24h: 5_000_000,
        activeSignals: [],
        openInterest: null,
        fundingRate: null,
      }),
      makeResult({ symbol: "SOLUSDT", marketType: "futures", signalScore: 65, volume24h: 50_000_000 }),
    ]);
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("GET /screener with marketType filter returns only futures", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/screener?marketType=futures",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(2);
    expect(body.every((r: { marketType: string }) => r.marketType === "futures")).toBe(true);
  });

  it("GET /screener with minSignalScore=70 returns 1", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/screener?minSignalScore=70",
    });
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].symbol).toBe("BTCUSDT");
  });

  it("POST /screener/query body filter equals GET /screener result shape", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/screener/query",
      headers: { "content-type": "application/json" },
      payload: { marketType: ["futures"], minVolume24h: 100_000_000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].symbol).toBe("BTCUSDT");
  });

  it("hasActiveSignal=true filters out empty-signal rows", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/screener/query",
      payload: { hasActiveSignal: true },
      headers: { "content-type": "application/json" },
    });
    const body = res.json();
    expect(body.every((r: { activeSignals: string[] }) => r.activeSignals.length > 0)).toBe(true);
  });
});

describe("screener routes — string-column sort (I-008)", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
    ctx.store.setSnapshots([
      makeResult({ symbol: "ETHUSDT", marketType: "spot" }),
      makeResult({ symbol: "BTCUSDT", marketType: "futures" }),
      makeResult({ symbol: "SOLUSDT", marketType: "futures" }),
    ]);
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("sortColumn=symbol&sortDirection=asc returns alphabetical order", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/screener?sortColumn=symbol&sortDirection=asc",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { symbol: string }[];
    expect(body.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("sortColumn=symbol&sortDirection=desc returns reverse alphabetical", async () => {
    const res = await ctx.fastify.inject({
      method: "GET",
      url: "/screener?sortColumn=symbol&sortDirection=desc",
    });
    const body = res.json() as { symbol: string }[];
    expect(body.map((r) => r.symbol)).toEqual(["SOLUSDT", "ETHUSDT", "BTCUSDT"]);
  });
});
