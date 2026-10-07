/**
 * Mines, minefields and fire ships (validator spec §4.1–4.2): `place_defence` and `detonate`.
 */
import { getShip } from "../state/derived";
import { gravityWellAt, onPlanet } from "../rules/planets";
import { minefieldPlacementProblem, minefieldRect } from "../rules/minefields";
import type { GameState } from "../state/types";
import type { Detonate, PlaceDefence } from "../transforms/types";
import { cm, OK, reject, type ValidationResult } from "./reasons";
import { MINEFIELD_REACH } from "../geometry/constants";

export function checkPlaceDefence(state: GameState, t: PlaceDefence): ValidationResult {
  const left = state.setup.emplacements?.unplaced;
  // 1
  const next = left?.minefields?.[0];
  if (t.kind === "orbital_mine" ? (left?.orbitalMines ?? 0) === 0 : next === undefined) {
    return reject("NOTHING_TO_PLACE", t.kind === "orbital_mine" ? "No orbital mines are left to place" : "No minefields are left to place", { kind: t.kind });
  }
  if (t.kind === "orbital_mine") {
    // 2
    if (t.turned !== undefined) return reject("CANT_TURN_MINE", "A mine is round: it can't be turned");
    // 3 (state N108, T145)
    if (gravityWellAt(state, t.position) === undefined || onPlanet(state, t.position) !== undefined) {
      return reject("NOT_IN_GRAVITY_WELL", "An orbital mine goes in the planet's gravity well, off the template", { position: { ...t.position } });
    }
    return OK;
  }
  if (next === undefined) return OK; // unreachable: check 1
  const rect = minefieldRect(next, t.position, t.turned === true);
  const problem = minefieldPlacementProblem(state, rect);
  // 4–6 (T146)
  if (problem?.code === "OFF_TABLE") return reject("OFF_TABLE", "The minefield must lie wholly on the table", { rect: { ...rect } });
  if (problem?.code === "MINEFIELD_TOO_FAR") {
    return reject("MINEFIELD_TOO_FAR", `The minefield is ${cm(problem.distance)} from the planet: its nearest point must be within ${cm(MINEFIELD_REACH)}`, {
      distance: problem.distance,
      limit: MINEFIELD_REACH,
    });
  }
  if (problem?.code === "MINEFIELDS_OVERLAP") return reject("MINEFIELDS_OVERLAP", "Minefields can't overlap", { minefieldId: problem.minefieldId });
  return OK;
}

export function checkDetonate(state: GameState, t: Detonate): ValidationResult {
  const ship = state.ships.find((s) => s.id === t.shipId);
  if (ship === undefined) return reject("UNKNOWN_SHIP", `No ship ${t.shipId}`, { shipId: t.shipId });
  if (ship.owner !== t.player) return reject("NOT_YOUR_SHIP", `${ship.name} isn't yours`, { shipId: ship.id });
  if (ship.status !== "active") return reject("SHIP_NOT_ACTIVE", `${ship.name} isn't active`, { shipId: ship.id });
  if (getShip(state, ship.id).profile.traits?.fireShip !== true) return reject("NOT_A_FIRE_SHIP", `${ship.name} isn't a fire ship`, { shipId: ship.id });
  // Before its move or after it, never halfway (transform T153).
  if (state.activation !== null) return reject("ACTIVATION_OPEN", "Finish the ship that's moving first", { shipId: state.activation.shipId });
  return OK;
}
