import { z } from "zod";

/** Robust boolean parsing: "false"/"0"/"" → false; everything else truthy → true. */
const boolish = z
  .union([z.boolean(), z.string()])
  .default(false)
  .transform((v) => {
    if (typeof v === "boolean") return v;
    const s = v.trim().toLowerCase();
    return !(s === "" || s === "false" || s === "0" || s === "no" || s === "off");
  });

const Env = z.object({
  USE_MOCK_DATA: boolish.default(false),
  /** Optional dev/test fixtures flag (alias of USE_MOCK_DATA for clarity in tests). */
  ENABLE_TEST_FIXTURES: boolish.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_PORT: z.coerce.number().int().default(4000),

  MOCK_MARKET_COUNT: z.coerce.number().int().min(50).max(100).default(80),
  MOCK_UPDATE_INTERVAL_MS: z.coerce.number().int().min(100).default(750),
  MOCK_SEED: z.coerce.number().int().default(42),

  SCREENER_INTERVAL_MS: z.coerce.number().int().min(250).default(1000),
  ALERT_INTERVAL_MS: z.coerce.number().int().min(500).default(2000),

  WS_BATCH_INTERVAL_MS: z.coerce.number().int().min(500).max(1000).default(750),
  WS_BATCH_MAX_ENTRIES: z.coerce.number().int().min(50).max(2000).default(500),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  RATE_LIMIT_MAX: z.coerce.number().int().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),

  HOT_MARKET_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(81),

  // ---- No-subscription data policy ----
  ENABLED_EXCHANGES: z
    .string()
    .default("binance")
    .transform((v) => {
      const arr = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .filter((s) => ["binance", "bybit", "okx", "coinbase", "kraken"].includes(s));
      return arr.length === 0 ? ["binance"] : arr;
    }),
  ENABLE_PUBLIC_API_ADAPTERS: boolish.default(true),
  DISABLE_PAID_PROVIDERS: boolish.default(true),
  MARKET_METADATA_PROVIDER: z.enum(["none"]).default("none"),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(500).default(5_000),
  EXTERNAL_API_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(30),

  /** Live polling interval for public REST adapters (ms). 0 = disabled. */
  LIVE_POLLING_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  /** Max symbols per exchange to ingest into the live store via polling. */
  LIVE_POLLING_SYMBOL_LIMIT: z.coerce.number().int().min(1).max(50).default(15),

  /**
   * Hard memory cap (in hours) on the depth-snapshot ring buffer used by the
   * Liquidity Heatmap. Drives both the per-feed buffer capacity AND the
   * `lookback=max` ceiling on `/liquidity/:symbol/snapshot`.
   */
  MAX_HEATMAP_LOOKBACK_HOURS: z.coerce.number().min(0.5).default(4),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Environment parse failed, using defaults:", parsed.error.issues);
    return Env.parse({});
  }
  return parsed.data;
}
