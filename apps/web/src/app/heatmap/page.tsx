"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartStatusBar } from "@/components/liquidity/ChartStatusBar";
import { ChartToolbar } from "@/components/liquidity/ChartToolbar";
import { LiquidityChart } from "@/components/liquidity/LiquidityChart";
import { LiquidityControls } from "@/components/liquidity/LiquidityControls";
import { OrderBookPanel } from "@/components/liquidity/OrderBookPanel";
import { VolumeHistogram } from "@/components/liquidity/VolumeHistogram";
import { ApiError, api } from "@/lib/api";
import { loadDrawings, saveDrawings } from "@/lib/chart/drawingStorage";
import {
  fitViewportToLiveWindow,
  zoomTime,
  type Viewport,
} from "@/lib/chart/viewport";
import type { HeatmapMatrix } from "@/lib/liquidity/binning";
import {
  defaultLookbackForTimeframe,
  lookbackToQuery,
  lookbackToVisibleRangeMs,
} from "@/lib/liquidity/lookback";
import { useScreenerWebSocket } from "@/lib/ws";
import { useChartInteractionStore } from "@/state/useChartInteractionStore";
import { useLiquidityStore } from "@/state/useLiquidityStore";

const POLL_MS = 2000;
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];

export default function LiquidityHeatmapPage() {
  // Mount the global market WebSocket so the topbar Connected badge stays in
  // sync with every other page.
  useScreenerWebSocket();
  const symbol = useLiquidityStore((s) => s.symbol);
  const marketType = useLiquidityStore((s) => s.marketType);
  const timeframe = useLiquidityStore((s) => s.timeframe);
  const binSize = useLiquidityStore((s) => s.binSize);
  const depthLevels = useLiquidityStore((s) => s.depthLevels);
  const heatmapLookback = useLiquidityStore((s) => s.heatmapLookback);
  const heatmapLookbackUserSet = useLiquidityStore((s) => s.heatmapLookbackUserSet);
  const setControls = useLiquidityStore((s) => s.setControls);
  const showDelta = useLiquidityStore((s) => s.showDelta);
  const setMatrix = useLiquidityStore((s) => s.setMatrix);
  const setCandles = useLiquidityStore((s) => s.setCandles);
  const setOrderBook = useLiquidityStore((s) => s.setOrderBook);
  const setDelta = useLiquidityStore((s) => s.setDelta);
  const setStatus = useLiquidityStore((s) => s.setStatus);
  const setConnection = useLiquidityStore((s) => s.setConnection);
  const setError = useLiquidityStore((s) => s.setError);
  const matrix = useLiquidityStore((s) => s.matrix);
  const candles = useLiquidityStore((s) => s.candles);
  const status = useLiquidityStore((s) => s.status);
  const error = useLiquidityStore((s) => s.error);
  const connection = useLiquidityStore((s) => s.connection);

  const viewport = useChartInteractionStore((s) => s.viewport);
  const setViewport = useChartInteractionStore((s) => s.setViewport);
  const setDrawings = useChartInteractionStore((s) => s.setDrawings);
  const drawings = useChartInteractionStore((s) => s.drawings);
  const clearDrawings = useChartInteractionStore((s) => s.clearDrawings);

  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [size, setSize] = useState({ width: 900, height: 460 });
  const wrap = useRef<HTMLDivElement>(null);

  // Load symbols
  useEffect(() => {
    let cancelled = false;
    void api
      .liquiditySymbols({ exchange: "binance", marketType })
      .then((r) => {
        if (!cancelled && r.symbols.length > 0) setSymbols(r.symbols);
      })
      .catch(() => {
        if (!cancelled) setSymbols(FALLBACK_SYMBOLS);
      });
    return () => {
      cancelled = true;
    };
  }, [marketType]);

  // Resize observer
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.max(400, r.width - 280), height: 460 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load drawings on symbol/marketType change
  useEffect(() => {
    setDrawings(loadDrawings("binance", marketType, symbol));
  }, [symbol, marketType, setDrawings]);

  // Persist drawings on every change
  useEffect(() => {
    saveDrawings("binance", marketType, symbol, drawings);
  }, [drawings, symbol, marketType]);

  // When timeframe / symbol / marketType changes: clear stale matrix/candles/
  // delta/order book and reset the viewport to a "live window" anchored on
  // now. We cannot reuse the previous symbol's heatmap cells, and the new
  // symbol's heatmap starts accumulating from zero on the backend.
  useEffect(() => {
    setMatrix(null);
    setCandles([]);
    setDelta([]);
    setOrderBook(null);
    setStatus(null);
    setViewport((vp) => ({ ...vp, autoFit: true }));
  }, [symbol, marketType, timeframe, setMatrix, setCandles, setDelta, setOrderBook, setStatus, setViewport]);

  // Compute an adaptive heatmap bucket size: target ~120 columns across the
  // plotting width, snapped to a "nice" step (1/2/5/10/15/30/60 s). Capped
  // at 60 s so the heatmap never collapses to one column per candle on
  // 5m/15m timeframes — users want to see the depth fluctuating *inside*
  // each candle.
  const heatmapBucketMs = useMemo(() => {
    const visibleMs = Math.max(0, viewport.timeEnd - viewport.timeStart);
    const innerWidth = Math.max(200, size.width - 280);
    if (visibleMs <= 0 || innerWidth <= 0) return 5_000;
    const target = Math.max(60, Math.min(180, innerWidth / 8));
    const raw = visibleMs / target;
    const NICE = [250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000];
    for (const step of NICE) if (raw <= step) return step;
    return NICE[NICE.length - 1]!; // hard cap at 60 s
  }, [viewport.timeStart, viewport.timeEnd, size.width]);

  // Mutable ref so the polling loop reads the current value without
  // re-subscribing on every viewport tick (which would tear down + re-fetch).
  const heatmapBucketMsRef = useRef(heatmapBucketMs);
  useEffect(() => {
    heatmapBucketMsRef.current = heatmapBucketMs;
  }, [heatmapBucketMs]);

  // Same trick for the price window — but we DO NOT use it on every poll.
  // Sending the live viewport into the snapshot fetch made the heatmap
  // re-build server-side on every wheel/pan event, so cells appeared to
  // "jump". The matrix is now stable: server uses its own ±2 % cap around
  // mid by default, and we only forward the viewport to the API when the
  // user explicitly clicks "Rebuild for visible range".
  const priceWindowRef = useRef<{ priceMin: number; priceMax: number } | null>(null);
  /**
   * Rebuild epoch — bumped when the user clicks "Rebuild for visible range".
   * Read inside the polling loop via a ref so a click triggers exactly one
   * fetch with the explicit window without tearing the loop down.
   */
  const rebuildEpochRef = useRef(0);
  const [rebuildBanner, setRebuildBanner] = useState<string | null>(null);
  const requestRebuildForViewport = useCallback(() => {
    priceWindowRef.current = { priceMin: viewport.priceMin, priceMax: viewport.priceMax };
    rebuildEpochRef.current += 1;
    setRebuildBanner(
      `Rebuilding heatmap for ${viewport.priceMin.toFixed(2)} – ${viewport.priceMax.toFixed(2)}…`,
    );
  }, [viewport.priceMin, viewport.priceMax]);

  // When the user changes timeframe and hasn't manually picked a lookback,
  // pick the timeframe-appropriate default automatically (15m/30m/1h/4h).
  useEffect(() => {
    if (heatmapLookbackUserSet) return;
    const next = defaultLookbackForTimeframe(timeframe);
    if (next !== heatmapLookback) setControls({ heatmapLookback: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, heatmapLookbackUserSet]);

  // Mutable refs so the polling loop reads the latest values without
  // re-subscribing on every dropdown toggle. Keeping bin size, depth levels,
  // lookback, and bucket size out of the polling effect's dep array means
  // changing them does NOT clear the previous matrix and does NOT cause a
  // ~2 s "Accumulating order book history…" flash; the next tick simply
  // picks up the new value.
  const lookbackRef = useRef(heatmapLookback);
  useEffect(() => {
    lookbackRef.current = heatmapLookback;
  }, [heatmapLookback]);

  const binSizeRef = useRef(binSize);
  useEffect(() => {
    binSizeRef.current = binSize;
  }, [binSize]);

  const depthLevelsRef = useRef(depthLevels);
  useEffect(() => {
    depthLevelsRef.current = depthLevels;
  }, [depthLevels]);

  // Polling loop — restarts only on symbol/marketType/timeframe changes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let lastRebuildEpoch = -1;

    const tick = async () => {
      if (cancelled) return;
      setConnection("loading");
      const epochAtFetch = rebuildEpochRef.current;
      const isRebuild = epochAtFetch !== lastRebuildEpoch && priceWindowRef.current !== null;
      try {
        const [snap, candlesRaw, ob, delta] = await Promise.all([
          api.liquiditySnapshot(symbol, {
            marketType,
            timeframe,
            binSize: binSizeRef.current,
            // Heatmap lookback drives how far back we walk the depth ring
            // buffer. "max" = whole accumulated history (server-capped).
            ...lookbackToQuery(lookbackRef.current),
            levels: depthLevelsRef.current,
            heatmapBucketMs: heatmapBucketMsRef.current,
            // Price window is sent ONLY when the user explicitly clicked
            // "Rebuild for visible range". Otherwise the server uses its
            // own stable ±2 % cap, so wheel/pan never re-builds the matrix.
            ...(priceWindowRef.current
              ? {
                  priceMin: priceWindowRef.current.priceMin,
                  priceMax: priceWindowRef.current.priceMax,
                }
              : {}),
          }),
          // candles request now uses the selected timeframe so 5m/15m fetch
          // their own kline series rather than always 1m.
          api.liquidityCandles(symbol, { marketType, interval: timeframe, limit: 500 }),
          // OrderBookPanel renders the top 12 levels per side; 20 leaves a
          // small headroom for the "biggest walls" panel without round-trip
          // bandwidth waste.
          api.liquidityOrderBook(symbol, { marketType, levels: 20 }),
          api.liquidityDelta(symbol, { marketType, timeframe, limit: 200 }),
        ]);
        if (cancelled) return;
        const snapAny = snap as HeatmapMatrix & { status?: unknown };
        if (snapAny && Array.isArray(snapAny.cells)) setMatrix(snapAny);
        else setMatrix(null);
        if (snapAny.status) setStatus(snapAny.status as never);
        // Reset the rebuild flag — the explicit-rebuild request was honoured
        // by this fetch, so subsequent polls go back to stable-window mode.
        if (isRebuild) {
          priceWindowRef.current = null;
          lastRebuildEpoch = epochAtFetch;
          setRebuildBanner("Rebuild applied");
          // Auto-clear the toast after a short delay.
          setTimeout(() => {
            if (!cancelled) setRebuildBanner(null);
          }, 1500);
        }
        const candlesAny = candlesRaw as { candles?: { t: number; open: number; high: number; low: number; close: number; volume: number }[] };
        setCandles(candlesAny.candles ?? []);
        const obAny = ob as never;
        setOrderBook(obAny);
        const deltaAny = delta as { buckets?: never[] };
        setDelta(deltaAny.buckets ?? []);
        setError(null);
        setConnection("ready");
        consecutiveFailures = 0;
      } catch (e) {
        if (cancelled) return;
        setConnection("error");
        if (e instanceof ApiError) setError(`${e.code}: ${e.message}`);
        else setError((e as Error).message);
        consecutiveFailures += 1;
      } finally {
        if (!cancelled) {
          // Exponential backoff on consecutive failures. Capped at 30 s so
          // the chart still recovers automatically once upstream is healthy.
          const delay =
            consecutiveFailures === 0
              ? POLL_MS
              : Math.min(30_000, POLL_MS * 2 ** Math.min(consecutiveFailures - 1, 4));
          timer = setTimeout(tick, delay);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, marketType, timeframe, setMatrix, setCandles, setOrderBook, setDelta, setStatus, setConnection, setError]);

  // Compute the visible-range hint from the heatmap lookback selector. When
  // the user picked "Max" we use the snapshot lookback echo from the API
  // (`availableHistoryMs`) so Reset shows whatever the server actually has.
  const lookbackVisibleMs = useMemo(() => {
    const fallback =
      timeframe === "5m" ? 60 * 60_000 : timeframe === "15m" ? 4 * 60 * 60_000 : 30 * 60_000;
    const available = matrix?.lookback?.availableHistoryMs ?? 0;
    return lookbackToVisibleRangeMs(heatmapLookback, available, fallback);
  }, [heatmapLookback, timeframe, matrix?.lookback?.availableHistoryMs]);

  // "live window" helper so the viewport always shows the timeframe's default
  // visible range anchored on now — the heatmap (which only has live history)
  // is not pushed to a sliver on the right by hundreds of backfilled candles.
  useEffect(() => {
    if (!viewport.autoFit) return;
    const bounds = computeBounds(matrix, candles);
    if (bounds) setViewport(fitViewportToLiveWindow(bounds, timeframe, Date.now(), lookbackVisibleMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, candles, timeframe, lookbackVisibleMs, setViewport]);

  // Toolbar handlers
  const onZoomIn = useCallback(() => {
    setViewport((vp) => zoomTime(vp, (vp.timeStart + vp.timeEnd) / 2, 0.7));
  }, [setViewport]);
  const onZoomOut = useCallback(() => {
    setViewport((vp) => zoomTime(vp, (vp.timeStart + vp.timeEnd) / 2, 1.4));
  }, [setViewport]);
  const onResetView = useCallback(() => {
    const bounds = computeBounds(matrix, candles);
    if (bounds) setViewport(fitViewportToLiveWindow(bounds, timeframe, Date.now(), lookbackVisibleMs));
  }, [matrix, candles, timeframe, lookbackVisibleMs, setViewport]);
  const onFitData = onResetView;
  const onClearAll = useCallback(() => clearDrawings(), [clearDrawings]);

  const dbg = matrix?.debugStats;

  return (
    <div className="liq-page" ref={wrap}>
      <header className="page-header">
        <h1>Liquidity Chart</h1>
        <span className="page-subtitle">
          Order book liquidity heatmap over time for one symbol — built from Binance public depth streams.
        </span>
      </header>

      <div className="liq-header">
        <div className="liq-source">
          <span className="badge badge-normal">Binance {marketType === "spot" ? "Spot" : "Futures"}</span>
          {status?.connected ? (
            <span className="dim">live · {status.snapshots} snapshots · {status.trades} trades</span>
          ) : status?.needsResync ? (
            <span className="yellow">resyncing order book…</span>
          ) : connection === "error" ? (
            <span className="red">error · {error ?? "see console"}</span>
          ) : connection === "loading" || connection === "idle" ? (
            <span className="dim">Waiting for live public market data…</span>
          ) : (
            <span className="dim">connecting…</span>
          )}
        </div>
        <LiquidityControls symbols={symbols} />
      </div>

      <ChartToolbar
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetView={onResetView}
        onFitData={onFitData}
        onClearAll={onClearAll}
      />

      <AccumulationBanner symbol={symbol} timeframe={timeframe} dbg={dbg} />

      <OutsideHeatmapBanner
        viewport={viewport}
        matrix={matrix}
        onRebuild={requestRebuildForViewport}
      />

      {rebuildBanner && (
        <div className="liq-rebuild-toast" role="status" aria-live="polite">
          {rebuildBanner}
        </div>
      )}

      <DebugBar
        dbg={dbg}
        matrix={matrix}
        lookbackInfo={matrix?.lookback}
        lookbackChoice={heatmapLookback}
        candleCount={candles.length}
        connected={Boolean(status?.connected)}
        needsResync={Boolean(status?.needsResync)}
        connection={connection}
        timeframe={timeframe}
        viewport={viewport}
      />

      <div className="liq-body">
        <div className="liq-main">
          <LiquidityChart width={size.width} height={size.height} />
          {showDelta && <VolumeHistogram width={size.width} mode="delta" />}
          {(!matrix || matrix.cells.length === 0) && (
            <div className="liq-overlay-info">
              {connection === "ready"
                ? "Accumulating order book history…"
                : "Connecting to Binance public depth stream…"}
            </div>
          )}
        </div>
        <OrderBookPanel />
      </div>

      <ChartStatusBar />
    </div>
  );
}

function computeBounds(
  matrix: HeatmapMatrix | null,
  candles: { t: number; open: number; high: number; low: number; close: number; volume: number }[],
): { timeStart: number; timeEnd: number; priceMin: number; priceMax: number } | null {
  let priceMin = Infinity;
  let priceMax = -Infinity;
  let timeStart = Infinity;
  let timeEnd = -Infinity;
  if (matrix && matrix.cells.length > 0) {
    if (matrix.priceMin > 0) priceMin = Math.min(priceMin, matrix.priceMin);
    if (matrix.priceMax > 0) priceMax = Math.max(priceMax, matrix.priceMax);
    timeStart = Math.min(timeStart, matrix.timeStart);
    timeEnd = Math.max(timeEnd, matrix.timeEnd);
  }
  if (candles.length > 0) {
    const slice = candles.slice(-200);
    for (const c of slice) {
      if (c.low < priceMin) priceMin = c.low;
      if (c.high > priceMax) priceMax = c.high;
      if (c.t < timeStart) timeStart = c.t;
      if (c.t + 60_000 > timeEnd) timeEnd = c.t + 60_000;
    }
  }
  if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || !Number.isFinite(timeStart) || !Number.isFinite(timeEnd)) {
    return null;
  }
  return { timeStart, timeEnd, priceMin, priceMax };
}

function DebugBar({
  dbg,
  matrix,
  lookbackInfo,
  lookbackChoice,
  candleCount,
  connected,
  needsResync,
  connection,
  timeframe,
  viewport,
}: {
  dbg:
    | (HeatmapMatrix["debugStats"] & {
        requestedTimeframe?: string;
        timeBucketMs?: number;
        snapshotTimeSpanMs?: number;
        accumulationWarning?: string | null;
        requiredHistoryMs?: number;
        feedStartedAt?: string | null;
        historyAgeMs?: number;
        historyCompleteness?: number;
      })
    | undefined;
  matrix: HeatmapMatrix | null;
  lookbackInfo?: HeatmapMatrix["lookback"];
  lookbackChoice: string;
  candleCount: number;
  connected: boolean;
  needsResync: boolean;
  connection: string;
  timeframe: string;
  viewport: Viewport;
}) {
  const streamStatus = needsResync
    ? "resyncing"
    : connected
    ? "live"
    : connection === "error"
    ? "degraded"
    : "connecting";
  const visibleMs = Math.max(0, viewport.timeEnd - viewport.timeStart);
  const completenessPct =
    typeof dbg?.historyCompleteness === "number"
      ? Math.min(100, Math.round(dbg.historyCompleteness * 100))
      : 0;
  // Clip-stats: how many cells are visible / hidden under the current
  // viewport. Useful when zoom/pan looks empty — DebugBar tells the user
  // exactly how much is being clipped.
  let visibleCells = 0;
  let hiddenCells = 0;
  let viewportInsideMatrix = true;
  if (matrix && matrix.cells.length > 0) {
    const tfMs = matrix.debugStats?.timeBucketMs ?? 0;
    const binWidth = matrix.binWidth;
    for (const c of matrix.cells) {
      const inTime = c.t + tfMs >= viewport.timeStart && c.t <= viewport.timeEnd;
      const inPrice =
        c.price + binWidth >= viewport.priceMin && c.price <= viewport.priceMax;
      if (inTime && inPrice) visibleCells++;
      else hiddenCells++;
    }
    if (matrix.priceMin > 0 && matrix.priceMax > 0) {
      const overlapLo = Math.max(matrix.priceMin, viewport.priceMin);
      const overlapHi = Math.min(matrix.priceMax, viewport.priceMax);
      const overlap = Math.max(0, overlapHi - overlapLo);
      const span = Math.max(1, viewport.priceMax - viewport.priceMin);
      viewportInsideMatrix = overlap / span >= 0.5;
    }
  }
  return (
    <div className="liq-debug">
      <span><span className="dim">Stream:</span> {streamStatus}</span>
      <span><span className="dim">Timeframe:</span> {timeframe}</span>
      <span><span className="dim">Candle interval:</span> {timeframe}</span>
      <span><span className="dim">Time bucket:</span> {fmtSecondsMs(dbg?.timeBucketMs)}</span>
      <span><span className="dim">Visible:</span> {fmtRange(visibleMs)}</span>
      <span><span className="dim">Snapshot span:</span> {fmtRange(dbg?.snapshotTimeSpanMs ?? 0)}</span>
      <span><span className="dim">Required history:</span> {fmtRange(dbg?.requiredHistoryMs ?? 0)}</span>
      <span><span className="dim">Heatmap age:</span> {fmtRange(dbg?.historyAgeMs ?? 0)}</span>
      <span><span className="dim">Completeness:</span> {completenessPct}%</span>
      <span>
        <span className="dim">Feed started:</span>{" "}
        {dbg?.feedStartedAt ? new Date(dbg.feedStartedAt).toLocaleTimeString() : "—"}
      </span>
      <span><span className="dim">AutoFit:</span> {viewport.autoFit ? "on" : "off"}</span>
      <span><span className="dim">Snapshots:</span> {dbg?.snapshotCount ?? 0}</span>
      <span><span className="dim">Cells:</span> {dbg?.cellCount ?? 0}</span>
      <span><span className="dim">Price bins:</span> {dbg?.priceBinCount ?? 0}</span>
      <span><span className="dim">Time buckets:</span> {dbg?.timeBucketCount ?? 0}</span>
      <span><span className="dim">Candles:</span> {candleCount}</span>
      <span><span className="dim">Heatmap lookback:</span> {lookbackChoice}</span>
      {matrix && (
        <>
          <span>
            <span className="dim">Heatmap window:</span>{" "}
            {matrix.priceMin > 0 ? matrix.priceMin.toFixed(2) : "—"} – {matrix.priceMax > 0 ? matrix.priceMax.toFixed(2) : "—"}
          </span>
          <span>
            <span className="dim">Viewport window:</span>{" "}
            {viewport.priceMin.toFixed(2)} – {viewport.priceMax.toFixed(2)}
          </span>
          <span>
            <span className="dim">Viewport inside matrix:</span>{" "}
            {viewportInsideMatrix ? "yes" : "no"}
          </span>
          <span><span className="dim">Visible cells:</span> {visibleCells}</span>
          <span><span className="dim">Hidden (out of view):</span> {hiddenCells}</span>
        </>
      )}
      {lookbackInfo && (
        <>
          <span>
            <span className="dim">Available history:</span> {fmtRange(lookbackInfo.availableHistoryMs)} /{" "}
            {fmtRange(lookbackInfo.maxLookbackMs)}
          </span>
          <span>
            <span className="dim">Rendered range:</span> {fmtRange(lookbackInfo.appliedMinutes * 60_000)}
          </span>
          <span>
            <span className="dim">Oldest snapshot:</span>{" "}
            {lookbackInfo.oldestSnapshotMs
              ? new Date(lookbackInfo.oldestSnapshotMs).toLocaleTimeString()
              : "—"}
          </span>
          <span>
            <span className="dim">Newest snapshot:</span>{" "}
            {lookbackInfo.newestSnapshotMs
              ? new Date(lookbackInfo.newestSnapshotMs).toLocaleTimeString()
              : "—"}
          </span>
          {lookbackInfo.truncated && (
            <span className="yellow">
              ⚠ Showing max available within {fmtRange(lookbackInfo.maxLookbackMs)} memory limit.
            </span>
          )}
        </>
      )}
      {dbg && dbg.snapshotCount > 100 && (dbg.timeBucketCount ?? 0) < 10 && (
        <span className="yellow">⚠ Heatmap is over-aggregated; check heatmap time resolution.</span>
      )}
      {dbg?.warning && <span className="yellow">⚠ {dbg.warning}</span>}
    </div>
  );
}

/**
 * Banner shown when the viewport's price window leaves the loaded heatmap
 * matrix's price window. We do NOT silently re-fetch on every wheel event
 * (that's what made cells "jump"). Instead the user explicitly clicks
 * "Rebuild" if they want the matrix rebuilt for the new range.
 */
function OutsideHeatmapBanner({
  viewport,
  matrix,
  onRebuild,
}: {
  viewport: Viewport;
  matrix: HeatmapMatrix | null;
  onRebuild: () => void;
}) {
  if (!matrix || matrix.priceMin <= 0 || matrix.priceMax <= 0) return null;
  const vpLo = viewport.priceMin;
  const vpHi = viewport.priceMax;
  // Banner triggers when the viewport overlaps the matrix by less than 50 %.
  // Same threshold as DebugBar's `viewportInsideMatrix` field — keep them in
  // sync; the rest of the app reads the comment as the contract.
  if (!Number.isFinite(vpLo) || !Number.isFinite(vpHi) || vpHi <= vpLo) return null;
  const overlapLo = Math.max(matrix.priceMin, vpLo);
  const overlapHi = Math.min(matrix.priceMax, vpHi);
  const overlap = Math.max(0, overlapHi - overlapLo);
  const vpSpan = vpHi - vpLo;
  if (vpSpan <= 0) return null;
  const overlapFrac = overlap / vpSpan;
  if (overlapFrac >= 0.5) return null;
  return (
    <div className="liq-outside-window" role="status" aria-live="polite">
      <span>
        Viewport drifted outside the loaded heatmap price window
        ({matrix.priceMin.toFixed(2)} – {matrix.priceMax.toFixed(2)}).
        Liquidity cells outside this range are not loaded.
      </span>
      <button type="button" className="link-btn" onClick={onRebuild}>
        Rebuild for visible range
      </button>
    </div>
  );
}

/**
 * Inline banner above the chart that explains the live-only nature of the
 * heatmap on cold start (after a symbol switch) — and disappears once enough
 * history has accumulated. Drives user expectations explicitly so the chart
 * never looks "broken".
 */
function AccumulationBanner({
  symbol,
  timeframe,
  dbg,
}: {
  symbol: string;
  timeframe: string;
  dbg:
    | (HeatmapMatrix["debugStats"] & {
        requiredHistoryMs?: number;
        historyAgeMs?: number;
        historyCompleteness?: number;
      })
    | undefined;
}) {
  if (!dbg) return null;
  const completeness = dbg.historyCompleteness ?? 0;
  const timeBuckets = dbg.timeBucketCount ?? 0;
  // Only show while we don't yet cover the timeframe's default visible range
  // OR when we have at most one time bucket (heatmap is a sliver).
  if (completeness >= 1 && timeBuckets > 1) return null;
  const ageS = Math.max(0, Math.round((dbg.historyAgeMs ?? 0) / 1000));
  const reqS = Math.max(1, Math.round((dbg.requiredHistoryMs ?? 0) / 1000));
  const fmtSec = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
  const pct = Math.round(completeness * 100);
  return (
    <div className="liq-accumulation" role="status" aria-live="polite">
      <div className="liq-accumulation-headline">
        <strong>{symbol} heatmap history: {fmtSec(ageS)} / {fmtSec(reqS)} collected</strong>
        <span className="dim"> · {pct}%</span>
      </div>
      <div className="liq-accumulation-bar" aria-hidden>
        <div className="liq-accumulation-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="liq-accumulation-note dim">
        Order book heatmap history starts when this symbol is selected. Candles are backfilled from REST,
        but liquidity depth is accumulated live from the Binance WebSocket — keep this symbol open to
        build a deeper {timeframe} heatmap.
      </div>
    </div>
  );
}

function fmtSecondsMs(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
function fmtRange(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
