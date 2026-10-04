/**
 * Swept contact (validator spec §2.5): move a shape along a straight line and
 * find the distance at which it *first* touches something.
 *
 * Every function takes the mover's start point, heading and travel length L,
 * and returns the contact distance t ∈ [0, L] (0 = touching at the start),
 * or null for no contact within L. Contact is inclusive, within EPS (ruling V2).
 */
import { EPS } from "./constants";
import { headingVector } from "./basic";
import type { Point, Table } from "../state/types";

/**
 * A point in the mover's local frame: u along the direction of travel,
 * v across it (positive to starboard).
 */
export function toLocal(start: Point, heading: number, p: Point): { u: number; v: number } {
  const dir = headingVector(heading);
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  return { u: dx * dir.x + dy * dir.y, v: dx * dir.y - dy * dir.x };
}

/** Shared core: a mover whose leading edge spans |v| ≤ 0 meeting a circle of radius R at (cu, cv). */
function firstContact(cu: number, cv: number, R: number, length: number): number | null {
  const across = Math.abs(cv);
  if (across > R + EPS) return null;
  const h = Math.sqrt(Math.max(0, R * R - across * across));
  if (cu + h < -EPS) return null; // entirely behind the mover
  const t = Math.max(0, cu - h);
  return t <= length + EPS ? t : null;
}

/** A circle of radius `moverRadius` (a ship's base) swept against a circle (a base or a Blast Marker). */
export function sweptCircleVsCircle(
  start: Point,
  heading: number,
  length: number,
  moverRadius: number,
  centre: Point,
  radius: number,
): number | null {
  const { u, v } = toLocal(start, heading, centre);
  return firstContact(u, v, moverRadius + radius, length);
}

/** A segment `width` wide, perpendicular to travel (a torpedo salvo), swept against a circle. */
export function sweptSegmentVsCircle(
  start: Point,
  heading: number,
  length: number,
  width: number,
  centre: Point,
  radius: number,
): number | null {
  const { u, v } = toLocal(start, heading, centre);
  const dv = Math.max(0, Math.abs(v) - width / 2);
  return firstContact(u, dv, radius, length);
}

/**
 * A segment `width` wide (perpendicular to travel) swept against a stationary
 * segment: a salvo meeting a salvo. Exact: the first u at which the stationary
 * segment's part with |v| ≤ width/2 is reached.
 */
export function sweptSegmentVsSegment(
  start: Point,
  heading: number,
  length: number,
  width: number,
  otherCentre: Point,
  otherHeading: number,
  otherWidth: number,
): number | null {
  // Endpoints of the stationary segment: centre ± (otherWidth / 2) along its own starboard direction.
  const across = headingVector(otherHeading + 90);
  const half = otherWidth / 2;
  const p1 = toLocal(start, heading, { x: otherCentre.x - half * across.x, y: otherCentre.y - half * across.y });
  const p2 = toLocal(start, heading, { x: otherCentre.x + half * across.x, y: otherCentre.y + half * across.y });

  // Clip the stationary segment (parameter s ∈ [0, 1]) to the band |v| ≤ width/2 + EPS.
  const band = width / 2 + EPS;
  const dv = p2.v - p1.v;
  let sLo = 0;
  let sHi = 1;
  if (dv === 0) {
    if (Math.abs(p1.v) > band) return null;
  } else {
    const a = (-band - p1.v) / dv;
    const b = (band - p1.v) / dv;
    sLo = Math.max(0, Math.min(a, b));
    sHi = Math.min(1, Math.max(a, b));
    if (sLo > sHi) return null;
  }
  const uLo = p1.u + sLo * (p2.u - p1.u);
  const uHi = p1.u + sHi * (p2.u - p1.u);
  const uMin = Math.min(uLo, uHi);
  const uMax = Math.max(uLo, uHi);
  if (uMax < -EPS) return null; // behind
  const t = Math.max(0, uMin);
  return t <= length + EPS ? t : null;
}

/**
 * A circle of radius `radius` (a ship's base) swept against a stationary segment
 * from `a` to `b` (a torpedo salvo lying across its own heading). Exact: the
 * first contact with the segment's capsule, i.e. either end disc or the band between.
 */
export function sweptCircleVsSegment(
  start: Point,
  heading: number,
  length: number,
  radius: number,
  a: Point,
  b: Point,
): number | null {
  const candidates: number[] = [];
  for (const end of [a, b]) {
    const t = sweptCircleVsCircle(start, heading, length, radius, end, 0);
    if (t !== null) candidates.push(t);
  }
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const segLength = Math.sqrt(abx * abx + aby * aby);
  if (segLength > 0) {
    const n = { x: -aby / segLength, y: abx / segLength }; // unit normal to the segment
    const dir = headingVector(heading);
    const f0 = n.x * (start.x - a.x) + n.y * (start.y - a.y); // signed distance from the segment's line
    const rate = n.x * dir.x + n.y * dir.y;
    let enter: number | null = null;
    if (Math.abs(f0) <= radius + EPS) enter = 0;
    else if (rate !== 0) {
      const t1 = (radius - f0) / rate;
      const t2 = (-radius - f0) / rate;
      const lo = Math.min(t1, t2);
      if (Math.max(t1, t2) >= -EPS) enter = Math.max(0, lo);
    }
    if (enter !== null && enter <= length + EPS) {
      const p = { x: start.x + enter * dir.x, y: start.y + enter * dir.y };
      const s = ((p.x - a.x) * abx + (p.y - a.y) * aby) / (segLength * segLength);
      if (s >= 0 && s <= 1) candidates.push(enter);
    }
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/**
 * Distance along a straight move at which the point leaves the table, or null.
 * It only counts as leaving if the end of the move is outside by more than EPS;
 * the distance returned is where it crosses the edge itself.
 */
export function exitT(start: Point, heading: number, length: number, table: Table): number | null {
  const dir = headingVector(heading);
  const end = { x: start.x + length * dir.x, y: start.y + length * dir.y };
  const crossings: number[] = [];
  if (end.x < -EPS) crossings.push((0 - start.x) / dir.x);
  if (end.x > table.width + EPS) crossings.push((table.width - start.x) / dir.x);
  if (end.y < -EPS) crossings.push((0 - start.y) / dir.y);
  if (end.y > table.height + EPS) crossings.push((table.height - start.y) / dir.y);
  if (crossings.length === 0) return null;
  return Math.max(0, Math.min(...crossings));
}
