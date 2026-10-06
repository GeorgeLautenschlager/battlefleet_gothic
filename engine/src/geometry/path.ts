/**
 * Walking a path (validator spec §2.6): expand a move's PathSteps into straight
 * legs with running totals, and query them for Blast Markers and the table edge.
 */
import { BM_RADIUS } from "./constants";
import { baseRadius, bmTouchesBase, headingVector, norm } from "./basic";
import { exitT, sweptCircleVsCircle } from "./sweep";
import { EngineError } from "../state/derived";
import type { BlastMarker, GameState, PathStep, Point, Ship, Table } from "../state/types";

export type Leg = {
  stepIndex: number;
  start: Point;
  heading: number;
  length: number;
  /** Forward distance moved before this leg. */
  distanceBefore: number;
};

export type Walk = {
  legs: Leg[];
  turns: { stepIndex: number; degrees: number; sinceLastTurn: number }[];
  /** A gravity well's free turns (state N68): not turns, so they're kept apart. */
  gravityTurns: { stepIndex: number; degrees: number; at: Point; headingBefore: number }[];
  /** Total forward distance. */
  total: number;
  end: { position: Point; heading: number };
};

/** Expand a path from a starting pose. Turns rotate in place; only advances make legs. */
export function walkPath(start: { position: Point; heading: number }, path: readonly PathStep[]): Walk {
  const legs: Leg[] = [];
  const turns: Walk["turns"] = [];
  const gravityTurns: Walk["gravityTurns"] = [];
  let position = start.position;
  let heading = start.heading;
  let total = 0;
  let sinceLastTurn = 0;
  for (const [stepIndex, step] of path.entries()) {
    if (step.kind === "turn") {
      turns.push({ stepIndex, degrees: step.degrees, sinceLastTurn });
      heading = norm(heading + step.degrees);
      sinceLastTurn = 0;
      continue;
    }
    if (step.kind === "gravity_turn") {
      gravityTurns.push({ stepIndex, degrees: step.degrees, at: position, headingBefore: heading });
      heading = norm(heading + step.degrees);
      continue;
    }
    legs.push({ stepIndex, start: position, heading, length: step.distance, distanceBefore: total });
    const dir = headingVector(heading);
    position = { x: position.x + step.distance * dir.x, y: position.y + step.distance * dir.y };
    total += step.distance;
    sinceLastTurn += step.distance;
  }
  return { legs, turns, gravityTurns, total, end: { position, heading } };
}

/** walkPath from a ship's current pose. */
export function walkShipPath(ship: Ship, path: readonly PathStep[]): Walk {
  if (ship.position === null || ship.heading === null) throw new EngineError(`${ship.id} is not on the table`);
  return walkPath({ position: ship.position, heading: ship.heading }, path);
}

/** First path distance at which a swept base of `radius` touches a circle, or null. */
export function firstContactAlong(walk: Walk, radius: number, centre: Point, otherRadius: number): number | null {
  for (const leg of walk.legs) {
    const t = sweptCircleVsCircle(leg.start, leg.heading, leg.length, radius, centre, otherRadius);
    if (t !== null) return leg.distanceBefore + t;
  }
  return null;
}

/**
 * Path distances, ascending, at which the swept base first touches each Blast
 * Marker not in `exclude` (validator §2.6 `bmContacts`).
 */
export function bmContacts(
  blastMarkers: readonly BlastMarker[],
  ship: Ship,
  walk: Walk,
  exclude: ReadonlySet<string> = new Set(),
): { id: string; distance: number }[] {
  const radius = baseRadius(ship.profile.baseSize);
  const out: { id: string; distance: number }[] = [];
  for (const bm of blastMarkers) {
    if (exclude.has(bm.id)) continue;
    const distance = firstContactAlong(walk, radius, bm.position, BM_RADIUS);
    if (distance !== null) out.push({ id: bm.id, distance });
  }
  // Stable sort keeps creation order for ties, so the result is deterministic.
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * The move passes through Blast Markers (the −5 cm slowdown, p. 69): it goes
 * somewhere, and either starts in contact with a BM or touches one on the way.
 * Moving off a BM you start on counts (p. 201).
 */
export function touchesAnyBm(state: GameState, ship: Ship, walk: Walk): boolean {
  if (walk.total <= 0) return false;
  const stem = ship.position;
  if (stem !== null && state.blastMarkers.some((bm) => bmTouchesBase(bm.position, stem, ship.profile.baseSize))) {
    return true;
  }
  return bmContacts(state.blastMarkers, ship, walk).length > 0;
}

/** Path distance at which the stem leaves the table, or null (validator §2.6 `exitDistance`). */
export function exitDistance(walk: Walk, table: Table): number | null {
  for (const leg of walk.legs) {
    const t = exitT(leg.start, leg.heading, leg.length, table);
    if (t !== null) return leg.distanceBefore + t;
  }
  return null;
}

/** The leg a path distance falls in (the first leg whose span contains it). */
export function legAt(walk: Walk, distance: number): Leg | null {
  for (const leg of walk.legs) {
    if (distance <= leg.distanceBefore + leg.length) return leg;
  }
  return null;
}
