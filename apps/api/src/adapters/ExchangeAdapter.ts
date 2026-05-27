import type {
  ExchangeName,
  FuturesMetrics,
  Kline,
  Market,
  MarketType,
  OrderBook,
  Ticker,
  Trade,
} from "@screener/shared";

export type Unsubscribe = () => void;

export interface AdapterHealth {
  status: "ok" | "degraded" | "disabled";
  enabled: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface ExchangeAdapter {
  readonly name: ExchangeName;
  /** Market types this adapter can return: ["spot"], ["futures"], or both. */
  readonly marketTypes: MarketType[];

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  health(): AdapterHealth;

  getMarkets(): Promise<Market[]>;
  getTicker(symbol: string): Promise<Ticker | null>;
  getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;
  getOrderBook(symbol: string, limit?: number): Promise<OrderBook | null>;
  getRecentTrades(symbol: string, limit?: number): Promise<Trade[]>;
  /** Returns null if the adapter does not support futures or the symbol is spot. */
  getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null>;

  subscribeTickers(symbols: string[], cb: (t: Ticker) => void): Unsubscribe;
  subscribeOrderBook(symbol: string, cb: (ob: OrderBook) => void): Unsubscribe;
  subscribeTrades(symbol: string, cb: (trades: Trade[]) => void): Unsubscribe;
}
