import type { Drawing } from "./drawingTypes";
import { priceToY, timeToX, type Viewport } from "./viewport";

const HIT_PX = 6;

interface Box {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
}

/** Returns the topmost drawing under the given canvas-pixel coordinates, or null. */
export function hitTest(
  drawings: Drawing[],
  px: { x: number; y: number },
  vp: Viewport,
  box: Box,
): Drawing | null {
  // Iterate in reverse so newer drawings are picked first.
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i]!;
    if (testOne(d, px.x, px.y, vp, box)) return d;
  }
  return null;
}

function testOne(d: Drawing, x: number, y: number, vp: Viewport, box: Box): boolean {
  switch (d.type) {
    case "horizontal": {
      const yLine = priceToY(d.price, vp, box.yTop, box.yBottom);
      return Math.abs(y - yLine) <= HIT_PX && x >= box.xLeft && x <= box.xRight;
    }
    case "trend": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      return distanceToSegment(x, y, x1, y1, x2, y2) <= HIT_PX;
    }
    case "ray": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      // Ray = infinite line starting at (x1,y1) going through (x2,y2)
      // Hit if close to the half-line from (x1,y1) outward
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(x - x1, y - y1) <= HIT_PX;
      const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      if (t < 0) return false;
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      return Math.hypot(x - projX, y - projY) <= HIT_PX;
    }
    case "rectangle": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
      const hi = { x: Math.max(x1, x2), y: Math.max(y1, y2) };
      // Hit if cursor is on the border (within HIT_PX) OR inside the box.
      const insideX = x >= lo.x - HIT_PX && x <= hi.x + HIT_PX;
      const insideY = y >= lo.y - HIT_PX && y <= hi.y + HIT_PX;
      return insideX && insideY;
    }
    case "text": {
      const xC = timeToX(d.t, vp, box.xLeft, box.xRight);
      const yC = priceToY(d.price, vp, box.yTop, box.yBottom);
      // Approx 6 px per character at 11 px font.
      const w = Math.max(20, d.text.length * 6);
      return x >= xC - 4 && x <= xC + w + 4 && y >= yC - 12 && y <= yC + 4;
    }
  }
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}
