"use client";
import { calculateHeatmapSummary } from "@/lib/heatmap";
import type { ScreenerResult } from "@screener/shared";
import { useMemo } from "react";

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
};

export function HeatmapSummary({ rows }: { rows: ScreenerResult[] }) {
  const s = useMemo(() => calculateHeatmapSummary(rows), [rows]);
  return (
    <div className="cards heatmap-summary-cards">
      <div className="card">
        <div className="label">Visible</div>
        <div className="value">{s.total}</div>
      </div>
      <div className="card">
        <div className="label">Hot (61–80)</div>
        <div className="value">{s.hot}</div>
      </div>
      <div className="card">
        <div className="label">Extreme (81+)</div>
        <div className="value">{s.extreme}</div>
      </div>
      <div className="card">
        <div className="label">Avg volatility</div>
        <div className="value" style={{ fontSize: 18 }}>{s.avgVolatility.toFixed(2)}</div>
      </div>
      <div className="card">
        <div className="label">Total volume</div>
        <div className="value" style={{ fontSize: 18 }}>{fmt(s.totalVolume)}</div>
      </div>
    </div>
  );
}
