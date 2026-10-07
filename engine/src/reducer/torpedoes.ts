/** Torpedoes (reducer spec §9): launch, moving a salvo, and torpedo attacks. */
import { salvoPlanetContact } from "../rules/planets";
import { minefields } from "../rules/minefields";
import { sweptSegmentVsRect } from "../geometry/rect";
import { BM_RADIUS, EPS, TORPEDO_WIDTH } from "../geometry/constants";
import { baseRadius, headingVector, norm } from "../geometry/basic";
import { exitT, sweptSegmentVsCircle, sweptSegmentVsSegment } from "../geometry/sweep";
import { armourFacing, bmsInContact, effectiveStrength, getShip, onTable, roundOf } from "../state/derived";
import { capOf, fighters, waveRadius } from "../rules/craft";
import type { AttackCraftWave, GameState, Point, TorpedoSalvo } from "../state/types";
import type { LaunchTorpedoes } from "../transforms/types";
import type { Ctx } from "./context";
import { inflict } from "./damage";
import { salvoMayAttack } from "./movement";
import { enqueueFront } from "./queue";
import { turretDice } from "./turrets";
import { intercept } from "./craft";

// --- Launch (§9.1)

export function launchTorpedoes(ctx: Ctx, t: LaunchTorpedoes): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const weapon = ship.profile.weapons.find((w) => w.id === t.weaponId);
  if (weapon === undefined) return; // unreachable after validation
  const salvo: TorpedoSalvo = {
    id: ctx.newId("ord"),
    kind: "torpedo_salvo",
    owner: ship.owner,
    launchedBy: ship.id,
    launched: state.clock.playerTurn,
    position: { ...(ship.position as Point) },
    heading: norm((ship.heading as number) + t.bearing),
    strength: effectiveStrength(ship, weapon),
    speed: weapon.speed ?? 0,
    width: TORPEDO_WIDTH,
    attacks: [],
  };
  state.ordnance.push(salvo);
  ship.loaded.torpedoes = false;
  state.turnState.ships[ship.id]?.weaponsFired.push(weapon.id);
  ctx.log("ordnance_launch", {
    ordnanceId: salvo.id,
    shipId: ship.id,
    position: { ...salvo.position },
    heading: salvo.heading,
    strength: salvo.strength,
  });
}

// --- Moving a salvo (§9.2)

export function moveOrdnance(ctx: Ctx, ordnanceId: string): void {
  ctx.state.queue.push({ kind: "ordnance_move", ordnanceId, travelled: 0, bmTested: false });
}

function removeSalvo(ctx: Ctx, id: string, reason: string): void {
  ctx.state.ordnance = ctx.state.ordnance.filter((o) => o.id !== id);
  ctx.log("ordnance_removed", { ordnanceId: id, reason });
}

function markMoved(state: GameState, id: string): void {
  if (!state.turnState.ordnanceMoved.includes(id)) state.turnState.ordnanceMoved.push(id);
}

type SalvoEvent =
  | { kind: "exit"; t: number }
  | { kind: "planet"; t: number; planetId: string }
  | { kind: "minefield"; t: number; minefieldId: string }
  | { kind: "salvo"; t: number; otherId: string }
  | { kind: "wave"; t: number; waveId: string }
  | { kind: "ship"; t: number; shipId: string }
  | { kind: "blast_marker"; t: number };

const ORDER: Record<SalvoEvent["kind"], number> = { exit: 0, planet: 0, minefield: 0, salvo: 1, wave: 1, ship: 2, blast_marker: 3 };

function earliest(events: SalvoEvent[]): SalvoEvent | null {
  let best: SalvoEvent | null = null;
  for (const e of events) {
    if (best === null || e.t < best.t - EPS || (Math.abs(e.t - best.t) <= EPS && ORDER[e.kind] < ORDER[best.kind])) best = e;
  }
  return best;
}

