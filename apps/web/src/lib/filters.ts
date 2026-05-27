import type { ExchangeName, MarketType, ScreenerResult, SignalType } from "@screener/shared";

export interface ScreenerFilters {
  exchange: ExchangeName[];
  marketType: MarketType[];
  quoteAsset: string[];
  symbols: string[];
  signalTypes: SignalType[];
  search: string;
  minVolume24h: number | null;
  minChange5m: number | null;
  minChange5mAbs: number | null;
  minChange15m: number | null;
  minRelativeVolume: number | null;
  minVolatility: number | null;
  maxSpreadPercent: number | null;
  minTradesPerMinute: number | null;
  minSignalScore: number | null;
  minOpenInterestChange15m: number | null;
  hasActiveSignal: boolean;
  watchlistOnly: boolean;
}

export const EMPTY_FILTERS: ScreenerFilters = {
  exchange: [],
  marketType: [],
  quoteAsset: [],
  symbols: [],
  signalTypes: [],
  search: "",
  minVolume24h: null,
  minChange5m: null,
  minChange5mAbs: null,
  minChange15m: null,
  minRelativeVolume: null,
  minVolatility: null,
  maxSpreadPercent: null,
  minTradesPerMinute: null,
  minSignalScore: null,
  minOpenInterestChange15m: null,
  hasActiveSignal: false,
  watchlistOnly: false,
};

export function applyFilters(
  rows: ScreenerResult[],
  f: ScreenerFilters,
  watchlist: Set<string>,
): ScreenerResult[] {
  return rows.filter((r) => {
    if (f.exchange.length && !f.exchange.includes(r.exchange)) return false;
    if (f.marketType.length && !f.marketType.includes(r.marketType)) return false;
    if (f.quoteAsset.length && !f.quoteAsset.includes(r.quoteAsset)) return false;
    if (f.symbols.length && !f.symbols.includes(r.symbol)) return false;
    if (f.signalTypes.length && !r.activeSignals.some((s) => f.signalTypes.includes(s))) return false;
    if (f.search && !r.symbol.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.minVolume24h !== null && r.volume24h < f.minVolume24h) return false;
    if (f.minChange5m !== null && r.change5m < f.minChange5m) return false;
    if (f.minChange5mAbs !== null && Math.abs(r.change5m) < f.minChange5mAbs) return false;
    if (f.minChange15m !== null && r.change15m < f.minChange15m) return false;
    if (f.minRelativeVolume !== null && r.relativeVolume < f.minRelativeVolume) return false;
    if (f.minVolatility !== null && r.volatility < f.minVolatility) return false;
    if (f.maxSpreadPercent !== null && r.spreadPct > f.maxSpreadPercent) return false;
    if (f.minTradesPerMinute !== null && r.tradesPerMinute < f.minTradesPerMinute) return false;
    if (f.minSignalScore !== null && r.signalScore < f.minSignalScore) return false;
    if (f.hasActiveSignal && r.activeSignals.length === 0) return false;
    if (f.watchlistOnly && !watchlist.has(r.symbol)) return false;
    // minOpenInterestChange15m is server-side concept; we approximate by skipping (no field on result)
    return true;
  });
}

// =============================================================================
// URL serialization (so filter state can be shared via link)
// =============================================================================

const NUMBER_KEYS = [
  "minVolume24h",
  "minChange5m",
  "minChange5mAbs",
  "minChange15m",
  "minRelativeVolume",
  "minVolatility",
  "maxSpreadPercent",
  "minTradesPerMinute",
  "minSignalScore",
  "minOpenInterestChange15m",
] as const;

export function filtersToSearchParams(f: ScreenerFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.exchange.length) p.set("exchange", f.exchange.join(","));
  if (f.marketType.length) p.set("marketType", f.marketType.join(","));
  if (f.quoteAsset.length) p.set("quoteAsset", f.quoteAsset.join(","));
  if (f.symbols.length) p.set("symbols", f.symbols.join(","));
  if (f.signalTypes.length) p.set("signalTypes", f.signalTypes.join(","));
  if (f.search) p.set("search", f.search);
  for (const key of NUMBER_KEYS) {
    const v = f[key];
    if (v !== null && Number.isFinite(v)) p.set(key, String(v));
  }
  if (f.hasActiveSignal) p.set("hasActiveSignal", "1");
  if (f.watchlistOnly) p.set("watchlistOnly", "1");
  return p;
}

export function filtersFromSearchParams(p: URLSearchParams): ScreenerFilters {
  const f: ScreenerFilters = { ...EMPTY_FILTERS };
  const csv = (k: string) => (p.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  f.exchange = csv("exchange") as ScreenerFilters["exchange"];
  f.marketType = csv("marketType") as ScreenerFilters["marketType"];
  f.quoteAsset = csv("quoteAsset");
  f.symbols = csv("symbols");
  f.signalTypes = csv("signalTypes") as ScreenerFilters["signalTypes"];
  f.search = p.get("search") ?? "";
  for (const key of NUMBER_KEYS) {
    const raw = p.get(key);
    if (raw !== null && raw !== "" && Number.isFinite(Number(raw))) {
      (f as unknown as Record<string, unknown>)[key] = Number(raw);
    }
  }
  f.hasActiveSignal = p.get("hasActiveSignal") === "1";
  f.watchlistOnly = p.get("watchlistOnly") === "1";
  return f;
}
