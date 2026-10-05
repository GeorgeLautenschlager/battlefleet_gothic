/**
 * Derived values (state spec §11) and turn helpers (§2, §5, §12).
 *
 * Every function here is a pure function of the state. They're the single
 * definition the validator, reducer and UI all share: never store their results.
 */
import { DEFENCES_MOVE, EPS, MAX_LEADERSHIP } from "../geometry/constants";
import { bmTouchesBase, quadrantsOfPoint } from "../geometry/basic";
import type {
  AttackCraftWave,
  BlastMarker,
  CriticalKind,
  Ordnance,
  GameState,
  OrderKind,
  PlayerId,
  Point,
  Quadrant,
  Ship,
  TorpedoSalvo,
  Weapon,
} from "./types";

/** Thrown when a derived value is asked for in a state where it isn't defined. */
export class EngineError extends Error {
  override name = "EngineError";
}

// --- Look-ups and small helpers

export function getShip(state: GameState, id: string): Ship {
  const ship = state.ships.find((s) => s.id === id);
  if (!ship) throw new EngineError(`No ship with id ${id}`);
  return ship;
}

export const otherPlayer = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** Halve, rounding up (interpretation #5). */
export const halveUp = (n: number): number => Math.ceil(n / 2);

// --- Time (§2 "Player turns")

/** The round (game turn) a player turn belongs to: ceil(pt / 2). */
export const roundOf = (playerTurn: number): number => Math.ceil(playerTurn / 2);

/** Who owns a player turn: the first player owns odd turns. */
export function activePlayer(state: GameState, playerTurn = state.clock.playerTurn): PlayerId {
  const first = state.setup.firstPlayer;
  if (first === null) throw new EngineError("No first player yet: the battle hasn't started");
  return playerTurn % 2 === 1 ? first : otherPlayer(first);
}

// --- Ship status

export const remainingHits = (ship: Ship): number => ship.profile.hits - ship.damage;

/** Lost at least half its starting hits (p. 65). */
export const isCrippled = (ship: Ship): boolean => 2 * ship.damage >= ship.profile.hits;

export const isHulk = (ship: Ship): boolean =>
  ship.status === "drifting_hulk" || ship.status === "blazing_hulk";

export const onTable = (ship: Ship): boolean => ship.status === "active" || isHulk(ship);

export const hasCritical = (ship: Ship, kind: CriticalKind): boolean =>
  ship.criticals.some((c) => c.kind === kind);

export const isBraced = (ship: Ship): boolean => ship.specialOrder?.kind === "brace_for_impact";

/** Leadership after Bridge Smashed, capped at 10. Throws if not rolled yet. */
export function leadership(ship: Ship): number {
  if (ship.leadership === null) throw new EngineError(`${ship.id} has no Leadership yet`);
  const value = ship.leadership - (hasCritical(ship, "bridge_smashed") ? 3 : 0);
  return Math.min(MAX_LEADERSHIP, value);
}

/** Current speed: −5 cm crippled, −10 cm with Thrusters damaged (once, however many). */
export function speed(ship: Ship): number {
  const crippled = isCrippled(ship) ? 5 : 0;
  const thrusters = hasCritical(ship, "thrusters") ? 10 : 0;
  return Math.max(0, ship.profile.speed - crippled - thrusters);
}

export function maxShields(ship: Ship): number {
  if (isHulk(ship) || hasCritical(ship, "shields_collapse")) return 0;
  return isCrippled(ship) ? halveUp(ship.profile.shields) : ship.profile.shields;
}

/** Blast Markers touching the ship's base. Empty for ships not on the table. */
export function bmsInContact(state: GameState, ship: Ship): BlastMarker[] {
  const stem = ship.position;
  if (!onTable(ship) || stem === null) return [];
  return state.blastMarkers.filter((bm) => bmTouchesBase(bm.position, stem, ship.profile.baseSize));
}

/** Shields left this phase: max shields minus BMs in contact (interpretation #11). */
export function shieldCapacity(state: GameState, ship: Ship): number {
  return Math.max(0, maxShields(ship) - bmsInContact(state, ship).length);
}

/** Turrets: hulks 0, crippled halved. Not affected by Brace. */
export function turrets(ship: Ship): number {
  if (isHulk(ship)) return 0;
  return isCrippled(ship) ? halveUp(ship.profile.turrets) : ship.profile.turrets;
}

export const canTurn = (ship: Ship): boolean => !hasCritical(ship, "engine_room");

// --- Facing and armour

/** The target's quadrants containing `from`: one, or two on a boundary. */
export function facingQuadrants(target: Ship, from: Point): Quadrant[] {
  if (target.position === null || target.heading === null) {
    throw new EngineError(`${target.id} is not on the table`);
  }
  return quadrantsOfPoint(target.position, target.heading, from);
}

/**
 * The quadrant of `target` facing `from`, and its armour value.
 * On a boundary the shooter chooses (`chosen`); with no choice given, the
 * attacker gets the lower armour (reducer ruling R7).
 */
export function armourFacing(
  target: Ship,
  from: Point,
  chosen?: Quadrant,
): { quadrant: Quadrant; armour: number } {
  const candidates = facingQuadrants(target, from);
  if (chosen !== undefined) {
    if (!candidates.includes(chosen)) {
      throw new EngineError(`${chosen} doesn't face that point (candidates: ${candidates.join(", ")})`);
    }
    return { quadrant: chosen, armour: target.profile.armour[chosen] };
  }
  let best: { quadrant: Quadrant; armour: number } | null = null;
  for (const quadrant of candidates) {
    const armour = target.profile.armour[quadrant];
    if (best === null || armour < best.armour) best = { quadrant, armour };
  }
  if (best === null) throw new EngineError("No facing quadrant"); // unreachable: quadrantsOf never returns []
  return best;
}

// --- Weapons

const ARMAMENT_CRITICAL: Partial<Record<Weapon["location"], CriticalKind>> = {
  prow: "prow_armament",
  port: "port_armament",
  starboard: "starboard_armament",
  dorsal: "dorsal_armament",
};

/** Disabled by a matching armament critical, or by a failed disengage test this turn. */
export function weaponDisabled(state: GameState, ship: Ship, weapon: Weapon): boolean {
  const critical = ARMAMENT_CRITICAL[weapon.location];
  if (critical !== undefined && hasCritical(ship, critical)) return true;
  const turn = state.turnState.ships[ship.id];
  // Grappled ships and ships attempting to board can't fire or launch (p. 89; drawn combats, pp. 90–91).
  return turn?.disengage === "failed" || isGrappled(ship) || (turn?.boardingDeclared ?? null) !== null;
}

// --- Attack craft (state §10.2, §11)

/** Disabled by its location's armament critical (T31). Launch bays don't care about orders or grapples here. */
function bayLost(ship: Ship, weapon: Weapon): boolean {
  const critical = ARMAMENT_CRITICAL[weapon.location];
  return critical !== undefined && hasCritical(ship, critical);
}

export const launchBays = (ship: Ship): Weapon[] => ship.profile.weapons.filter((w) => w.kind === "launch_bay");

/**
 * Squadrons the ship can launch: its launch bays not lost to a critical, the
 * total halved (rounding up) for crippled and again for braced (p. 73, state N9).
 */
export function launchCapacity(ship: Ship): number {
  let total = launchBays(ship)
    .filter((w) => !bayLost(ship, w))
    .reduce((n, w) => n + w.strength, 0);
  if (total === 0) return 0;
  if (isCrippled(ship)) total = halveUp(total);
  if (isBraced(ship)) total = halveUp(total);
  return total;
}

export const isWave = (o: Ordnance): o is AttackCraftWave => o.kind === "attack_craft";
export const isSalvo = (o: Ordnance): o is TorpedoSalvo => o.kind === "torpedo_salvo";

export const waves = (state: GameState): AttackCraftWave[] => state.ordnance.filter(isWave);

/** Squadrons in the player's attack craft waves, CAP included. */
export const craftInPlay = (state: GameState, player: PlayerId): number =>
  waves(state)
    .filter((w) => w.owner === player)
    .reduce((n, w) => n + w.squadrons.length, 0);

/** The fleet's ordnance limit: launch capacity over its active ships (p. 73). */
export const fleetBays = (state: GameState, player: PlayerId): number =>
  state.ships.filter((s) => s.owner === player && s.status === "active").reduce((n, s) => n + launchCapacity(s), 0);

// --- Boarding (state §7, §11)

export const isGrappled = (ship: Ship): boolean => ship.grapple !== null;

/** Boarding value (p. 89): damage points remaining. Later fleets modify it (Mark of Khorne, Tau). */
export const boardingValue = (ship: Ship): number => remainingHits(ship);

/** Shields down: the ship can be teleported onto (pp. 91–92). */
export const shieldsDown = (state: GameState, ship: Ship): boolean => shieldCapacity(state, ship) === 0;

const HALVES_DIRECT_FIRE: readonly OrderKind[] = ["all_ahead_full", "come_to_new_heading", "burn_retros"];

/**
 * Firepower / strength after halving, rounding up each time:
 * crippled; braced; and for direct fire, AAF / Come To New Heading / Burn Retros.
 * A Brace that replaced one of those halves once, not twice (reducer ruling R8).
 */
export function effectiveStrength(ship: Ship, weapon: Weapon): number {
  let value = weapon.strength;
  if (isCrippled(ship)) value = halveUp(value);
  if (isBraced(ship)) value = halveUp(value);
  const order = ship.specialOrder?.kind;
  const direct = weapon.kind === "battery" || weapon.kind === "lance";
  if (direct && order !== undefined && HALVES_DIRECT_FIRE.includes(order)) value = halveUp(value);
  return value;
}

// --- Shooting and orders

/**
 * Moved less than 5 cm in its last move, so it's shot at on the Defences column (p. 53).
 * A ship that hasn't moved yet is not (state N7).
 */
export function targetedAsDefences(ship: Ship): boolean {
  return ship.lastMove !== null && ship.lastMove.distance < DEFENCES_MOVE - EPS;
}

/**
 * Target for a Command check: Ld −1 with BMs in contact (Under Fire),
 * +1 if any enemy ship is on special orders (Enemy Contacts), capped at 10 (p. 48).
 */
export function commandCheckLd(state: GameState, ship: Ship): number {
  const underFire = bmsInContact(state, ship).length > 0 ? 1 : 0;
  const enemyContacts = state.ships.some((s) => s.owner !== ship.owner && s.specialOrder !== null) ? 1 : 0;
  return Math.min(MAX_LEADERSHIP, leadership(ship) - underFire + enemyContacts);
}

export type GunneryColumn = "A" | "B" | "C" | "D" | "E";

/**
 * Base Gunnery Table column, before shifts (reducer spec §4.1).
 * `aspect` is the target quadrant facing the firer; ignored for Defences and ordnance.
 */
export function gunneryColumn(target: Ship | "ordnance", aspect: Quadrant): GunneryColumn {
  if (target === "ordnance") return "E";
  if (targetedAsDefences(target)) return "A";
  const capital = target.profile.type !== "escort";
  switch (aspect) {
    case "front":
      return capital ? "B" : "C";
    case "rear":
      return capital ? "C" : "D";
    default:
      return capital ? "D" : "E";
  }
}

// --- Scoring (p. 128, D7)

export const destroyedForScoring = (ship: Ship): boolean =>
  ship.status === "destroyed" || isHulk(ship);

/** Cruiser Clash points for `player`: 1 per damage on enemy ships, +3 destroyed, or +1 crippled. */
export function score(state: GameState, player: PlayerId): number {
  let total = 0;
  for (const ship of state.ships) {
    if (ship.owner === player) continue;
    total += ship.damage;
    if (destroyedForScoring(ship)) total += 3;
    else if (isCrippled(ship)) total += 1;
  }
  return total;
}

// --- Whose move is it? (§5, §12)

/**
 * Next player to deploy: the first deployer, then alternating, skipping a
 * player with nothing left to deploy (§5). Null when everything is deployed.
 */
export function nextDeployer(state: GameState): PlayerId | null {
  const first = state.setup.firstDeployer;
  if (first === null) return null;
  const total = { p1: 0, p2: 0 };
  let deployed = 0;
  for (const ship of state.ships) {
    total[ship.owner] += 1;
    if (ship.status !== "undeployed") deployed += 1;
  }
  const remaining = { ...total };
  let current = first;
  for (let i = 0; i < deployed; i++) {
    remaining[current] -= 1;
    const other = otherPlayer(current);
    if (remaining[other] > 0) current = other;
  }
  return remaining[current] > 0 ? current : null;
}

/** Who must submit the next transform: a player, "either", or null when nobody can (§12). */
export type Actor = PlayerId | "either" | null;

export function actor(state: GameState): Actor {
  const top = state.pending[state.pending.length - 1];
  if (top !== undefined) return top.player;

  const { clock } = state;
  if (clock.stage === "ended") return null;

  if (clock.stage === "setup") {
    switch (clock.setupStep) {
      case "deploy":
        return nextDeployer(state);
      case "choose_first_turn":
        return state.setup.firstTurnChooser;
      case null:
        return null;
      default:
        return "either"; // the roll_* steps: one machine, the reducer rolls for both
    }
  }

  if (clock.step === "damage_control") return "either";
  const active = activePlayer(state);
  return clock.step === "inactive_ordnance" ? otherPlayer(active) : active;
}
