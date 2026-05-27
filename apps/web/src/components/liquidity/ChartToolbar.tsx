"use client";
import type { DrawingTool } from "@/lib/chart/drawingTypes";
import { useChartInteractionStore } from "@/state/useChartInteractionStore";

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitData: () => void;
  onClearAll: () => void;
}

const TOOLS: { id: DrawingTool; label: string; icon: string; group: "nav" | "draw" | "edit" }[] = [
  { id: "cursor", label: "Cursor", icon: "↖", group: "nav" },
  { id: "hand", label: "Hand / Pan", icon: "✋", group: "nav" },
  { id: "horizontal", label: "Horizontal Line", icon: "─", group: "draw" },
  { id: "trend", label: "Trend Line", icon: "╱", group: "draw" },
  { id: "ray", label: "Ray", icon: "→", group: "draw" },
  { id: "rectangle", label: "Rectangle", icon: "▭", group: "draw" },
  { id: "text", label: "Text Label", icon: "T", group: "draw" },
  { id: "eraser", label: "Eraser", icon: "✕", group: "edit" },
];

export function ChartToolbar({ onZoomIn, onZoomOut, onResetView, onFitData, onClearAll }: Props) {
  const tool = useChartInteractionStore((s) => s.tool);
  const setTool = useChartInteractionStore((s) => s.setTool);
  return (
    <div className="chart-toolbar" role="toolbar" aria-label="Chart tools">
      <div className="chart-toolbar-group">
        {TOOLS.filter((t) => t.group === "nav").map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chart-tool${tool === t.id ? " active" : ""}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <span className="chart-tool-icon">{t.icon}</span>
            <span className="chart-tool-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="chart-toolbar-divider" />
      <div className="chart-toolbar-group">
        {TOOLS.filter((t) => t.group === "draw").map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chart-tool${tool === t.id ? " active" : ""}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <span className="chart-tool-icon">{t.icon}</span>
            <span className="chart-tool-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="chart-toolbar-divider" />
      <div className="chart-toolbar-group">
        {TOOLS.filter((t) => t.group === "edit").map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chart-tool${tool === t.id ? " active" : ""}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <span className="chart-tool-icon">{t.icon}</span>
            <span className="chart-tool-label">{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="chart-tool"
          title="Clear all drawings"
          onClick={() => {
            if (window.confirm("Remove all drawings?")) onClearAll();
          }}
        >
          <span className="chart-tool-icon">⌫</span>
          <span className="chart-tool-label">Clear All</span>
        </button>
      </div>
      <div className="chart-toolbar-divider" />
      <div className="chart-toolbar-group">
        <button type="button" className="chart-tool" title="Zoom in" onClick={onZoomIn}>
          <span className="chart-tool-icon">＋</span>
        </button>
        <button type="button" className="chart-tool" title="Zoom out" onClick={onZoomOut}>
          <span className="chart-tool-icon">−</span>
        </button>
        <button type="button" className="chart-tool" title="Reset view" onClick={onResetView}>
          <span className="chart-tool-icon">⟲</span>
          <span className="chart-tool-label">Reset</span>
        </button>
        <button type="button" className="chart-tool" title="Fit to data" onClick={onFitData}>
          <span className="chart-tool-icon">⛶</span>
          <span className="chart-tool-label">Fit</span>
        </button>
      </div>
    </div>
  );
}
