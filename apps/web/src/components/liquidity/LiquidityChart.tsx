"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  panPrice,
  panTime,
  priceToY,
  timeToX,
  xToTime,
  yToPrice,
  zoomPrice,
  zoomTime,
  type Viewport,
} from "@/lib/chart/viewport";
import {
  renderCandles,
  renderHeatmap,
  type RenderConfig,
} from "@/lib/liquidity/canvasRenderer";
import { findCellAt, timeframeMs } from "@/lib/liquidity/binning";
import { getPlotArea, BOTTOM_TIME_AXIS_PX, RIGHT_PRICE_AXIS_PX } from "@/lib/liquidity/plotLayout";
import { renderDrawings } from "@/lib/chart/drawingRenderer";
import { hitTest } from "@/lib/chart/drawingHitTest";
import { newId, type Drawing } from "@/lib/chart/drawingTypes";
import { useChartInteractionStore } from "@/state/useChartInteractionStore";
import { useLiquidityStore } from "@/state/useLiquidityStore";

interface TooltipState {
  x: number;
  y: number;
  price: number;
  time: number;
  bidLiquidity?: number;
  askLiquidity?: number;
}

const PRICE_AXIS_HIT = 50; // pixels from the right edge that act as the price-scale handle
const TIME_AXIS_HIT = 16; // pixels from the bottom edge that act as the time-scale handle

interface DragState {
  kind: "pan-chart" | "scale-time" | "scale-price" | "draw" | "draw-rectangle" | null;
  startX: number;
  startY: number;
  startVp: Viewport;
  /** For drawing tools that capture a starting domain anchor. */
  startTime?: number;
  startPrice?: number;
  movedPx?: number;
}

