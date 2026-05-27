"use client";
import type { ScreenerResult } from "@screener/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FilterPanel } from "@/components/FilterPanel";
import { HeatmapControls } from "@/components/heatmap/HeatmapControls";
import { HeatmapGrid } from "@/components/heatmap/HeatmapGrid";
import { HeatmapLegend } from "@/components/heatmap/HeatmapLegend";
import { HeatmapSummary } from "@/components/heatmap/HeatmapSummary";
import {
  EMPTY_FILTERS,
  applyFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  type ScreenerFilters,
} from "@/lib/filters";
import {
  type HeatmapMode,
  type TileSizeMode,
  getHeatmapMetric,
} from "@/lib/heatmap";
import { PRESETS, type PresetName } from "@/lib/presets";
import { useScreenerWebSocket } from "@/lib/ws";
import { useMarketStore } from "@/state/useMarketStore";
import { useWatchlistStore } from "@/state/useWatchlistStore";

const MODE_KEY = "heatmap_mode";
const SIZE_KEY = "heatmap_size";

export default function HeatmapPage() {
  return (
    <Suspense fallback={<div className="loading">Loading heatmap…</div>}>
      <HeatmapPageInner />
    </Suspense>
  );
}

function HeatmapPageInner() {
  useScreenerWebSocket();
  const markets = useMarketStore((s) => s.markets);
  const connection = useMarketStore((s) => s.connection);
  const watchlist = useWatchlistStore((s) => s.symbols);

  const router = useRouter();
  const searchParams = useSearchParams();
  const initialParams = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  );

  const [filters, setFilters] = useState<ScreenerFilters>(() =>
    filtersFromSearchParams(initialParams),
  );
  const [activePreset, setActivePreset] = useState<PresetName | null>(null);

  const [mode, setMode] = useState<HeatmapMode>(() => {
    const fromUrl = initialParams.get(MODE_KEY);
    if (fromUrl) return fromUrl as HeatmapMode;
    return "performance";
  });
  const [sizeMode, setSizeMode] = useState<TileSizeMode>(() => {
    const fromUrl = initialParams.get(SIZE_KEY);
    return (fromUrl as TileSizeMode) ?? "volume_24h";
  });

  // Reflect everything in URL so links can be shared
  useEffect(() => {
    const params = filtersToSearchParams(filters);
    params.set(MODE_KEY, mode);
    params.set(SIZE_KEY, sizeMode);
    const url = `/market-map?${params.toString()}`;
    router.replace(url, { scroll: false });
  }, [filters, mode, sizeMode, router]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);
  const allRows = useMemo(() => [...markets.values()], [markets]);
  const filtered = useMemo(
    () => applyFilters(allRows, filters, watchSet),
    [allRows, filters, watchSet],
  );

  // Order by metric so largest cells gravitate to the top-left
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const am = getHeatmapMetric(a, mode);
      const bm = getHeatmapMetric(b, mode);
      // Non-applicable rows go to the bottom
      if (am.applicable !== bm.applicable) return am.applicable ? -1 : 1;
      const av = mode === "performance" ? Math.abs(am.value) : am.value;
      const bv = mode === "performance" ? Math.abs(bm.value) : bm.value;
      return bv - av;
    });
  }, [filtered, mode]);

  const onPreset = useCallback((name: PresetName) => {
    setFilters({ ...EMPTY_FILTERS, ...PRESETS[name] });
    setActivePreset(name);
  }, []);
  const onReset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setActivePreset(null);
  }, []);

  useEffect(() => {
    if (!activePreset) return;
    const expected = JSON.stringify({ ...EMPTY_FILTERS, ...PRESETS[activePreset] });
    const actual = JSON.stringify(filters);
    if (expected !== actual) setActivePreset(null);
  }, [filters, activePreset]);

  const bybitWarning = filters.exchange.includes("bybit");

  if (markets.size === 0) {
    if (connection === "disconnected") {
      return <div className="error">Disconnected from API. Reconnecting…</div>;
    }
    return <div className="loading">Loading market data…</div>;
  }

  return (
    <div className="heatmap-page">
      <header className="page-header">
        <h1>Market Map</h1>
        <span className="page-subtitle">
          Tiled overview of all markets by performance, volume, volatility or score.
        </span>
        <div className="form-error" style={{ marginTop: 8 }}>
          Market Map is no longer linked from the sidebar — the main chart view is now{" "}
          <Link href="/heatmap" className="symbol-link">Liquidity Chart</Link>. This page is kept for
          legacy bookmarks.
        </div>
      </header>
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        activePreset={activePreset}
        onPreset={onPreset}
        onReset={onReset}
        bybitWarning={bybitWarning}
      />

      <HeatmapControls mode={mode} setMode={setMode} sizeMode={sizeMode} setSizeMode={setSizeMode} />

      <HeatmapSummary rows={sorted} />

      <HeatmapLegend mode={mode} />

      {mode === "futures_oi" && sorted.every((r) => r.marketType !== "futures") && (
        <div className="empty heatmap-empty">
          The current adapter selection has no futures markets. Switch the colour mode or
          enable an exchange that provides futures data (Binance / Bybit / OKX).
        </div>
      )}

      <RenderedGrid rows={sorted} mode={mode} sizeMode={sizeMode} />
    </div>
  );
}

/**
 * Memoization barrier: avoids re-rendering the entire grid when only top-bar
 * state (mode chip hover, etc.) changes. The grid itself memoises tiles.
 */
function RenderedGrid({
  rows,
  mode,
  sizeMode,
}: {
  rows: ScreenerResult[];
  mode: HeatmapMode;
  sizeMode: TileSizeMode;
}) {
  return <HeatmapGrid rows={rows} mode={mode} sizeMode={sizeMode} />;
}
