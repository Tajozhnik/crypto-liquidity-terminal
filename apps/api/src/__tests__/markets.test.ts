import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, makeResult, teardownTestContext } from "./helpers.js";

describe("markets routes", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
    ctx.store.setSnapshots([
      makeResult({ symbol: "BTCUSDT" }),
      makeResult({ symbol: "ETHUSDT", marketType: "spot", openInterest: null, fundingRate: null }),
    ]);
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("GET /markets returns the in-memory store", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(2);
    const symbols = body.map((m: { symbol: string }) => m.symbol).sort();
    expect(symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("GET /markets/:symbol 200 for known", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/markets/BTCUSDT" });
    expect(res.statusCode).toBe(200);
    expect(res.json().symbol).toBe("BTCUSDT");
  });

  it("GET /markets/:symbol 404 for unknown", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/markets/UNKNOWN" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("not_found");
    expect(body.statusCode).toBe(404);
  });
});
