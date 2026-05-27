"use client";
import { useWatchlistStore } from "@/state/useWatchlistStore";

export function WatchlistStar({ symbol }: { symbol: string }) {
  const symbols = useWatchlistStore((s) => s.symbols);
  const toggle = useWatchlistStore((s) => s.toggle);
  const starred = symbols.includes(symbol);
  return (
    <button
      type="button"
      className={`star-btn${starred ? " starred" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle(symbol);
      }}
      title={starred ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={starred}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
