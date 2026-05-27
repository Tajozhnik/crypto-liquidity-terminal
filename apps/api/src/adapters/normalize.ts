import type { ExchangeName, MarketType } from "@screener/shared";

/**
 * Internal symbol convention: BASE + QUOTE concatenated, uppercase, no separator.
 * Examples: BTCUSDT, ETHUSD, BTCEUR, BTCUSDC.
 *
 * Each adapter has helpers to convert to/from its native symbol format.
 */

const QUOTE_ALIASES: Record<string, string> = {
  XBT: "BTC", // Kraken historical alias
  USD: "USD",
  USDT: "USDT",
  USDC: "USDC",
  EUR: "EUR",
  BTC: "BTC",
  ETH: "ETH",
};

/** Common quote assets we look for when splitting BASE+QUOTE strings. */
const KNOWN_QUOTES = ["USDT", "USDC", "USDD", "TUSD", "FDUSD", "BUSD", "USD", "EUR", "BTC", "ETH", "BNB", "DAI"];

export function normalizeBaseAsset(raw: string): string {
  const u = raw.toUpperCase();
  return QUOTE_ALIASES[u] ?? u;
}
export function normalizeQuoteAsset(raw: string): string {
  return normalizeBaseAsset(raw);
}
export function normalizeMarketType(raw: string): MarketType {
  const u = raw.toLowerCase();
  if (["futures", "perp", "swap", "perpetual", "linear", "inverse"].includes(u)) return "futures";
  return "spot";
}

/**
 * Try to split a concatenated symbol like "BTCUSDT" into base/quote, using a
 * known-quote suffix list. Returns null if no quote matches.
 */
export function splitConcatenated(symbol: string): { base: string; quote: string } | null {
  const u = symbol.toUpperCase();
  for (const q of KNOWN_QUOTES) {
    if (u.endsWith(q) && u.length > q.length) {
      return { base: normalizeBaseAsset(u.slice(0, -q.length)), quote: normalizeQuoteAsset(q) };
    }
  }
  return null;
}

/**
 * Normalize an exchange-native symbol into our internal BASEQUOTE form.
 * Returns null if the symbol cannot be parsed safely.
 */
export function normalizeExchangeSymbol(
  exchange: ExchangeName,
  rawSymbol: string,
): { internalSymbol: string; base: string; quote: string } | null {
  if (!rawSymbol) return null;
  const u = rawSymbol.toUpperCase();

  switch (exchange) {
    case "binance":
    case "bybit":
    case "mock": {
      const parts = splitConcatenated(u);
      if (!parts) return null;
      return { internalSymbol: `${parts.base}${parts.quote}`, ...parts };
    }
    case "okx": {
      // OKX uses "BTC-USDT" or "BTC-USDT-SWAP"
      const segs = u.split("-");
      if (segs.length < 2) return null;
      const base = normalizeBaseAsset(segs[0]!);
      const quote = normalizeQuoteAsset(segs[1]!);
      return { internalSymbol: `${base}${quote}`, base, quote };
    }
    case "coinbase": {
      // Coinbase Exchange uses "BTC-USD"
      const segs = u.split("-");
      if (segs.length !== 2) return null;
      const base = normalizeBaseAsset(segs[0]!);
      const quote = normalizeQuoteAsset(segs[1]!);
      return { internalSymbol: `${base}${quote}`, base, quote };
    }
    case "kraken": {
      // Kraken pairs may look like "XBTUSD", "XXBTZUSD", "BTCUSD". Handle the
      // legacy X/Z prefixes carefully without losing letters from XBT or
      // mangling real tickers that happen to contain `Z` (XTZ Tezos, XEM, …).
      let cleaned = u;
      // Strip leading "XX" only when followed by another asset code (e.g. XXBTZUSD).
      if (cleaned.startsWith("XX")) cleaned = cleaned.slice(1);
      // Strip the middle Z-prefix in the QUOTE half ONLY when we know the
      // remaining base is a legacy X-prefixed asset code. This avoids
      // mangling Tezos (XTZ) or other real tickers that happen to contain `Z`.
      // Examples:
      //   XBTZUSD → XBTUSD       (legacy BTC + ZUSD)
      //   XETHZEUR → XETHEUR     (legacy ETH + ZEUR)
      //   XTZUSD → XTZUSD        (Tezos: NOT mangled)
      //   ZECUSD → ZECUSD        (Zcash: NOT mangled — no leading X)
      cleaned = cleaned.replace(
        /^(X(?:BT|ETH|LTC|XRP|XLM|ZEC|REP|XMR|DG))Z(USD|EUR|GBP|JPY|CAD|AUD|CHF)$/,
        "$1$2",
      );
      // Now alias XBT → BTC and similar X-prefixed legacy assets after Z-strip.
      // Order matters: do XBT first so the `X` is replaced wholesale.
      if (cleaned.startsWith("XBT")) cleaned = `BTC${cleaned.slice(3)}`;
      else if (/^X(ETH|LTC|XRP|XLM|ZEC|REP|XMR)/.test(cleaned)) cleaned = cleaned.slice(1);
      else if (cleaned.startsWith("XDG")) cleaned = `DOGE${cleaned.slice(3)}`;
      const parts = splitConcatenated(cleaned);
      if (!parts) return null;
      return { internalSymbol: `${parts.base}${parts.quote}`, ...parts };
    }
  }
}

/**
 * Convert an internal BASEQUOTE symbol to the exchange's native format.
 * Returns null when the conversion is not unambiguously possible.
 */
export function toExchangeSymbol(
  exchange: ExchangeName,
  internalSymbol: string,
  marketType: MarketType,
): string | null {
  const parts = splitConcatenated(internalSymbol);
  if (!parts) return null;
  const { base, quote } = parts;
  switch (exchange) {
    case "binance":
    case "bybit":
    case "mock":
      return `${base}${quote}`;
    case "okx":
      return marketType === "futures" ? `${base}-${quote}-SWAP` : `${base}-${quote}`;
    case "coinbase":
      return `${base}-${quote}`;
    case "kraken":
      // Use concatenated form (BTCUSD) — modern Kraken REST accepts both.
      return `${base === "BTC" ? "XBT" : base}${quote}`;
  }
}


/**
 * Convert a Binance-style interval string (1m, 5m, 15m, 1h, 4h, 1d, ...) to
 * milliseconds. Used by adapters that don't get an exact close-time in the
 * upstream payload (Bybit / OKX) so they can compute `closeTime = openTime
 * + intervalMs(interval)` accurately on every interval, not just 1m.
 */
export function intervalToMs(interval: string): number {
  const m = /^(\d+)([smhdw])$/i.exec(interval.trim());
  if (!m) return 60_000; // safe fallback
  const n = Number.parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase();
  if (unit === "s") return n * 1_000;
  if (unit === "m") return n * 60_000;
  if (unit === "h") return n * 3_600_000;
  if (unit === "d") return n * 86_400_000;
  if (unit === "w") return n * 7 * 86_400_000;
  return 60_000;
}
