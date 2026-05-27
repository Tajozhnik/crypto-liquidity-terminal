"use client";
import type { ExchangeName, MarketType } from "@screener/shared";
import { EMPTY_FILTERS, type ScreenerFilters } from "@/lib/filters";
import { PRESETS, PRESET_NAMES, type PresetName } from "@/lib/presets";
import { useReadinessStore } from "@/state/useReadinessStore";

const ALL_EXCHANGES: ExchangeName[] = ["mock", "binance", "bybit", "okx", "coinbase", "kraken"];
const MARKET_TYPES: MarketType[] = ["spot", "futures"];
const QUOTE_ASSETS = ["USDT", "USDC", "USD", "BTC"];

export function FilterPanel({
  filters,
  setFilters,
  activePreset,
  onPreset,
  onReset,
  bybitWarning,
}: {
  filters: ScreenerFilters;
  setFilters: (f: ScreenerFilters | ((prev: ScreenerFilters) => ScreenerFilters)) => void;
  activePreset: PresetName | null;
  onPreset: (name: PresetName) => void;
  onReset: () => void;
  bybitWarning: boolean;
}) {
  const adapters = useReadinessStore((s) => s.adapters);

  const toggleArr = <T extends string>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];

  const numberInput = (label: string, key: keyof ScreenerFilters, placeholder?: string) => {
    const value = filters[key] as number | null;
    return (
      <label className="filter-label" key={key as string}>
        <span>{label}</span>
        <input
          type="number"
          step="any"
          value={value === null ? "" : value}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            setFilters((prev) => ({ ...prev, [key]: raw === "" ? null : Number(raw) }));
          }}
        />
      </label>
    );
  };

  return (
    <div className="filter-panel">
      <div className="presets-bar">
        {PRESET_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={`preset-btn${activePreset === name ? " active" : ""}`}
            onClick={() => onPreset(name)}
            title={JSON.stringify(PRESETS[name])}
          >
            {name}
          </button>
        ))}
        <button type="button" className="preset-btn reset" onClick={onReset}>
          Reset
        </button>
      </div>

      {bybitWarning && (
        <div className="bybit-warning">
          {bybitStatusMessage(adapters.find((a) => a.name === "bybit"))}
        </div>
      )}

      <div className="filter-grid">
        <div className="filter-group">
          <span className="filter-group-label">Exchange</span>
          <div className="filter-chips">
            {ALL_EXCHANGES.map((ex) => {
              const adapter = adapters.find((a) => a.name === ex);
              const enabled = ex === "mock" ? true : adapter?.enabled ?? false;
              const status = adapter?.status ?? "unknown";
              const isActive = filters.exchange.includes(ex);
              const dotClass = `adapter-dot adapter-dot-${status}`;
              const title = adapter
                ? `${ex} · status=${status}${adapter.lastErrorMessage ? ` · last error: ${adapter.lastErrorMessage}` : ""}`
                : ex === "mock"
                ? "mock adapter"
                : "adapter not registered";
              return (
                <button
                  key={ex}
                  type="button"
                  disabled={!enabled}
                  className={`chip${isActive ? " active" : ""}${enabled ? "" : " disabled"}`}
                  title={title}
                  onClick={() =>
                    enabled && setFilters((prev) => ({ ...prev, exchange: toggleArr(prev.exchange, ex) }))
                  }
                >
                  <span className={dotClass} /> {ex}
                </button>
              );
            })}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group-label">Market Type</span>
          <div className="filter-chips">
            {MARKET_TYPES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${filters.marketType.includes(m) ? " active" : ""}`}
                onClick={() => setFilters((prev) => ({ ...prev, marketType: toggleArr(prev.marketType, m) }))}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group-label">Quote Asset</span>
          <div className="filter-chips">
            {QUOTE_ASSETS.map((q) => (
              <button
                key={q}
                type="button"
                className={`chip${filters.quoteAsset.includes(q) ? " active" : ""}`}
                onClick={() => setFilters((prev) => ({ ...prev, quoteAsset: toggleArr(prev.quoteAsset, q) }))}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {numberInput("Min Volume 24h", "minVolume24h", "10000000")}
        {numberInput("Min 5m %", "minChange5m", "1.0")}
        {numberInput("Min |5m| %", "minChange5mAbs", "1.5")}
        {numberInput("Min 15m %", "minChange15m", "1.0")}
        {numberInput("Min Relative Volume", "minRelativeVolume", "2.0")}
        {numberInput("Min Volatility", "minVolatility", "1.0")}
        {numberInput("Max Spread %", "maxSpreadPercent", "0.1")}
        {numberInput("Min Trades/min", "minTradesPerMinute", "50")}
        {numberInput("Min Signal Score", "minSignalScore", "70")}

        <label className="filter-label">
          <span>Search</span>
          <input
            type="text"
            value={filters.search}
            placeholder="BTC, ETH..."
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        </label>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filters.hasActiveSignal}
            onChange={(e) => setFilters((prev) => ({ ...prev, hasActiveSignal: e.target.checked }))}
          />
          <span>Has active signal</span>
        </label>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filters.watchlistOnly}
            onChange={(e) => setFilters((prev) => ({ ...prev, watchlistOnly: e.target.checked }))}
          />
          <span>Watchlist only</span>
        </label>
      </div>
    </div>
  );
}

function bybitStatusMessage(a: { status: string; lastErrorMessage: string | null } | undefined): string {
  if (!a) return "Bybit adapter is not registered in this build.";
  if (a.status === "ok") return "Bybit live data is enabled.";
  if (a.status === "degraded") return `Bybit adapter is degraded${a.lastErrorMessage ? `: ${a.lastErrorMessage}` : "."}`;
  return "Bybit adapter is disabled.";
}

export const _DEFAULT_FILTERS_FOR_PRESET_RESET = EMPTY_FILTERS;
