import type {
  Alert,
  AlertEvent,
  AlertInput,
  AlertPatch,
  Kline,
  OrderBook,
  ScreenerResult,
  ServerSettings,
  Signal,
  Trade,
} from "@screener/shared";
import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 204) return null as T;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = body as { error?: string; message?: string; details?: unknown } | null;
      throw new ApiError(
        res.status,
        err?.error ?? "unknown_error",
        err?.message ?? `${path} -> ${res.status}`,
        err?.details,
      );
    }
    return body as T;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") {
      throw new ApiError(0, "timeout", `${path} timed out after ${timeoutMs}ms`);
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "network_error", (e as Error).message ?? "network error");
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request<{ status: string; serverTime: string }>("/health"),
  readiness: () =>
    request<{
      status: "ok" | "degraded";
      db: "ok" | "unavailable";
      redis: "ok" | "fallback";
      exchangeAdapters: { name: string; connected: boolean }[];
      serverTime: string;
    }>("/readiness"),

  // markets
  markets: () => request<ScreenerResult[]>("/markets"),
  market: (symbol: string) => request<ScreenerResult>(`/markets/${encodeURIComponent(symbol)}`),
  klines: (symbol: string, limit = 200) =>
    request<Kline[]>(`/markets/${encodeURIComponent(symbol)}/klines?limit=${limit}`),
  orderbook: (symbol: string) =>
    request<OrderBook>(`/markets/${encodeURIComponent(symbol)}/orderbook`),
  trades: (symbol: string, limit = 100) =>
    request<Trade[]>(`/markets/${encodeURIComponent(symbol)}/trades?limit=${limit}`),

  // signals
  signals: (params?: { symbol?: string; type?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.symbol) qs.set("symbol", params.symbol);
    if (params?.type) qs.set("type", params.type);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<{ items: Signal[]; nextCursor: string | null }>(
      `/signals${query ? `?${query}` : ""}`,
    );
  },
  signalsForSymbol: (symbol: string) =>
    request<{ items: Signal[]; nextCursor: string | null }>(`/signals/${encodeURIComponent(symbol)}`),

  // alerts
  alerts: () => request<Alert[]>("/alerts"),
  createAlert: (input: AlertInput) =>
    request<Alert>("/alerts", { method: "POST", body: JSON.stringify(input) }),
  updateAlert: (id: string, patch: AlertPatch) =>
    request<Alert>(`/alerts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteAlert: (id: string) =>
    request<null>(`/alerts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  alertEvents: (limit = 100) => request<AlertEvent[]>(`/alert-events?limit=${limit}`),
  alertEventsForAlert: (alertId: string, limit = 50) =>
    request<AlertEvent[]>(`/alert-events?alertId=${encodeURIComponent(alertId)}&limit=${limit}`),

  // settings
  settings: () => request<ServerSettings>("/settings"),
  updateSettings: (patch: Partial<ServerSettings>) =>
    request<ServerSettings>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // liquidity
  liquiditySymbols: (params: { exchange?: string; marketType?: "spot" | "futures" } = {}) => {
    const qs = new URLSearchParams();
    if (params.exchange) qs.set("exchange", params.exchange);
    if (params.marketType) qs.set("marketType", params.marketType);
    return request<{ exchange: string; marketType: string; symbols: string[] }>(
      `/liquidity/symbols${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  },
  liquiditySnapshot: (
    symbol: string,
    p: {
      marketType: "spot" | "futures";
      timeframe: string;
      binSize: string;
      lookbackMinutes?: number;
      lookback?: "max";
      levels?: number;
      heatmapBucketMs?: number;
      priceMin?: number;
      priceMax?: number;
    },
  ) => {
    const qs = new URLSearchParams({
      exchange: "binance",
      marketType: p.marketType,
      timeframe: p.timeframe,
      binSize: p.binSize,
    });
    if (p.lookbackMinutes) qs.set("lookbackMinutes", String(p.lookbackMinutes));
    if (p.lookback === "max") qs.set("lookback", "max");
    if (p.levels) qs.set("levels", String(p.levels));
    if (p.heatmapBucketMs) {
      const hb = Math.max(250, Math.min(3_600_000, Math.round(p.heatmapBucketMs)));
      qs.set("heatmapBucketMs", String(hb));
    }
    if (p.priceMin && p.priceMin > 0) qs.set("priceMin", String(p.priceMin));
    if (p.priceMax && p.priceMax > 0) qs.set("priceMax", String(p.priceMax));
    return request<unknown>(`/liquidity/${encodeURIComponent(symbol)}/snapshot?${qs.toString()}`);
  },
  liquidityOrderBook: (symbol: string, p: { marketType: "spot" | "futures"; levels?: number }) => {
    const qs = new URLSearchParams({
      exchange: "binance",
      marketType: p.marketType,
      levels: String(p.levels ?? 100),
    });
    return request<unknown>(`/liquidity/${encodeURIComponent(symbol)}/orderbook?${qs.toString()}`);
  },
  liquidityCandles: (symbol: string, p: { marketType: "spot" | "futures"; interval?: string; limit?: number }) => {
    const qs = new URLSearchParams({
      exchange: "binance",
      marketType: p.marketType,
      interval: p.interval ?? "1m",
      limit: String(p.limit ?? 500),
    });
    return request<unknown>(`/liquidity/${encodeURIComponent(symbol)}/candles?${qs.toString()}`);
  },
  liquidityDelta: (symbol: string, p: { marketType: "spot" | "futures"; timeframe?: string; limit?: number }) => {
    const qs = new URLSearchParams({
      exchange: "binance",
      marketType: p.marketType,
      timeframe: p.timeframe ?? "1m",
      limit: String(p.limit ?? 200),
    });
    return request<unknown>(`/liquidity/${encodeURIComponent(symbol)}/delta?${qs.toString()}`);
  },
};
