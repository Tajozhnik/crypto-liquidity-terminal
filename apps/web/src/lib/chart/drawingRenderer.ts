import type { Drawing } from "./drawingTypes";
import { priceToY, timeToX, type Viewport } from "./viewport";

interface Box {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
}

const COLOR_DEFAULT = "rgba(255, 200, 70, 0.95)";
const COLOR_SELECTED = "rgba(120, 220, 255, 1)";
const COLOR_RECT_FILL = "rgba(255, 200, 70, 0.10)";

export function renderDrawings(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  vp: Viewport,
  box: Box,
  selectedId: string | null,
  /** Drawing currently being authored (preview), if any. */
  pending: Drawing | null,
): void {
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.font = "11px -apple-system, sans-serif";
  for (const d of drawings) drawOne(ctx, d, vp, box, d.id === selectedId);
  if (pending) drawOne(ctx, pending, vp, box, false);
  ctx.restore();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  vp: Viewport,
  box: Box,
  selected: boolean,
): void {
  const stroke = selected ? COLOR_SELECTED : d.color ?? COLOR_DEFAULT;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;

  switch (d.type) {
    case "horizontal": {
      const y = priceToY(d.price, vp, box.yTop, box.yBottom);
      if (y < box.yTop || y > box.yBottom) return;
      ctx.beginPath();
      ctx.moveTo(box.xLeft, y);
      ctx.lineTo(box.xRight, y);
      ctx.stroke();
      ctx.fillText(d.price.toLocaleString(undefined, { maximumFractionDigits: 6 }), box.xLeft + 4, y - 4);
      return;
    }
    case "trend": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return;
    }
    case "ray": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      // Extend (x1,y1)→(x2,y2) outward to chart bounds
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const farX = x1 + (dx / len) * 5000;
      const farY = y1 + (dy / len) * 5000;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(farX, farY);
      ctx.stroke();
      return;
    }
    case "rectangle": {
      const x1 = timeToX(d.t1, vp, box.xLeft, box.xRight);
      const y1 = priceToY(d.p1, vp, box.yTop, box.yBottom);
      const x2 = timeToX(d.t2, vp, box.xLeft, box.xRight);
      const y2 = priceToY(d.p2, vp, box.yTop, box.yBottom);
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      ctx.fillStyle = selected ? "rgba(120,220,255,0.16)" : COLOR_RECT_FILL;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = stroke;
      ctx.strokeRect(x, y, w, h);
      return;
    }
    case "text": {
      const x = timeToX(d.t, vp, box.xLeft, box.xRight);
      const y = priceToY(d.price, vp, box.yTop, box.yBottom);
      ctx.fillStyle = stroke;
      ctx.fillText(d.text, x, y);
      return;
    }
  }
}
