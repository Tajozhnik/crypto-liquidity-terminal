import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadEnv } from "../config/env.js";
import { bucketDelta } from "../market-depth/DeltaCalculator.js";
import { buildHeatmap } from "../market-depth/LiquidityHeatmapBuilder.js";
import type { LiquidityFeedManager } from "../market-depth/LiquidityFeedManager.js";
import { type BinSizeMode } from "../market-depth/PriceBinner.js";

const COMMON_SPOT = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];

const Query = z.object({
  exchange: z.enum(["binance"]).default("binance"),
  marketType: z.enum(["spot", "futures"]).default("spot"),
  interval: z.string().default("1m"),
  timeframe: z.string().default("1m"),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  levels: z.coerce.number().int().min(10).max(1000).default(100),
  binSize: z.enum(["auto", "0.1%", "0.25%", "0.5%", "1%"]).default("auto"),
  lookbackMinutes: z.coerce.number().int().min(1).max(1440).default(30),
  /** When `lookback=max` the server uses the entire ring buffer up to a
   *  hard memory cap (env `MAX_HEATMAP_LOOKBACK_HOURS`, default 4 h). */
  lookback: z.enum(["max"]).optional(),
  /** Heatmap time-slice resolution in ms (250 ms .. 1 h). */
  heatmapBucketMs: z.coerce.number().int().min(250).max(3_600_000).optional(),
  /** Optional price window from the chart viewport (so the server crops to it). */
  priceMin: z.coerce.number().positive().optional(),
  priceMax: z.coerce.number().positive().optional(),
});

/** Hard memory cap on the heatmap lookback in hours, sourced from the
 *  validated env schema so behaviour is consistent across the app. */
function maxLookbackHours(): number {
  return loadEnv().MAX_HEATMAP_LOOKBACK_HOURS;
}

