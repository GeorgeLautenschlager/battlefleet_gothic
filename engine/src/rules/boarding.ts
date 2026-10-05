/**
 * Boarding rules shared by the validator and the reducer: which boarding
 * actions are still to be fought (transform spec §4.6), and whether a teleport
 * attack is legal (validator spec §4.6), which also decides when the boarding
 * step is complete (reducer spec §10.4).
 */
import { TELEPORT_RANGE } from "../geometry/constants";
import { approxLe, basesTouch, distance } from "../geometry/basic";
import { activePlayer, isCrippled, remainingHits, shieldsDown } from "../state/derived";
import type { GameState, Point, Ship } from "../state/types";
import { OK, reject, type ValidationResult } from "../validator/reasons";

export type BoardingGroup = { targetId: string; shipIds: string[] };

const touching = (a: Ship, b: Ship): boolean =>
  a.position !== null && b.position !== null && basesTouch(a.position, a.profile.baseSize, b.position, b.profile.baseSize);

/**
 * The active player's declared boarding actions still to be fought, by target:
 * active, ungrappled enemy targets, and boarders that are active, unfought and
 * still in base contact. Lapsed declarations simply drop out.
 */
export function boardingsToFight(state: GameState): BoardingGroup[] {
  const player = activePlayer(state);
  const out: BoardingGroup[] = [];
  for (const target of state.ships) {
    if (target.owner === player || target.status !== "active" || target.grapple !== null) continue;
    const shipIds = state.ships
      .filter((s) => {
        const turn = state.turnState.ships[s.id];
        return (
          s.owner === player &&
          s.status === "active" &&
          turn?.boardingDeclared === target.id &&
          turn.boarded !== true &&
          touching(s, target)
        );
      })
      .map((s) => s.id);
    if (shipIds.length > 0) out.push({ targetId: target.id, shipIds });
  }
  return out;
}

/** Teleport checks 4–13 for the active player's own active ship (validator §4.6). */
export function teleportProblem(state: GameState, ship: Ship, targetId: string): ValidationResult {
  const turn = state.turnState.ships[ship.id];
  if (turn?.disengage === "failed") {
    return reject("DISENGAGE_FAILED", `${ship.name} failed to disengage this turn`, { shipId: ship.id });
  }
  if (ship.grapple !== null) return reject("GRAPPLED", `${ship.name} is locked in a boarding action`, { shipId: ship.id });
  if ((turn?.boardingDeclared ?? null) !== null) {
    return reject("BOARDING_SHIP", `${ship.name} is boarding this turn`, { shipId: ship.id });
  }
  if (turn?.teleported === true) {
    return reject("ALREADY_TELEPORTED", `${ship.name} has already teleported this turn`, { shipId: ship.id });
  }
  const order = ship.specialOrder?.kind ?? null;
  const reason =
    ship.profile.type === "escort" ? "escort"
    : isCrippled(ship) ? "crippled"
    : order !== null && order !== "lock_on" && order !== "reload_ordnance" ? "orders"
    : null;
  if (reason !== null) {
    const why = { escort: "escorts can't", crippled: "crippled ships can't", orders: "its special order rules it out" }[reason];
    return reject("CANNOT_TELEPORT", `${ship.name} can't make a teleport attack: ${why}`, { shipId: ship.id, reason });
  }

  const target = state.ships.find((s) => s.id === targetId);
  if (target === undefined) return reject("UNKNOWN_TARGET", `No ship ${targetId}`, { targetId });
  if (target.owner === ship.owner || target.status !== "active") {
    return reject("INVALID_TARGET", `${target.name} isn't an active enemy ship`, { targetId });
  }
  if (!shieldsDown(state, target)) {
    return reject("SHIELDS_UP", `${target.name}'s shields are still up`, { targetId });
  }
  const range = distance(ship.position as Point, target.position as Point);
  if (!approxLe(range, TELEPORT_RANGE)) {
    return reject("OUT_OF_RANGE", `${target.name} is more than ${TELEPORT_RANGE} cm away`, { targetId, range, limit: TELEPORT_RANGE });
  }
  if (remainingHits(target) > remainingHits(ship)) {
    return reject("TARGET_TOO_LARGE", `${target.name} has more hits left than ${ship.name}`, { targetId });
  }
  return OK;
}

/** Whether any of the active player's ships could make a teleport attack now. */
export function anyTeleport(state: GameState): boolean {
  const player = activePlayer(state);
  const mine = state.ships.filter((s) => s.owner === player && s.status === "active");
  const enemies = state.ships.filter((s) => s.owner !== player && s.status === "active");
  return mine.some((s) => enemies.some((t) => teleportProblem(state, s, t.id).ok));
}
