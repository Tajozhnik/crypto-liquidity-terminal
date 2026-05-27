"use client";
import { create } from "zustand";
import type { Drawing, DrawingTool } from "@/lib/chart/drawingTypes";
import { fitViewportToData, type DataBounds, type Viewport } from "@/lib/chart/viewport";

interface ChartInteractionStore {
  viewport: Viewport;
  tool: DrawingTool;
  drawings: Drawing[];
  selectedId: string | null;
  /** A drawing being authored — first click placed but second not yet. */
  pendingDrawing: Drawing | null;

  setViewport: (v: Viewport | ((prev: Viewport) => Viewport)) => void;
  resetViewportFromBounds: (b: DataBounds) => void;
  setTool: (t: DrawingTool) => void;
  setDrawings: (d: Drawing[]) => void;
  addDrawing: (d: Drawing) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: () => void;
  setSelected: (id: string | null) => void;
  setPending: (d: Drawing | null) => void;
}

const INITIAL_VIEWPORT: Viewport = {
  timeStart: Date.now() - 30 * 60_000,
  timeEnd: Date.now(),
  priceMin: 0,
  priceMax: 1,
  autoFit: true,
};

export const useChartInteractionStore = create<ChartInteractionStore>((set) => ({
  viewport: INITIAL_VIEWPORT,
  tool: "cursor",
  drawings: [],
  selectedId: null,
  pendingDrawing: null,

  setViewport: (v) =>
    set((state) => ({
      viewport: typeof v === "function" ? (v as (prev: Viewport) => Viewport)(state.viewport) : v,
    })),
  resetViewportFromBounds: (b) => set({ viewport: fitViewportToData(b) }),
  setTool: (tool) => set({ tool, pendingDrawing: null }),
  setDrawings: (drawings) => set({ drawings, selectedId: null, pendingDrawing: null }),
  addDrawing: (d) =>
    set((state) => ({ drawings: [...state.drawings, d], selectedId: null, pendingDrawing: null })),
  removeDrawing: (id) =>
    set((state) => ({
      drawings: state.drawings.filter((x) => x.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  clearDrawings: () => set({ drawings: [], selectedId: null, pendingDrawing: null }),
  setSelected: (selectedId) => set({ selectedId }),
  setPending: (pendingDrawing) => set({ pendingDrawing }),
}));