export async function registerLiquidityRoutes(
  fastify: FastifyInstance,
  feeds: LiquidityFeedManager,
): Promise<void> {
  fastify.get("/liquidity/symbols", async (req) => {
    const q = Query.parse(req.query ?? {});
    return {
      exchange: q.exchange,
      marketType: q.marketType,
      symbols: COMMON_SPOT,
    };
  });

  fastify.get<{ Params: { symbol: string } }>("/liquidity/:symbol/snapshot", async (req) => {
    const q = Query.parse(req.query ?? {});
    const symbol = req.params.symbol.toUpperCase();
    const feed = await feeds.getOrStart(symbol, q.marketType);
    const snapshots = feed.snapshots();
    // Resolve effective lookback. `lookback=max` walks back to the oldest
    // snapshot in the ring buffer, capped at MAX_HEATMAP_LOOKBACK_HOURS so a
    // single request never tries to render multi-day matrices.
    const maxHrs = maxLookbackHours();
    const maxLookbackMs = Math.round(maxHrs * 60 * 60_000);
    let availableHistoryMs = 0;
    if (snapshots.length > 0) {
      availableHistoryMs = Math.max(0, snapshots[snapshots.length - 1]!.t - snapshots[0]!.t);
    }
    let lookbackMinutes = q.lookbackMinutes;
    let lookbackMode: "fixed" | "max" = "fixed";
    let lookbackTruncated = false;
    if (q.lookback === "max") {
      lookbackMode = "max";
      const desired = Math.max(60_000, availableHistoryMs);
      const capped = Math.min(desired, maxLookbackMs);
      lookbackTruncated = desired > capped;
      lookbackMinutes = Math.max(1, Math.ceil(capped / 60_000));
    }
    const candles = feed.candles(500);
    let candlePriceMin: number | undefined;
    let candlePriceMax: number | undefined;
    if (candles.length > 0) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of candles) {
        if (c.low < lo) lo = c.low;
        if (c.high > hi) hi = c.high;
      }
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        candlePriceMin = lo;
        candlePriceMax = hi;
      }
    }
    const matrix = buildHeatmap([...snapshots], {
      symbol,
      exchange: q.exchange,
      marketType: q.marketType,
      timeframe: q.timeframe,
      binSize: q.binSize as BinSizeMode,
      lookbackMinutes,
      feedStartedAt: feed.status().startedAt,
      depthLevels: q.levels,
      ...(q.heatmapBucketMs !== undefined ? { heatmapBucketMs: q.heatmapBucketMs } : {}),
      ...(q.priceMin !== undefined ? { priceMin: q.priceMin } : {}),
      ...(q.priceMax !== undefined ? { priceMax: q.priceMax } : {}),
      ...(candlePriceMin !== undefined ? { candlePriceMin } : {}),
      ...(candlePriceMax !== undefined ? { candlePriceMax } : {}),
    });
    return {
      ...matrix,
      status: feed.status(),
      lookback: {
        mode: lookbackMode,
        appliedMinutes: lookbackMinutes,
        availableHistoryMs,
        maxLookbackMs,
        truncated: lookbackTruncated,
        oldestSnapshotMs: snapshots.length > 0 ? snapshots[0]!.t : null,
        newestSnapshotMs: snapshots.length > 0 ? snapshots[snapshots.length - 1]!.t : null,
      },
    };
  });

  fastify.get<{ Params: { symbol: string } }>("/liquidity/:symbol/orderbook", async (req) => {
    const q = Query.parse(req.query ?? {});
    const symbol = req.params.symbol.toUpperCase();
    const feed = await feeds.getOrStart(symbol, q.marketType);
    const { bids, asks } = feed.topOfBook(q.levels);
    const bestBid = bids[0]?.[0] ?? 0;
    const bestAsk = asks[0]?.[0] ?? 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
    const spread = bestAsk - bestBid;
    const sumQty = (rows: [number, number][]) => rows.reduce((acc, [, q]) => acc + q, 0);
    const bidQty = sumQty(bids.slice(0, 20));
    const askQty = sumQty(asks.slice(0, 20));
    const total = bidQty + askQty;
    const imbalance = total > 0 ? (bidQty - askQty) / total : 0;
    return {
      symbol,
      exchange: q.exchange,
      marketType: q.marketType,
      bids,
      asks,
      bestBid,
      bestAsk,
      midPrice: mid,
      spread,
      spreadPct: mid > 0 ? (spread / mid) * 100 : 0,
      imbalance,
      updatedAt: new Date().toISOString(),
      status: feed.status(),
    };
  });

  fastify.get<{ Params: { symbol: string } }>("/liquidity/:symbol/trades", async (req) => {
    const q = Query.parse(req.query ?? {});
    const symbol = req.params.symbol.toUpperCase();
    const feed = await feeds.getOrStart(symbol, q.marketType);
    return {
      symbol,
      exchange: q.exchange,
      marketType: q.marketType,
      trades: feed.recentTrades(q.limit),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { symbol: string } }>("/liquidity/:symbol/delta", async (req) => {
    const q = Query.parse(req.query ?? {});
    const symbol = req.params.symbol.toUpperCase();
    const feed = await feeds.getOrStart(symbol, q.marketType);
    const buckets = bucketDelta(feed.recentTrades(250_000), q.timeframe);
    return {
      symbol,
      exchange: q.exchange,
      marketType: q.marketType,
      timeframe: q.timeframe,
      buckets: buckets.slice(-q.limit),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { symbol: string } }>("/liquidity/:symbol/candles", async (req) => {
    const q = Query.parse(req.query ?? {});
    const symbol = req.params.symbol.toUpperCase();
    const feed = await feeds.getOrStart(symbol, q.marketType);
    // Use interval param when supplied. For interval=1m we serve the live buffer
    // for fresher data; for other intervals we issue a cached REST request.
    let candles;
    if (q.interval === "1m") {
      candles = feed.candles(q.limit);
    } else {
      candles = await feed.fetchCandlesAtInterval(q.interval, q.limit);
    }
    return {
      symbol,
      exchange: q.exchange,
      marketType: q.marketType,
      interval: q.interval,
      candles,
      updatedAt: new Date().toISOString(),
    };
  });
}