export function LiquidityChart({ width, height }: { width: number; height: number }) {
  const heatmapRef = useRef<HTMLCanvasElement>(null);
  const candleRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState>({ kind: null, startX: 0, startY: 0, startVp: blankVp() });

  const matrix = useLiquidityStore((s) => s.matrix);
  const candles = useLiquidityStore((s) => s.candles);
  const ob = useLiquidityStore((s) => s.orderBook);
  const status = useLiquidityStore((s) => s.status);
  const intensity = useLiquidityStore((s) => s.intensity);
  const logScale = useLiquidityStore((s) => s.logScale);
  const sideMode = useLiquidityStore((s) => s.sideMode);
  const showCandles = useLiquidityStore((s) => s.showCandles);
  const timeframe = useLiquidityStore((s) => s.timeframe);
  // Density-pipeline controls — when present these override the legacy
  // colour path inside `renderHeatmap`.
  const densityMode = useLiquidityStore((s) => s.densityMode);
  const gamma = useLiquidityStore((s) => s.gamma);
  const capPercentile = useLiquidityStore((s) => s.capPercentile);
  const minOpacity = useLiquidityStore((s) => s.minOpacity);
  const maxOpacity = useLiquidityStore((s) => s.maxOpacity);
  const hideWeak = useLiquidityStore((s) => s.hideWeak);
  const strongOnly = useLiquidityStore((s) => s.strongOnly);
  const glow = useLiquidityStore((s) => s.glow);

  const vp = useChartInteractionStore((s) => s.viewport);
  const setVp = useChartInteractionStore((s) => s.setViewport);
  const tool = useChartInteractionStore((s) => s.tool);
  const drawings = useChartInteractionStore((s) => s.drawings);
  const selectedId = useChartInteractionStore((s) => s.selectedId);
  const setSelected = useChartInteractionStore((s) => s.setSelected);
  const addDrawing = useChartInteractionStore((s) => s.addDrawing);
  const removeDrawing = useChartInteractionStore((s) => s.removeDrawing);
  const pending = useChartInteractionStore((s) => s.pendingDrawing);
  const setPending = useChartInteractionStore((s) => s.setPending);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const cfg = useMemo<RenderConfig>(() => {
    // Heatmap cell width on the time axis comes from the matrix's actual
    // bucket size (decoupled from candle timeframe). Falls back to candle
    // timeframe only if the matrix isn't loaded yet.
    const matrixBucketMs = matrix?.debugStats?.timeBucketMs;
    const tfMs = matrixBucketMs && matrixBucketMs > 0
      ? matrixBucketMs
      : timeframeMs(timeframe);
    // Single source of truth for the X-axis plot area — the volume /
    // delta histogram below uses the same helper, so bars line up
    // pixel-for-pixel under each candle body.
    const plot = getPlotArea(width);
    return {
      priceScale: {
        priceMin: vp.priceMin,
        priceMax: vp.priceMax,
        yTop: 4,
        yBottom: height - BOTTOM_TIME_AXIS_PX,
      },
      timeScale: {
        timeMin: vp.timeStart,
        timeMax: vp.timeEnd,
        xLeft: plot.xLeft,
        xRight: plot.xRight,
      },
      binWidth: matrix?.binWidth ?? 0,
      timeBucketMs: tfMs,
      candleMs: timeframeMs(timeframe),
      colorOpts: { intensityMultiplier: intensity, logScale, sideMode },
      density: {
        mode: densityMode,
        capPercentile,
        gamma,
        minOpacity,
        maxOpacity,
        hideWeakBelow: hideWeak ? 0.55 : 0,
        strongOnlyAbove: strongOnly ? 0.85 : 0,
        glow,
      },
      densitySide: sideMode,
    };
  }, [
    vp,
    matrix,
    intensity,
    logScale,
    sideMode,
    timeframe,
    width,
    height,
    densityMode,
    capPercentile,
    gamma,
    minOpacity,
    maxOpacity,
    hideWeak,
    strongOnly,
    glow,
  ]);

  // Heatmap layer
  useEffect(() => {
    const c = heatmapRef.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (matrix && matrix.cells.length > 0) renderHeatmap(ctx, matrix.cells, cfg);
    else ctx.clearRect(0, 0, width, height);
  }, [matrix, cfg, width, height]);

  // Candle + price line + axes + "no liquidity history" shading
  useEffect(() => {
    const c = candleRef.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (showCandles && candles.length > 0) renderCandles(ctx, candles.slice(-300), cfg);
    if (ob && ob.midPrice >= vp.priceMin && ob.midPrice <= vp.priceMax) {
      const y = priceToY(ob.midPrice, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cfg.timeScale.xLeft, y);
      ctx.lineTo(cfg.timeScale.xRight, y);
      ctx.stroke();
      ctx.restore();
    }
    drawAxes(ctx, vp, cfg, width, height);
    drawNoHistoryZone(ctx, vp, cfg, status?.startedAt ?? null);
  }, [candles, ob, status, showCandles, vp, cfg, width, height]);

  // Drawings layer
  useEffect(() => {
    const c = drawingRef.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    renderDrawings(
      ctx,
      drawings,
      vp,
      {
        xLeft: cfg.timeScale.xLeft,
        xRight: cfg.timeScale.xRight,
        yTop: cfg.priceScale.yTop,
        yBottom: cfg.priceScale.yBottom,
      },
      selectedId,
      pending,
    );
  }, [drawings, vp, selectedId, pending, cfg, width, height]);

  // Crosshair overlay (cleared on every move)
  const drawCrosshair = useCallback(
    (x: number, y: number) => {
      const c = overlayRef.current;
      if (!c) return;
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (
        x < cfg.timeScale.xLeft ||
        x > cfg.timeScale.xRight ||
        y < cfg.priceScale.yTop ||
        y > cfg.priceScale.yBottom
      ) {
        return;
      }
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(cfg.timeScale.xLeft, y);
      ctx.lineTo(cfg.timeScale.xRight, y);
      ctx.moveTo(x, cfg.priceScale.yTop);
      ctx.lineTo(x, cfg.priceScale.yBottom);
      ctx.stroke();
      ctx.restore();
    },
    [cfg, width, height],
  );

  const eventToCanvas = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * width) / rect.width;
    const y = ((e.clientY - rect.top) * height) / rect.height;
    return { x, y };
  };

  // ---------------------------------------------------------------- handlers

  const isInPriceAxis = (x: number) => x >= width - RIGHT_PRICE_AXIS_PX;
  const isInTimeAxis = (y: number) => y >= height - BOTTOM_TIME_AXIS_PX;

  // Stable refs so the native wheel listener can read current state without
  // having to re-attach on every viewport change.
  const vpRef = useRef(vp);
  const cfgRef = useRef(cfg);
  useEffect(() => {
    vpRef.current = vp;
  }, [vp]);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  // Native non-passive wheel listener — React's synthetic wheel handler is
  // attached as passive in modern browsers, which prevents preventDefault from
  // working and lets the page scroll. We bind directly to the canvas DOM node.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * width) / rect.width;
      const y = ((e.clientY - rect.top) * height) / rect.height;
      const curVp = vpRef.current;
      const curCfg = cfgRef.current;
      const t = xToTime(x, curVp, curCfg.timeScale.xLeft, curCfg.timeScale.xRight);
      const p = yToPrice(y, curVp, curCfg.priceScale.yTop, curCfg.priceScale.yBottom);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      if (e.ctrlKey || e.shiftKey || isInPriceAxis(x)) {
        setVp((prev) => zoomPrice(prev, p, factor));
      } else {
        setVp((prev) => zoomTime(prev, t, factor));
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, setVp]);

  const cursorCss = useMemo(() => {
    switch (tool) {
      case "hand":
        return "grab";
      case "horizontal":
      case "trend":
      case "ray":
      case "rectangle":
      case "text":
        return "crosshair";
      case "eraser":
        return "not-allowed";
      default:
        return "crosshair";
    }
  }, [tool]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = eventToCanvas(e);
    const t = xToTime(x, vp, cfg.timeScale.xLeft, cfg.timeScale.xRight);
    const p = yToPrice(y, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);

    // Scale handles take precedence over chart drag
    if (isInPriceAxis(x)) {
      dragRef.current = { kind: "scale-price", startX: x, startY: y, startVp: vp };
      return;
    }
    if (isInTimeAxis(y)) {
      dragRef.current = { kind: "scale-time", startX: x, startY: y, startVp: vp };
      return;
    }

    if (tool === "hand" || (tool === "cursor" && e.altKey)) {
      dragRef.current = { kind: "pan-chart", startX: x, startY: y, startVp: vp };
      return;
    }

    if (tool === "cursor") {
      const hit = hitTest(
        drawings,
        { x, y },
        vp,
        {
          xLeft: cfg.timeScale.xLeft,
          xRight: cfg.timeScale.xRight,
          yTop: cfg.priceScale.yTop,
          yBottom: cfg.priceScale.yBottom,
        },
      );
      setSelected(hit?.id ?? null);
      // Cursor mode also pans on drag for convenience
      dragRef.current = { kind: "pan-chart", startX: x, startY: y, startVp: vp, movedPx: 0 };
      return;
    }

    if (tool === "eraser") {
      const hit = hitTest(
        drawings,
        { x, y },
        vp,
        {
          xLeft: cfg.timeScale.xLeft,
          xRight: cfg.timeScale.xRight,
          yTop: cfg.priceScale.yTop,
          yBottom: cfg.priceScale.yBottom,
        },
      );
      if (hit) removeDrawing(hit.id);
      return;
    }

    if (tool === "horizontal") {
      addDrawing({ id: newId(), createdAt: Date.now(), type: "horizontal", price: p });
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Label text", "");
      if (text && text.trim()) {
        addDrawing({ id: newId(), createdAt: Date.now(), type: "text", t, price: p, text: text.trim() });
      }
      return;
    }
    if (tool === "trend" || tool === "ray") {
      if (!pending) {
        setPending({ id: "pending", createdAt: Date.now(), type: tool, t1: t, p1: p, t2: t, p2: p });
      } else if (pending.type === tool) {
        addDrawing({ ...pending, id: newId(), t2: t, p2: p });
        setPending(null);
      }
      return;
    }
    if (tool === "rectangle") {
      dragRef.current = {
        kind: "draw-rectangle",
        startX: x,
        startY: y,
        startVp: vp,
        startTime: t,
        startPrice: p,
      };
      setPending({ id: "pending", createdAt: Date.now(), type: "rectangle", t1: t, p1: p, t2: t, p2: p });
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = eventToCanvas(e);
    drawCrosshair(x, y);

    // Update tooltip for cells under cursor
    if (matrix && matrix.cells.length > 0) {
      const t = xToTime(x, vp, cfg.timeScale.xLeft, cfg.timeScale.xRight);
      const p = yToPrice(y, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);
      const cell = findCellAt(matrix.cells, t, p, matrix.binWidth, cfg.timeBucketMs);
      if (cell) {
        setTooltip({ x, y, price: cell.price, time: cell.t, bidLiquidity: cell.bidLiquidity, askLiquidity: cell.askLiquidity });
      } else {
        setTooltip({ x, y, price: p, time: t });
      }
    } else {
      const t = xToTime(x, vp, cfg.timeScale.xLeft, cfg.timeScale.xRight);
      const p = yToPrice(y, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);
      setTooltip({ x, y, price: p, time: t });
    }

    const drag = dragRef.current;
    if (drag.kind === null) return;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const widthPx = cfg.timeScale.xRight - cfg.timeScale.xLeft;
    const heightPx = cfg.priceScale.yBottom - cfg.priceScale.yTop;

    if (drag.kind === "pan-chart") {
      // Direct manipulation: drag left → time scrolls left; drag down →
      // viewport's price window slides down so the chart moves with the
      // cursor (not against it). The previous `-dy` was inverted.
      let v = drag.startVp;
      v = panTime(v, dx, widthPx);
      v = panPrice(v, dy, heightPx);
      setVp(v);
      drag.movedPx = (drag.movedPx ?? 0) + Math.abs(dx) + Math.abs(dy);
    } else if (drag.kind === "scale-time") {
      // Drag right → compress (zoom in time)
      const factor = 1 + (-dx / widthPx) * 1.5;
      const safeFactor = Math.max(0.2, Math.min(5, factor));
      const anchor = (drag.startVp.timeStart + drag.startVp.timeEnd) / 2;
      setVp(zoomTime(drag.startVp, anchor, safeFactor));
    } else if (drag.kind === "scale-price") {
      // Drag down → compress (zoom in price)
      const factor = 1 + (dy / heightPx) * 1.5;
      const safeFactor = Math.max(0.2, Math.min(5, factor));
      const anchor = (drag.startVp.priceMin + drag.startVp.priceMax) / 2;
      setVp(zoomPrice(drag.startVp, anchor, safeFactor));
    } else if (drag.kind === "draw-rectangle" && drag.startTime !== undefined && drag.startPrice !== undefined) {
      const t = xToTime(x, vp, cfg.timeScale.xLeft, cfg.timeScale.xRight);
      const p = yToPrice(y, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);
      setPending({
        id: "pending",
        createdAt: Date.now(),
        type: "rectangle",
        t1: drag.startTime,
        p1: drag.startPrice,
        t2: t,
        p2: p,
      });
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.kind === "draw-rectangle" && pending && pending.type === "rectangle") {
      // Commit the rectangle if it has size
      if (Math.abs(pending.t1 - pending.t2) > 0 && Math.abs(pending.p1 - pending.p2) > 0) {
        addDrawing({ ...pending, id: newId() });
      }
      setPending(null);
    }
    dragRef.current = { kind: null, startX: 0, startY: 0, startVp: vp };
    void e;
  };

  const onMouseLeave = () => {
    setTooltip(null);
    const c = overlayRef.current;
    const ctx = c?.getContext("2d");
    ctx?.clearRect(0, 0, width, height);
  };

  // Keyboard delete + escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          removeDrawing(selectedId);
          e.preventDefault();
        }
      } else if (e.key === "Escape") {
        setSelected(null);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, removeDrawing, setSelected, setPending]);

  return (
    <div className="liq-chart" style={{ width, height, cursor: cursorCss }}>
      <canvas ref={heatmapRef} className="liq-canvas" />
      <canvas ref={candleRef} className="liq-canvas" />
      <canvas ref={drawingRef} className="liq-canvas" />
      <canvas
        ref={overlayRef}
        className="liq-canvas liq-canvas-overlay"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
      {tooltip && <Tooltip t={tooltip} />}
    </div>
  );
}

