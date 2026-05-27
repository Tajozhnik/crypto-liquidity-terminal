"use client";
import { useEffect, useRef } from "react";
import { useChartInteractionStore } from "@/state/useChartInteractionStore";
import { useLiquidityStore } from "@/state/useLiquidityStore";
import {
  buildDeltaBars,
  buildVolumeBars,
  renderDeltaBars,
  renderVolumeBars,
  timeframeToMs,
  type VolumeLayout,
} from "@/lib/liquidity/volumeRenderer";
import { getPlotArea } from "@/lib/liquidity/plotLayout";

const PANEL_PADDING = 6;
/** When delta data has fewer than this many usable buckets, fall back to candle volume. */
const MIN_DELTA_BUCKETS_FOR_DELTA_MODE = 2;

/**
 * Per-candle volume / delta histogram aligned to the main chart viewport.
 * Bars match the candle BODY geometry from `plotLayout.ts` exactly, so on
 * any timeframe / zoom / pan the bar sits directly under its candle.
 *
 * In delta mode with < 2 buckets we fall back to volume bars so the panel
 * never renders one fat block.
 */
export function VolumeHistogram({
  width,
  height = 110,
  mode = "volume",
}: {
  width: number;
  height?: number;
  mode?: "volume" | "delta";
}) {
  const candles = useLiquidityStore((s) => s.candles);
  const buckets = useLiquidityStore((s) => s.delta);
  const timeframe = useLiquidityStore((s) => s.timeframe);
  const viewport = useChartInteractionStore((s) => s.viewport);
  const ref = useRef<HTMLCanvasElement>(null);

  const fallbackToVolume = mode === "delta" && buckets.length < MIN_DELTA_BUCKETS_FOR_DELTA_MODE;
  const effectiveMode = fallbackToVolume ? "volume" : mode;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = width;
    c.height = height;
    ctx.clearRect(0, 0, width, height);

    // Use the SAME plot area helper as the candle / heatmap layers so xLeft
    // / xRight match exactly. This is the single source of truth for the
    // chart's horizontal geometry.
    const plot = getPlotArea(width);
    const layout: VolumeLayout = {
      xLeft: plot.xLeft,
      xRight: plot.xRight,
      yTop: PANEL_PADDING,
      yBottom: height - PANEL_PADDING,
    };
    const tfMs = timeframeToMs(timeframe);

    if (effectiveMode === "delta") {
      const bars = buildDeltaBars(buckets, viewport, layout, tfMs);
      renderDeltaBars(ctx, bars, buckets, viewport, layout, tfMs);
      return;
    }
    if (candles.length === 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(layout.xLeft, layout.yBottom);
      ctx.lineTo(layout.xRight, layout.yBottom);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const bars = buildVolumeBars(candles, viewport, layout, tfMs);
    renderVolumeBars(ctx, bars, layout);
  }, [candles, buckets, viewport, timeframe, effectiveMode, width, height]);

  return (
    <div className="liq-volume-wrap">
      <canvas ref={ref} className="liq-volume" />
      {fallbackToVolume && (
        <span className="liq-volume-fallback">
          Waiting for trade delta — showing candle volume
        </span>
      )}
    </div>
  );
}
