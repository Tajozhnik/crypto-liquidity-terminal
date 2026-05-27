"use client";
import { useMemo } from "react";

export function Sparkline({
  data,
  width = 600,
  height = 160,
  stroke = "#4ea1ff",
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / span) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, width, height]);

  if (data.length < 2) {
    return <div className="dim">Not enough data points yet…</div>;
  }
  const last = data[data.length - 1] ?? 0;
  const first = data[0] ?? 0;
  const trendUp = last >= first;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="price sparkline">
      <path
        d={path}
        fill="none"
        stroke={trendUp ? "#22c55e" : "#ef4444"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
