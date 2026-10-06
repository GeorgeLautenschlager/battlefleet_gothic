/** Setup, ordnance, brace and End Phase checks (validator spec §4.1, §4.4–4.6). */
import { EPS } from "../geometry/constants";
import { baseRadius, bmTouchesBase, distance } from "../geometry/basic";
import { onTable } from "../state/derived";
import { deploymentDivisions, divisionAt, emptyDivisions, setupOptions } from "../rules/engagement";
import type { GameState } from "../state/types";
import type { AnswerBrace, ChooseSetup, DeployShip, RemoveBlastMarkers, Repair } from "../transforms/types";
import { isResult, ownActiveShip, ownShip, rerollCheck } from "./movement";
import { OK, reject, type ValidationResult } from "./reasons";

const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

export function checkDeployShip(state: GameState, t: DeployShip): ValidationResult {
  const ship = ownShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  if (ship.status !== "undeployed") return reject("ALREADY_DEPLOYED", `${ship.name} is already deployed`);

  // 4: in one of the player's divisions (Cruiser Clash: its one zone)
  const zoneId = state.setup.zones?.[t.player] ?? null;
  const divisions = deploymentDivisions(state, t.player);
  const division = divisionAt(divisions, t.position);
  if (division < 0) return reject("NOT_IN_ZONE", `That isn't in your deployment zone${zoneId === null ? "" : ` (${zoneId})`}`, { zone: zoneId });

  // 5: every division gets a ship before any gets a second (state N18)
  const empty = emptyDivisions(state, t.player);
  const undeployed = state.ships.filter((s) => s.owner === t.player && s.status === "undeployed").length;
  if (undeployed <= empty.length && !empty.includes(division)) {
    return reject("FILL_DIVISIONS_FIRST", "Each division needs a ship before any gets a second", { empty });
  }

  const radius = baseRadius(ship.profile.baseSize);
  for (const other of state.ships) {
    if (other.position === null) continue;
    const touching = radius + baseRadius(other.profile.baseSize);
    if (distance(t.position, other.position) <= touching - EPS) {
      return reject("BASES_OVERLAP", `${ship.name} would overlap ${other.name}`, { shipId: other.id });
    }
  }
  return OK;
}

/** choose_setup: one of the two set-ups the formations offer, seen from the chooser's side (validator §4.1). */
export function checkChooseSetup(state: GameState, t: ChooseSetup): ValidationResult {
  const options = setupOptions(state).map((o) => ({ map: o.map, colour: o.colours[t.player] }));
  if (!options.some((o) => o.map === t.map && o.colour === t.colour)) {
    return reject("INVALID_SETUP", `Map ${t.map} with ${t.colour} isn't one of the set-ups on offer`, { options });
  }
  return OK;
}

export function checkAnswerBrace(state: GameState, t: AnswerBrace): ValidationResult {
  const top = state.pending[state.pending.length - 1];
  if (top === undefined || top.id !== t.pendingId) {
    return reject("NOT_TOP_PENDING", "That isn't the decision being asked", { pendingId: top?.id ?? null });
  }
  // 2: a re-roll for a failed brace check
  const ship = state.ships.find((s) => s.id === top.shipId);
  return ship === undefined ? OK : rerollCheck(state, ship, t.reroll, t.attempt);
}

/** Exactly the required set: no extras, no duplicates, none missing. */
export function priorityProblem(given: readonly string[], required: readonly string[]): ValidationResult {
  const want = new Set(required);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const id of given) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
    if (!want.has(id)) unexpected.push(id);
  }
  const missing = required.filter((id) => !seen.has(id));
  if (missing.length + unexpected.length + duplicates.length === 0) return OK;
  return reject("INVALID_PRIORITY", "The priority list must name each one exactly once", { missing, unexpected, duplicates });
}

export function checkRepair(state: GameState, t: Repair): ValidationResult {
  const ship = ownActiveShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  if (state.turnState.ships[ship.id]?.repaired === true) {
    return reject("ALREADY_REPAIRED", `${ship.name} has already rolled for repairs`, { shipId: ship.id });
  }
  const repairable = ship.criticals.filter((c) => !UNREPAIRABLE.has(c.kind)).map((c) => c.id);
  if (repairable.length === 0) return reject("NOTHING_TO_REPAIR", `${ship.name} has nothing to repair`, { shipId: ship.id });
  return priorityProblem(t.priority, repairable);
}

export function checkRemoveBlastMarkers(state: GameState, t: RemoveBlastMarkers): ValidationResult {
  const onTableShips = state.ships.filter(onTable);
  const removable = state.blastMarkers
    .filter((bm) => !onTableShips.some((s) => s.position !== null && bmTouchesBase(bm.position, s.position, s.profile.baseSize)))
    .map((bm) => bm.id);
  return priorityProblem(t.priority, removable);
}
