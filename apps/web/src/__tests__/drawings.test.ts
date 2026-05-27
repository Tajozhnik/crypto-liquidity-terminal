import { afterEach, describe, expect, it } from "vitest";
import { hitTest } from "@/lib/chart/drawingHitTest";
import { loadDrawings, saveDrawings, storageKey } from "@/lib/chart/drawingStorage";
import type { Drawing } from "@/lib/chart/drawingTypes";
import type { Viewport } from "@/lib/chart/viewport";

const VP: Viewport = {
  timeStart: 0,
  timeEnd: 1000,
  priceMin: 100,
  priceMax: 200,
  autoFit: false,
};
const BOX = { xLeft: 0, xRight: 1000, yTop: 0, yBottom: 1000 };

describe("hit test", () => {
  it("hits a horizontal line at its price", () => {
    const d: Drawing = { id: "1", createdAt: 0, type: "horizontal", price: 150 };
    // priceToY(150) = bottom - 0.5*(bottom-top) = 500
    const hit = hitTest([d], { x: 200, y: 500 }, VP, BOX);
    expect(hit?.id).toBe("1");
    expect(hitTest([d], { x: 200, y: 200 }, VP, BOX)).toBeNull();
  });

  it("hits a trend line near the segment", () => {
    // From (t=0,p=200) to (t=1000,p=100)
    // At t=500 expected price is 150 → y=500
    const d: Drawing = { id: "1", createdAt: 0, type: "trend", t1: 0, p1: 200, t2: 1000, p2: 100 };
    const hit = hitTest([d], { x: 500, y: 500 }, VP, BOX);
    expect(hit?.id).toBe("1");
    expect(hitTest([d], { x: 500, y: 100 }, VP, BOX)).toBeNull();
  });

  it("hits a rectangle when cursor is inside", () => {
    // Rect t1=200..t2=600, p1=110..p2=190
    const d: Drawing = { id: "1", createdAt: 0, type: "rectangle", t1: 200, p1: 110, t2: 600, p2: 190 };
    const hit = hitTest([d], { x: 400, y: 500 }, VP, BOX);
    expect(hit?.id).toBe("1");
  });

  it("returns the topmost drawing on overlap", () => {
    const a: Drawing = { id: "a", createdAt: 0, type: "horizontal", price: 150 };
    const b: Drawing = { id: "b", createdAt: 1, type: "horizontal", price: 150 };
    const hit = hitTest([a, b], { x: 100, y: 500 }, VP, BOX);
    expect(hit?.id).toBe("b");
  });
});

describe("drawing storage", () => {
  afterEach(() => {
    if (typeof window !== "undefined") window.localStorage.clear();
  });

  it("persists per (exchange, marketType, symbol) key", () => {
    const d: Drawing = { id: "1", createdAt: 0, type: "horizontal", price: 100 };
    saveDrawings("binance", "spot", "BTCUSDT", [d]);
    const back = loadDrawings("binance", "spot", "BTCUSDT");
    expect(back).toHaveLength(1);
    expect(back[0]!.type).toBe("horizontal");
    expect(loadDrawings("binance", "futures", "BTCUSDT")).toEqual([]);
  });

  it("storageKey includes all three identifiers", () => {
    expect(storageKey("binance", "spot", "BTCUSDT")).toContain("binance");
    expect(storageKey("binance", "spot", "BTCUSDT")).toContain("spot");
    expect(storageKey("binance", "spot", "BTCUSDT")).toContain("BTCUSDT");
  });

  it("returns [] on parse error", () => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey("binance", "spot", "ETHUSDT"), "not json");
    expect(loadDrawings("binance", "spot", "ETHUSDT")).toEqual([]);
  });
});
