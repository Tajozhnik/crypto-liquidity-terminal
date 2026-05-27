"use client";
import type { ScreenerResult } from "@screener/shared";
import { useMemo } from "react";
import { getTileSizeWeight, type HeatmapMode, type TileSizeMode } from "@/lib/heatmap";
import { HeatmapTile } from "./HeatmapTile";

const COLUMNS = 12;
const MIN_SPAN = 1;
const MAX_SPAN = 4;

interface Props {
  rows: ScreenerResult[];
  mode: HeatmapMode;
  sizeMode: TileSizeMode;
}

/**
 * CSS-grid layout. Tile spans (col×row) are derived from a normalized weight,
 * bucketed into 1..4. This is much more stable under live updates than a real
 * treemap re-layout, and renders smoothly at 300 markets.
 */
export function HeatmapGrid({ rows, mode, sizeMode }: Props) {
  const tiles = useMemo(() => {
    if (rows.length === 0) return [];
    const weights = rows.map((r) => getTileSizeWeight(r, sizeMode));
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    const span = max - min || 1;

    return rows.map((r, i) => {
      const norm = (weights[i]! - min) / span; // 0..1
      let bucket = 1 + Math.round(norm * (MAX_SPAN - MIN_SPAN));
      if (sizeMode === "equal" || sizeMode === "market_cap") bucket = 1;
      const colSpan = Math.max(1, Math.min(MAX_SPAN, bucket));
      const rowSpan = Math.max(1, Math.min(MAX_SPAN, Math.ceil(bucket / 1.4)));
      return { r, col: colSpan, row: rowSpan };
    });
  }, [rows, sizeMode]);

  if (rows.length === 0) {
    return (
      <div className="empty heatmap-empty">
        No markets match the current filters. Adjust filters or click Reset.
      </div>
    );
  }

  return (
    <div
      className="heatmap-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: "60px",
        gap: 4,
      }}
    >
      {tiles.map(({ r, col, row }) => (
        <HeatmapTile key={r.symbol} r={r} mode={mode} span={{ col, row }} />
      ))}
    </div>
  );
}
