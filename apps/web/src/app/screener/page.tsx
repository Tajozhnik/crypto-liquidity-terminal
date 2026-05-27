"use client";
import type { ScreenerResult } from "@screener/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, memo, useCallback, useEffect, useMemo, useState } from "react";
import { FilterPanel } from "@/components/FilterPanel";
import { PriceChange } from "@/components/PriceChange";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SignalBadges } from "@/components/SignalBadges";
import { WatchlistStar } from "@/components/WatchlistStar";
import {
  EMPTY_FILTERS,
  applyFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  type ScreenerFilters,
} from "@/lib/filters";
import { abbreviate } from "@/lib/format";
import { PRESETS, type PresetName } from "@/lib/presets";
import { useScreenerWebSocket } from "@/lib/ws";
import { useMarketStore } from "@/state/useMarketStore";
import { useWatchlistStore } from "@/state/useWatchlistStore";

type SortColumn = keyof ScreenerResult | null;

export default function ScreenerPage() {
  return (
    <Suspense fallback={<div className="loading">Loading screener…</div>}>
      <ScreenerPageInner />
    </Suspense>
  );
}

function ScreenerPageInner() {
  useScreenerWebSocket();
  const markets = useMarketStore((s) => s.markets);
  const connection = useMarketStore((s) => s.connection);
  const watchlist = useWatchlistStore((s) => s.symbols);

  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<ScreenerFilters>(() =>
    filtersFromSearchParams(new URLSearchParams(searchParams?.toString() ?? "")),
  );
  const [activePreset, setActivePreset] = useState<PresetName | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("signalScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Sync filter state to URL (replaceState so browser history isn't spammed)
  useEffect(() => {
    const params = filtersToSearchParams(filters);
    const search = params.toString();
    const url = search ? `/screener?${search}` : "/screener";
    router.replace(url, { scroll: false });
  }, [filters, router]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const allRows = useMemo(() => [...markets.values()], [markets]);
  const filtered = useMemo(() => applyFilters(allRows, filters, watchSet), [allRows, filters, watchSet]);

  const sorted = useMemo(() => {
    if (!sortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortColumn];
      const bv = b[sortColumn];
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [filtered, sortColumn, sortDir]);

  const onSort = useCallback(
    (col: keyof ScreenerResult) => {
      if (sortColumn === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(col);
        setSortDir("desc");
      }
    },
    [sortColumn],
  );

  const onPreset = useCallback((name: PresetName) => {
    setFilters({ ...EMPTY_FILTERS, ...PRESETS[name] });
    setActivePreset(name);
  }, []);

  const onReset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setActivePreset(null);
  }, []);

  // Detect customized preset
  useEffect(() => {
    if (!activePreset) return;
    const expected = JSON.stringify({ ...EMPTY_FILTERS, ...PRESETS[activePreset] });
    const actual = JSON.stringify(filters);
    if (expected !== actual) setActivePreset(null);
  }, [filters, activePreset]);

  const bybitWarning = filters.exchange.includes("bybit");

  if (markets.size === 0 && connection !== "connected") {
    return <div className="loading">Connecting to market data…</div>;
  }

  return (
    <div>
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        activePreset={activePreset}
        onPreset={onPreset}
        onReset={onReset}
        bybitWarning={bybitWarning}
      />

      <div className="filter-summary">
        <span className="dim">{sorted.length} of {markets.size}</span>
        {sorted.length === 0 && filtered.length === 0 && (
          <span className="dim">No markets match — adjust filters or click Reset.</span>
        )}
      </div>

      <div className="panel">
        <div className="panel-body" style={{ maxHeight: "70vh" }}>
          {sorted.length === 0 ? (
            <div className="empty">No markets match the current filters.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>
                    <SortHeader col="symbol" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Symbol
                    </SortHeader>
                  </th>
                  <th>Exch</th>
                  <th>Type</th>
                  <th>
                    <SortHeader col="price" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Price
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="change24h" current={sortColumn} dir={sortDir} onSort={onSort}>
                      24h
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="change5m" current={sortColumn} dir={sortDir} onSort={onSort}>
                      5m
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="change15m" current={sortColumn} dir={sortDir} onSort={onSort}>
                      15m
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="change1h" current={sortColumn} dir={sortDir} onSort={onSort}>
                      1h
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="volume24h" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Vol 24h
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="relativeVolume" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Rel Vol
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="volatility" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Vlty
                    </SortHeader>
                  </th>
                  <th>
                    <SortHeader col="spreadPct" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Spread%
                    </SortHeader>
                  </th>
                  <th>OB Imb</th>
                  <th>OI</th>
                  <th>Funding</th>
                  <th>
                    <SortHeader col="signalScore" current={sortColumn} dir={sortDir} onSort={onSort}>
                      Score
                    </SortHeader>
                  </th>
                  <th>Signals</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <MarketRow key={r.symbol} r={r} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  col,
  current,
  dir,
  onSort,
  children,
}: {
  col: keyof ScreenerResult;
  current: SortColumn;
  dir: "asc" | "desc";
  onSort: (col: keyof ScreenerResult) => void;
  children: React.ReactNode;
}) {
  const active = current === col;
  return (
    <button type="button" className={`sort-btn${active ? " active" : ""}`} onClick={() => onSort(col)}>
      {children} {active ? (dir === "asc" ? "▲" : "▼") : ""}
    </button>
  );
}

const MarketRow = memo(function MarketRowImpl({ r }: { r: ScreenerResult }) {
  return (
    <tr>
      <td>
        <WatchlistStar symbol={r.symbol} />
      </td>
      <td>
        <Link href={`/markets/${encodeURIComponent(r.symbol)}`} className="symbol-link">
          {r.symbol}
        </Link>
      </td>
      <td className="dim">{r.exchange}</td>
      <td className="dim">{r.marketType}</td>
      <td>{r.price.toFixed(r.price > 100 ? 2 : 6)}</td>
      <td><PriceChange value={r.change24h} /></td>
      <td><PriceChange value={r.change5m} /></td>
      <td><PriceChange value={r.change15m} /></td>
      <td><PriceChange value={r.change1h} /></td>
      <td className="dim">{abbreviate(r.volume24h)}</td>
      <td>{r.relativeVolume.toFixed(2)}</td>
      <td>{r.volatility.toFixed(2)}</td>
      <td>{r.spreadPct.toFixed(3)}</td>
      <td>{(r.orderBookImbalance * 100).toFixed(1)}%</td>
      <td>{r.openInterest === null ? <span className="dim">—</span> : abbreviate(r.openInterest)}</td>
      <td>
        {r.fundingRate === null ? (
          <span className="dim">—</span>
        ) : (
          <PriceChange value={r.fundingRate * 100} />
        )}
      </td>
      <td><ScoreBadge score={r.signalScore} band={r.scoreBand} /></td>
      <td><SignalBadges types={r.activeSignals} /></td>
    </tr>
  );
});

