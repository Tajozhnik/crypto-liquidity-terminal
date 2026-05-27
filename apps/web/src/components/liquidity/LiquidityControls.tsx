"use client";
import { densityPreset, type DensityMode, type DensityPreset } from "@/lib/liquidity/densityScale";
import {
  HEATMAP_LOOKBACK_OPTIONS,
  type HeatmapLookback,
} from "@/lib/liquidity/lookback";
import { useLiquidityStore } from "@/state/useLiquidityStore";

const TIMEFRAMES = ["1m", "5m", "15m"] as const;
const BIN_SIZES = ["auto", "0.1%", "0.25%", "0.5%", "1%"] as const;
const SIDES = ["combined", "bids", "asks", "imbalance"] as const;
const DENSITY_MODES: DensityMode[] = ["raw", "log", "percentile", "zscore"];
const DENSITY_PRESETS: { id: DensityPreset; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "deep", label: "Deep Liquidity" },
  { id: "walls", label: "Strong Walls" },
  { id: "weak", label: "Weak Liquidity" },
  { id: "clean", label: "Clean" },
];
const DEPTH_LEVELS = [50, 100, 250, 500, 1000];

export function LiquidityControls({ symbols }: { symbols: string[] }) {
  const s = useLiquidityStore();
  return (
    <div className="liq-controls">
      <label>
        <span className="dim">Symbol</span>
        <select value={s.symbol} onChange={(e) => s.setControls({ symbol: e.target.value.toUpperCase() })}>
          {symbols.map((sym) => (
            <option key={sym} value={sym}>{sym}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Market</span>
        <select
          value={s.marketType}
          onChange={(e) => s.setControls({ marketType: e.target.value as "spot" | "futures" })}
        >
          <option value="spot">Spot</option>
          <option value="futures">Futures</option>
        </select>
      </label>
      <label>
        <span className="dim">Timeframe</span>
        <select
          value={s.timeframe}
          onChange={(e) => s.setControls({ timeframe: e.target.value as "1m" | "5m" | "15m" })}
        >
          {TIMEFRAMES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Bin size</span>
        <select
          value={s.binSize}
          onChange={(e) => s.setControls({ binSize: e.target.value as typeof BIN_SIZES[number] })}
        >
          {BIN_SIZES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Side</span>
        <select
          value={s.sideMode}
          onChange={(e) => s.setControls({ sideMode: e.target.value as typeof SIDES[number] })}
        >
          {SIDES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Intensity</span>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.1}
          value={s.intensity}
          onChange={(e) => s.setControls({ intensity: Number(e.target.value) })}
        />
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.logScale}
          onChange={(e) => s.setControls({ logScale: e.target.checked })}
        />
        <span>Log scale</span>
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.showCandles}
          onChange={(e) => s.setControls({ showCandles: e.target.checked })}
        />
        <span>Candles</span>
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.showDelta}
          onChange={(e) => s.setControls({ showDelta: e.target.checked })}
        />
        <span>Delta</span>
      </label>

      {/* --------- Density / depth controls --------- */}
      <label>
        <span className="dim">Density</span>
        <select
          value={s.densityMode}
          onChange={(e) =>
            s.setControls({ densityMode: e.target.value as DensityMode })
          }
        >
          {DENSITY_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Preset</span>
        <select
          value={s.densityPreset}
          onChange={(e) => {
            const id = e.target.value as DensityPreset;
            const opts = densityPreset(id);
            s.setControls({
              densityPreset: id,
              densityMode: opts.mode,
              gamma: opts.gamma,
              capPercentile: opts.capPercentile,
              minOpacity: opts.minOpacity,
              maxOpacity: opts.maxOpacity,
              hideWeak: opts.hideWeakBelow > 0,
              strongOnly: opts.strongOnlyAbove > 0,
              glow: opts.glow,
            });
          }}
        >
          {DENSITY_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Depth</span>
        <select
          value={s.depthLevels}
          onChange={(e) =>
            s.setControls({ depthLevels: Number.parseInt(e.target.value, 10) })
          }
        >
          {DEPTH_LEVELS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Lookback</span>
        <select
          value={s.heatmapLookback}
          onChange={(e) =>
            s.setControls({
              heatmapLookback: e.target.value as HeatmapLookback,
              heatmapLookbackUserSet: true,
            })
          }
        >
          {HEATMAP_LOOKBACK_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="dim">Gamma {s.gamma.toFixed(2)}</span>
        <input
          type="range"
          min={0.3}
          max={1.5}
          step={0.05}
          value={s.gamma}
          onChange={(e) => s.setControls({ gamma: Number(e.target.value) })}
        />
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.glow}
          onChange={(e) => s.setControls({ glow: e.target.checked })}
        />
        <span>Glow</span>
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.hideWeak}
          onChange={(e) => s.setControls({ hideWeak: e.target.checked })}
        />
        <span>Hide weak</span>
      </label>
      <label className="liq-toggle">
        <input
          type="checkbox"
          checked={s.strongOnly}
          onChange={(e) => s.setControls({ strongOnly: e.target.checked })}
        />
        <span>Strong only</span>
      </label>
    </div>
  );
}
