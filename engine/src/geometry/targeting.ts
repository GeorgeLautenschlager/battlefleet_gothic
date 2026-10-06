/**
 * Lines of fire and targeting (validator spec §2.7).
 */
import { EPS, NOVA_RADIUS } from "./constants";
import { approxLe, baseRadius, distance, quadrantsOfPoint, segmentTouchesCircle } from "./basic";
import { EngineError, formation, gunneryColumn, inFormation, isHulk, squadronOf } from "../state/derived";
import type { GameState, Ordnance, Point, Quadrant, Ship, Weapon } from "../state/types";

/** `salvo` is any ordnance: a torpedo salvo or an attack craft wave. */
export type Target = { kind: "ship"; ship: Ship } | { kind: "ordnance"; salvo: Ordnance };

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

/** Ordnance a ship may shoot at: the enemy's, and never CAP fighters (T27). */
export const shootableOrdnance = (o: Ordnance, ship: Ship): boolean =>
  o.owner !== ship.owner && !(o.kind === "attack_craft" && o.cap !== null);

/** The nearest enemy torpedo salvoes and attack craft waves (not on CAP) this weapon could engage. */
export function nearestOrdnanceTargets(state: GameState, ship: Ship, weapon: Weapon): Ordnance[] {
  const from = pose(ship).position;
  const candidates = state.ordnance.filter(
    (o) => shootableOrdnance(o, ship) && canEngage(state, ship, weapon, { kind: "ordnance", salvo: o }),
  );
  return nearestOf(from, candidates, (o) => o.position);
}

/** The target is (one of) the nearest for this weapon, so no priority test is needed. A squadron is nearest if any member in formation is (V15). */
export function isNearest(state: GameState, ship: Ship, weapon: Weapon, target: Target): boolean {
  if (target.kind === "ship") {
    const ids = (squadronTarget(state, target.ship) ?? [target.ship]).map((s) => s.id);
    return nearestShipTargets(state, ship, weapon).some((s) => ids.includes(s.id));
  }
  return nearestOrdnanceTargets(state, ship, weapon).some((o) => o.id === target.salvo.id);
}

// --- Squadrons (validator §2.7, V15–V17; transform T83–T85)

export type AspectCategory = "closing" | "moving_away" | "abeam";
const CATEGORY_QUADRANT: Record<AspectCategory, Quadrant> = { closing: "front", moving_away: "rear", abeam: "left" };
export const aspectCategory = (q: Quadrant): AspectCategory => (q === "front" ? "closing" : q === "rear" ? "moving_away" : "abeam");
const COLUMNS = ["A", "B", "C", "D", "E"];

/** The members in formation a target ship stands for (V15), or null if it's a stray or in no squadron. */
export function squadronTarget(state: GameState, target: Ship): Ship[] | null {
  const sq = squadronOf(state, target);
  return sq !== undefined && inFormation(state, target) ? formation(state, sq) : null;
}

/** The aspect a ship shows from a point: on a quadrant boundary, the easier one (V16). */
export function easiestAspect(ship: Ship, from: Point): AspectCategory {
  const { position, heading } = pose(ship);
  const quadrants = quadrantsOfPoint(position, heading, from);
  const rank = (q: Quadrant) => COLUMNS.indexOf(gunneryColumn(ship, q));
  const best = [...quadrants].sort((a, b) => rank(a) - rank(b))[0] ?? "front";
  return aspectCategory(best);
}

/** Its Gothic column at an aspect (the squadron's members share a type, so columns compare). */
export const columnAt = (ship: Ship, aspect: AspectCategory): number => COLUMNS.indexOf(gunneryColumn(ship, CATEGORY_QUADRANT[aspect]));

/** Members of `members` that took fire from the volley: some weapon of it can engage them (V17). */
export function tookFire(state: GameState, volley: readonly { ship: Ship; weapon: Weapon }[], members: readonly Ship[]): Ship[] {
  return members.filter((m) => volley.some((v) => canEngage(state, v.ship, v.weapon, { kind: "ship", ship: m })));
}

/** The aspect a volley fires at: `chosen`, or the one shown to the lead by the nearest member that took fire (T85). */
export function volleyAspect(lead: Ship, engaged: readonly Ship[], chosen: AspectCategory | undefined): AspectCategory {
  if (chosen !== undefined) return chosen;
  const from = pose(lead).position;
  const nearest = [...engaged].sort((a, b) => distance(from, pose(a).position) - distance(from, pose(b).position))[0];
  return nearest === undefined ? "closing" : easiestAspect(nearest, from);
}

/** Of the members that took fire, those no harder to hit than `aspect` (T83). */
export const eligibleAt = (lead: Ship, engaged: readonly Ship[], aspect: AspectCategory): Ship[] =>
  engaged.filter((m) => columnAt(m, easiestAspect(m, pose(lead).position)) <= columnAt(m, aspect));

// --- Nova cannon (validator spec §2.4, §2.7)

/** From the stem to the template's near edge (state N13). */
export const novaRange = (ship: Ship, aim: Point): number => distance(pose(ship).position, aim) - NOVA_RADIUS;

/** A ship's base touches the template (r = NOVA_RADIUS) or its centre hole (r = NOVA_HOLE_RADIUS). */
export function templateTouchesShip(centre: Point, ship: Ship, r: number): boolean {
  if (ship.position === null) return false;
  return approxLe(distance(centre, ship.position), r + baseRadius(ship.profile.baseSize));
}

/** A hulk lies across the line from the stem to the aim point, other than one the template touches there (T44). */
export function novaLineBlocked(state: GameState, ship: Ship, aim: Point): boolean {
  const from = pose(ship).position;
  return state.ships.some((hulk) => {
    if (!isHulk(hulk) || hulk.id === ship.id || hulk.position === null) return false;
    if (templateTouchesShip(aim, hulk, NOVA_RADIUS)) return false;
    return segmentTouchesCircle(from, aim, hulk.position, baseRadius(hulk.profile.baseSize));
  });
}
