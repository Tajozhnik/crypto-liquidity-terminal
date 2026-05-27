import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../server.js";
import { _resetPublicFetchState, publicFetch } from "../adapters/publicFetch.js";
import { buildTestContext, teardownTestContext } from "./helpers.js";

describe("no-subscription policy", () => {
  let ctx: AppContext;

  beforeEach(async () => {
    // Tests must not require any API keys / paid providers.
    delete process.env.MARKET_METADATA_PROVIDER;
    delete process.env.DISABLE_PAID_PROVIDERS;
    ctx = await buildTestContext();
  });
  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  it("starts without API keys", () => {
    expect(process.env.BINANCE_API_KEY).toBeUndefined();
    expect(process.env.BYBIT_API_KEY).toBeUndefined();
    expect(ctx.fastify).toBeDefined();
  });

  it("readiness reports paidProvidersDisabled=true and marketMetadata=none by default", async () => {
    const res = await ctx.fastify.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.paidProvidersDisabled).toBe(true);
    expect(body.marketMetadata).toBe("none");
  });

  it("readiness exposes the registered adapters with connected flags", async () => {
    // The shared helper shuts the adapter registry down (to stop the mock interval).
    // Build a fresh context that keeps adapters around for this assertion.
    const fresh = await (await import("../server.js")).buildServer({ startJobs: false });
    try {
      const res = await fresh.fastify.inject({ method: "GET", url: "/readiness" });
      const body = res.json();
      expect(Array.isArray(body.exchangeAdapters)).toBe(true);
      const names = body.exchangeAdapters.map((a: { name: string }) => a.name);
      expect(names).toContain("mock");
    } finally {
      await (await import("../server.js")).shutdownContext(fresh);
    }
  });
});

describe("publicFetch backoff & timeout", () => {
  beforeEach(() => {
    _resetPublicFetchState();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetPublicFetchState();
  });

  it("returns null on 429 without throwing and triggers backoff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({}), {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      ),
    );
    const r = await publicFetch<{}>({
      key: "k1",
      url: "https://example.test/",
      ttlSeconds: 30,
      timeoutMs: 1000,
    });
    expect(r).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const r = await publicFetch<{}>({
      key: "k2",
      url: "https://example.test/",
      ttlSeconds: 30,
      timeoutMs: 1000,
    });
    expect(r).toBeNull();
  });

  it("subsequent calls during backoff return null without re-fetching", async () => {
    const stub = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 503 }),
    );
    vi.stubGlobal("fetch", stub);
    await publicFetch<{}>({ key: "k3", url: "https://example.test/", ttlSeconds: 30, timeoutMs: 1000 });
    await publicFetch<{}>({ key: "k3", url: "https://example.test/", ttlSeconds: 30, timeoutMs: 1000 });
    await publicFetch<{}>({ key: "k3", url: "https://example.test/", ttlSeconds: 30, timeoutMs: 1000 });
    // Only the first call hits the network; backoff suppresses the rest.
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("caches successful responses for the TTL window", async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", stub);
    const a = await publicFetch<{ ok: boolean }>({
      key: "k4",
      url: "https://example.test/",
      ttlSeconds: 30,
      timeoutMs: 1000,
    });
    const b = await publicFetch<{ ok: boolean }>({
      key: "k4",
      url: "https://example.test/",
      ttlSeconds: 30,
      timeoutMs: 1000,
    });
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(stub).toHaveBeenCalledTimes(1);
  });
});