function blankVp(): Viewport {
  const now = Date.now();
  return { timeStart: now - 60_000, timeEnd: now, priceMin: 0, priceMax: 1, autoFit: true };
}

function Tooltip({ t }: { t: TooltipState }) {
  return (
    <div
      className="liq-tooltip"
      style={{ left: Math.min(t.x + 12, 800), top: Math.max(8, t.y - 90) }}
    >
      <div><span className="dim">Time</span> {new Date(t.time).toLocaleTimeString()}</div>
      <div><span className="dim">Price</span> {t.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
      {t.bidLiquidity !== undefined && (
        <div><span className="dim">Bid liq</span> {abbrev(t.bidLiquidity)}</div>
      )}
      {t.askLiquidity !== undefined && (
        <div><span className="dim">Ask liq</span> {abbrev(t.askLiquidity)}</div>
      )}
    </div>
  );
}

function abbrev(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cfg: RenderConfig,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px -apple-system, sans-serif";
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const price = vp.priceMin + ((vp.priceMax - vp.priceMin) * i) / ticks;
    const y = priceToY(price, vp, cfg.priceScale.yTop, cfg.priceScale.yBottom);
    const decimals = price > 1000 ? 1 : price > 1 ? 4 : 8;
    ctx.fillText(price.toFixed(decimals), cfg.timeScale.xRight + 4, y + 3);
  }
  for (let i = 0; i <= 5; i++) {
    const t = vp.timeStart + ((vp.timeEnd - vp.timeStart) * i) / 5;
    const x = cfg.timeScale.xLeft + ((cfg.timeScale.xRight - cfg.timeScale.xLeft) * i) / 5;
    ctx.fillText(
      new Date(t).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      Math.max(cfg.timeScale.xLeft, x - 22),
      height - 4,
    );
  }
  ctx.restore();
}

