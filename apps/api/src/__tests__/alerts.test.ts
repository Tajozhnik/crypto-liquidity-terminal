import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, teardownTestContext } from "./helpers.js";

describe("alerts CRUD", () => {
  let ctx: AppContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("POST /alerts valid futures SIGNAL_SCORE returns 201", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/alerts",
      headers: { "content-type": "application/json" },
      payload: {
        symbol: "BTCUSDT",
        exchange: "mock",
        marketType: "futures",
        conditionType: "SIGNAL_SCORE",
        operator: ">",
        threshold: 70,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.cooldownSeconds).toBe(300); // default
    expect(body.lastTriggeredAt).toBeNull();
  });

  it("POST /alerts FUNDING_RATE on spot returns 400 with validation_error", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/alerts",
      headers: { "content-type": "application/json" },
      payload: {
        symbol: "BTCUSDT",
        exchange: "mock",
        marketType: "spot",
        conditionType: "FUNDING_RATE",
        operator: ">",
        threshold: 0.01,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("validation_error");
    expect(body.statusCode).toBe(400);
    expect(body.details).toBeDefined();
  });

  it("POST /alerts OPEN_INTEREST on spot returns 400", async () => {
    const res = await ctx.fastify.inject({
      method: "POST",
      url: "/alerts",
      headers: { "content-type": "application/json" },
      payload: {
        symbol: "BTCUSDT",
        exchange: "mock",
        marketType: "spot",
        conditionType: "OPEN_INTEREST",
        operator: ">",
        threshold: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });

  it("PATCH /alerts/:id enabled=false then enabled=true resets lastTriggeredAt", async () => {
    // Create
    const created = await ctx.fastify.inject({
      method: "POST",
      url: "/alerts",
      headers: { "content-type": "application/json" },
      payload: {
        symbol: "ETHUSDT",
        exchange: "mock",
        marketType: "futures",
        conditionType: "PRICE_CHANGE_5M",
        operator: ">",
        threshold: 1,
      },
    });
    const id = created.json().id as string;

    // Manually set lastTriggeredAt to simulate firing
    const before = new Date().toISOString();
    await ctx.fastify.inject({
      method: "PATCH",
      url: `/alerts/${id}`,
      headers: { "content-type": "application/json" },
      payload: { enabled: false },
    });
    // Force a lastTriggeredAt via store (since we just patched without firing)
    await import("../state/AlertStore.js").then(({ alertStore }) =>
      alertStore.setLastTriggered(id, before),
    );

    // Re-enable
    const reEnabled = await ctx.fastify.inject({
      method: "PATCH",
      url: `/alerts/${id}`,
      headers: { "content-type": "application/json" },
      payload: { enabled: true },
    });
    expect(reEnabled.statusCode).toBe(200);
    const body = reEnabled.json();
    expect(body.enabled).toBe(true);
    expect(body.lastTriggeredAt).toBeNull();
  });

  it("DELETE /alerts/:id returns 204; subsequent GET returns 404", async () => {
    const created = await ctx.fastify.inject({
      method: "POST",
      url: "/alerts",
      headers: { "content-type": "application/json" },
      payload: {
        symbol: "SOLUSDT",
        exchange: "mock",
        marketType: "spot",
        conditionType: "PRICE_CHANGE_5M",
        operator: ">",
        threshold: 5,
      },
    });
    const id = created.json().id as string;

    const del = await ctx.fastify.inject({ method: "DELETE", url: `/alerts/${id}` });
    expect(del.statusCode).toBe(204);

    const fetched = await ctx.fastify.inject({ method: "GET", url: `/alerts/${id}` });
    expect(fetched.statusCode).toBe(404);
  });

  it("GET /alert-events returns array", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/alert-events" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
