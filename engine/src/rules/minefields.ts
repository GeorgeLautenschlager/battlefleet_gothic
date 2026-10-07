/**
 * Orbital mines and minefields (fleets book pp. 512–513; state §4, §10.2, §11, N106–N122).
 */
import { DETECTION_RANGE, EPS, MINE_RADIUS, MINEFIELD_REACH } from "../geometry/constants";
import { baseRadius, circlesTouch, distance } from "../geometry/basic";
import { circleTouchesRect, pointRectDistance, rectAround, rectOnTable, rectsOverlap, segmentTouchesRect } from "../geometry/rect";
import type { GameState, Minefield, MinefieldSize, Ordnance, OrbitalMine, Point, Rect, Ship } from "../state/types";
import { planets } from "./planets";

export const minefields = (state: GameState): Minefield[] => (state.table.features ?? []).filter((f): f is Minefield => f.kind === "minefield");

export const isMine = (o: Ordnance): o is OrbitalMine => o.kind === "orbital_mine";

/** Some minefield (other than `except`) has a point of its rectangle on the segment from `from` to `to` (N114). */
export const minefieldBlocks = (state: GameState, from: Point, to: Point, except?: string): boolean =>
  minefields(state).some((f) => f.id !== except && segmentTouchesRect(from, to, f.rect));

/** The minefields a circle (a base, a wave, a Blast Marker) touches. */
export const minefieldsTouching = (state: GameState, centre: Point, radius: number): Minefield[] =>
  minefields(state).filter((f) => circleTouchesRect(centre, radius, f.rect));

/** The nearest enemy active ship to a mine, stem to centre; ties go to the first in `ships` (N110). */
export function mineQuarry(state: GameState, mine: OrbitalMine): Ship | undefined {
  let best: Ship | undefined;
  let bestD = Infinity;
  for (const s of state.ships) {
    if (s.owner === mine.owner || s.status !== "active" || s.position === null) continue;
    const d = distance(mine.position, s.position);
    if (d < bestD - EPS) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** The enemy active ships a mine's marker touches, in `ships` order. */
export const mineTouching = (state: GameState, mine: OrbitalMine): Ship[] =>
  state.ships.filter(
    (s) => s.owner !== mine.owner && s.status === "active" && s.position !== null && circlesTouch(mine.position, MINE_RADIUS, s.position, baseRadius(s.profile.baseSize)),
  );

/** The rectangle a minefield of `size` makes centred on `position`, turned a quarter if `turned`. */
export const minefieldRect = (size: MinefieldSize, position: Point, turned: boolean): Rect =>
  turned ? rectAround(position, size.height, size.width) : rectAround(position, size.width, size.height);

/** Why a minefield can't go here (validator place_defence 4–6), or null. */
export function minefieldPlacementProblem(state: GameState, rect: Rect): { code: "OFF_TABLE" } | { code: "MINEFIELD_TOO_FAR"; distance: number } | { code: "MINEFIELDS_OVERLAP"; minefieldId: string } | null {
  if (!rectOnTable(rect, state.table)) return { code: "OFF_TABLE" };
  const planet = planets(state)[0];
  if (planet !== undefined) {
    const gap = Math.max(0, pointRectDistance(planet.position, rect) - planet.diameter / 2);
    if (gap > MINEFIELD_REACH + EPS) return { code: "MINEFIELD_TOO_FAR", distance: gap };
  }
  const other = minefields(state).find((f) => rectsOverlap(f.rect, rect));
  if (other !== undefined) return { code: "MINEFIELDS_OVERLAP", minefieldId: other.id };
  return null;
}

/** Enemy ships a minefield can detect: active, stem within 30 cm of its rectangle (N118). */
export const inDetectionRange = (field: Minefield, ship: Ship): boolean =>
  ship.position !== null && pointRectDistance(ship.position, field.rect) <= DETECTION_RANGE + EPS;