function salvoEvents(state: GameState, salvo: TorpedoSalvo, length: number, bmTested: boolean): SalvoEvent[] {
  const { position, heading, width } = salvo;
  const events: SalvoEvent[] = [];
  const exit = exitT(position, heading, length, state.table);
  if (exit !== null) events.push({ kind: "exit", t: exit });
  const planet = salvoPlanetContact(state, position, heading, length, width);
  if (planet !== null) events.push({ kind: "planet", ...planet });
  // Torpedoes touching a minefield are destroyed (state N117, reducer R68).
  for (const f of minefields(state)) {
    const t = sweptSegmentVsRect(position, heading, length, width, f.rect);
    if (t !== null) events.push({ kind: "minefield", t, minefieldId: f.id });
  }
  for (const other of state.ordnance) {
    if (other.id === salvo.id || other.kind === "orbital_mine") continue; // mines and torpedoes pass each other by (N110)
    if (other.kind === "torpedo_salvo") {
      const t = sweptSegmentVsSegment(position, heading, length, width, other.position, other.heading, other.width);
      if (t !== null) events.push({ kind: "salvo", t, otherId: other.id });
    } else if (other.owner !== salvo.owner && other.cap === null && fighters(other) > 0) {
      // An enemy wave with fighters stops torpedoes (p. 82); CAP is met at its ship (§9.3).
      const t = sweptSegmentVsCircle(position, heading, length, width, other.position, waveRadius(other));
      if (t !== null) events.push({ kind: "wave", t, waveId: other.id });
    }
  }
  for (const ship of state.ships) {
    if (!onTable(ship) || ship.position === null || !salvoMayAttack(state, salvo, ship)) continue;
    const t = sweptSegmentVsCircle(position, heading, length, width, ship.position, baseRadius(ship.profile.baseSize));
    if (t !== null) events.push({ kind: "ship", t, shipId: ship.id });
  }
  if (!bmTested) {
    for (const bm of state.blastMarkers) {
      const t = sweptSegmentVsCircle(position, heading, length, width, bm.position, BM_RADIUS);
      if (t !== null) events.push({ kind: "blast_marker", t });
    }
  }
  return events;
}

const findSalvo = (state: GameState, id: string): TorpedoSalvo | undefined =>
  state.ordnance.find((o): o is TorpedoSalvo => o.id === id && o.kind === "torpedo_salvo");

