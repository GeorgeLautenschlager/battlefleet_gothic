/**
 * Lines of fire and targeting (validator spec §2.7).
 */
import { EPS } from "./constants";
import { approxLe, baseRadius, distance, quadrantsOfPoint, segmentTouchesCircle } from "./basic";
import { EngineError, isHulk } from "../state/derived";
import type { GameState, Point, Quadrant, Ship, TorpedoSalvo, Weapon } from "../state/types";

export type Target = { kind: "ship"; ship: Ship } | { kind: "ordnance"; salvo: TorpedoSalvo };

export function targetPosition(target: Target): Point {
  if (target.kind === "ordnance") return target.salvo.position;
  if (target.ship.position === null) throw new EngineError(`${target.ship.id} is not on the table`);
  return target.ship.position;
}

function pose(ship: Ship): { position: Point; heading: number } {
  if (ship.position === null || ship.heading === null) throw new EngineError(`${ship.id} is not on the table`);
  return { position: ship.position, heading: ship.heading };
}

/** A hulk other than the shooter and the target lies across the stem-to-stem line (p. 71). */
export function lineOfFireBlocked(state: GameState, shooter: Ship, target: Ship): boolean {
  const from = pose(shooter).position;
  const to = pose(target).position;
  return state.ships.some((hulk) => {
    if (!isHulk(hulk) || hulk.id === shooter.id || hulk.id === target.id || hulk.position === null) return false;
    return segmentTouchesCircle(from, to, hulk.position, baseRadius(hulk.profile.baseSize));
  });
}

/** The weapon's arcs that contain a point: one, two on a boundary, or none. */
export function arcsBearing(ship: Ship, weapon: Weapon, point: Point): Quadrant[] {
  const { position, heading } = pose(ship);
  return quadrantsOfPoint(position, heading, point).filter((q) => weapon.arcs.includes(q));
}

/** In range, in arc, and (for ships) with a clear line of fire. */
export function canEngage(state: GameState, ship: Ship, weapon: Weapon, target: Target): boolean {
  if (weapon.range === null) return false;
  const point = targetPosition(target);
  if (!approxLe(distance(pose(ship).position, point), weapon.range)) return false;
  if (arcsBearing(ship, weapon, point).length === 0) return false;
  return target.kind === "ordnance" || !lineOfFireBlocked(state, ship, target.ship);
}

/** Of `candidates`, those within EPS of the minimum distance from `from`. */
function nearestOf<T>(from: Point, candidates: T[], position: (c: T) => Point): T[] {
  if (candidates.length === 0) return [];
  const distances = candidates.map((c) => distance(from, position(c)));
  const min = Math.min(...distances);
  return candidates.filter((_, i) => (distances[i] ?? Infinity) < min + EPS);
}

/**
 * The nearest enemy ships *this weapon* could engage (ruling V1). Hulks are
 * never the nearest (p. 71). Ties all count.
 */
export function nearestShipTargets(state: GameState, ship: Ship, weapon: Weapon): Ship[] {
  const from = pose(ship).position;
  const candidates = state.ships.filter(
    (s) => s.owner !== ship.owner && s.status === "active" && canEngage(state, ship, weapon, { kind: "ship", ship: s }),
  );
  return nearestOf(from, candidates, (s) => pose(s).position);
}

/** The nearest enemy torpedo salvoes this weapon could engage. */
export function nearestOrdnanceTargets(state: GameState, ship: Ship, weapon: Weapon): TorpedoSalvo[] {
  const from = pose(ship).position;
  const candidates = state.ordnance.filter(
    (o) => o.owner !== ship.owner && canEngage(state, ship, weapon, { kind: "ordnance", salvo: o }),
  );
  return nearestOf(from, candidates, (o) => o.position);
}

/** The target is (one of) the nearest for this weapon, so no priority test is needed. */
export function isNearest(state: GameState, ship: Ship, weapon: Weapon, target: Target): boolean {
  if (target.kind === "ship") return nearestShipTargets(state, ship, weapon).some((s) => s.id === target.ship.id);
  return nearestOrdnanceTargets(state, ship, weapon).some((o) => o.id === target.salvo.id);
}
