import type { ScoreBand } from "@screener/shared";

export function ScoreBadge({ score, band }: { score: number; band: ScoreBand }) {
  return <span className={`badge badge-${band}`}>{band} · {score}</span>;
}
