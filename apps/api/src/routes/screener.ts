import { ScreenerQuery, type ScreenerResult } from "@screener/shared";
import type { FastifyInstance } from "fastify";
import type { MarketDataStore } from "../state/MarketDataStore.js";

function applyQuery(rows: ScreenerResult[], q: ScreenerQuery): ScreenerResult[] {
  let out = rows;

  const include = <T>(set: T[] | undefined, value: T): boolean => !set || set.length === 0 || set.includes(value);
  const exchange = q.exchange as string[] | undefined;
  const marketType = q.marketType as string[] | undefined;
  const quoteAsset = q.quoteAsset as string[] | undefined;
  const symbols = q.symbols as string[] | undefined;
  const signalTypes = q.signalTypes as string[] | undefined;
  const watchlist = q.watchlistSymbols as string[] | undefined;

  out = out.filter((r) => {
    if (!include(exchange, r.exchange)) return false;
    if (!include(marketType, r.marketType)) return false;
    if (!include(quoteAsset, r.quoteAsset)) return false;
    if (symbols && symbols.length > 0 && !symbols.includes(r.symbol)) return false;
    if (watchlist && watchlist.length > 0 && !watchlist.includes(r.symbol)) return false;
    if (signalTypes && signalTypes.length > 0 && !r.activeSignals.some((s) => signalTypes.includes(s))) return false;
    if (q.minVolume24h !== undefined && r.volume24h < q.minVolume24h) return false;
    if (q.minChange5m !== undefined && r.change5m < q.minChange5m) return false;
    if (q.minChange5mAbs !== undefined && Math.abs(r.change5m) < q.minChange5mAbs) return false;
    if (q.minChange15m !== undefined && r.change15m < q.minChange15m) return false;
    if (q.minRelativeVolume !== undefined && r.relativeVolume < q.minRelativeVolume) return false;
    if (q.minVolatility !== undefined && r.volatility < q.minVolatility) return false;
    if (q.maxSpreadPercent !== undefined && r.spreadPct > q.maxSpreadPercent) return false;
    if (q.minTradesPerMinute !== undefined && r.tradesPerMinute < q.minTradesPerMinute) return false;
    if (q.minSignalScore !== undefined && r.signalScore < q.minSignalScore) return false;
    if (q.hasActiveSignal === true && r.activeSignals.length === 0) return false;
    if (q.search && !r.symbol.toLowerCase().includes(q.search.toLowerCase())) return false;
    return true;
  });

  if (q.sortColumn) {
    const col = q.sortColumn as keyof ScreenerResult;
    const dir = q.sortDirection ?? "desc";
    out = [...out].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      // Numeric columns: subtract. String columns: localeCompare so
      // sortColumn=symbol/exchange/quoteAsset actually works server-side
      // instead of silently returning 0 (the previous no-op behaviour).
      // Mixed or unsupported types fall through to 0 like before.
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv);
        return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  if (q.limit) out = out.slice(0, q.limit);
  return out;
}

export async function registerScreenerRoutes(
  fastify: FastifyInstance,
  store: MarketDataStore,
): Promise<void> {
  fastify.get("/screener", async (req) => {
    const q = ScreenerQuery.parse(req.query ?? {});
    return applyQuery(store.list(), q);
  });

  fastify.post("/screener/query", async (req) => {
    const q = ScreenerQuery.parse(req.body ?? {});
    return applyQuery(store.list(), q);
  });
}
