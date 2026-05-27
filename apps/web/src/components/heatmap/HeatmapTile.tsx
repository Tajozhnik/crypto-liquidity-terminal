"use client";
import type { ScreenerResult } from "@screener/shared";
import Link from "next/link";
import { memo, useState } from "react";
import { SignalBadges } from "@/components/SignalBadges";
import { getHeatmapColor, getHeatmapMetric, type HeatmapMode } from "@/lib/heatmap";
import { HeatmapTooltip } from "./HeatmapTooltip";

interface Props {
  r: ScreenerResult;
  mode: HeatmapMode;
  /** Grid span in 12-column rows. Computed by HeatmapGrid from tile size weight. */
  span: { col: number; row: number };
}

function tileEqual(a: Props, b: Props) {
  if (a.mode !== b.mode) return false;
  if (a.span.col !== b.span.col || a.span.row !== b.span.row) return false;
  const ar = a.r;
  const br = b.r;
  return (
    ar.symbol === br.symbol &&
    ar.price === br.price &&
    ar.change24h === br.change24h &&
    ar.signalScore === br.signalScore &&
    ar.scoreBand === br.scoreBand &&
    ar.volume24h === br.volume24h &&
    ar.relativeVolume === br.relativeVolume &&
    ar.volatility === br.volatility &&
    ar.spreadPct === br.spreadPct &&
    ar.openInterest === br.openInterest &&
    ar.fundingRate === br.fundingRate &&
    ar.activeSignals.length === br.activeSignals.length &&
    ar.activeSignals.every((s, i) => s === br.activeSignals[i])
  );
}

export const HeatmapTile = memo(function HeatmapTileImpl({ r, mode, span }: Props) {
  const color = getHeatmapColor(r, mode);
  const metric = getHeatmapMetric(r, mode);
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={`/markets/${encodeURIComponent(r.symbol)}`}
      className={`heatmap-tile${color.muted ? " muted" : ""}`}
      style={{
        background: color.background,
        color: color.color,
        gridColumn: `span ${span.col}`,
        gridRow: `span ${span.row}`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${r.symbol} ${metric.display}`}
    >
      <div className="heatmap-tile-symbol">{r.symbol}</div>
      <div className="heatmap-tile-price">
        {r.price.toFixed(r.price > 100 ? 2 : r.price > 1 ? 4 : 6)}
      </div>
      <div className="heatmap-tile-metric">{metric.display}</div>
      {span.col >= 2 && span.row >= 2 && (
        <div className="heatmap-tile-foot">
          <span className="heatmap-tile-score">{r.signalScore}</span>
          {r.activeSignals.length > 0 && <SignalBadges types={r.activeSignals.slice(0, 3)} />}
        </div>
      )}
      {hover && (
        <div className="heatmap-tile-tooltip">
          <HeatmapTooltip r={r} />
        </div>
      )}
    </Link>
  );
}, tileEqual);
