"use client";
import { useEffect } from "react";
import { ApiError, api } from "@/lib/api";
import { useReadinessStore } from "@/state/useReadinessStore";

/**
 * Polls /readiness on a slow interval (15 s) to keep adapter status fresh.
 * Mounted once at the layout level so every page can read enabled exchanges
 * and per-adapter status without making its own request. Surfaces the last
 * fetch error to the store so the Settings page can display "API unreachable"
 * instead of getting stuck on "Probing readiness…".
 */
export function ReadinessProbe() {
  const setAdapters = useReadinessStore((s) => s.setAdapters);
  const setFetchError = useReadinessStore((s) => s.setFetchError);
  const setFetchedAt = useReadinessStore((s) => s.setFetchedAt);
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await api.readiness();
        if (cancelled) return;
        setAdapters(r.exchangeAdapters as never);
        setFetchError(null);
        setFetchedAt(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setFetchError(`${err.code}: ${err.message}`);
        } else {
          setFetchError((err as Error).message ?? "readiness fetch failed");
        }
      }
    };
    void fetchOnce();
    const t = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [setAdapters, setFetchError, setFetchedAt]);
  return null;
}
