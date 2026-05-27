import { logger } from "../logger.js";
import { LiquidityFeed, type FeedDeps } from "./LiquidityFeed.js";

/**
 * Lazy-creates per-symbol LiquidityFeed instances on demand. The first request
 * for a symbol kicks off the WS connection; subsequent requests return the
 * existing feed. Idle feeds are not auto-stopped in MVP (a single user is
 * unlikely to switch symbols often) — call `stopAll()` on shutdown.
 */
export class LiquidityFeedManager {
  private feeds = new Map<string, LiquidityFeed>();

  constructor(private readonly deps: FeedDeps) {}

  private key(symbol: string, marketType: "spot" | "futures"): string {
    return `${marketType}:${symbol}`;
  }

  async getOrStart(symbol: string, marketType: "spot" | "futures"): Promise<LiquidityFeed> {
    const k = this.key(symbol, marketType);
    let feed = this.feeds.get(k);
    if (!feed) {
      feed = new LiquidityFeed(symbol, marketType, this.deps);
      this.feeds.set(k, feed);
      try {
        await feed.start();
      } catch (err) {
        logger.warn(
          { symbol, marketType, err: (err as Error).message },
          "LiquidityFeed start failed",
        );
      }
    }
    return feed;
  }

  get(symbol: string, marketType: "spot" | "futures"): LiquidityFeed | undefined {
    return this.feeds.get(this.key(symbol, marketType));
  }

  list(): LiquidityFeed[] {
    return [...this.feeds.values()];
  }

  async stopAll(): Promise<void> {
    for (const f of this.feeds.values()) f.stop();
    this.feeds.clear();
  }
}
