"use client";
import { DASHBOARD_TOP_N, type ScreenerResult } from "@screener/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PriceChange } from "@/components/PriceChange";
import { ScoreBadge } from "@/components/ScoreBadge";
import { useScreenerWebSocket } from "@/lib/ws";
import { useAlertStore } from "@/state/useAlertStore";
import { useMarketStore } from "@/state/useMarketStore";

/**
 * After this many seconds without market data the empty state stops saying
 * "Loading…" and tells the user the polling job hasn't filled the store yet.
 * Default LIVE_POLLING_INTERVAL_MS is 60 s, so 10 s is enough buffer for
 * mock-mode (≈ 2 s) and the first real live tick (≈ 60 s).
 */
const LOADING_HINT_TIMEOUT_S = 10;

export default function DashboardPage() {
  useScreenerWebSocket();
  const markets = useMarketStore((s) => s.markets);
  const recentSignals = useMarketStore((s) => s.recentSignals);
  const connection = useMarketStore((s) => s.connection);
  const alertEvents = useAlertStore((s) => s.events);

  const list = useMemo(() => [...markets.values()], [markets]);
  const totalMarkets = list.length;
  const activeSignals = list.reduce((acc, r) => acc + r.activeSignals.length, 0);

  const topGainers = useMemo(
    () => [...list].sort((a, b) => b.change24h - a.change24h).slice(0, DASHBOARD_TOP_N),
    [list],
  );
  const topLosers = useMemo(
    () => [...list].sort((a, b) => a.change24h - b.change24h).slice(0, DASHBOARD_TOP_N),
    [list],
  );
  const topVolumeSpikes = useMemo(
    () => [...list].sort((a, b) => b.relativeVolume - a.relativeVolume).slice(0, DASHBOARD_TOP_N),
    [list],
  );
  const hottest = useMemo(
    () => [...list].sort((a, b) => b.signalScore - a.signalScore).slice(0, DASHBOARD_TOP_N),
    [list],
  );

  if (totalMarkets === 0) {
    if (connection === "disconnected") {
      return <div className="error">Disconnected from API. Reconnecting…</div>;
    }
    return <EmptyDashboard connection={connection} />;
  }

  return (
    <div>
      <div className="cards">
        <div className="card">
          <div className="label">Markets tracked</div>
          <div className="value">{totalMarkets}</div>
        </div>
        <div className="card">
          <div className="label">Active signals</div>
          <div className="value">{activeSignals}</div>
        </div>
        <div className="card">
          <div className="label">Recent signals</div>
          <div className="value">{recentSignals.length}</div>
        </div>
        <div className="card">
          <div className="label">Recent alerts</div>
          <div className="value">{alertEvents.length}</div>
        </div>
        <div className="card">
          <div className="label">Connection</div>
          <div className="value" style={{ fontSize: 16 }}>
            <span className={`connection ${connection}`}>
              <span className="dot" /> {connection}
            </span>
          </div>
        </div>
      </div>

      <div className="section-grid">
        <RankList
          title="Top Gainers (24h)"
          rows={topGainers}
          render={(r) => <PriceChange value={r.change24h} />}
        />
        <RankList
          title="Top Losers (24h)"
          rows={topLosers}
          render={(r) => <PriceChange value={r.change24h} />}
        />
        <RankList
          title="Top Volume Spikes"
          rows={topVolumeSpikes}
          render={(r) => <span>{r.relativeVolume.toFixed(2)}×</span>}
        />
        <RankList
          title="Hottest Markets"
          rows={hottest}
          render={(r) => <ScoreBadge score={r.signalScore} band={r.scoreBand} />}
        />
      </div>

      <div className="section-grid">
        <div className="panel">
          <div className="panel-header">Live Signal Feed</div>
          <div className="panel-body">
            {recentSignals.length === 0 ? (
              <div className="empty">Waiting for signals…</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSignals.slice(0, 25).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/markets/${encodeURIComponent(s.symbol)}`} className="symbol-link">
                          {s.symbol}
                        </Link>
                      </td>
                      <td>{s.type}</td>
                      <td>{Math.round(s.score)}</td>
                      <td className="dim">{new Date(s.createdAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Recent Alert Events</div>
          <div className="panel-body">
            {alertEvents.length === 0 ? (
              <div className="empty">
                No alert events yet.{" "}
                <Link href="/alerts" className="symbol-link">
                  Create an alert →
                </Link>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Value</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {alertEvents.slice(0, 25).map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/markets/${encodeURIComponent(e.symbol)}`} className="symbol-link">
                          {e.symbol}
                        </Link>
                      </td>
                      <td>{e.value.toFixed(4)}</td>
                      <td className="dim">{new Date(e.triggeredAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyDashboard({
  connection,
}: {
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
}) {
  const [secondsWaiting, setSecondsWaiting] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecondsWaiting((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (secondsWaiting < LOADING_HINT_TIMEOUT_S) {
    return <div className="loading">Loading market data…</div>;
  }
  // Past the threshold: switch to an actionable hint. Polling job ticks at
  // LIVE_POLLING_INTERVAL_MS (default 60 s) — first results may take that
  // long on live mode. If the store stays empty after 60 s, something
  // upstream is wrong and the user should check ConnectionStatus / health.
  return (
    <div className="loading" role="status" aria-live="polite">
      <div>Live polling in progress…</div>
      <div className="dim" style={{ marginTop: 6, fontSize: 13 }}>
        First tick may take up to 60 s. WebSocket: <strong>{connection}</strong>.{" "}
        Still empty after a minute? Check <Link href="/settings" className="symbol-link">Settings → Connection</Link>.
      </div>
    </div>
  );
}

function RankList<T extends ScreenerResult>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: T[];
  render: (r: T) => React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-header">{title}</div>
      <div className="panel-body">
        {rows.length === 0 ? (
          <div className="empty">No data yet.</div>
        ) : (
          <table className="table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <Link href={`/markets/${encodeURIComponent(r.symbol)}`} className="symbol-link">
                      {r.symbol}
                    </Link>
                  </td>
                  <td>{render(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