/**
 * Draw a thin vertical "heatmap collection started" marker at the timestamp
 * when the feed for the current symbol opened its WS connection. The chart
 * area to the left of the marker is where candles exist but the live order
 * book heatmap does not — the marker tells the user this is by design and
 * not a missing-data bug. We deliberately do NOT shade the pre-feed area:
 * the candles, current-price line and grid stay readable, and panning the
 * chart left feels like normal scrolling instead of dragging into a void.
 */
function drawNoHistoryZone(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cfg: RenderConfig,
  feedStartedAt: string | null,
): void {
  if (!feedStartedAt) return;
  const startedMs = Date.parse(feedStartedAt);
  if (!Number.isFinite(startedMs)) return;
  if (startedMs <= vp.timeStart || startedMs >= vp.timeEnd) return; // marker off-screen
  const xLeft = cfg.timeScale.xLeft;
  const xRight = cfg.timeScale.xRight;
  const yTop = cfg.priceScale.yTop;
  const yBottom = cfg.priceScale.yBottom;
  const span = vp.timeEnd - vp.timeStart;
  if (span <= 0) return;
  const xMarker = xLeft + ((startedMs - vp.timeStart) / span) * (xRight - xLeft);
  ctx.save();
  ctx.strokeStyle = "rgba(245,165,36,0.55)";
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(xMarker, yTop);
  ctx.lineTo(xMarker, yBottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(245,165,36,0.95)";
  ctx.font = "11px -apple-system, sans-serif";
  const label = "heatmap collection started";
  const textW = ctx.measureText(label).width;
  // Prefer label to the right of the marker; flip to the left if it would
  // run off the chart's right edge.
  const labelX =
    xMarker + 6 + textW < xRight ? xMarker + 6 : Math.max(xLeft + 6, xMarker - 6 - textW);
  ctx.fillText(label, labelX, yTop + 14);
  ctx.restore();
}
