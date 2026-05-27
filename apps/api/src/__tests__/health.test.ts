import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../server.js";
import { buildTestContext, teardownTestContext } from "./helpers.js";

describe("health & readiness", () => {
  let ctx: AppContext;
  beforeEach(async () => {
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("GET /health returns ok with serverTime", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
  });

  it("GET /readiness reports degraded when DB/Redis unavailable", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.db).toBe("unavailable");
    expect(body.redis).toBe("fallback");
    expect(Array.isArray(body.exchangeAdapters)).toBe(true);
  });
});
