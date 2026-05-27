import { afterEach, describe, expect, it } from "vitest";
import { useWatchlistStore } from "@/state/useWatchlistStore";

describe("useWatchlistStore", () => {
  afterEach(() => {
    useWatchlistStore.getState().clear();
  });

  it("toggle adds and removes symbols", () => {
    expect(useWatchlistStore.getState().symbols).toEqual([]);
    useWatchlistStore.getState().toggle("BTCUSDT");
    expect(useWatchlistStore.getState().symbols).toEqual(["BTCUSDT"]);
    useWatchlistStore.getState().toggle("ETHUSDT");
    expect(useWatchlistStore.getState().symbols.sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    useWatchlistStore.getState().toggle("BTCUSDT");
    expect(useWatchlistStore.getState().symbols).toEqual(["ETHUSDT"]);
  });

  it("has() reflects toggle", () => {
    useWatchlistStore.getState().toggle("SOLUSDT");
    expect(useWatchlistStore.getState().has("SOLUSDT")).toBe(true);
    expect(useWatchlistStore.getState().has("DOGEUSDT")).toBe(false);
  });

  it("persists to localStorage under expected key", () => {
    useWatchlistStore.getState().toggle("BTCUSDT");
    const raw = localStorage.getItem("screener.watchlist.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.symbols).toContain("BTCUSDT");
  });
});
