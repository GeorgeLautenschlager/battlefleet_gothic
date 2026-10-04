/**
 * Basic geometry shared by state, validator and reducer (validator spec §2.2–2.4).
 * Swept contact and path walking (§2.5–2.7) arrive with the validator.
 */
import { atan2Deg, cosDeg, sinDeg } from "../math/dmath";
import { BASE_RADIUS, BM_RADIUS, EPS } from "./constants";
import type { BaseSize, Point, Quadrant } from "../state/types";

// --- Tolerant comparison (§2.2)

export const approxLe = (a: number, b: number): boolean => a < b + EPS;
export const approxGe = (a: number, b: number): boolean => a > b - EPS;
export const approxEq = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

// --- Angles and bearings (§2.3). Aviation style: degrees clockwise, 0 = +y.

/** Normalise an angle to [0, 360). */
export function norm(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return r + 0; // no −0
}

/** Table bearing from one point to another: 0 = +y (top edge), clockwise. */
export function tableBearing(from: Point, to: Point): number {
  return norm(atan2Deg(to.x - from.x, to.y - from.y));
}

/** Unit vector for a heading: (sin h, cos h). Exact on cardinal headings. */
export function headingVector(heading: number): Point {
  return { x: sinDeg(heading), y: cosDeg(heading) };
}

/** Bearing of `point` relative to a ship's bow: 0 ahead, 90 starboard, 180 aft, 270 port. */
export function relBearing(position: Point, heading: number, point: Point): number {
  return norm(tableBearing(position, point) - heading);
}

/**
 * Quadrants whose closed range contains bearing `b`, each widened by EPS.
 * One quadrant normally; two when `b` sits on a boundary.
 */
export function quadrantsOf(b: number): Quadrant[] {
  const out: Quadrant[] = [];
  if (approxGe(b, 315) || approxLe(b, 45)) out.push("front");
  if (approxGe(b, 45) && approxLe(b, 135)) out.push("right");
  if (approxGe(b, 135) && approxLe(b, 225)) out.push("rear");
  if (approxGe(b, 225) && approxLe(b, 315)) out.push("left");
  return out;
}

const ALL_QUADRANTS: readonly Quadrant[] = ["front", "right", "rear", "left"];

/**
 * Quadrants of the ship at (position, heading) that contain `point`.
 * All four if the points coincide (bearing undefined).
 */
export function quadrantsOfPoint(position: Point, heading: number, point: Point): Quadrant[] {
  if (distance(position, point) < EPS) return [...ALL_QUADRANTS];
  return quadrantsOf(relBearing(position, heading, point));
}

// --- Distances and contact (§2.4)

export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy); // not Math.hypot: see validator §2.8
}

export const baseRadius = (size: BaseSize): number => BASE_RADIUS[size];

/** Two circles touch or overlap (contact is inclusive, ruling V2). */
export function circlesTouch(a: Point, ra: number, b: Point, rb: number): boolean {
  return approxLe(distance(a, b), ra + rb);
}

/** A Blast Marker at `bm` touches a base of the given size at `stem`. */
export function bmTouchesBase(bm: Point, stem: Point, size: BaseSize): boolean {
  return circlesTouch(bm, BM_RADIUS, stem, baseRadius(size));
}
