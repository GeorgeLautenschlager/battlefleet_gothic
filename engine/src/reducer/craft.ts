/**
 * Attack craft (reducer spec §9.1, §9.4–9.7): launching, flying a wave,
 * intercepts and dogfights, meeting a ship, bombers and assault boats.
 */
import { BM_RADIUS, EPS } from "../geometry/constants";
import { baseRadius, distance, tableBearing } from "../geometry/basic";
import { sweptCircleVsCircle, sweptCircleVsSegment } from "../geometry/sweep";
import { capOf, craftFor, fighters, isFighter, isStriker, strikers, waveRadius } from "../rules/craft";
import { bmsInContact, getShip, isBraced, isWave, launchBays, onTable, turrets } from "../state/derived";
import type { AttackCraftWave, GameState, Point, Ship, Squadron, TorpedoSalvo } from "../state/types";
import type { LaunchAttackCraft, MoveOrdnance, ReleaseCap } from "../transforms/types";
import type { Ctx } from "./context";
import { applyCritical, catastrophic, inflict } from "./damage";
import { salvoEnds } from "./movement";
import { enqueueFront } from "./queue";
import { turretDice } from "./turrets";

const findWave = (state: GameState, id: string): AttackCraftWave | undefined =>
  state.ordnance.find((o): o is AttackCraftWave => o.id === id && isWave(o));

function markMoved(state: GameState, id: string): void {
  if (!state.turnState.ordnanceMoved.includes(id)) state.turnState.ordnanceMoved.push(id);
}

function removeOrdnance(ctx: Ctx, id: string, reason: string): void {
  ctx.state.ordnance = ctx.state.ordnance.filter((o) => o.id !== id);
  ctx.log("ordnance_removed", { ordnanceId: id, reason });
}

const live = (state: GameState, wave: AttackCraftWave): boolean => state.ordnance.includes(wave);

/**
 * Remove up to `k` squadrons matching `pred` from a side (one wave, or a ship's
 * CAP fighters), last first (T25, R18). Emptied waves leave play. Returns the names lost.
 */
function removeLast(ctx: Ctx, side: AttackCraftWave[], pred: (s: Squadron) => boolean, k: number, reason: string): string[] {
  const lost: string[] = [];
  for (let w = side.length - 1; w >= 0 && lost.length < k; w--) {
    const wave = side[w];
    if (wave === undefined) continue;
    for (let i = wave.squadrons.length - 1; i >= 0 && lost.length < k; i--) {
      const sq = wave.squadrons[i];
      if (sq !== undefined && pred(sq)) {
        wave.squadrons.splice(i, 1);
        lost.push(sq.name);
      }
    }
    if (wave.squadrons.length === 0 && live(ctx.state, wave)) removeOrdnance(ctx, wave.id, reason);
  }
  return lost;
}

const count = (side: AttackCraftWave[], pred: (s: Squadron) => boolean): number =>
  side.reduce((n, w) => n + w.squadrons.filter(pred).length, 0);

// --- Launch (§9.1)

export function launchAttackCraft(ctx: Ctx, t: LaunchAttackCraft): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  for (const id of t.recall) removeOrdnance(ctx, id, "recalled");
  const ordnanceIds: string[] = [];
  const add = (squadrons: Squadron[], cap: string | null) => {
    const wave: AttackCraftWave = {
      id: ctx.newId("ord"),
      kind: "attack_craft",
      owner: ship.owner,
      launchedBy: ship.id,
      launched: state.clock.playerTurn,
      position: { ...(ship.position as Point) },
      squadrons,
      cap,
    };
    state.ordnance.push(wave);
    ordnanceIds.push(wave.id);
  };
  for (const entry of t.waves) {
    const squadrons = entry.roles.map((role): Squadron => {
      const option = craftFor(ship, role);
      return { role, name: option?.name ?? role, speed: option?.speed ?? 0 }; // validated: the bays carry it
    });
    if (entry.cap) for (const sq of squadrons) add([sq], ship.id);
    else add(squadrons, null);
  }
  ship.loaded.launchBays = false; // launching any amount expends the bays (p. 73)
  const fired = state.turnState.ships[ship.id]?.weaponsFired;
  if (fired !== undefined) for (const bay of launchBays(ship)) if (!fired.includes(bay.id)) fired.push(bay.id);
  ctx.log("craft_launch", { shipId: ship.id, ordnanceIds, recalled: [...t.recall] });
}

