/**
 * A move's parameters (validator spec §4.2 `move`, reducer §8.1): shared so the
 * validator and the reducer can't disagree about how far or how sharply a ship may go.
 */
import { BM_SLOWDOWN, TURN_DISTANCE } from "../geometry/constants";
import { approxGe, approxLe } from "../geometry/basic";
import { bmContacts, walkShipPath } from "../geometry/path";
import { bmsInContact, hasCritical, speed } from "../state/derived";
import type { Activation, GameState, OrderKind, Ship } from "../state/types";

export type MoveParameters = {
  order: OrderKind | null;
  /** Current speed (crippled, Thrusters), before any order. */
  baseSpeed: number;
  /** Unslowed maximum: speed plus the All Ahead Full extra. */
  d0: number;
  /** Maximum before any Blast Marker slowdown: half speed on Burn Retros, else d0. */
  maxIfBR: number;
  /** Minimum before the "can't make half speed" rule: 0 on Burn Retros, else half speed. */
  minDistance: number;
  turnsAllowed: number;
  /** Forward distance required before each turn. */
  turnDistance: number;
};

/** The order a ship moves on now: its activation's, or its squadron's move's (state N37), or none. */
export function movingOrder(state: GameState, ship: Ship): Pick<Activation, "shipId" | "order" | "aafExtra"> | null {
  const a = state.activation;
  if (a !== null && a.shipId === ship.id) return a;
  const sm = state.turnState.squadronMove ?? null;
  if (sm !== null && sm.members.includes(ship.id)) return { shipId: ship.id, order: sm.order, aafExtra: sm.aafExtra };
  return null;
}

export function moveParameters(ship: Ship, activation: Pick<Activation, "shipId" | "order" | "aafExtra"> | null): MoveParameters {
  const order = activation !== null && activation.shipId === ship.id ? activation.order : null;
  const aafExtra = activation !== null && activation.shipId === ship.id ? (activation.aafExtra ?? 0) : 0;
  const baseSpeed = speed(ship);
  const d0 = baseSpeed + aafExtra;
  const burnRetros = order === "burn_retros";
  let turnsAllowed = 1;
  if (hasCritical(ship, "engine_room") || order === "all_ahead_full" || order === "lock_on") turnsAllowed = 0;
  else if (order === "come_to_new_heading") turnsAllowed = 2;
  return {
    order,
    baseSpeed,
    d0,
    maxIfBR: burnRetros ? baseSpeed / 2 : d0,
    minDistance: burnRetros ? 0 : baseSpeed / 2,
    turnsAllowed,
    turnDistance: TURN_DISTANCE[ship.profile.type],
  };
}

/**
 * Where an All Ahead Full move must end (validator §4.2 check 14): the full
 * distance, less 5 cm if slowed, unless a new Blast Marker in the last 5 cm stops it.
 */
/** `heading`: the bow after any first gravity turn (validator check 14); the ship's own by default. */
export function allAheadFullEnd(state: GameState, ship: Ship, d0: number, heading = ship.heading): { end: number; stoppedByBm: boolean } {
  const startingBms = bmsInContact(state, ship);
  const line = walkShipPath({ ...ship, heading }, [{ kind: "advance", distance: d0 }]);
  const contacts = bmContacts(state.blastMarkers, ship, line, new Set(startingBms.map((b) => b.id)));
  const first = contacts[0];
  const slowed = startingBms.length > 0 || (first !== undefined && first.distance < d0 - BM_SLOWDOWN);
  const d = d0 - (slowed ? BM_SLOWDOWN : 0);
  const stop = contacts.find((c) => approxGe(c.distance, d - BM_SLOWDOWN) && approxLe(c.distance, d));
  return stop !== undefined ? { end: stop.distance, stoppedByBm: true } : { end: d, stoppedByBm: false };
}
