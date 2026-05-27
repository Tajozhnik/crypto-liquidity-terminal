import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer, shutdownContext } from "../server.js";

const ENV_KEYS = [
  "USE_MOCK_DATA",
  "ENABLE_TEST_FIXTURES",
  "ENABLE_PUBLIC_API_ADAPTERS",
  "ENABLED_EXCHANGES",
];

function resetEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  resetEnv();
  process.env.LOG_LEVEL = "error";
});
afterEach(() => {
  resetEnv();
});

describe("/readiness mode field", () => {
  it("reports mode=live when USE_MOCK_DATA=false and public adapters enabled", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance";
    const ctx = await buildServer({ startJobs: false });
    try {
      const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      expect(body.mode).toBe("live");
      expect(body.mockEnabled).toBe(false);
      expect(body.publicAdaptersEnabled).toBe(true);
    } finally {
      await shutdownContext(ctx);
    }
  });

  it("reports mode=mock when only mock is enabled", async () => {
    process.env.USE_MOCK_DATA = "true";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "false";
    const ctx = await buildServer({ startJobs: false });
    try {
      const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      expect(body.mode).toBe("mock");
      expect(body.mockEnabled).toBe(true);
      expect(body.publicAdaptersEnabled).toBe(false);
    } finally {
      await shutdownContext(ctx);
    }
  });

  it("reports mode=hybrid when both enabled", async () => {
    process.env.USE_MOCK_DATA = "true";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "true";
    process.env.ENABLED_EXCHANGES = "binance";
    const ctx = await buildServer({ startJobs: false });
    try {
      const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      expect(body.mode).toBe("hybrid");
      expect(body.mockEnabled).toBe(true);
      expect(body.publicAdaptersEnabled).toBe(true);
    } finally {
      await shutdownContext(ctx);
    }
  });
});


describe("/readiness mode reflects the registry, not env (B-017)", () => {
  it("safety-net case (USE_MOCK_DATA=false, ENABLE_PUBLIC_API_ADAPTERS=false) still reports mode=mock", async () => {
    process.env.USE_MOCK_DATA = "false";
    process.env.ENABLE_PUBLIC_API_ADAPTERS = "false";
    const ctx = await buildServer({ startJobs: false });
    try {
      const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      // The registry falls back to mock when the env disables both — readiness
      // must report the truth (`mode=mock`), not the env intention (`live`).
      expect(body.mode).toBe("mock");
      expect(body.mockEnabled).toBe(true);
      expect(body.exchangeAdapters.map((a: { name: string }) => a.name)).toEqual(["mock"]);
    } finally {
      await shutdownContext(ctx);
    }
  });
});
