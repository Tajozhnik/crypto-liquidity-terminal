"use client";
import {
  HEATMAP_MODES,
  TILE_SIZE_MODES,
  type HeatmapMode,
  type TileSizeMode,
} from "@/lib/heatmap";

interface Props {
  mode: HeatmapMode;
  setMode: (m: HeatmapMode) => void;
  sizeMode: TileSizeMode;
  setSizeMode: (m: TileSizeMode) => void;
}

export function HeatmapControls({ mode, setMode, sizeMode, setSizeMode }: Props) {
  return (
    <div className="heatmap-controls">
      <div className="heatmap-control-group">
        <span className="heatmap-control-label">Color by</span>
        <div className="filter-chips">
          {HEATMAP_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip${mode === m.id ? " active" : ""}`}
              title={m.description}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heatmap-control-group">
        <span className="heatmap-control-label">Size by</span>
        <div className="filter-chips">
          {TILE_SIZE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={m.disabled}
              className={`chip${sizeMode === m.id ? " active" : ""}${m.disabled ? " disabled" : ""}`}
              title={m.disabledReason ?? ""}
              onClick={() => !m.disabled && setSizeMode(m.id)}
            >
              {m.label}
              {m.disabled ? " (n/a)" : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
