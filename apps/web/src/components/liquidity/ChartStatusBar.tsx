"use client";
import { useChartInteractionStore } from "@/state/useChartInteractionStore";
import { zoomPercent } from "@/lib/chart/viewport";

const REFERENCE_SPAN_MS = 30 * 60_000;

export function ChartStatusBar() {
  const vp = useChartInteractionStore((s) => s.viewport);
  const tool = useChartInteractionStore((s) => s.tool);
  const drawings = useChartInteractionStore((s) => s.drawings);
  const fmtT = (t: number) =>
    new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtP = (p: number) => p.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return (
    <div className="chart-statusbar">
      <span><span className="dim">Tool:</span> {tool}</span>
      <span><span className="dim">Zoom:</span> {zoomPercent(vp, REFERENCE_SPAN_MS)}%</span>
      <span><span className="dim">Time:</span> {fmtT(vp.timeStart)} – {fmtT(vp.timeEnd)}</span>
      <span><span className="dim">Price:</span> {fmtP(vp.priceMin)} – {fmtP(vp.priceMax)}</span>
      <span><span className="dim">Drawings:</span> {drawings.length}</span>
      <span className="dim chart-hint">
        Wheel: zoom time · Shift/Ctrl+wheel: zoom price · Drag: pan · Toolbar for drawings
      </span>
    </div>
  );
}
