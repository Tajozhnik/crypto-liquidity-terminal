"use client";
import type {
  Alert,
  AlertConditionType,
  AlertEvent,
  AlertInput,
  AlertOperator,
  ExchangeName,
  MarketType,
} from "@screener/shared";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useScreenerWebSocket } from "@/lib/ws";
import { useAlertStore } from "@/state/useAlertStore";
import { useMarketStore } from "@/state/useMarketStore";

const CONDITION_TYPES: AlertConditionType[] = [
  "PRICE_CHANGE_5M",
  "PRICE_CHANGE_15M",
  "PRICE_CHANGE_1H",
  "PRICE_CHANGE_24H",
  "RELATIVE_VOLUME",
  "VOLATILITY",
  "SPREAD",
  "ORDER_BOOK_IMBALANCE",
  "SIGNAL_SCORE",
  "OPEN_INTEREST",
  "FUNDING_RATE",
];

const FUTURES_ONLY: AlertConditionType[] = ["OPEN_INTEREST", "FUNDING_RATE"];
const OPERATORS: AlertOperator[] = [">", ">=", "<", "<=", "=="];

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading alerts…</div>}>
      <AlertsPageInner />
    </Suspense>
  );
}

function AlertsPageInner() {
  useScreenerWebSocket();
  const alerts = useAlertStore((s) => s.alerts);
  const setAlerts = useAlertStore((s) => s.setAlerts);
  const addAlert = useAlertStore((s) => s.addAlert);
  const updateAlert = useAlertStore((s) => s.updateAlert);
  const removeAlert = useAlertStore((s) => s.removeAlert);
  const events = useAlertStore((s) => s.events);
  const setEvents = useAlertStore((s) => s.setEvents);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [a, e] = await Promise.all([api.alerts(), api.alertEvents(100)]);
      setAlerts(a);
      setEvents(e);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setAlerts, setEvents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: AlertInput) => {
      const created = await api.createAlert(input);
      addAlert(created);
      return created;
    },
    [addAlert],
  );

  const handleToggle = useCallback(
    async (a: Alert) => {
      const updated = await api.updateAlert(a.id, { enabled: !a.enabled });
      updateAlert(updated);
    },
    [updateAlert],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await api.deleteAlert(id);
      removeAlert(id);
    },
    [removeAlert],
  );

  return (
    <div className="alerts-grid">
      <div className="panel">
        <div className="panel-header">Create Alert</div>
        <div className="panel-body" style={{ padding: 16 }}>
          <AlertForm onCreate={handleCreate} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Active Alerts ({alerts.length})</div>
        <div className="panel-body" style={{ maxHeight: 480 }}>
          {loading ? (
            <div className="loading">Loading…</div>
          ) : error ? (
            <div className="error">
              {error} <button onClick={refresh}>Retry</button>
            </div>
          ) : alerts.length === 0 ? (
            <div className="empty">No alerts yet. Create one on the left.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th>Condition</th>
                  <th>Op</th>
                  <th>Threshold</th>
                  <th>Cooldown</th>
                  <th>Last fired</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.symbol}</td>
                    <td className="dim">{a.marketType}</td>
                    <td>{a.conditionType}</td>
                    <td>{a.operator}</td>
                    <td>{a.threshold}</td>
                    <td className="dim">{a.cooldownSeconds}s</td>
                    <td className="dim">
                      {a.lastTriggeredAt ? new Date(a.lastTriggeredAt).toLocaleTimeString() : "—"}
                    </td>
                    <td>
                      <button
                        className={`pill-btn ${a.enabled ? "pill-on" : "pill-off"}`}
                        onClick={() => handleToggle(a)}
                      >
                        {a.enabled ? "enabled" : "disabled"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="link-btn red"
                        onClick={() => {
                          if (confirm(`Delete alert for ${a.symbol}?`)) void handleDelete(a.id);
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel" style={{ gridColumn: "span 2" }}>
        <div className="panel-header">Recent Alert Events ({events.length})</div>
        <div className="panel-body" style={{ maxHeight: 360 }}>
          {events.length === 0 ? (
            <div className="empty">No events yet. Triggered alerts will appear here in real time.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Symbol</th>
                  <th>Value</th>
                  <th>Threshold</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e: AlertEvent) => (
                  <tr key={e.id}>
                    <td className="dim">{new Date(e.triggeredAt).toLocaleTimeString()}</td>
                    <td>{e.symbol}</td>
                    <td>{e.value.toFixed(4)}</td>
                    <td>{e.threshold}</td>
                    <td className="dim">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertForm({ onCreate }: { onCreate: (input: AlertInput) => Promise<Alert> }) {
  const search = useSearchParams();
  const markets = useMarketStore((s) => s.markets);
  const symbolList = useMemo(() => [...markets.values()].map((m) => m.symbol).sort(), [markets]);

  const prefillRaw = search?.get("prefill") ?? null;
  const prefill = useMemo(() => {
    if (!prefillRaw) return null;
    try {
      return JSON.parse(prefillRaw) as { symbol?: string; exchange?: ExchangeName; marketType?: MarketType };
    } catch {
      return null;
    }
  }, [prefillRaw]);

  const [symbol, setSymbol] = useState(prefill?.symbol ?? "BTCUSDT");
  const [exchange, setExchange] = useState<ExchangeName>(prefill?.exchange ?? "mock");
  const [marketType, setMarketType] = useState<MarketType>(prefill?.marketType ?? "spot");
  const [conditionType, setConditionType] = useState<AlertConditionType>("PRICE_CHANGE_5M");
  const [operator, setOperator] = useState<AlertOperator>(">");
  const [threshold, setThreshold] = useState<number>(2);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(300);

  // Sync defaults from chosen market
  useEffect(() => {
    const m = markets.get(symbol);
    if (m) {
      if (m.marketType !== marketType) setMarketType(m.marketType);
      if (m.exchange !== exchange) setExchange(m.exchange);
    }
  }, [symbol, markets, marketType, exchange]);

  const futuresOnly = FUTURES_ONLY.includes(conditionType);
  const conditionInvalid = futuresOnly && marketType !== "futures";

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (conditionInvalid) {
      setSubmitError(`Condition '${conditionType}' requires futures market`);
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({
        symbol,
        exchange,
        marketType,
        conditionType,
        operator,
        threshold,
        enabled: true,
        cooldownSeconds,
      });
      setSubmitError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.code}: ${err.message}`);
      } else {
        setSubmitError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="alert-form">
      <label className="filter-label">
        <span>Symbol</span>
        <input
          list="symbol-list"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <datalist id="symbol-list">
          {symbolList.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <label className="filter-label">
        <span>Market Type</span>
        <select value={marketType} onChange={(e) => setMarketType(e.target.value as MarketType)}>
          <option value="spot">spot</option>
          <option value="futures">futures</option>
        </select>
      </label>

      <label className="filter-label">
        <span>Exchange</span>
        <select value={exchange} onChange={(e) => setExchange(e.target.value as ExchangeName)}>
          <option value="mock">mock</option>
          <option value="binance">binance</option>
          <option value="bybit">bybit</option>
          <option value="okx">okx</option>
          <option value="coinbase">coinbase</option>
          <option value="kraken">kraken</option>
        </select>
      </label>

      <label className="filter-label">
        <span>Condition</span>
        <select
          value={conditionType}
          onChange={(e) => setConditionType(e.target.value as AlertConditionType)}
        >
          {CONDITION_TYPES.map((c) => (
            <option
              key={c}
              value={c}
              disabled={FUTURES_ONLY.includes(c) && marketType !== "futures"}
            >
              {c}
              {FUTURES_ONLY.includes(c) ? " (futures only)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-label">
        <span>Operator</span>
        <select value={operator} onChange={(e) => setOperator(e.target.value as AlertOperator)}>
          {OPERATORS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-label">
        <span>Threshold</span>
        <input
          type="number"
          step="any"
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          required
        />
      </label>

      <label className="filter-label">
        <span>Cooldown (seconds, default 300 = 5 min)</span>
        <input
          type="number"
          min={1}
          step={1}
          value={cooldownSeconds}
          onChange={(e) => setCooldownSeconds(Number.parseInt(e.target.value, 10) || 1)}
        />
      </label>

      {conditionInvalid && (
        <div className="form-error">Condition {conditionType} requires marketType=futures.</div>
      )}
      {submitError && <div className="form-error">{submitError}</div>}

      <button type="submit" className="primary-btn" disabled={submitting || conditionInvalid}>
        {submitting ? "Creating…" : "Create Alert"}
      </button>
    </form>
  );
}
