/**
 * Derived values (state spec §11) and turn helpers (§2, §5, §12).
 *
 * Every function here is a pure function of the state. They're the single
 * definition the validator, reducer and UI all share: never store their results.
 */
import { DEFENCES_MOVE, EPS, FORMATION_RANGE, MAX_LEADERSHIP, SLAANESH_RANGE } from "../geometry/constants";
import { approxLe, bmTouchesBase, distance, quadrantsOfPoint } from "../geometry/basic";
import type {
  AttackCraftWave,
  BlastMarker,
  Commander,
  CriticalKind,
  Ordnance,
  GameState,
  OrderKind,
  PlayerId,
  Point,
  Quadrant,
  Ship,
  ShipSquadron,
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

/** A commander aboard, if any (state §7.4); older saves have none. */
export const commanderOf = (ship: Ship): Commander | null => ship.commander ?? null;

/** An active enemy ship with the Mark of Slaanesh has its stem within 15 cm (state §7.4, N26). */
export function slaaneshNear(state: GameState, ship: Ship): boolean {
  const stem = ship.position;
  if (stem === null) return false;
  return state.ships.some(
    (s) =>
      s.owner !== ship.owner &&
      s.status === "active" &&
      s.position !== null &&
      (s.commander?.marks.includes("slaanesh") ?? false) &&
      approxLe(distance(stem, s.position), SLAANESH_RANGE),
  );
}

/**
 * Leadership (state §11): a commander's replaces the rolled value (N22); then
 * −3 for Bridge Smashed and −2 near an enemy Mark of Slaanesh; capped at 10.
 * Throws if not rolled yet.
 */
export function leadership(state: GameState, ship: Ship): number {
  const commander = commanderOf(ship);
  if (commander === null && ship.leadership === null) throw new EngineError(`${ship.id} has no Leadership yet`);
  // The Emperor's +1 goes on after a commander's value, capped at 10 (N32).
  const base = Math.min(MAX_LEADERSHIP, (commander?.leadership ?? (ship.leadership as number)) + (ship.profile.traits?.leadershipBonus ?? 0));
  return base - (hasCritical(ship, "bridge_smashed") ? 3 : 0) - (slaaneshNear(state, ship) ? 2 : 0) - (surprised(state, ship) ? 1 : 0);
}

/** The Raiders: a defending ship in the rounds of surprise, −1 Leadership (state N61). */
export function surprised(state: GameState, ship: Ship): boolean {
  const turns = state.setup.raid?.surpriseTurns ?? null;
  return (
    turns !== null &&
    state.clock.stage === "battle" &&
    ship.owner !== state.scenario.attacker &&
    roundOf(state.clock.playerTurn) <= turns
  );
}

/** The ship, its options and anyone aboard: its value for victory points (N25). */
export const shipValue = (ship: Ship): number => ship.profile.points + (ship.commander?.points ?? 0);

/** The side's fleet commander's ship, if any (an Admiral or Warmaster). */
export const flagship = (state: GameState, player: PlayerId): Ship | undefined =>
  state.ships.find((s) => s.owner === player && (s.commander?.kind === "admiral" || s.commander?.kind === "warmaster"));

/**
 * The ship whose commander would spend a re-roll for `ship` (state §11, N23–N24):
 * its own commander if they have one left, else its side's fleet commander, if
 * that ship is active and has one left. Undefined if there's none.
 */
export function rerollFor(state: GameState, ship: Ship): Ship | undefined {
  if ((ship.commander?.rerolls ?? 0) > 0) return ship;
  const fleet = flagship(state, ship.owner);
  return fleet !== undefined && fleet.status === "active" && (fleet.commander?.rerolls ?? 0) > 0 ? fleet : undefined;
}

/** Not on the Mark of Nurgle (T62). */
export const canBeBoarded = (ship: Ship): boolean => !(ship.commander?.marks.includes("nurgle") ?? false);

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
export const boardingValue = (ship: Ship): number => remainingHits(ship) * ((ship.commander?.marks.includes("khorne") ?? false) ? 2 : 1);

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

const BARS_NOVA_CANNON: readonly OrderKind[] = ["all_ahead_full", "come_to_new_heading", "burn_retros", "brace_for_impact"];

/** Why a ship can't fire a nova cannon (p. 64, p. 65), or null. Lock On and Reload Ordnance don't matter. */
export function novaCannonBarred(ship: Ship): "crippled" | "order" | null {
  if (isCrippled(ship)) return "crippled";
  const order = ship.specialOrder?.kind;
  return order !== undefined && BARS_NOVA_CANNON.includes(order) ? "order" : null;
}

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
 * A ship in formation checks for its squadron: the squadron's Leadership, and
 * Under Fire if any member in formation has a BM in contact (p. 95).
 */
export function commandCheckLd(state: GameState, ship: Ship): number {
  const sq = squadronOf(state, ship);
  const crew = sq !== undefined && inFormation(state, ship) ? formation(state, sq) : [ship];
  const underFire = crew.some((s) => bmsInContact(state, s).length > 0) ? 1 : 0;
  const enemyContacts = state.ships.some((s) => s.owner !== ship.owner && s.specialOrder !== null) ? 1 : 0;
  const ld = sq !== undefined && crew.length > 1 ? squadronLd(state, sq) : leadership(state, ship);
  return Math.min(MAX_LEADERSHIP, ld - underFire + enemyContacts);
}

/** The Leadership for a priority test: the squadron's for a ship in formation (state N40), else its own. */
export function priorityLd(state: GameState, ship: Ship): number {
  const sq = squadronOf(state, ship);
  return sq !== undefined && inFormation(state, ship) ? squadronLd(state, sq) : leadership(state, ship);
}

// --- Squadrons (state §7.5, §11)

export const squadronsOf = (state: GameState): ShipSquadron[] => state.squadrons ?? [];

export const squadronOf = (state: GameState, ship: Ship): ShipSquadron | undefined =>
  squadronsOf(state).find((sq) => sq.shipIds.includes(ship.id));

export const getSquadron = (state: GameState, id: string): ShipSquadron | undefined => squadronsOf(state).find((sq) => sq.id === id);

/**
 * The members in formation (N35): the largest chain of `active` members on the
 * table whose stems link within 15 cm; on a tie, the chain with the earliest member.
 */
export function formation(state: GameState, sq: ShipSquadron): Ship[] {
  const members = sq.shipIds.flatMap((id) => state.ships.find((s) => s.id === id && s.status === "active" && s.position !== null) ?? []);
  const seen = new Set<string>();
  let best: Ship[] = [];
  for (const start of members) {
    if (seen.has(start.id)) continue;
    const chain: Ship[] = [start];
    seen.add(start.id);
    for (let i = 0; i < chain.length; i++) {
      const at = chain[i]?.position as Point;
      for (const m of members) {
        if (!seen.has(m.id) && approxLe(distance(at, m.position as Point), FORMATION_RANGE)) {
          seen.add(m.id);
          chain.push(m);
        }
      }
    }
    if (chain.length > best.length) best = chain; // members are in shipIds order, so the first chain wins a tie
  }
  return members.filter((m) => best.includes(m)); // in shipIds order
}

export const inFormation = (state: GameState, ship: Ship): boolean => {
  const sq = squadronOf(state, ship);
  return sq !== undefined && formation(state, sq).some((s) => s.id === ship.id);
};

/** The squadron's Leadership (p. 95): an escort squadron's shared value; a capital squadron's highest in formation. */
export function squadronLd(state: GameState, sq: ShipSquadron): number {
  const members = sq.shipIds.map((id) => getShip(state, id));
  if (sq.type === "escort") {
    const any = formation(state, sq)[0] ?? members.find((s) => s.leadership !== null); // where Slaanesh is measured from
    if (any === undefined) throw new EngineError(`${sq.id} has no Leadership yet`);
    return leadership(state, any);
  }
  const crew = formation(state, sq);
  return Math.max(...(crew.length > 0 ? crew : members.filter((s) => s.status === "active")).map((s) => leadership(state, s)));
}

/** An escort squadron that has lost at least half its ships, rounding up (p. 123, N43). */
export function escortSquadronCrippled(state: GameState, sq: ShipSquadron): boolean {
  const members = sq.shipIds.map((id) => getShip(state, id));
  const lost = members.filter((s) => s.status !== "active" && s.status !== "disengaged" && s.status !== "undeployed" && s.status !== "reserve").length;
  return lost >= Math.ceil(members.length / 2);
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

/** The game's score for `player`: Cruiser Clash points or victory points, per `scenario.scoring` (state §11). */
export function score(state: GameState, player: PlayerId): number {
  return state.scenario.scoring === "victory_points" ? victoryPoints(state, player).total : cruiserClashScore(state, player);
}

/** Cruiser Clash points for `player`: 1 per damage on enemy ships, +3 destroyed, or +1 crippled (p. 128). */
export function cruiserClashScore(state: GameState, player: PlayerId): number {
  let total = 0;
  for (const ship of state.ships) {
    if (ship.owner === player) continue;
    total += ship.damage;
    if (destroyedForScoring(ship)) total += 3;
    else if (isCrippled(ship)) total += 1;
  }
  return total;
}

// --- Victory points (pp. 122–123, state §11, N11–N12)

export type ShipVP = { shipId: string; vp: number; why: "destroyed" | "crippled" | "disengaged" };
export type SquadronVP = { squadronId: string; vp: number; why: "destroyed" | "disengaged" };
export type VictoryPoints = { total: number; ships: ShipVP[]; squadrons: SquadronVP[]; field: number };

const percent = (points: number, pct: number): number => Math.ceil((points * pct) / 100); // per ship, rounded up (N12)

/** What an enemy ship is worth to its opponent now, or null if nothing. */
export function shipVP(ship: Ship): ShipVP | null {
  if (ship.profile.type === "escort") return null; // escorts score by squadron (N42)
  const points = shipValue(ship);
  if (destroyedForScoring(ship)) return { shipId: ship.id, vp: points, why: "destroyed" };
  if (ship.status === "disengaged") return { shipId: ship.id, vp: percent(points, isCrippled(ship) ? 25 : 10), why: "disengaged" };
  if (ship.status === "active" && isCrippled(ship)) return { shipId: ship.id, vp: percent(points, 25), why: "crippled" };
  return null;
}

/**
 * What an enemy escort squadron is worth (p. 123, N42): its full value once every
 * member is destroyed; else, once none is active, 10% or 25% if crippled.
 */
export function squadronVP(state: GameState, sq: ShipSquadron): SquadronVP | null {
  if (sq.type !== "escort") return null;
  const members = sq.shipIds.map((id) => getShip(state, id));
  const full = members.reduce((n, s) => n + shipValue(s), 0);
  if (members.every((s) => s.status === "destroyed")) return { squadronId: sq.id, vp: full, why: "destroyed" };
  if (members.some((s) => s.status === "active" || s.status === "undeployed" || s.status === "reserve")) return null;
  return { squadronId: sq.id, vp: percent(full, escortSquadronCrippled(state, sq) ? 25 : 10), why: "disengaged" };
}

/** Half of every hulk on the table, friend or foe, if `player` holds the field: no enemy active, one of theirs is (T38). */
export function holdingTheField(state: GameState, player: PlayerId): number {
  const mine = state.ships.some((s) => s.owner === player && s.status === "active");
  const theirs = state.ships.some((s) => s.owner !== player && s.status === "active");
  if (!mine || theirs) return 0;
  return state.ships.filter(isHulk).reduce((n, s) => n + percent(shipValue(s), 50), 0);
}

/** Victory points for `player`: enemy ships destroyed, crippled or disengaged, plus holding the field. */
export function victoryPoints(state: GameState, player: PlayerId): VictoryPoints {
  const ships = state.ships.filter((s) => s.owner !== player).flatMap((s) => shipVP(s) ?? []);
  const squadrons = squadronsOf(state).filter((sq) => sq.owner !== player).flatMap((sq) => squadronVP(state, sq) ?? []);
  const field = holdingTheField(state, player);
  return { total: ships.reduce((n, s) => n + s.vp, 0) + squadrons.reduce((n, s) => n + s.vp, 0) + field, ships, squadrons, field };
}

// --- Whose move is it? (§5, §12)

/**
 * Next player to deploy: the first deployer, then alternating, skipping a
 * player with nothing left to deploy (§5). Null when everything is deployed.
 */
export function nextDeployer(state: GameState): PlayerId | null {
  const first = state.setup.firstDeployer;
  if (first === null) return null;
  // A squadron is one placement (transform T80): its owner finishes it first.
  const partial = partlyDeployedSquadron(state);
  if (partial !== undefined) return partial.owner;
  const total = { p1: 0, p2: 0 };
  let deployed = 0;
  for (const unit of deploymentUnits(state)) {
    const owner = unit[0]?.owner;
    if (owner === undefined || unit.some((s) => s.status === "reserve")) continue; // reserves arrive later (N51, N60)
    total[owner] += 1;
    if (unit.every((s) => s.status !== "undeployed")) deployed += 1;
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

/** What deploys as one placement (T80): each squadron, and each ship in none. */
export function deploymentUnits(state: GameState): Ship[][] {
  const squads = squadronsOf(state);
  const units: Ship[][] = squads.map((sq) => sq.shipIds.map((id) => getShip(state, id)));
  for (const ship of state.ships) if (!squads.some((sq) => sq.shipIds.includes(ship.id))) units.push([ship]);
  return units;
}

/** A squadron with some members deployed and some not (validator `deploy_ship` check 7). */
export const partlyDeployedSquadron = (state: GameState, player?: PlayerId): ShipSquadron | undefined =>
  squadronsOf(state).find((sq) => {
    if (player !== undefined && sq.owner !== player) return false;
    const members = sq.shipIds.map((id) => getShip(state, id));
    return members.some((s) => s.status === "undeployed") && members.some((s) => s.status !== "undeployed");
  });

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
      case "choose_formation":
        return state.setup.engagement?.formations.p1 === null ? "p1" : "p2"; // p1 first (state N16)
      case "choose_setup":
        return state.setup.engagement?.setupChooser ?? null;
      case "choose_facing":
        return state.scenario.attacker === undefined ? null : otherPlayer(state.scenario.attacker); // the defender
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
