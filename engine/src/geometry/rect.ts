/**
 * Axis-aligned rectangles (validator spec §2.4–2.5): minefields. `x, y` is the
 * bottom-left corner. Contact is inclusive within EPS (ruling V2).
 */
import { EPS } from "./constants";
import { approxLe, distance, segmentPointDistance } from "./basic";
import { sweptCircleVsCircle, toLocal } from "./sweep";
import type { Point, Rect, Table } from "../state/types";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The rectangle's corners, anticlockwise from the bottom-left. */
export function corners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** The point of the rectangle (edge or inside) nearest `p`: `p` itself when it's inside. */
export const nearestPoint = (r: Rect, p: Point): Point => ({ x: clamp(p.x, r.x, r.x + r.width), y: clamp(p.y, r.y, r.y + r.height) });

/** Distance from `p` to the rectangle; 0 inside or on the edge. */
export const pointRectDistance = (p: Point, r: Rect): number => distance(p, nearestPoint(r, p));

export const insideRect = (p: Point, r: Rect): boolean => pointRectDistance(p, r) <= EPS;

/**
 * The point on the rectangle's boundary nearest `p`: the nearest point when `p`
 * is outside; when inside, `p` moved straight to the nearest side (ties: left, right, bottom, top).
 */
export function edgePoint(r: Rect, p: Point): Point {
  const outside = p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height;
  if (outside) return nearestPoint(r, p);
  const sides = [
    { d: p.x - r.x, at: { x: r.x, y: p.y } },
    { d: r.x + r.width - p.x, at: { x: r.x + r.width, y: p.y } },
    { d: p.y - r.y, at: { x: p.x, y: r.y } },
    { d: r.y + r.height - p.y, at: { x: p.x, y: r.y + r.height } },
  ];
  let best = sides[0] as (typeof sides)[number];
  for (const s of sides) if (s.d < best.d - EPS) best = s;
  return best.at;
}

/** The unit normal pointing out of the side `p` (on the boundary) is on; at a corner, toward `toward`. */
export function outwardNormal(r: Rect, p: Point, toward: Point): Point {
  const onLeft = Math.abs(p.x - r.x) <= EPS;
  const onRight = Math.abs(p.x - (r.x + r.width)) <= EPS;
  const onBottom = Math.abs(p.y - r.y) <= EPS;
  const onTop = Math.abs(p.y - (r.y + r.height)) <= EPS;
  const sides = [onLeft, onRight, onBottom, onTop].filter(Boolean).length;
  if (sides === 1) {
    if (onLeft) return { x: -1, y: 0 };
    if (onRight) return { x: 1, y: 0 };
    if (onBottom) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }
  const d = distance(p, toward);
  return d <= EPS ? { x: 0, y: 1 } : { x: (toward.x - p.x) / d, y: (toward.y - p.y) / d };
}

/** A circle at `c` of radius `radius` touches or overlaps the rectangle. */
export const circleTouchesRect = (c: Point, radius: number, r: Rect): boolean => approxLe(pointRectDistance(c, r), radius);

/** Segment `ab` touches the rectangle: an end inside, or it crosses or touches a side. */
export function segmentTouchesRect(a: Point, b: Point, r: Rect): boolean {
  if (insideRect(a, r) || insideRect(b, r)) return true;
  const cs = corners(r);
  for (let i = 0; i < 4; i++) {
    const p = cs[i] as Point;
    const q = cs[(i + 1) % 4] as Point;
    if (segmentsTouch(a, b, p, q)) return true;
  }
  return false;
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Two segments touch (within EPS). */
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    segmentPointDistance(c, d, a) <= EPS ||
    segmentPointDistance(c, d, b) <= EPS ||
    segmentPointDistance(a, b, c) <= EPS ||
    segmentPointDistance(a, b, d) <= EPS
  );
}

/** Interiors overlap: touching isn't overlapping (V38). */
export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;

export const rectOnTable = (r: Rect, table: Table): boolean =>
  r.x >= -EPS && r.y >= -EPS && r.x + r.width <= table.width + EPS && r.y + r.height <= table.height + EPS;

/** A rectangle `width` × `height` centred on `c`. */
export const rectAround = (c: Point, width: number, height: number): Rect => ({ x: c.x - width / 2, y: c.y - height / 2, width, height });

/**
 * A segment `width` wide (perpendicular to travel; 0 for a point) swept
 * `length` along `heading`, against a convex polygon: the first contact
 * distance, or null (validator §2.5).
 */
export function sweptSegmentVsPolygon(start: Point, heading: number, length: number, width: number, polygon: readonly Point[]): number | null {
  const band = width / 2 + EPS;
  const local = polygon.map((p) => toLocal(start, heading, p));
  const us: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const p = local[i] as { u: number; v: number };
    const q = local[(i + 1) % local.length] as { u: number; v: number };
    if (Math.abs(p.v) <= band) us.push(p.u);
    for (const edge of [band, -band]) {
      if ((p.v - edge) * (q.v - edge) < 0) {
        const s = (edge - p.v) / (q.v - p.v);
        us.push(p.u + s * (q.u - p.u));
      }
    }
  }
  if (us.length === 0) return null; // the band misses the polygon
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  if (uMax < -EPS) return null;
  const t = Math.max(0, uMin);
  return t <= length + EPS ? t : null;
}

/** A segment `width` wide swept against a rectangle (a torpedo salvo meeting a minefield). */
export const sweptSegmentVsRect = (start: Point, heading: number, length: number, width: number, r: Rect): number | null =>
  sweptSegmentVsPolygon(start, heading, length, width, corners(r));

/** A circle of radius `radius` swept against a rectangle: the rectangle grown by `radius`, rounded at the corners. */
export function sweptCircleVsRect(start: Point, heading: number, length: number, radius: number, r: Rect): number | null {
  const candidates: number[] = [];
  const wide = { x: r.x - radius, y: r.y, width: r.width + 2 * radius, height: r.height };
  const tall = { x: r.x, y: r.y - radius, width: r.width, height: r.height + 2 * radius };
  for (const g of [wide, tall]) {
    const t = sweptSegmentVsPolygon(start, heading, length, 0, corners(g));
    if (t !== null) candidates.push(t);
  }
  for (const c of corners(r)) {
    const t = sweptCircleVsCircle(start, heading, length, radius, c, 0);
    if (t !== null) candidates.push(t);
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}
