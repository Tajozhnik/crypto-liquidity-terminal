"use client";
import { buildHeatmapLegend, type HeatmapMode } from "@/lib/heatmap";

export function HeatmapLegend({ mode }: { mode: HeatmapMode }) {
  const legend = buildHeatmapLegend(mode);
  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend-title">{legend.title}</div>
      <div className="heatmap-legend-swatches">
        {legend.swatches.map((s, i) => (
          <span key={i} className="legend-swatch" style={{ background: s.background, color: s.color }}>
            {s.label}
          </span>
        ))}
      </div>
      {legend.note && <div className="heatmap-legend-note">{legend.note}</div>}
    </div>
  );
}
