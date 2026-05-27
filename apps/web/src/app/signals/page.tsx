"use client";
import Link from "next/link";
import { useScreenerWebSocket } from "@/lib/ws";
import { useMarketStore } from "@/state/useMarketStore";

export default function SignalsPage() {
  useScreenerWebSocket();
  const signals = useMarketStore((s) => s.recentSignals);
  return (
    <div className="panel">
      <div className="panel-header">Recent Signals ({signals.length})</div>
      <div className="panel-body" style={{ maxHeight: "75vh" }}>
        {signals.length === 0 ? (
          <div className="empty">Waiting for signals…</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Type</th>
                <th>Score</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td className="dim">{new Date(s.createdAt).toLocaleTimeString()}</td>
                  <td>
                    <Link href={`/markets/${encodeURIComponent(s.symbol)}`} className="symbol-link">
                      {s.symbol}
                    </Link>
                  </td>
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
  );
}
