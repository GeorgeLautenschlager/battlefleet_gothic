/**
 * Mines, minefields and fire ships (validator spec §4.1–4.2): `place_defence` and `detonate`.
 */
import { getShip } from "../state/derived";
import { gravityWellAt, onPlanet } from "../rules/planets";
import { minefieldPlacementProblem, minefieldRect } from "../rules/minefields";
import type { GameState } from "../state/types";
import type { ChooseDefences, Detonate, PlaceDefence } from "../transforms/types";
import { MINE_POINTS } from "../state/derived";
import { CATALOGUE } from "../state/catalogue";
import { isDefenceClass, MAX_FIRE_SHIPS, MAX_MINEFIELDS, MINEFIELD_POINTS } from "../state/newGame";
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

/** Surprise Attack's free defences (validator §4.1, V45–V47): the whole shopping list at once. */
export function checkChooseDefences(state: GameState, t: ChooseDefences): ValidationResult {
  // 1
  const bad = t.ships.find((s) => !isDefenceClass(s.classId));
  if (bad !== undefined) return reject("NOT_A_DEFENCE", `${bad.classId} isn't a planetary defence`, { classId: bad.classId });
  // 2
  const taken = new Set(state.ships.map((s) => s.name.trim()));
  for (const s of t.ships) {
    const name = s.name.trim();
    if (name.length === 0 || name.length > 40) return reject("INVALID_NAME", "Ship names need 1–40 characters", { name: s.name });
    if (taken.has(name)) return reject("INVALID_NAME", `${name} is already a ship in this game`, { name });
    taken.add(name);
  }
  // 3
  const profile = (classId: string) => CATALOGUE[classId]?.profile;
  const points = t.ships.reduce((n, s) => n + (profile(s.classId)?.points ?? 0), 0) + MINE_POINTS * t.orbitalMines + MINEFIELD_POINTS * t.minefields;
  const budget = state.setup.surpriseAttack?.defenceBudget ?? 0;
  if (points > budget) return reject("OVER_BUDGET", `That's ${points} pts of defences; the budget is ${budget} pts`, { points, budget });
  // 4 (state N125)
  const fields = (state.setup.emplacements?.minefields ?? 0) + t.minefields;
  if (fields > MAX_MINEFIELDS) return reject("TOO_MANY", `At most ${MAX_MINEFIELDS} minefields in all`, { kind: "minefield", count: fields, max: MAX_MINEFIELDS });
  const torches = state.ships.filter((s) => s.owner === t.player && s.profile.traits?.fireShip === true).length + t.ships.filter((s) => profile(s.classId)?.traits?.fireShip === true).length;
  if (torches > MAX_FIRE_SHIPS) return reject("TOO_MANY", `At most ${MAX_FIRE_SHIPS} fire ships in all`, { kind: "fire_ship", count: torches, max: MAX_FIRE_SHIPS });
  // 5 (V47)
  const theirs = new Set((state.squadrons ?? []).filter((sq) => sq.owner === t.player).map((sq) => sq.name));
  const min = state.meta.options.fleetLists === true ? 2 : 1;
  const groups = new Map<string, number>();
  for (const s of t.ships) {
    const escort = profile(s.classId)?.type === "escort";
    const name = s.squadron?.trim();
    if (escort && (name === undefined || name === "")) return reject("INVALID_SQUADRON", `${s.name.trim()} is an escort: name its squadron`, { name: s.name });
    if (!escort && name !== undefined) return reject("INVALID_SQUADRON", `${s.name.trim()} is a stationary defence: it doesn't squadron`, { name: s.name });
    if (name === undefined) continue;
    if (theirs.has(name)) return reject("INVALID_SQUADRON", `${name} is already one of your squadrons`, { squadron: name });
    groups.set(name, (groups.get(name) ?? 0) + 1);
  }
  for (const [name, n] of groups) {
    if (n < min || n > 6) return reject("INVALID_SQUADRON", `Squadron ${name} has ${n} ships: it needs ${min}–6`, { squadron: name, count: n });
  }
  return OK;
}
