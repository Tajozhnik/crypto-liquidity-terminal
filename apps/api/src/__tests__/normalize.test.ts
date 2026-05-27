import { describe, expect, it } from "vitest";
import {
  normalizeBaseAsset,
  normalizeExchangeSymbol,
  normalizeMarketType,
  normalizeQuoteAsset,
  splitConcatenated,
  toExchangeSymbol,
} from "../adapters/normalize.js";

describe("normalize: assets and types", () => {
  it("uppercases base and quote and aliases XBT→BTC", () => {
    expect(normalizeBaseAsset("xbt")).toBe("BTC");
    expect(normalizeQuoteAsset("usd")).toBe("USD");
  });
  it("maps perp/swap/futures to futures, default spot", () => {
    expect(normalizeMarketType("perp")).toBe("futures");
    expect(normalizeMarketType("SWAP")).toBe("futures");
    expect(normalizeMarketType("linear")).toBe("futures");
    expect(normalizeMarketType("spot")).toBe("spot");
    expect(normalizeMarketType("anything-else")).toBe("spot");
  });
});

describe("splitConcatenated", () => {
  it("splits major USDT pairs", () => {
    expect(splitConcatenated("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitConcatenated("ETHUSDT")).toEqual({ base: "ETH", quote: "USDT" });
  });
  it("splits BTC pairs and EUR pairs", () => {
    expect(splitConcatenated("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(splitConcatenated("BTCEUR")).toEqual({ base: "BTC", quote: "EUR" });
  });
  it("returns null on garbage", () => {
    expect(splitConcatenated("NOTAPAIR")).toBeNull();
    expect(splitConcatenated("")).toBeNull();
  });
});

describe("normalizeExchangeSymbol — per exchange", () => {
  it("binance / bybit / mock: concatenated", () => {
    expect(normalizeExchangeSymbol("binance", "btcusdt")).toEqual({
      internalSymbol: "BTCUSDT",
      base: "BTC",
      quote: "USDT",
    });
    expect(normalizeExchangeSymbol("bybit", "BTCUSDT")?.internalSymbol).toBe("BTCUSDT");
    expect(normalizeExchangeSymbol("mock", "ETHUSDT")?.internalSymbol).toBe("ETHUSDT");
  });

  it("okx: BTC-USDT spot and BTC-USDT-SWAP futures both normalize to BTCUSDT", () => {
    expect(normalizeExchangeSymbol("okx", "BTC-USDT")?.internalSymbol).toBe("BTCUSDT");
    expect(normalizeExchangeSymbol("okx", "BTC-USDT-SWAP")?.internalSymbol).toBe("BTCUSDT");
  });

  it("coinbase: BTC-USD", () => {
    expect(normalizeExchangeSymbol("coinbase", "BTC-USD")?.internalSymbol).toBe("BTCUSD");
  });

  it("kraken: XBTUSD aliases to BTCUSD; XXBTZUSD stripped", () => {
    expect(normalizeExchangeSymbol("kraken", "XBTUSD")?.internalSymbol).toBe("BTCUSD");
    expect(normalizeExchangeSymbol("kraken", "XXBTZUSD")?.internalSymbol).toBe("BTCUSD");
    expect(normalizeExchangeSymbol("kraken", "ETHUSD")?.internalSymbol).toBe("ETHUSD");
  });

  it("returns null on unparseable input", () => {
    expect(normalizeExchangeSymbol("okx", "BAD")).toBeNull();
    expect(normalizeExchangeSymbol("coinbase", "BAD")).toBeNull();
    expect(normalizeExchangeSymbol("binance", "")).toBeNull();
  });
});

describe("toExchangeSymbol — round trip", () => {
  it("binance / bybit / mock: concatenated", () => {
    expect(toExchangeSymbol("binance", "BTCUSDT", "spot")).toBe("BTCUSDT");
    expect(toExchangeSymbol("bybit", "ETHUSDT", "futures")).toBe("ETHUSDT");
  });
  it("okx: BTC-USDT for spot, BTC-USDT-SWAP for futures", () => {
    expect(toExchangeSymbol("okx", "BTCUSDT", "spot")).toBe("BTC-USDT");
    expect(toExchangeSymbol("okx", "BTCUSDT", "futures")).toBe("BTC-USDT-SWAP");
  });
  it("coinbase: BTC-USD", () => {
    expect(toExchangeSymbol("coinbase", "BTCUSD", "spot")).toBe("BTC-USD");
  });
  it("kraken: BTC → XBT prefix", () => {
    expect(toExchangeSymbol("kraken", "BTCUSD", "spot")).toBe("XBTUSD");
    expect(toExchangeSymbol("kraken", "ETHUSD", "spot")).toBe("ETHUSD");
  });
  it("returns null on unparseable internal symbol", () => {
    expect(toExchangeSymbol("binance", "GIBBERISH", "spot")).toBeNull();
  });
});


describe("Kraken normalize: legacy Z-prefix only mangles known quotes (B-018)", () => {
  it("does not mangle XTZUSD (Tezos) — the trailing Z must survive", () => {
    const r = normalizeExchangeSymbol("kraken", "XTZUSD");
    expect(r?.internalSymbol).toBe("XTZUSD");
  });

  it("XBTZUSD legacy form still strips correctly", () => {
    expect(normalizeExchangeSymbol("kraken", "XBTZUSD")?.internalSymbol).toBe("BTCUSD");
  });

  it("XETHZEUR legacy form strips Z to ETHEUR", () => {
    // Kraken legacy form for ETH/EUR is `XETHZEUR`. The X-prefix on the base
    // unambiguously marks this as legacy, so the Z-strip applies.
    expect(normalizeExchangeSymbol("kraken", "XETHZEUR")?.internalSymbol).toBe("ETHEUR");
  });

  it("ZECUSD (Zcash) is not mangled", () => {
    expect(normalizeExchangeSymbol("kraken", "ZECUSD")?.internalSymbol).toBe("ZECUSD");
  });
});
