"use client";
import type { ExchangeName, MarketType, ServerSettings } from "@screener/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useScreenerWebSocket } from "@/lib/ws";
import { useLocalSettings } from "@/state/useLocalSettings";
import { useMarketStore } from "@/state/useMarketStore";
import { useReadinessStore } from "@/state/useReadinessStore";
import { useWatchlistStore } from "@/state/useWatchlistStore";

interface ExtendedReadiness {
  status: string;
  mode?: "live" | "mock" | "hybrid";
  mockEnabled?: boolean;
  publicAdaptersEnabled?: boolean;
  db: string;
  redis: string;
  exchangeAdapters: { name: string; enabled: boolean; status: string }[];
}

interface ExtendedSettings extends ServerSettings {
  persisted?: boolean;
  storage?: "database" | "memory";
  warning?: string | null;
}

export default function SettingsPage() {
  useScreenerWebSocket();
  const connection = useMarketStore((s) => s.connection);

  const [serverSettings, setServerSettings] = useState<ExtendedSettings | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  /** Latest /settings + /readiness fetch state — drives loading/error UI. */
  const [bootstrapState, setBootstrapState] = useState<"loading" | "ready" | "error">("loading");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<ExtendedReadiness | null>(null);

  const adapters = useReadinessStore((s) => s.adapters);
  const readinessFetchError = useReadinessStore((s) => s.lastFetchError);

  const theme = useLocalSettings((s) => s.theme);
  const setTheme = useLocalSettings((s) => s.setTheme);
  const density = useLocalSettings((s) => s.tableDensity);
  const setDensity = useLocalSettings((s) => s.setTableDensity);
  const mirroredExchange = useLocalSettings((s) => s.defaultExchange);
  const setMirrored = useLocalSettings((s) => s.setMirroredServerSettings);

  const watchlist = useWatchlistStore((s) => s.symbols);
  const clearWatchlist = useWatchlistStore((s) => s.clear);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const bootstrap = useCallback(async () => {
    setBootstrapState("loading");
    setBootstrapError(null);
    // Fetch the two endpoints independently so a /settings failure does not
    // blank out the /readiness card (and vice versa) — each promise reports
    // its own error to the user.
    const [settingsRes, readinessRes] = await Promise.allSettled([api.settings(), api.readiness()]);
    let nextErr: string | null = null;

    if (settingsRes.status === "fulfilled") {
      const ss = settingsRes.value as ExtendedSettings;
      setServerSettings(ss);
      setMirrored({
        defaultExchange: ss.defaultExchange,
        defaultMarketType: ss.defaultMarketType,
        defaultQuoteAsset: ss.defaultQuoteAsset,
      });
    } else {
      const err = settingsRes.reason;
      nextErr = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message ?? "settings fetch failed";
    }

    if (readinessRes.status === "fulfilled") {
      setReadiness(readinessRes.value as unknown as ExtendedReadiness);
    } else if (!nextErr) {
      const err = readinessRes.reason;
      nextErr = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message ?? "readiness fetch failed";
    }

    if (nextErr) {
      setBootstrapError(nextErr);
      setBootstrapState("error");
    } else {
      setBootstrapState("ready");
    }
  }, [setMirrored]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const updateField = async <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    if (!serverSettings) return;
    setSaving(true);
    setSaveMsg(null);
    setServerError(null);
    // Optimistically update local mirror so the user sees their choice immediately.
    if (key === "defaultExchange") setMirrored({ defaultExchange: value as string });
    if (key === "defaultMarketType") setMirrored({ defaultMarketType: value as string });
    if (key === "defaultQuoteAsset") setMirrored({ defaultQuoteAsset: value as string });
    try {
      const updated = (await api.updateSettings({ [key]: value } as Partial<ServerSettings>)) as ExtendedSettings;
      setServerSettings(updated);
      if (updated.storage === "database") setSaveMsg("Saved to database");
      else if (updated.storage === "memory") setSaveMsg("Saved temporarily (database unavailable)");
      else setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (err) {
      if (err instanceof ApiError) setServerError(`${err.code}: ${err.message}`);
      else setServerError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Available exchange options come from /readiness so the user only sees real adapters.
  const exchangeOptions = adapters
    .filter((a) => a.enabled || a.name === serverSettings?.defaultExchange)
    .map((a) => ({
      value: a.name,
      label: a.name,
      status: a.status,
    }));

  // Authoritative signal that the API is using the in-memory fallback comes
  // from the `/settings` response itself (`storage: "memory"`). Don't gate the
  // banner on `readiness.db` — readiness is a separate probe and it may be
  // missing or stale on first paint, which used to cause the banner to flash
  // even when the DB was healthy.
  const usingMemoryFallback = serverSettings?.storage === "memory";
  const storageLabel =
    serverSettings?.storage === "database"
      ? "database"
      : serverSettings?.storage === "memory"
      ? "memory fallback"
      : "browser localStorage";

  return (
    <div className="settings-grid">
      <div className="panel">
        <div className="panel-header">Runtime</div>
        <div className="panel-body" style={{ padding: 16 }}>
          <p>
            <span className="dim">Mode:</span>{" "}
            <span className={`badge ${readiness?.mode === "live" ? "badge-normal" : readiness?.mode === "hybrid" ? "badge-hot" : "badge-cold"}`}>
              {readiness?.mode === "live"
                ? "Live Public Data"
                : readiness?.mode === "hybrid"
                ? "Hybrid"
                : readiness?.mode === "mock"
                ? "Mock"
                : "—"}
            </span>
          </p>
          <p>
            <span className="dim">WebSocket:</span> <code>{connection}</code>
          </p>
          {bootstrapState === "error" ? (
            <div className="form-error">
              API unreachable: {bootstrapError ?? "unknown error"}
              <button
                className="link-btn"
                style={{ marginLeft: 8 }}
                onClick={() => void bootstrap()}
              >
                Retry
              </button>
            </div>
          ) : readiness ? (
            <>
              <p>
                <span className="dim">Server status:</span>{" "}
                <span className={readiness.status === "ok" ? "green" : "yellow"}>{readiness.status}</span>
              </p>
              <p>
                <span className="dim">Database:</span>{" "}
                <code className={readiness.db === "ok" ? "green" : "red"}>{readiness.db}</code>
              </p>
              <p>
                <span className="dim">Redis:</span>{" "}
                <code className={readiness.redis === "ok" ? "green" : "yellow"}>{readiness.redis}</code>
              </p>
              <p>
                <span className="dim">Settings storage:</span> <code>{storageLabel}</code>
              </p>
              <p>
                <span className="dim">Enabled exchanges:</span>{" "}
                {readiness.exchangeAdapters
                  .filter((a) => a.enabled)
                  .map((a) => `${a.name}${a.status === "degraded" ? "*" : ""}`)
                  .join(", ") || "none"}
              </p>
              {readinessFetchError && (
                <p className="yellow">
                  <span className="dim">Last readiness error:</span> {readinessFetchError}
                </p>
              )}
            </>
          ) : (
            <p className="dim">Probing readiness…</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Server-side defaults</div>
        <div className="panel-body" style={{ padding: 16 }}>
          {usingMemoryFallback && (
            <p className="form-error">
              Database unavailable. Settings are stored in memory and mirrored to your browser; they
              will reset when the API restarts.
            </p>
          )}
          {!serverSettings ? (
            bootstrapState === "error" ? (
              <div className="form-error">
                Failed to load settings: {bootstrapError ?? "unknown error"}
                <button
                  className="link-btn"
                  style={{ marginLeft: 8 }}
                  onClick={() => void bootstrap()}
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="loading">Loading…</div>
            )
          ) : (
            <>
              <label className="filter-label">
                <span>Default exchange</span>
                <select
                  value={(mirroredExchange ?? serverSettings.defaultExchange) as string}
                  onChange={(e) => updateField("defaultExchange", e.target.value as ExchangeName)}
                >
                  {exchangeOptions.length === 0 ? (
                    <option value={serverSettings.defaultExchange}>{serverSettings.defaultExchange}</option>
                  ) : (
                    exchangeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {o.status === "degraded" ? " (degraded)" : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="filter-label">
                <span>Default market type</span>
                <select
                  value={serverSettings.defaultMarketType}
                  onChange={(e) => updateField("defaultMarketType", e.target.value as MarketType)}
                >
                  <option value="spot">spot</option>
                  <option value="futures">futures</option>
                </select>
              </label>
              <label className="filter-label">
                <span>Default quote asset</span>
                <select
                  value={serverSettings.defaultQuoteAsset}
                  onChange={(e) => updateField("defaultQuoteAsset", e.target.value)}
                >
                  <option value="USDT">USDT</option>
                  <option value="USDC">USDC</option>
                  <option value="USD">USD</option>
                  <option value="BTC">BTC</option>
                </select>
              </label>
              <label className="filter-label">
                <span>Update frequency (ms)</span>
                <input
                  type="number"
                  min={250}
                  step={250}
                  value={serverSettings.screenerUpdateFrequencyMs}
                  onChange={(e) =>
                    updateField(
                      "screenerUpdateFrequencyMs",
                      Math.max(250, Number.parseInt(e.target.value, 10) || 1000),
                    )
                  }
                />
              </label>
              {saving && <p className="dim">Saving…</p>}
              {saveMsg && <p className="green">{saveMsg}</p>}
              {serverError && <p className="red">{serverError}</p>}
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Local preferences (browser only)</div>
        <div className="panel-body" style={{ padding: 16 }}>
          <label className="filter-label">
            <span>Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
              <option value="dark">dark</option>
              <option value="light">light</option>
            </select>
          </label>
          <label className="filter-label">
            <span>Table density</span>
            <select
              value={density}
              onChange={(e) => setDensity(e.target.value as "comfortable" | "compact")}
            >
              <option value="comfortable">comfortable</option>
              <option value="compact">compact</option>
            </select>
          </label>
          <p className="dim">Theme and density are stored only in your browser.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Watchlist ({watchlist.length})</div>
        <div className="panel-body" style={{ padding: 16 }}>
          {watchlist.length === 0 ? (
            <div className="empty">Star markets in the screener to add them here.</div>
          ) : (
            <>
              <div className="watchlist-chips">
                {watchlist.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
              <button className="link-btn red" onClick={clearWatchlist} style={{ marginTop: 12 }}>
                Clear watchlist
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
