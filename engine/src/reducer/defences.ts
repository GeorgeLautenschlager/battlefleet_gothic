/**
 * Orbital mines, minefields and fire ships (reducer spec §8.2, §8.5, §9.8, §10.0;
 * state N106–N122): placing them, the minefield test, a mine's move and attack,
 * and a fire ship's detonation.
 */
import { EPS, MINE_RADIUS, MINE_SPEED } from "../geometry/constants";
import { approxLe, baseRadius, distance, headingVector, tableBearing } from "../geometry/basic";
import { sweptCircleVsCircle } from "../geometry/sweep";
import { armourFacing, bmsInContact, getShip, leadership, squadronLd, squadronOf } from "../state/derived";
import { isMine, mineQuarry, minefieldRect, mineTouching } from "../rules/minefields";
import { capOf, fighters, isFighter, waveRadius } from "../rules/craft";
import type { AttackCraftWave, JsonValue, OrbitalMine, Point } from "../state/types";
import type { Detonate, PlaceDefence } from "../transforms/types";
import { sum, type Ctx } from "./context";
import { escortLost, inflict, lostLikeAnEscort } from "./damage";
import { enqueueFront } from "./queue";
import { turretDice } from "./turrets";
import { placeAt } from "./blast";
import { releaseCap } from "./cap";
import { leaveGrapple } from "./grapple";
import { afterSquadronMember, stillToMove } from "./squadrons";
import { BM_RADIUS } from "../geometry/constants";

// --- Placing (§10.0)

export function placeDefence(ctx: Ctx, t: PlaceDefence): void {
  const { state } = ctx;
  const e = state.setup.emplacements;
  if (e === undefined) return; // unreachable after validation
  if (t.kind === "orbital_mine") {
    const mine: OrbitalMine = { id: ctx.newId("ord"), kind: "orbital_mine", owner: e.owner, position: { ...t.position }, source: "bought" };
    state.ordnance.push(mine);
    e.unplaced.orbitalMines -= 1;
    ctx.log("defence_placed", { kind: t.kind, id: mine.id, position: { ...t.position } });
    return;
  }
  const size = e.unplaced.minefields?.shift();
  if (size === undefined) return; // unreachable after validation
  const rect = minefieldRect(size, t.position, t.turned === true);
  const id = ctx.newId("mf");
  state.table.features = [...(state.table.features ?? []), { kind: "minefield", id, owner: e.owner, rect }];
  ctx.log("defence_placed", { kind: t.kind, id, position: { ...t.position }, rect: { ...rect } });
}

// --- The minefield test (§8.2, R66)

export function minefieldTest(ctx: Ctx, shipId: string, minefieldId: string): void {
  const { state } = ctx;
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined || ship.status !== "active") {
    ctx.log("skipped", { item: "minefield_test", shipId });
    return;
  }
  const sq = squadronOf(state, ship);
  const ld = sq !== undefined ? squadronLd(state, sq) : leadership(state, ship);
  const dice = state.activation?.order === "all_ahead_full" ? 3 : 2;
  const rolls = ctx.nD6(dice);
  let passed = sum(rolls) <= ld;
  let rerolls: number[] | undefined;
  if (!passed && ship.profile.type === "escort") {
    rerolls = ctx.nD6(dice); // an escort re-rolls a failure once (p. 110)
    passed = sum(rerolls) <= ld;
  }
  const hitRolls = passed ? undefined : [ctx.d6()];
  ctx.log("minefield_test", {
    shipId, minefieldId, leadership: ld, rolls,
    ...(rerolls !== undefined ? { rerolls } : {}),
    passed,
    ...(hitRolls !== undefined ? { hitRolls } : {}),
  });
  if (hitRolls === undefined) return;
  inflict(ctx, ship, hitRolls[0] ?? 0, {
    source: { kind: "ship", id: ship.id },
    origin: { ...(ship.position as Point) },
    shieldable: true,
    braceable: true,
    cause: "minefield",
    markers: false,
  });
}

// --- Orbital mines (§9.8)

function markMoved(ctx: Ctx, id: string): void {
  const moved = ctx.state.turnState.ordnanceMoved;
  if (!moved.includes(id)) moved.push(id);
}

function removeMine(ctx: Ctx, id: string, reason: string): void {
  ctx.state.ordnance = ctx.state.ordnance.filter((o) => o.id !== id);
  ctx.log("ordnance_removed", { ordnanceId: id, reason });
}

const findMine = (ctx: Ctx, id: string): OrbitalMine | undefined => ctx.state.ordnance.find((o): o is OrbitalMine => o.id === id && isMine(o));

