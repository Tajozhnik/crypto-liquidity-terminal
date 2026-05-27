export function PriceChange({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span className="dim">—</span>;
  const cls = value > 0 ? "green" : value < 0 ? "red" : "dim";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cls}>
      {sign}
      {value.toFixed(2)}%
    </span>
  );
}
