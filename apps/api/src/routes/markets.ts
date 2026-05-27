import { MARKET_DETAIL } from "@screener/shared";
import type { FastifyInstance } from "fastify";
import type { AdapterRegistry } from "../adapters/AdapterRegistry.js";
import type { ExchangeAdapter } from "../adapters/ExchangeAdapter.js";
import { notFoundError } from "../plugins/errorHandler.js";
import type { MarketDataStore } from "../state/MarketDataStore.js";

/**
 * Find the adapter that should serve a given symbol. We prefer the adapter
 * matching the live snapshot's exchange; otherwise fall back to the primary.
 *
 * When the caller supplies explicit `exchange` / `marketType` query params we
 * do a strict store lookup first so multi-exchange installs don't silently
 * collapse the same symbol from two venues.
 */
function adapterFor(
  registry: AdapterRegistry,
  store: MarketDataStore,
  symbol: string,
  exchange?: string,
  marketType?: string,
): ExchangeAdapter {
  if (exchange) {
    const named = registry.byName(exchange);
    if (named) return named;
  }
  const snap = store.get(symbol, exchange, marketType);
  if (snap) {
    const a = registry.byName(snap.exchange);
    if (a) return a;
  }
  return registry.primary();
}

export async function registerMarketsRoutes(
  fastify: FastifyInstance,
  store: MarketDataStore,
  registry: AdapterRegistry,
): Promise<void> {
  fastify.get("/markets", async () => store.list());

  fastify.get<{
    Params: { symbol: string };
    Querystring: { exchange?: string; marketType?: string };
  }>("/markets/:symbol", async (req) => {
    const result = store.get(req.params.symbol, req.query.exchange, req.query.marketType);
    if (!result) throw notFoundError("market", req.params.symbol);
    return result;
  });

  fastify.get<{
    Params: { symbol: string };
    Querystring: { limit?: string; interval?: string; exchange?: string; marketType?: string };
  }>(
    "/markets/:symbol/klines",
    async (req) => {
      const limit = Math.min(1000, Number.parseInt(req.query.limit ?? String(MARKET_DETAIL.candleLimit), 10) || MARKET_DETAIL.candleLimit);
      const interval = req.query.interval ?? MARKET_DETAIL.candleInterval;
      const adapter = adapterFor(registry, store, req.params.symbol, req.query.exchange, req.query.marketType);
      const klines = await adapter.getKlines(req.params.symbol, interval, limit);
      if (klines.length === 0 && !store.get(req.params.symbol, req.query.exchange, req.query.marketType)) {
        throw notFoundError("market", req.params.symbol);
      }
      return klines;
    },
  );

  fastify.get<{
    Params: { symbol: string };
    Querystring: { exchange?: string; marketType?: string };
  }>("/markets/:symbol/orderbook", async (req) => {
    const adapter = adapterFor(registry, store, req.params.symbol, req.query.exchange, req.query.marketType);
    const ob = await adapter.getOrderBook(req.params.symbol, MARKET_DETAIL.orderbookDepth);
    if (!ob) throw notFoundError("market", req.params.symbol);
    return {
      symbol: ob.symbol,
      bids: ob.bids.slice(0, MARKET_DETAIL.orderbookDepth),
      asks: ob.asks.slice(0, MARKET_DETAIL.orderbookDepth),
      ts: ob.ts,
    };
  });

  fastify.get<{
    Params: { symbol: string };
    Querystring: { limit?: string; exchange?: string; marketType?: string };
  }>(
    "/markets/:symbol/trades",
    async (req) => {
      const adapter = adapterFor(registry, store, req.params.symbol, req.query.exchange, req.query.marketType);
      const limit = Math.min(500, Number.parseInt(req.query.limit ?? `${MARKET_DETAIL.recentTradesLimit}`, 10));
      const trades = await adapter.getRecentTrades(req.params.symbol, limit);
      if (!store.get(req.params.symbol, req.query.exchange, req.query.marketType)) {
        throw notFoundError("market", req.params.symbol);
      }
      return trades.slice(-limit);
    },
  );
}
