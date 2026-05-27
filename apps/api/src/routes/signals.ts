import type { FastifyInstance } from "fastify";
import type { MarketDataStore } from "../state/MarketDataStore.js";

export async function registerSignalsRoutes(
  fastify: FastifyInstance,
  store: MarketDataStore,
): Promise<void> {
  fastify.get<{
    Querystring: { symbol?: string; type?: string; limit?: string };
  }>("/signals", async (req) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? "50", 10) || 50));
    const symbol = req.query.symbol;
    const type = req.query.type;

    let items = store.getRecentSignals(500); // already newest-first
    if (symbol) items = items.filter((s) => s.symbol === symbol);
    if (type) items = items.filter((s) => s.type === type);

    const sliced = items.slice(0, limit);
    // We don't currently support cursor-based pagination — return null so
    // the client doesn't try to paginate with a placeholder string.
    return { items: sliced, nextCursor: null };
  });

  fastify.get<{ Params: { symbol: string } }>("/signals/:symbol", async (req) => {
    const items = store.getRecentSignalsForSymbol(req.params.symbol, 50);
    return { items, nextCursor: null };
  });
}
