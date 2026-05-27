import { Redis } from "ioredis";
import { logger } from "../logger.js";

let _client: Redis | null = null;
let _connected = false;

export function isRedisAvailable(): boolean {
  return _connected;
}

export async function initRedis(url: string | undefined): Promise<void> {
  if (!url) {
    logger.warn("REDIS_URL not set; using in-memory fallback");
    return;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy(times: number) {
      // Exponential backoff capped at 30s — see Requirement 17.6
      return Math.min(30_000, 1000 * 2 ** Math.min(times - 1, 5));
    },
  });

  client.on("connect", () => {
    _connected = true;
    logger.info("Redis connected");
  });
  client.on("error", (err: Error) => {
    if (_connected) {
      logger.warn({ err: err.message }, "Redis error; falling back to in-memory");
    }
    _connected = false;
  });
  client.on("end", () => {
    _connected = false;
  });

  try {
    await client.connect();
    _client = client;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Redis unavailable at boot; using in-memory fallback");
  }
}

export async function shutdownRedis(): Promise<void> {
  try {
    await _client?.quit();
  } catch {
    /* ignore */
  }
  _client = null;
  _connected = false;
}
