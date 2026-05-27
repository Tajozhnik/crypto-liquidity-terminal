/** Score band thresholds — see Requirements 6.6 / 11.5 */
export const SCORE_BANDS = {
  cold: { min: 0, max: 30 },
  normal: { min: 31, max: 60 },
  hot: { min: 61, max: 80 },
  extreme: { min: 81, max: 100 },
} as const;

/** Default HOT_MARKET threshold — see Requirement 10.11 */
export const HOT_MARKET_SCORE_THRESHOLD = 81;

/** Default API and WS values */
export const DEFAULT_WS_BATCH_INTERVAL_MS = 750;
export const DEFAULT_WS_BATCH_MAX_ENTRIES = 500;
export const DEFAULT_SCREENER_INTERVAL_MS = 1000;
export const DEFAULT_ALERT_INTERVAL_MS = 2000;
export const DEFAULT_ALERT_COOLDOWN_SECONDS = 300;

/** WS initial snapshot caps — see Requirement 19.4 */
export const WS_SNAPSHOT_MARKETS_LIMIT = 300;
export const WS_SNAPSHOT_RECENT_SIGNALS_LIMIT = 50;
export const WS_SNAPSHOT_RECENT_ALERT_EVENTS_LIMIT = 50;

/** Dashboard top-N — see Requirement 5.4-5.7 */
export const DASHBOARD_TOP_N = 10;

/** Market detail defaults — see Requirement 9 */
export const MARKET_DETAIL = {
  candleInterval: "1m" as const,
  candleLimit: 200,
  orderbookDepth: 20,
  recentTradesLimit: 100,
  recentSignalsLimit: 50,
};

/** Disclaimer — see Requirement 3.1 */
export const DISCLAIMER_TEXT =
  "This tool is for market analysis only and does not provide financial advice.";
