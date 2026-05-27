import type { Drawing } from "./drawingTypes";

const KEY_PREFIX = "screener.drawings.v1:";

export function storageKey(exchange: string, marketType: string, symbol: string): string {
  return `${KEY_PREFIX}${exchange}:${marketType}:${symbol}`;
}

export function loadDrawings(
  exchange: string,
  marketType: string,
  symbol: string,
): Drawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(exchange, marketType, symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid) as Drawing[];
  } catch {
    return [];
  }
}

export function saveDrawings(
  exchange: string,
  marketType: string,
  symbol: string,
  drawings: Drawing[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(exchange, marketType, symbol),
      JSON.stringify(drawings),
    );
  } catch {
    /* quota exceeded — give up silently */
  }
}

function isValid(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.type === "string";
}