export function releaseCapOrder(ctx: Ctx, t: ReleaseCap): void {
  const wave = findWave(ctx.state, t.ordnanceId);
  if (wave === undefined || wave.cap === null) return; // unreachable after validation
  const shipId = wave.cap;
  wave.cap = null;
  ctx.log("cap_released", { shipId, ordnanceIds: [wave.id], reason: "order" });
}

// --- Flying a wave (§9.4)

type CraftEvent =
  | { kind: "blast_marker"; t: number }
  | { kind: "salvo"; t: number; id: string }
  | { kind: "wave"; t: number; id: string }
  | { kind: "ship"; t: number; id: string };

const ORDER: Record<CraftEvent["kind"], number> = { blast_marker: 0, salvo: 1, wave: 2, ship: 3 };

function earliest(events: CraftEvent[]): CraftEvent | null {
  let best: CraftEvent | null = null;
  for (const e of events) {
    if (best === null || e.t < best.t - EPS || (Math.abs(e.t - best.t) <= EPS && ORDER[e.kind] < ORDER[best.kind])) best = e;
  }
  return best;
}

function craftEvents(state: GameState, wave: AttackCraftWave, to: Point, length: number, bmTested: boolean, ignore: string[]): CraftEvent[] {
  const from = wave.position;
  const heading = tableBearing(from, to);
  const r = waveRadius(wave);
  const events: CraftEvent[] = [];
  if (!bmTested) {
    for (const bm of state.blastMarkers) {
      const t = sweptCircleVsCircle(from, heading, length, r, bm.position, BM_RADIUS);
      if (t !== null) events.push({ kind: "blast_marker", t });
    }
  }
  for (const o of state.ordnance) {
    if (o.owner === wave.owner) continue; // friendly ordnance is ignored (p. 82)
    if (o.kind === "torpedo_salvo") {
      if (fighters(wave) === 0) continue;
      const [a, b] = salvoEnds(o);
      const t = sweptCircleVsSegment(from, heading, length, r, a, b);
      if (t !== null) events.push({ kind: "salvo", t, id: o.id });
    } else if (o.cap === null && (fighters(wave) > 0 || fighters(o) > 0)) {
      const t = sweptCircleVsCircle(from, heading, length, r, o.position, waveRadius(o));
      if (t !== null) events.push({ kind: "wave", t, id: o.id });
    }
  }
  for (const ship of state.ships) {
    if (ship.owner === wave.owner || !onTable(ship) || ship.position === null || ignore.includes(ship.id)) continue;
    const t = sweptCircleVsCircle(from, heading, length, r, ship.position, baseRadius(ship.profile.baseSize));
    if (t !== null) events.push({ kind: "ship", t, id: ship.id });
  }
  return events;
}

