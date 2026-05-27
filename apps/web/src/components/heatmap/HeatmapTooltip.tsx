"use client";
import type { ScreenerResult } from "@screener/shared";
import { PriceChange } from "@/components/PriceChange";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SignalBadges } from "@/components/SignalBadges";

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
};

export function HeatmapTooltip({ r }: { r: ScreenerResult }) {
  return (
    <div className="heatmap-tooltip">
      <div className="heatmap-tooltip-header">
        <strong>{r.symbol}</strong>
        <span className="dim">
          {r.exchange} · {r.marketType}
        </span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>Price</span>
        <span>{r.price.toFixed(r.price > 100 ? 2 : 6)}</span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>5m / 15m</span>
        <span>
          <PriceChange value={r.change5m} /> · <PriceChange value={r.change15m} />
        </span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>1h / 24h</span>
        <span>
          <PriceChange value={r.change1h} /> · <PriceChange value={r.change24h} />
        </span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>Volume 24h</span>
        <span>{fmt(r.volume24h)}</span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>Rel volume</span>
        <span>{r.relativeVolume.toFixed(2)}×</span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>Volatility</span>
        <span>{r.volatility.toFixed(2)}</span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>Spread%</span>
        <span>{r.spreadPct.toFixed(3)}%</span>
      </div>
      <div className="heatmap-tooltip-row">
        <span>OB imbalance</span>
        <span>{(r.orderBookImbalance * 100).toFixed(1)}%</span>
      </div>
      {r.marketType === "futures" && (
        <>
          <div className="heatmap-tooltip-row">
            <span>Open interest</span>
            <span>{r.openInterest === null ? "—" : fmt(r.openInterest)}</span>
          </div>
          <div className="heatmap-tooltip-row">
            <span>Funding rate</span>
            <span>{r.fundingRate === null ? "—" : `${(r.fundingRate * 100).toFixed(4)}%`}</span>
          </div>
        </>
      )}
      <div className="heatmap-tooltip-row">
        <span>Score</span>
        <ScoreBadge score={r.signalScore} band={r.scoreBand} />
      </div>
      <div className="heatmap-tooltip-row">
        <span>Signals</span>
        <SignalBadges types={r.activeSignals} />
      </div>
      <div className="heatmap-tooltip-row dim">
        <span>Updated</span>
        <span>{new Date(r.updatedAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
