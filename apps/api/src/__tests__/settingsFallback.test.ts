import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, teardownTestContext } from "./helpers.js";

describe("settings fallback when DB is unavailable", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("GET /settings returns defaults with storage=memory when DB down", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.storage).toBe("memory");
    expect(body.persisted).toBe(false);
    expect(body.defaultExchange).toBeDefined();
  });

  it("PATCH /settings returns 200 with storage=memory and persists in-memory across reads", async () => {
    const a = await ctx.fastify.inject({
      method: "PATCH",
      url: "/settings",
      headers: { "content-type": "application/json" },
      payload: { defaultExchange: "binance", defaultMarketType: "futures" },
    });
    expect(a.statusCode).toBe(200);
    const aBody = a.json();
    expect(aBody.storage).toBe("memory");
    expect(aBody.persisted).toBe(false);
    expect(aBody.defaultExchange).toBe("binance");
    expect(aBody.warning).toMatch(/database unavailable/i);

    const b = await ctx.fastify.inject({ method: "GET", url: "/settings" });
    const bBody = b.json();
    expect(bBody.defaultExchange).toBe("binance");
    expect(bBody.defaultMarketType).toBe("futures");
  });
});
