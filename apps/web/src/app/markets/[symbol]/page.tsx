"use client";
import type { Alert, Kline, OrderBook, ScreenerResult, Signal, Trade } from "@screener/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PriceChange } from "@/components/PriceChange";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SignalBadges } from "@/components/SignalBadges";
import { Sparkline } from "@/components/Sparkline";
import { WatchlistStar } from "@/components/WatchlistStar";
import { abbreviate } from "@/lib/format";
import { api } from "@/lib/api";
import { useScreenerWebSocket } from "@/lib/ws";
import { useAlertStore } from "@/state/useAlertStore";
import { useMarketStore } from "@/state/useMarketStore";

export default function MarketDetailPage() {
  useScreenerWebSocket();
  const params = useParams<{ symbol: string }>();
  const router = useRouter();
  const symbolRaw = (params?.symbol ?? "") as string;
  const symbol = decodeURIComponent(symbolRaw).toUpperCase();

  const market = useMarketStore((s) => s.markets.get(symbol));
  const recentSignalsAll = useMarketStore((s) => s.recentSignals);
  const allAlerts = useAlertStore((s) => s.alerts);

  const [klines, setKlines] = useState<Kline[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signalsForSymbol, setSignalsForSymbol] = useState<Signal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [k, ob, t, sig] = await Promise.all([
        api.klines(symbol, 200),
        api.orderbook(symbol),
        api.trades(symbol, 100),
        api.signalsForSymbol(symbol),
      ]);
      setKlines(k);
      setOrderBook(ob);
      setTrades(t);
      setSignalsForSymbol(sig.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Merge live signals from WS for this symbol
  const allSignalsForSymbol = useMemo(() => {
    const live = recentSignalsAll.filter((s) => s.symbol === symbol);
    const merged = new Map<string, Signal>();
    for (const s of [...live, ...signalsForSymbol]) merged.set(s.id, s);
    return [...merged.values()].slice(0, 50);
  }, [recentSignalsAll, signalsForSymbol, symbol]);

  const alertsForSymbol = useMemo(
    () => allAlerts.filter((a) => a.symbol === symbol),
    [allAlerts, symbol],
  );

  if (!market && loading) return <div className="loading">Loading {symbol}…</div>;
  if (!market && error) {
    return (
      <div className="error">
        Failed to load: {error} <button onClick={refresh}>Retry</button>
      </div>
    );
  }
  if (!market) {
    return (
      <div className="empty">
        Market {symbol} not found.{" "}
        <Link href="/screener" className="symbol-link">Back to Screener</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="detail-header">
        <div>
          <Link href="/screener" className="symbol-link">← Screener</Link>
          <h2 className="detail-title">
            <WatchlistStar symbol={symbol} /> {symbol}
            <span className="dim" style={{ marginLeft: 12, fontSize: 13 }}>
              {market.exchange} · {market.marketType}
            </span>
          </h2>
        </div>
        <div className="detail-header-right">
          <ScoreBadge score={market.signalScore} band={market.scoreBand} />
          <button
            className="primary-btn"
            onClick={() =>
              router.push(
                `/alerts?prefill=${encodeURIComponent(
                  JSON.stringify({
                    symbol: market.symbol,
                    exchange: market.exchange,
                    marketType: market.marketType,
                  }),
                )}`,
              )
            }
          >
            + New alert for {symbol}
          </button>
        </div>
      </div>

      <DetailMetricsCards r={market} />

      <div className="detail-grid">
        <div className="panel" style={{ gridColumn: "span 2" }}>
          <div className="panel-header">Price (last {klines.length}× 1m)</div>
          <div style={{ padding: 16 }}>
            <Sparkline data={klines.map((k) => k.close)} width={760} height={180} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Order Book (top 20)</div>
          <div className="panel-body" style={{ maxHeight: 400 }}>
            {orderBook ? <OrderBookView ob={orderBook} /> : <div className="dim" style={{ padding: 16 }}>—</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Recent Trades (last {trades.length})</div>
          <div className="panel-body" style={{ maxHeight: 400 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {trades
                  .slice()
                  .reverse()
                  .map((t) => (
                    <tr key={t.id}>
                      <td className="dim">{new Date(t.ts).toLocaleTimeString()}</td>
                      <td className={t.side === "buy" ? "green" : "red"}>{t.side}</td>
                      <td>{t.price.toFixed(t.price > 100 ? 2 : 6)}</td>
                      <td>{t.qty.toFixed(3)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Recent Signals ({allSignalsForSymbol.length})</div>
          <div className="panel-body" style={{ maxHeight: 400 }}>
            {allSignalsForSymbol.length === 0 ? (
              <div className="empty">No signals yet for this symbol.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {allSignalsForSymbol.map((s) => (
                    <tr key={s.id}>
                      <td className="dim">{new Date(s.createdAt).toLocaleTimeString()}</td>
                      <td>{s.type}</td>
                      <td>{Math.round(s.score)}</td>
                      <td className="dim">{s.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Alerts for {symbol} ({alertsForSymbol.length})</div>
          <div className="panel-body" style={{ maxHeight: 400 }}>
            {alertsForSymbol.length === 0 ? (
              <div className="empty">
                No alerts. <Link href="/alerts" className="symbol-link">Create one →</Link>
              </div>
            ) : (
              <AlertsTable alerts={alertsForSymbol} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMetricsCards({ r }: { r: ScreenerResult }) {
  return (
    <div className="cards">
      <div className="card">
        <div className="label">Price</div>
        <div className="value">{r.price.toFixed(r.price > 100 ? 2 : 6)}</div>
      </div>
      <div className="card">
        <div className="label">24h</div>
        <div className="value"><PriceChange value={r.change24h} /></div>
      </div>
      <div className="card">
        <div className="label">5m / 15m / 1h</div>
        <div className="value" style={{ fontSize: 14, lineHeight: 1.5 }}>
          <PriceChange value={r.change5m} /> · <PriceChange value={r.change15m} /> ·{" "}
          <PriceChange value={r.change1h} />
        </div>
      </div>
      <div className="card">
        <div className="label">Volume 24h</div>
        <div className="value" style={{ fontSize: 16 }}>{abbreviate(r.volume24h)}</div>
      </div>
      <div className="card">
        <div className="label">Relative Volume</div>
        <div className="value">{r.relativeVolume.toFixed(2)}×</div>
      </div>
      <div className="card">
        <div className="label">Spread%</div>
        <div className="value" style={{ fontSize: 16 }}>{r.spreadPct.toFixed(3)}%</div>
      </div>
      <div className="card">
        <div className="label">OB Imbalance</div>
        <div className="value" style={{ fontSize: 16 }}>
          {(r.orderBookImbalance * 100).toFixed(1)}%
        </div>
      </div>
      {r.marketType === "futures" && (
        <>
          <div className="card">
            <div className="label">Open Interest</div>
            <div className="value" style={{ fontSize: 16 }}>
              {r.openInterest === null ? "—" : abbreviate(r.openInterest)}
            </div>
          </div>
          <div className="card">
            <div className="label">Funding Rate</div>
            <div className="value" style={{ fontSize: 16 }}>
              {r.fundingRate === null ? "—" : `${(r.fundingRate * 100).toFixed(4)}%`}
            </div>
          </div>
        </>
      )}
      <div className="card">
        <div className="label">Active Signals</div>
        <div className="value" style={{ fontSize: 14 }}>
          <SignalBadges types={r.activeSignals} />
        </div>
      </div>
    </div>
  );
}

function OrderBookView({ ob }: { ob: OrderBook }) {
  const bids = ob.bids.slice(0, 20);
  const asks = ob.asks.slice(0, 20);
  const maxQty = Math.max(
    ...bids.map((b) => b[1]),
    ...asks.map((a) => a[1]),
  );
  return (
    <div className="orderbook">
      <div className="orderbook-side">
        <table className="table">
          <thead>
            <tr>
              <th>Bid</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b, i) => (
              <tr key={i}>
                <td className="green">{b[0].toFixed(b[0] > 100 ? 2 : 6)}</td>
                <td>
                  <span className="bar bid-bar" style={{ width: `${(b[1] / maxQty) * 60}px` }} />{" "}
                  {b[1].toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="orderbook-side">
        <table className="table">
          <thead>
            <tr>
              <th>Ask</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {asks.map((a, i) => (
              <tr key={i}>
                <td className="red">{a[0].toFixed(a[0] > 100 ? 2 : 6)}</td>
                <td>
                  <span className="bar ask-bar" style={{ width: `${(a[1] / maxQty) * 60}px` }} />{" "}
                  {a[1].toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsTable({ alerts }: { alerts: Alert[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Condition</th>
          <th>Op</th>
          <th>Threshold</th>
          <th>Cooldown</th>
          <th>Enabled</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => (
          <tr key={a.id}>
            <td>{a.conditionType}</td>
            <td>{a.operator}</td>
            <td>{a.threshold}</td>
            <td className="dim">{a.cooldownSeconds}s</td>
            <td>{a.enabled ? "yes" : "no"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
