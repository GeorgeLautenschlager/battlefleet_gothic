/**
 * Planets (state §4, §11, N64–N71; pp. 112–113): the template, its gravity
 * well, line of sight, and the gravity well's free turns.
 */
import { EPS } from "../geometry/constants";
import { distance, norm, segmentPointDistance, tableBearing } from "../geometry/basic";
import { sweptCircleVsCircle, sweptSegmentVsCircle, toLocal } from "../geometry/sweep";
import type { GameState, Planet, PlanetSize, Point } from "../state/types";

/** The engine's template per size (N64): diameter and gravity well, cm. */
export const PLANET_SIZES: Readonly<Record<PlanetSize, { diameter: number; well: number }>> = {
  small: { diameter: 15, well: 10 },
  medium: { diameter: 25, well: 15 },
  large: { diameter: 35, well: 30 },
};

/** The most a gravity well turns a ship (p. 112). */
export const GRAVITY_TURN = 45;

export const planets = (state: GameState): Planet[] => (state.table.features ?? []).filter((f): f is Planet => f.kind === "planet");

const radius = (p: Planet): number => p.diameter / 2;

/** The planet whose template holds `point`, edge included (state §11). */
export const onPlanet = (state: GameState, point: Point): Planet | undefined =>
  planets(state).find((p) => distance(point, p.position) <= radius(p) + EPS);

/** The planet whose gravity well (template included) holds `point` (N67). */
export const gravityWellAt = (state: GameState, point: Point): Planet | undefined =>
  planets(state).find((p) => distance(point, p.position) <= radius(p) + p.well + EPS);

/** Some planet lies across the line, and neither end is on it (N65, V24). */
export function planetBlocks(state: GameState, from: Point, to: Point): boolean {
  return planets(state).some((p) => {
    const r = radius(p);
    if (distance(from, p.position) <= r + EPS || distance(to, p.position) <= r + EPS) return false;
    return segmentPointDistance(from, to, p.position) < r - EPS;
  });
}

/** The signed angle from `heading` to the bearing of the planet from `at`, in (−180, 180]. */
export function angleToPlanet(planet: Planet, at: Point, heading: number): number {
  const d = norm(tableBearing(at, planet.position) - heading);
  return d > 180 ? d - 360 : d;
}

/**
 * Why a gravity turn of `degrees` at `at`, from `heading`, isn't allowed (N68),
 * or null if it is: the stem must be in a well, and the bow turn toward the
 * planet's centre, by at most 45° and no further than the centre.
 */
export function gravityTurnProblem(state: GameState, at: Point, heading: number, degrees: number): "not_in_well" | "direction" | "too_sharp" | null {
  const planet = gravityWellAt(state, at);
  if (planet === undefined) return "not_in_well";
  const delta = angleToPlanet(planet, at, heading);
  const away = Math.abs(Math.abs(delta) - 180) <= EPS;
  if (!away && (Math.abs(delta) <= EPS || Math.sign(degrees) !== Math.sign(delta))) return "direction";
  if (Math.abs(degrees) > Math.min(GRAVITY_TURN, Math.abs(delta)) + EPS) return "too_sharp";
  return null;
}

/**
 * Where a torpedo salvo moving `length` meets a planet's edge (N66, reducer R48):
 * going in, its swept segment touches the template; coming out (its centre
 * starts on the template), its centre reaches the edge. The first, or null.
 */
export function salvoPlanetContact(state: GameState, start: Point, heading: number, length: number, width: number): { t: number; planetId: string } | null {
  let best: { t: number; planetId: string } | null = null;
  for (const p of planets(state)) {
    const r = radius(p);
    let t: number | null;
    if (distance(start, p.position) < r - EPS) {
      const { u, v } = toLocal(start, heading, p.position);
      const out = u + Math.sqrt(Math.max(0, r * r - v * v));
      t = out <= length + EPS ? Math.max(0, out) : null;
    } else {
      t = sweptSegmentVsCircle(start, heading, length, width, p.position, r);
    }
    if (t !== null && (best === null || t < best.t)) best = { t, planetId: p.id };
  }
  return best;
}

/** Where a drifting hulk's stem reaches a planet's template (N70, reducer R49), or null. */
export function stemPlanetContact(state: GameState, start: Point, heading: number, length: number): { t: number; planetId: string } | null {
  let best: { t: number; planetId: string } | null = null;
  for (const p of planets(state)) {
    const t = sweptCircleVsCircle(start, heading, length, 0, p.position, radius(p));
    if (t !== null && (best === null || t < best.t)) best = { t, planetId: p.id };
  }
  return best;
}