export function moveAttackCraft(ctx: Ctx, t: MoveOrdnance): void {
  const { state } = ctx;
  const wave = findWave(state, t.ordnanceId);
  if (wave === undefined) return; // unreachable after validation
  if (wave.cap !== null) {
    const shipId = wave.cap;
    wave.cap = null; // moving in the opponent's Ordnance Phase takes it off CAP (p. 82)
    ctx.log("cap_released", { shipId, ordnanceIds: [wave.id], reason: "moved" });
  }
  // Ships it starts the move touching don't stop it: it's leaving them (R16).
  const ignore = state.ships
    .filter((s) => s.owner !== wave.owner && onTable(s) && s.position !== null && distance(wave.position, s.position) <= waveRadius(wave) + baseRadius(s.profile.baseSize) + EPS)
    .map((s) => s.id);
  let bmTested = false;
  let stoppedBy: string | null = null;

  flight: for (const waypoint of t.path ?? []) {
    for (;;) {
      if (!live(state, wave)) break flight;
      const length = distance(wave.position, waypoint);
      if (length <= EPS) {
        wave.position = { ...waypoint };
        break;
      }
      const event = earliest(craftEvents(state, wave, waypoint, length, bmTested, ignore));
      if (event === null) {
        wave.position = { ...waypoint };
        break;
      }
      const f = event.t / length;
      wave.position = {
        x: wave.position.x + f * (waypoint.x - wave.position.x),
        y: wave.position.y + f * (waypoint.y - wave.position.y),
      };
      if (event.kind === "blast_marker") {
        bmTested = true;
        const roll = ctx.d6();
        ctx.log("bm_test", { entityId: wave.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
        if (roll === 6) removeOrdnance(ctx, wave.id, "blast_marker"); // the whole wave (p. 85)
      } else if (event.kind === "salvo") {
        const salvo = state.ordnance.find((o): o is TorpedoSalvo => o.id === event.id && o.kind === "torpedo_salvo");
        if (salvo !== undefined) intercept(ctx, wave, salvo);
      } else if (event.kind === "wave") {
        const other = findWave(state, event.id);
        if (other !== undefined) dogfight(ctx, [wave], [other]);
      } else {
        stoppedBy = event.id;
        break flight;
      }
      // Otherwise carry on along this leg: nothing above can fire twice (§9.4).
    }
  }

  markMoved(state, t.ordnanceId);
  if (!live(state, wave)) return;
  ctx.log("craft_move", { ordnanceId: wave.id, to: { ...wave.position }, stoppedBy });
  if (stoppedBy !== null) {
    enqueueFront(state, [{ kind: "craft_meets_ship", ordnanceId: wave.id, targetId: stoppedBy, bmTested }]);
    return;
  }
  const capShip = t.cap === undefined ? null : state.ships.find((s) => s.id === t.cap);
  if (capShip !== undefined && capShip !== null && capShip.position !== null) goOnCap(ctx, wave, capShip);
}

/** Split a fighter wave into single CAP fighters on a ship (T28). The first keeps the wave's id. */
function goOnCap(ctx: Ctx, wave: AttackCraftWave, ship: Ship): void {
  const { state } = ctx;
  const [first, ...rest] = wave.squadrons;
  if (first === undefined) return;
  const stem = ship.position as Point;
  wave.squadrons = [first];
  wave.cap = ship.id;
  wave.position = { ...stem };
  const ids = [wave.id];
  let at = state.ordnance.indexOf(wave);
  for (const sq of rest) {
    const single: AttackCraftWave = { ...wave, id: ctx.newId("ord"), position: { ...stem }, squadrons: [sq] };
    at += 1;
    state.ordnance.splice(at, 0, single);
    markMoved(state, single.id);
    ids.push(single.id);
  }
  ctx.log("cap_formed", { shipId: ship.id, ordnanceIds: ids });
}

// --- Intercepts and dogfights (§9.5)

/** A fighter meets torpedoes: one fighter and the whole salvo go (T22, p. 82). */
export function intercept(ctx: Ctx, wave: AttackCraftWave, salvo: TorpedoSalvo): void {
  const lost = removeLast(ctx, [wave], isFighter, 1, "intercepted");
  ctx.log("intercept", { ordnanceId: wave.id, salvoId: salvo.id, lost });
  removeOrdnance(ctx, salvo.id, "intercepted");
}

/** Waves meet, marker to marker (p. 85): fighters first, then fighters against the rest. */
export function dogfight(ctx: Ctx, a: AttackCraftWave[], b: AttackCraftWave[]): void {
  const ids = [a.map((w) => w.id), b.map((w) => w.id)];
  const k = Math.min(count(a, isFighter), count(b, isFighter));
  const lostA = removeLast(ctx, a, isFighter, k, "dogfight");
  const lostB = removeLast(ctx, b, isFighter, k, "dogfight");
  const kA = Math.min(count(a, isFighter), count(b, isStriker));
  lostB.push(...removeLast(ctx, b, isStriker, kA, "dogfight"));
  lostA.push(...removeLast(ctx, a, isFighter, kA, "dogfight"));
  const kB = Math.min(count(b, isFighter), count(a, isStriker));
  lostA.push(...removeLast(ctx, a, isStriker, kB, "dogfight"));
  lostB.push(...removeLast(ctx, b, isFighter, kB, "dogfight"));
  ctx.log("dogfight", { ordnanceIds: ids, lost: [lostA, lostB] });
}

// --- Meeting a ship (§9.6–9.7)

export function craftMeetsShip(ctx: Ctx, ordnanceId: string, targetId: string, bmTested: boolean): void {
  const { state } = ctx;
  const wave = findWave(state, ordnanceId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (wave === undefined || ship === undefined || !onTable(ship)) {
    ctx.log("skipped", { item: "craft_meets_ship", ordnanceId, targetId });
    return;
  }
  const cap = capOf(state, ship.id);
  if (cap.length > 0) dogfight(ctx, cap, [wave]); // CAP screens
  if (!live(state, wave)) return;
  if (strikers(wave) === 0) {
    ctx.log("craft_meets_ship", { ordnanceId, targetId, result: "no_effect" }); // fighters stay put (p. 82)
    return;
  }
  if (!bmTested && bmsInContact(state, ship).length > 0) {
    const roll = ctx.d6();
    ctx.log("bm_test", { entityId: wave.id, rolls: [roll], effect: roll === 6 ? "removed" : "none" });
    if (roll === 6) {
      removeOrdnance(ctx, wave.id, "blast_marker");
      return;
    }
  }
  enqueueFront(state, [
    { kind: "brace_offer", shipId: ship.id, source: { kind: "ordnance", id: wave.id } },
    { kind: "craft_attack", ordnanceId: wave.id, targetId: ship.id },
  ]);
}

export function craftAttack(ctx: Ctx, ordnanceId: string, targetId: string): void {
  const { state } = ctx;
  const wave = findWave(state, ordnanceId);
  const ship = state.ships.find((s) => s.id === targetId);
  if (wave === undefined || ship === undefined || !onTable(ship)) {
    ctx.log("skipped", { item: "craft_attack", ordnanceId, targetId });
    return;
  }
  const escorts = fighters(wave); // counted before turrets (T26, R20)
  const { own, massed, dice } = turretDice(state, ship, "attack_craft");
  const turretRolls = ctx.nD6(dice);
  const stopped = turretRolls.filter((r) => r >= 4).length;
  if (dice > 0) ctx.log("turrets", { shipId: ship.id, ordnanceId, against: "attack_craft", own, massed, rolls: turretRolls, stopped });
  const kf = Math.min(stopped, fighters(wave));
  removeLast(ctx, [wave], isFighter, kf, "turrets"); // fighters first (p. 85)
  removeLast(ctx, [wave], isStriker, stopped - kf, "turrets");
  if (!live(state, wave)) return;

  const bombers = wave.squadrons.filter((s) => s.role === "bomber").length;
  const boats = wave.squadrons.filter((s) => s.role === "assault_boat").length;
  const ownTurrets = turrets(ship); // never massed; always counts (p. 83)
  const bomberRolls = ctx.nD6(bombers);
  const attacks = bomberRolls.reduce((n, r) => n + Math.max(0, r - ownTurrets), 0) + Math.min(escorts, bombers);
  const armour = ship.profile.armour;
  const need = Math.min(armour.front, armour.left, armour.rear, armour.right); // lowest armour (p. 83)
  const attackRolls = ctx.nD6(attacks);
  const hits = attackRolls.filter((r) => r >= need).length;
  const origin = { ...wave.position };
  removeOrdnance(ctx, wave.id, "spent");
  ctx.log("craft_attack", {
    ordnanceId, targetId, bombers, escorts, own: ownTurrets, bomberRolls, attacks, need, attackRolls, hits, boats,
  });
  enqueueFront(state, Array.from({ length: boats }, () => ({ kind: "hit_and_run" as const, ordnanceId, targetId })));
  inflict(ctx, ship, hits, { source: { kind: "ordnance", id: ordnanceId }, origin, shieldable: false, braceable: true, cause: "bomber" });
}

/** An assault boat's Hit-and-Run (§9.7), as a teleport attack: 1 fails, else a critical; Brace saves on 4+. */
export function hitAndRun(ctx: Ctx, ordnanceId: string, targetId: string): void {
  const target = ctx.state.ships.find((s) => s.id === targetId);
  if (target === undefined || target.status !== "active") {
    ctx.log("skipped", { item: "hit_and_run", ordnanceId, targetId }); // hulks: R23
    return;
  }
  const roll = ctx.d6();
  if (roll === 1) {
    ctx.log("hit_and_run", { ordnanceId, targetId, rolls: [roll], result: "failed" });
    return;
  }
  if (isBraced(target)) {
    const save = ctx.d6();
    const result = save >= 4 ? "saved" : "critical";
    ctx.log("hit_and_run", { ordnanceId, targetId, rolls: [roll], saveRolls: [save], result });
    if (result === "saved") return;
  } else {
    ctx.log("hit_and_run", { ordnanceId, targetId, rolls: [roll], result: "critical" });
  }
  applyCritical(ctx, target, roll, [roll]);
  if (target.damage >= target.profile.hits && target.status === "active") catastrophic(ctx, target);
}