type MineEvent = { kind: "blast_marker"; t: number } | { kind: "wave"; t: number; id: string } | { kind: "ship"; t: number; id: string };
const ORDER: Record<MineEvent["kind"], number> = { blast_marker: 0, wave: 1, ship: 2 };

/** A mine's move: 10 cm straight at its quarry's stem, stopping at the first enemy base (state N110, R64). */
export function moveMine(ctx: Ctx, mineId: string): void {
  const { state } = ctx;
  const mine = findMine(ctx, mineId);
  if (mine === undefined) return; // unreachable after validation
  markMoved(ctx, mine.id);
  const touching = mineTouching(state, mine)[0];
  if (touching !== undefined) {
    ctx.log("mine_move", { ordnanceId: mine.id, to: { ...mine.position }, quarryId: touching.id });
    enqueueFront(state, [{ kind: "mine_attack", ordnanceId: mine.id, targetId: touching.id, bmTested: false }]);
    return;
  }
  const quarry = mineQuarry(state, mine);
  if (quarry === undefined || quarry.position === null) {
    ctx.log("mine_move", { ordnanceId: mine.id, to: { ...mine.position }, quarryId: null });
    return;
  }
  const heading = tableBearing(mine.position, quarry.position);
  const reach = sweptCircleVsCircle(mine.position, heading, MINE_SPEED, MINE_RADIUS, quarry.position, baseRadius(quarry.profile.baseSize));
  let length = reach ?? MINE_SPEED;
  let bmTested = false;
  for (;;) {
    const event = earliestMineEvent(ctx, mine, heading, length, bmTested);
    const step = event === null ? length : event.t;
    const dir = headingVector(heading);
    mine.position = { x: mine.position.x + step * dir.x, y: mine.position.y + step * dir.y };
    length -= step;
    if (event === null) break;
    if (event.kind === "blast_marker") {
      bmTested = true;
      const roll = ctx.d6();
      ctx.log("bm_test", { entityId: mine.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
      if (roll === 6) {
        removeMine(ctx, mine.id, "blast_marker");
        return;
      }
      continue;
    }
    if (event.kind === "wave") {
      const wave = state.ordnance.find((o): o is AttackCraftWave => o.id === event.id && o.kind === "attack_craft");
      if (wave !== undefined) mineMeetsFighters(ctx, wave, mine);
      return;
    }
    ctx.log("mine_move", { ordnanceId: mine.id, to: { ...mine.position }, quarryId: quarry.id });
    enqueueFront(state, [{ kind: "mine_attack", ordnanceId: mine.id, targetId: event.id, bmTested }]);
    return;
  }
  ctx.log("mine_move", { ordnanceId: mine.id, to: { ...mine.position }, quarryId: quarry.id });
}

function earliestMineEvent(ctx: Ctx, mine: OrbitalMine, heading: number, length: number, bmTested: boolean): MineEvent | null {
  const { state } = ctx;
  const events: MineEvent[] = [];
  if (!bmTested) {
    for (const bm of state.blastMarkers) {
      const t = sweptCircleVsCircle(mine.position, heading, length, MINE_RADIUS, bm.position, BM_RADIUS);
      if (t !== null) events.push({ kind: "blast_marker", t });
    }
  }
  for (const o of state.ordnance) {
    if (o.owner === mine.owner || o.kind !== "attack_craft" || o.cap !== null || fighters(o) === 0) continue;
    const t = sweptCircleVsCircle(mine.position, heading, length, MINE_RADIUS, o.position, waveRadius(o));
    if (t !== null) events.push({ kind: "wave", t, id: o.id });
  }
  for (const s of state.ships) {
    if (s.owner === mine.owner || s.status !== "active" || s.position === null) continue;
    const t = sweptCircleVsCircle(mine.position, heading, length, MINE_RADIUS, s.position, baseRadius(s.profile.baseSize));
    if (t !== null) events.push({ kind: "ship", t, id: s.id });
  }
  let best: MineEvent | null = null;
  for (const e of events) {
    if (best === null || e.t < best.t - EPS || (Math.abs(e.t - best.t) <= EPS && ORDER[e.kind] < ORDER[best.kind])) best = e;
  }
  return best;
}

/** Fighters and a mine: one fighter and the mine go (fleets book p. 512). */
function mineMeetsFighters(ctx: Ctx, wave: AttackCraftWave, mine: OrbitalMine): void {
  const i = wave.squadrons.map((s) => isFighter(s)).lastIndexOf(true);
  const lost = i >= 0 ? wave.squadrons.splice(i, 1).map((s) => s.name) : [];
  if (wave.squadrons.length === 0) removeMine(ctx, wave.id, "intercepted");
  removeMine(ctx, mine.id, "intercepted");
  ctx.log("mine_intercept", { ordnanceId: wave.id, mineId: mine.id, lost });
}

/** A mine meets an enemy ship (state N111, R65): CAP, the Blast Marker test, then the Brace offer. */
export function mineAttack(ctx: Ctx, mineId: string, targetId: string, bmTested: boolean): void {
  const { state } = ctx;
  const mine = findMine(ctx, mineId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (mine === undefined || ship === undefined || ship.status !== "active") {
    ctx.log("skipped", { item: "mine_attack", ordnanceId: mineId, targetId });
    return;
  }
  const fighter = capOf(state, ship.id).at(-1);
  if (fighter !== undefined) {
    removeMine(ctx, fighter.id, "intercepted");
    removeMine(ctx, mine.id, "cap");
    ctx.log("cap_screen", { shipId: ship.id, ordnanceId: mine.id, capIds: [fighter.id] });
    return;
  }
  if (!bmTested && bmsInContact(state, ship).length > 0) {
    const roll = ctx.d6();
    ctx.log("bm_test", { entityId: mine.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
    if (roll === 6) {
      removeMine(ctx, mine.id, "blast_marker");
      return;
    }
  }
  enqueueFront(state, [
    { kind: "brace_offer", shipId: ship.id, source: { kind: "ordnance", id: mine.id } },
    { kind: "mine_hit", ordnanceId: mine.id, targetId: ship.id },
  ]);
}

/** Turrets, then 8D6 (4D6 if a turret hit it) against the armour it's on; shields work (state N111). */
export function mineHit(ctx: Ctx, mineId: string, targetId: string): void {
  const { state } = ctx;
  const mine = findMine(ctx, mineId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (mine === undefined || ship === undefined || ship.status !== "active") {
    ctx.log("skipped", { item: "mine_hit", ordnanceId: mineId, targetId });
    return;
  }
  const { own, massed, dice } = turretDice(state, ship, "torpedoes"); // mines share the torpedoes' turrets (T151)
  const turretRolls = ctx.nD6(dice);
  const hit = turretRolls.some((r) => r >= 4);
  if (dice > 0) ctx.log("turrets", { shipId: ship.id, ordnanceId: mine.id, against: "mine", own, massed, rolls: turretRolls, stopped: hit ? 1 : 0 });
  const origin = { ...mine.position };
  const facing = armourFacing(ship, origin);
  const rolls = ctx.nD6(hit ? 4 : 8);
  const hits = rolls.filter((r) => r >= facing.armour).length;
  ctx.log("attack", { source: { kind: "ordnance", id: mine.id }, targetId: ship.id, weapon: "mine", facing: facing.quadrant, need: facing.armour, rolls, rerolls: [], hits });
  removeMine(ctx, mine.id, "detonated");
  inflict(ctx, ship, hits, { source: { kind: "ordnance", id: mineId }, origin, shieldable: true, braceable: true, cause: "mine" });
}

// --- Fire ships (§8.5, R71)

export function detonate(ctx: Ctx, t: Detonate): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const centre = { ...(ship.position as Point) };
  const radiusRolls = ctx.nD6(3);
  const radius = sum(radiusRolls);
  releaseCap(ctx, ship);
  leaveGrapple(ctx, ship);
  ship.status = "destroyed";
  ship.damage = ship.profile.hits;
  ship.position = null;
  ship.heading = null;
  ship.specialOrder = null;
  const blastMarkerId = placeAt(ctx, centre, "fire_ship");
  const ships: Record<string, JsonValue>[] = [];
  for (const s of state.ships) {
    if (s.id === ship.id || s.status !== "active" || s.position === null || !approxLe(distance(s.position, centre), radius)) continue;
    if (lostLikeAnEscort(s)) {
      escortLost(ctx, s, "fire_ship");
      ships.push({ shipId: s.id, lost: true });
      continue;
    }
    const roll = ctx.d6();
    const fires = Math.ceil(roll / 2);
    for (let k = 0; k < fires; k++) s.criticals.push({ id: ctx.newId("crit"), kind: "fire", playerTurn: state.clock.playerTurn });
    ships.push({ shipId: s.id, rolls: [roll], fires });
  }
  const ordnanceIds = state.ordnance.filter((o) => approxLe(distance(o.position, centre), radius)).map((o) => o.id);
  state.ordnance = state.ordnance.filter((o) => !ordnanceIds.includes(o.id));
  ctx.log("detonation", { shipId: ship.id, radiusRolls, radius, blastMarkerId, ships, ordnanceIds });
  // A squadron whose last ships to move went up in the blast has finished its move.
  const sm = state.turnState.squadronMove ?? null;
  const first = sm?.members[0];
  if (sm !== null && first !== undefined && stillToMove(ctx).length === 0) afterSquadronMember(ctx, getShip(state, first), false, false);
}
