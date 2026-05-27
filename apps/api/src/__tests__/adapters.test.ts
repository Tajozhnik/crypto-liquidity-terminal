import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinanceAdapter } from "../adapters/BinanceAdapter.js";
import { BybitAdapter } from "../adapters/BybitAdapter.js";
import { CoinbaseAdapter } from "../adapters/CoinbaseAdapter.js";
import { KrakenAdapter } from "../adapters/KrakenAdapter.js";
import { OkxAdapter } from "../adapters/OkxAdapter.js";
import { _resetPublicFetchState } from "../adapters/publicFetch.js";

const deps = { ttlSeconds: 30, timeoutMs: 1000 };

beforeEach(() => {
  _resetPublicFetchState();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetPublicFetchState();
});

const stubFetch = (impl: (url: string) => Response | Promise<Response>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      return impl(url);
    }),
  );
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe("BinanceAdapter", () => {
  it("does not require API keys (no Authorization header in fetch calls)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return ok({});
      }),
    );
    const a = new BinanceAdapter(deps);
    await a.connect();
    expect(a.isConnected()).toBe(true);
    for (const c of calls) {
      const headers = (c.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization ?? headers.authorization).toBeUndefined();
    }
  });

  it("network failure does not throw and leaves adapter degraded", async () => {
    stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    const a = new BinanceAdapter(deps);
    await a.connect();
    expect(a.isConnected()).toBe(false);
    expect(a.health().status).toBe("degraded");
  });

  it("429 from upstream returns null and triggers backoff (no throw)", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    });
    const a = new BinanceAdapter(deps);
    await a.connect();
    const t = await a.getTicker("BTCUSDT");
    expect(t).toBeNull();
    // Backoff suppresses the second call
    const t2 = await a.getTicker("BTCUSDT");
    expect(t2).toBeNull();
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("getMarkets parses real-shaped exchangeInfo response", async () => {
    stubFetch((url) => {
      if (url.includes("/ping")) return ok({});
      if (url.includes("/exchangeInfo")) {
        return ok({
          symbols: [
            { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
            { symbol: "ETHBTC", baseAsset: "ETH", quoteAsset: "BTC", status: "TRADING" }, // filtered out
          ],
        });
      }
      return ok({});
    });
    const a = new BinanceAdapter(deps);
    await a.connect();
    const markets = await a.getMarkets();
    expect(markets.length).toBe(1);
    expect(markets[0]!.symbol).toBe("BTCUSDT");
    expect(markets[0]!.exchange).toBe("binance");
  });
});

