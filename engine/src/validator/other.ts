/** Setup, ordnance, brace and End Phase checks (validator spec §4.1, §4.4–4.6). */
import { EPS } from "../geometry/constants";
import { baseRadius, bmTouchesBase, distance } from "../geometry/basic";
import { onTable } from "../state/derived";
import type { GameState } from "../state/types";
import type { AnswerBrace, DeployShip, RemoveBlastMarkers, Repair } from "../transforms/types";
import { isResult, ownActiveShip, ownShip } from "./movement";
import { OK, reject, type ValidationResult } from "./reasons";

const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

export function checkDeployShip(state: GameState, t: DeployShip): ValidationResult {
  const ship = ownShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  if (ship.status !== "undeployed") return reject("ALREADY_DEPLOYED", `${ship.name} is already deployed`);

  const zoneId = state.setup.zones?.[t.player];
  const zone = zoneId === undefined ? undefined : state.scenario.deploymentZones[zoneId];
  const { x, y } = t.position;
  const inZone =
    zone !== undefined &&
    x >= zone.x - EPS &&
    x <= zone.x + zone.width + EPS &&
    y >= zone.y - EPS &&
    y <= zone.y + zone.height + EPS;
  if (!inZone) return reject("NOT_IN_ZONE", `That isn't in your deployment zone (${zoneId ?? "none"})`, { zone: zoneId ?? null });

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

export function checkAnswerBrace(state: GameState, t: AnswerBrace): ValidationResult {
  const top = state.pending[state.pending.length - 1];
  if (top === undefined || top.id !== t.pendingId) {
    return reject("NOT_TOP_PENDING", "That isn't the decision being asked", { pendingId: top?.id ?? null });
  }
  return OK;
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
