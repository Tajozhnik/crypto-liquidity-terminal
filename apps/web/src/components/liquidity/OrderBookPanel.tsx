"use client";
import { useLiquidityStore } from "@/state/useLiquidityStore";

export function OrderBookPanel() {
  const ob = useLiquidityStore((s) => s.orderBook);
  const status = useLiquidityStore((s) => s.status);
  if (!ob) return <div className="empty liq-side-empty">Connecting to order book…</div>;
  const bids = ob.bids.slice(0, 12);
  const asks = ob.asks.slice(0, 12);
  const maxQty = Math.max(...bids.map((b) => b[1]), ...asks.map((a) => a[1]));
  const fmt = (n: number, dec = 2) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: dec }) : "—";

  return (
    <aside className="liq-side">
      <div className="liq-side-header">
        <strong>Order Book</strong>
        <span className={`adapter-dot adapter-dot-${status?.connected ? "ok" : "degraded"}`} />
      </div>
      <div className="liq-side-stats">
        <div><span className="dim">Best bid</span><span className="green">{fmt(ob.bestBid, 6)}</span></div>
        <div><span className="dim">Best ask</span><span className="red">{fmt(ob.bestAsk, 6)}</span></div>
        <div><span className="dim">Mid</span><span>{fmt(ob.midPrice, 6)}</span></div>
        <div><span className="dim">Spread%</span><span>{ob.spreadPct.toFixed(4)}%</span></div>
        <div><span className="dim">Imbalance</span><span>{(ob.imbalance * 100).toFixed(1)}%</span></div>
      </div>
      <table className="liq-ob-table">
        <thead>
          <tr><th>Ask</th><th>Qty</th></tr>
        </thead>
        <tbody>
          {asks.slice().reverse().map((a, i) => (
            <tr key={`a${i}`}>
              <td className="red">{fmt(a[0], 6)}</td>
              <td>
                <span className="bar ask-bar" style={{ width: `${(a[1] / maxQty) * 60}px` }} /> {fmt(a[1], 4)}
              </td>
            </tr>
          ))}
        </tbody>
        <thead>
          <tr><th>Bid</th><th>Qty</th></tr>
        </thead>
        <tbody>
          {bids.map((b, i) => (
            <tr key={`b${i}`}>
              <td className="green">{fmt(b[0], 6)}</td>
              <td>
                <span className="bar bid-bar" style={{ width: `${(b[1] / maxQty) * 60}px` }} /> {fmt(b[1], 4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <BiggestWalls bids={bids} asks={asks} />
    </aside>
  );
}

function BiggestWalls({ bids, asks }: { bids: [number, number][]; asks: [number, number][] }) {
  const bigBid = [...bids].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const bigAsk = [...asks].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="liq-walls">
      <div>
        <div className="dim small">Biggest bid walls</div>
        {bigBid.map((b, i) => (
          <div key={i}><span className="green">{b[0]}</span> · {b[1].toFixed(3)}</div>
        ))}
      </div>
      <div>
        <div className="dim small">Biggest ask walls</div>
        {bigAsk.map((a, i) => (
          <div key={i}><span className="red">{a[0]}</span> · {a[1].toFixed(3)}</div>
        ))}
      </div>
    </div>
  );
}