describe("BybitAdapter", () => {
  it("connects and parses spot tickers; returns futures metrics from linear category", async () => {
    stubFetch((url) => {
      if (url.includes("/v5/market/time")) return ok({ retCode: 0 });
      if (url.includes("/v5/market/instruments-info")) {
        return ok({
          retCode: 0,
          result: {
            list: [
              { symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" },
              { symbol: "ETHUSDT", baseCoin: "ETH", quoteCoin: "USDT", status: "Trading" },
            ],
          },
        });
      }
      if (url.includes("category=spot") && url.includes("/tickers")) {
        return ok({
          result: {
            list: [
              {
                symbol: "BTCUSDT",
                lastPrice: "60000",
                bid1Price: "59999",
                ask1Price: "60001",
                volume24h: "1000",
                turnover24h: "60000000",
                price24hPcnt: "0.012",
              },
            ],
          },
        });
      }
      if (url.includes("category=linear") && url.includes("/tickers")) {
        return ok({
          result: {
            list: [
              {
                symbol: "BTCUSDT",
                openInterest: "12345",
                fundingRate: "0.0001",
                nextFundingTime: "1700000000000",
              },
            ],
          },
        });
      }
      return ok({});
    });
    const a = new BybitAdapter(deps);
    await a.connect();
    expect(a.isConnected()).toBe(true);
    const markets = await a.getMarkets();
    expect(markets.length).toBe(2);
    const t = await a.getTicker("BTCUSDT");
    expect(t?.last).toBe(60000);
    expect(t?.change24h).toBeCloseTo(1.2);
    const f = await a.getFuturesMetrics("BTCUSDT");
    expect(f?.openInterest).toBe(12345);
    expect(f?.fundingRate).toBe(0.0001);
  });
});

describe("OkxAdapter", () => {
  it("normalizes BTC-USDT for spot and BTC-USDT-SWAP for futures", async () => {
    const seenUrls: string[] = [];
    stubFetch((url) => {
      seenUrls.push(url);
      if (url.includes("/public/time")) return ok({ code: "0" });
      if (url.includes("/public/instruments")) {
        return ok({
          code: "0",
          data: [
            { instId: "BTC-USDT", baseCcy: "BTC", quoteCcy: "USDT", state: "live", instType: "SPOT" },
          ],
        });
      }
      if (url.includes("/market/ticker")) {
        return ok({
          data: [{ instId: "BTC-USDT", last: "60000", bidPx: "59999", askPx: "60001", vol24h: "10", volCcy24h: "600000", open24h: "59000" }],
        });
      }
      if (url.includes("/public/open-interest")) {
        return ok({ data: [{ instId: "BTC-USDT-SWAP", oi: "100", oiCcy: "100" }] });
      }
      if (url.includes("/public/funding-rate")) {
        return ok({ data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001", nextFundingTime: "1700000000000" }] });
      }
      return ok({});
    });
    const a = new OkxAdapter(deps);
    await a.connect();
    const t = await a.getTicker("BTCUSDT");
    expect(t?.last).toBe(60000);
    const f = await a.getFuturesMetrics("BTCUSDT");
    expect(f?.openInterest).toBe(100);
    expect(seenUrls.some((u) => u.includes("BTC-USDT-SWAP"))).toBe(true);
  });
});

describe("CoinbaseAdapter", () => {
  it("is spot-only and getFuturesMetrics returns null without making a request", async () => {
    stubFetch((url) => {
      if (url.endsWith("/time")) return ok({ iso: new Date().toISOString() });
      if (url.endsWith("/products")) {
        return ok([
          { id: "BTC-USD", base_currency: "BTC", quote_currency: "USD", status: "online" },
          { id: "ETH-USD", base_currency: "ETH", quote_currency: "USD", status: "online" },
        ]);
      }
      return ok({});
    });
    const a = new CoinbaseAdapter(deps);
    await a.connect();
    expect(a.marketTypes).toEqual(["spot"]);
    const markets = await a.getMarkets();
    expect(markets[0]!.symbol).toBe("BTCUSD");
    const f = await a.getFuturesMetrics("BTCUSD");
    expect(f).toBeNull();
  });
});

describe("KrakenAdapter", () => {
  it("normalizes XBT to BTC and is spot-only for futures metrics", async () => {
    stubFetch((url) => {
      if (url.endsWith("/public/Time")) return ok({ result: { unixtime: 1 } });
      if (url.includes("/AssetPairs")) {
        return ok({
          result: {
            XXBTZUSD: { altname: "XBTUSD", wsname: "XBT/USD", base: "XXBT", quote: "ZUSD", status: "online" },
          },
        });
      }
      return ok({});
    });
    const a = new KrakenAdapter(deps);
    await a.connect();
    const markets = await a.getMarkets();
    expect(markets.length).toBeGreaterThan(0);
    expect(markets[0]!.symbol).toBe("BTCUSD");
    const f = await a.getFuturesMetrics("BTCUSD");
    expect(f).toBeNull();
  });
});

describe("Adapter constructor does not require API keys (env)", () => {
  it("none of the adapters read API key env vars at construction", () => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BYBIT_API_KEY;
    delete process.env.OKX_API_KEY;
    delete process.env.COINBASE_API_KEY;
    delete process.env.KRAKEN_API_KEY;
    expect(() => new BinanceAdapter(deps)).not.toThrow();
    expect(() => new BybitAdapter(deps)).not.toThrow();
    expect(() => new OkxAdapter(deps)).not.toThrow();
    expect(() => new CoinbaseAdapter(deps)).not.toThrow();
    expect(() => new KrakenAdapter(deps)).not.toThrow();
  });
});


describe("Bybit / OKX kline closeTime tracks the requested interval (B-002)", () => {
  it("Bybit 5m kline → closeTime = openTime + 300 000 ms", async () => {
    const t0 = 1_700_000_000_000;
    stubFetch((url) => {
      if (url.includes("/v5/market/time")) return ok({ retCode: 0 });
      if (url.includes("/v5/market/kline")) {
        // Bybit returns rows newest-first as [ts, o, h, l, c, vol, turnover]
        return ok({
          result: {
            list: [
              [String(t0 + 300_000), "100", "110", "95", "108", "5", "500"],
              [String(t0), "95", "105", "92", "100", "4", "400"],
            ],
          },
        });
      }
      return ok({});
    });
    const a = new BybitAdapter(deps);
    await a.connect();
    const klines = await a.getKlines("BTCUSDT", "5m", 100);
    expect(klines.length).toBe(2);
    for (const k of klines) {
      const span = Date.parse(k.closeTime) - Date.parse(k.openTime);
      expect(span).toBe(300_000);
    }
  });

  it("Bybit 15m kline → closeTime = openTime + 900 000 ms", async () => {
    const t0 = 1_700_000_000_000;
    stubFetch((url) => {
      if (url.includes("/v5/market/time")) return ok({ retCode: 0 });
      if (url.includes("/v5/market/kline")) {
        return ok({ result: { list: [[String(t0), "100", "110", "95", "108", "5", "500"]] } });
      }
      return ok({});
    });
    const a = new BybitAdapter(deps);
    await a.connect();
    const klines = await a.getKlines("BTCUSDT", "15m", 100);
    expect(Date.parse(klines[0]!.closeTime) - Date.parse(klines[0]!.openTime)).toBe(900_000);
  });

  it("OKX 5m kline → closeTime = openTime + 300 000 ms", async () => {
    const t0 = 1_700_000_000_000;
    stubFetch((url) => {
      if (url.includes("/api/v5/public/time")) return ok({ code: "0" });
      if (url.includes("/api/v5/market/candles")) {
        return ok({
          data: [
            [String(t0 + 300_000), "100", "110", "95", "108", "5", "500"],
            [String(t0), "95", "105", "92", "100", "4", "400"],
          ],
        });
      }
      return ok({});
    });
    const a = new OkxAdapter(deps);
    await a.connect();
    const klines = await a.getKlines("BTCUSDT", "5m", 100);
    expect(klines.length).toBe(2);
    for (const k of klines) {
      expect(Date.parse(k.closeTime) - Date.parse(k.openTime)).toBe(300_000);
    }
  });

  it("OKX 1h kline → closeTime = openTime + 3 600 000 ms", async () => {
    const t0 = 1_700_000_000_000;
    stubFetch((url) => {
      if (url.includes("/api/v5/public/time")) return ok({ code: "0" });
      if (url.includes("/api/v5/market/candles")) {
        return ok({ data: [[String(t0), "100", "110", "95", "108", "5", "500"]] });
      }
      return ok({});
    });
    const a = new OkxAdapter(deps);
    await a.connect();
    const klines = await a.getKlines("BTCUSDT", "1h", 100);
    expect(Date.parse(klines[0]!.closeTime) - Date.parse(klines[0]!.openTime)).toBe(3_600_000);
  });
});
