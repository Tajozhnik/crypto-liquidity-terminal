import type { SignalType } from "@screener/shared";

const LABELS: Record<SignalType, string> = {
  VOLUME_SPIKE: "VOL",
  PRICE_PUMP: "PUMP",
  PRICE_DUMP: "DUMP",
  VOLATILITY_EXPANSION: "VLTY",
  SPREAD_WIDENING: "SPRD",
  ORDER_BOOK_IMBALANCE: "OB",
  OI_SPIKE: "OI",
  FUNDING_ANOMALY: "FUND",
  BREAKOUT: "BO",
  HOT_MARKET: "HOT",
};

export function SignalBadges({ types }: { types: SignalType[] }) {
  if (types.length === 0) return <span className="dim">—</span>;
  return (
    <span>
      {types.map((t) => (
        <span key={t} className="signal-badge" title={t}>
          {LABELS[t]}
        </span>
      ))}
    </span>
  );
}
