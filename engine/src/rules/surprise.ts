/**
 * Surprise Attack (p. 132; state §4, §5, §11, N72–N80): units on full alert and on
 * standby, the planet the points limit sets, and the defender's deployment rules.
 */
import { approxLe, distance, quadrantsOfPoint } from "../geometry/basic";
import { getSquadron, otherPlayer, planetaryDefence, squadronOf } from "../state/derived";
import type { GameState, PlanetSize, PlayerId, Point } from "../state/types";
import { planets } from "./planets";

/** Where the defender's ships on full alert deploy: every stem at least 30 cm from every edge (state §4). */
export const ALERT_ZONE = { x: 30, y: 30, width: 120, height: 60 } as const;

/** The first ship on standby goes within this of the template's edge (state N75). */
export const STANDBY_RANGE = 15;

/** The planet a points limit gives (state N73): up to 500 small, up to 1,500 medium, larger above. */
export const planetForLimit = (limit: number): PlanetSize => (limit <= 500 ? "small" : limit <= 1500 ? "medium" : "large");

/** Surprise Attack's defender, or null in any other scenario. */
export function surpriseDefender(state: GameState): PlayerId | null {
  const attacker = state.scenario.attacker;
  return state.scenario.id === "surprise_attack" && attacker !== undefined ? otherPlayer(attacker) : null;
}

/** A player's units, as `choose_alert` names them (state N77): a squadron's id, or a ship's in none, in `ships` order. Planetary defences aren't among them (state N105). */
export function unitIds(state: GameState, player: PlayerId): string[] {
  const ids: string[] = [];
  for (const ship of state.ships) {
    if (ship.owner !== player || planetaryDefence(ship)) continue;
    const id = squadronOf(state, ship)?.id ?? ship.id;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The ship ids of a unit named by `unitIds`. */
export function unitShips(state: GameState, unitId: string): string[] {
  return getSquadron(state, unitId)?.shipIds ?? [unitId];
}

/** How many units `choose_alert` names: the D3, or every unit if there are fewer (state N77). */
export function alertCount(state: GameState, player: PlayerId): number {
  return Math.min(state.setup.surpriseAttack?.alertUnits ?? 0, unitIds(state, player).length);
}

/** The planet's centre is in the ship's port or starboard arc at `heading` (state N74, V29). */
export function abeamOfPlanet(state: GameState, position: Point, heading: number): boolean {
  const planet = planets(state)[0];
  if (planet === undefined) return false;
  const q = quadrantsOfPoint(position, heading, planet.position);
  return q.includes("left") || q.includes("right");
}

/** The stem is within 15 cm of the planet's template edge (state N75). */
export function nearPlanet(state: GameState, position: Point): boolean {
  const planet = planets(state)[0];
  return planet !== undefined && approxLe(distance(position, planet.position), planet.diameter / 2 + STANDBY_RANGE);
}