export function ordnanceMove(ctx: Ctx, ordnanceId: string, travelledSoFar: number, bmTestedSoFar: boolean): void {
  const { state } = ctx;
  const salvo = findSalvo(state, ordnanceId);
  if (salvo === undefined) {
    markMoved(state, ordnanceId);
    ctx.log("skipped", { item: "ordnance_move", ordnanceId });
    return;
  }
  let travelled = travelledSoFar;
  let bmTested = bmTestedSoFar;
  while (travelled < salvo.speed - EPS) {
    const remaining = salvo.speed - travelled;
    const event = earliest(salvoEvents(state, salvo, remaining, bmTested));
    const dir = headingVector(salvo.heading);
    const step = event === null ? remaining : event.t;
    salvo.position = { x: salvo.position.x + step * dir.x, y: salvo.position.y + step * dir.y };
    travelled += step;
    if (event === null) break;

    if (event.kind === "exit") {
      removeSalvo(ctx, salvo.id, "left_table");
      break;
    }
    if (event.kind === "planet") {
      // Torpedoes are destroyed at a planet's edge (state N66, R48).
      ctx.log("planet_contact", { planetId: event.planetId, ordnanceId: salvo.id });
      removeSalvo(ctx, salvo.id, "planet");
      break;
    }
    if (event.kind === "minefield") {
      ctx.log("minefield_contact", { minefieldId: event.minefieldId, ordnanceId: salvo.id });
      removeSalvo(ctx, salvo.id, "minefield");
      break;
    }
    if (event.kind === "salvo") {
      // Premature detonation: torpedo meets torpedo (p. 78).
      removeSalvo(ctx, salvo.id, "collision");
      removeSalvo(ctx, event.otherId, "collision");
      break;
    }
    if (event.kind === "wave") {
      const wave = state.ordnance.find((o): o is AttackCraftWave => o.id === event.waveId && o.kind === "attack_craft");
      if (wave !== undefined) intercept(ctx, wave, salvo);
      break;
    }
    if (event.kind === "blast_marker") {
      bmTested = true;
      const roll = ctx.d6();
      ctx.log("bm_test", { entityId: salvo.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
      if (roll === 6) {
        removeSalvo(ctx, salvo.id, "blast_marker");
        break;
      }
      continue;
    }
    // A ship: attack it, then carry on with whatever's left of the move.
    enqueueFront(state, [
      { kind: "torpedo_attack", ordnanceId: salvo.id, targetId: event.shipId, bmTested },
      { kind: "ordnance_move", ordnanceId: salvo.id, travelled, bmTested: true },
    ]);
    return;
  }
  if (state.ordnance.some((o) => o.id === ordnanceId)) {
    ctx.log("ordnance_move", { ordnanceId, to: { ...salvo.position } });
  }
  markMoved(state, ordnanceId);
}

// --- Attacks (§9.3)

export function torpedoAttack(ctx: Ctx, ordnanceId: string, targetId: string, bmTested: boolean): void {
  const { state } = ctx;
  const salvo = findSalvo(state, ordnanceId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (salvo === undefined || ship === undefined || !onTable(ship)) {
    ctx.log("skipped", { item: "torpedo_attack", ordnanceId, targetId });
    return;
  }
  // CAP screens enemy torpedoes: one CAP fighter and the whole salvo go (§9.3, p. 82).
  const cap = salvo.owner !== ship.owner ? capOf(state, ship.id) : [];
  const fighter = cap[cap.length - 1];
  if (fighter !== undefined) {
    removeSalvo(ctx, fighter.id, "intercepted");
    removeSalvo(ctx, salvo.id, "cap");
    ctx.log("cap_screen", { shipId: ship.id, ordnanceId: salvo.id, capIds: [fighter.id] });
    return;
  }
  // Ordnance attacking a ship with BMs in contact takes the BM test too (p. 75), once per move.
  if (!bmTested && bmsInContact(state, ship).length > 0) {
    const roll = ctx.d6();
    ctx.log("bm_test", { entityId: salvo.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
    if (roll === 6) {
      removeSalvo(ctx, salvo.id, "blast_marker");
      return;
    }
  }
  enqueueFront(state, [
    { kind: "brace_offer", shipId: ship.id, source: { kind: "ordnance", id: salvo.id } },
    { kind: "torpedo_hit", ordnanceId: salvo.id, targetId: ship.id },
  ]);
}

export function torpedoHit(ctx: Ctx, ordnanceId: string, targetId: string): void {
  const { state } = ctx;
  const salvo = findSalvo(state, ordnanceId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (salvo === undefined || ship === undefined || !onTable(ship)) {
    ctx.log("skipped", { item: "torpedo_hit", ordnanceId, targetId });
    return;
  }
  // Turrets fire after the brace decision (p. 66), massed outside the Movement Phase (p. 80).
  const { own, massed, dice } = turretDice(state, ship, "torpedoes");
  const turretRolls = ctx.nD6(dice);
  const stopped = turretRolls.filter((r) => r >= 4).length;
  salvo.strength -= stopped;
  if (dice > 0) ctx.log("turrets", { shipId: ship.id, ordnanceId: salvo.id, against: "torpedoes", own, massed, rolls: turretRolls, stopped });
  if (salvo.strength <= 0) {
    removeSalvo(ctx, salvo.id, "turrets");
    return;
  }
  const origin = { ...salvo.position };
  const facing = armourFacing(ship, origin); // the facing struck first (p. 201); lower armour on a boundary (R7)
  const rolls = ctx.nD6(salvo.strength);
  const hits = rolls.filter((r) => r >= facing.armour).length;
  ctx.log("attack", {
    source: { kind: "ordnance", id: salvo.id },
    targetId: ship.id,
    weapon: "torpedo",
    facing: facing.quadrant,
    need: facing.armour,
    rolls,
    rerolls: [],
    hits,
  });
  salvo.attacks.push({ targetId: ship.id, round: roundOf(state.clock.playerTurn) });
  salvo.strength -= hits; // hits scored, before any Brace saves (R6)
  if (salvo.strength <= 0) removeSalvo(ctx, salvo.id, "spent");
  inflict(ctx, ship, hits, {
    source: { kind: "ordnance", id: ordnanceId },
    origin,
    shieldable: false,
    braceable: true,
    cause: "torpedo",
  });
}
