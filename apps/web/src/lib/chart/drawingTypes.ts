/**
 * Drawing primitives. Coordinates are in domain space (time ms, price), so
 * drawings stay anchored when the viewport zooms or pans.
 */

export type DrawingTool =
  | "cursor"
  | "hand"
  | "horizontal"
  | "trend"
  | "rectangle"
  | "ray"
  | "text"
  | "eraser";

export interface BaseDrawing {
  id: string;
  /** Timestamp the drawing was created (used as a tie-breaker on hit-tests). */
  createdAt: number;
  color?: string;
}

export interface HorizontalDrawing extends BaseDrawing {
  type: "horizontal";
  price: number;
}

export interface TrendDrawing extends BaseDrawing {
  type: "trend";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
}

export interface RectangleDrawing extends BaseDrawing {
  type: "rectangle";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
}

export interface RayDrawing extends BaseDrawing {
  type: "ray";
  t1: number;
  p1: number;
  t2: number;
  p2: number;
}

export interface TextDrawing extends BaseDrawing {
  type: "text";
  t: number;
  price: number;
  text: string;
}

export type Drawing =
  | HorizontalDrawing
  | TrendDrawing
  | RectangleDrawing
  | RayDrawing
  | TextDrawing;

export const TOOL_LABELS: Record<DrawingTool, string> = {
  cursor: "Cursor",
  hand: "Hand",
  horizontal: "Horizontal Line",
  trend: "Trend Line",
  rectangle: "Rectangle",
  ray: "Ray",
  text: "Text Label",
  eraser: "Eraser",
};

export function newId(): string {
  return `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
