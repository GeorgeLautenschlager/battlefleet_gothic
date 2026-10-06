/**
 * Boarding actions, grapples and teleport attacks (reducer spec §10.4–10.5,
 * transform spec §4.6). Boarding damage bypasses the damage pipeline: no
 * shields, no Brace, no per-point critical checks (T12).
 */
import { activePlayer, bmsInContact, boardingValue, getShip, isBraced, isCrippled, turrets } from "../state/derived";
import type { Ship } from "../state/types";
import type { Board, Teleport } from "../transforms/types";
import type { Ctx } from "./context";
import { applyCritical, catastrophic, critical, damagePoint } from "./damage";
import { placeAtStem } from "./blast";
import { leaveGrapple } from "./grapple";
import { releaseCap } from "./cap";
import { enqueueFront } from "./queue";

type Need = number | "auto" | "none";

/** Critical chance by difference, read as (loser, winner) (R#1). */
const CRITS: Record<number, [Need, Need]> = { 1: [5, 5], 2: [4, 5], 3: [3, 6], 4: [2, 6], 5: ["auto", "none"] };
const RESULTS = ["draw", "stalemate", "heavy_fighting", "driven_back", "stormed", "overwhelmed"] as const;

/** The boarding-value modifier: higher +1, twice +2, three times +3, four or more times +4 (p. 90). */
function ratio(own: number, enemy: number): number {
  if (own >= 4 * enemy) return 4;
  if (own >= 3 * enemy) return 3;
  if (own >= 2 * enemy) return 2;
  return own > enemy ? 1 : 0;
}

/** The "enemy ship" modifiers a side gets against this ship: Blast Markers +1, crippled +2, on orders +1. */
function enemyCondition(ctx: Ctx, ship: Ship): number {
  return (bmsInContact(ctx.state, ship).length > 0 ? 1 : 0) + (isCrippled(ship) ? 2 : 0) + (ship.specialOrder !== null ? 1 : 0);
}

const factionMod = (ctx: Ctx, ship: Ship): number => ctx.state.players[ship.owner].factionTraits.boardingModifier;

// --- Entering steps

/** Entering move_ships: the active player's grappled ships stay put (state §6). */
export function grappledStayPut(ctx: Ctx): void {
  const { state } = ctx;
  for (const ship of state.ships) {
    if (ship.owner !== activePlayer(state) || ship.status !== "active" || ship.grapple === null) continue;
    const turn = state.turnState.ships[ship.id];
    if (turn !== undefined) turn.moved = true;
    ship.lastMove = { playerTurn: state.clock.playerTurn, distance: 0 };
    ctx.log("grappled", { shipId: ship.id });
  }
}

/** Entering boarding: every grapple fights again (transform §4.6). */
export function grapplesFight(ctx: Ctx): void {
  const { state } = ctx;
  if (!state.meta.options.boarding) return;
  for (const ship of state.ships) {
    const g = ship.grapple;
    if (g !== null && g.defenderId === ship.id) {
      state.queue.push({ kind: "boarding_fight", defenderId: ship.id, attackerIds: [...g.attackerIds] });
    }
  }
}

// --- Handlers

export function board(ctx: Ctx, t: Board): void {
  const { state } = ctx;
  for (const id of t.priority) {
    const turn = state.turnState.ships[id];
    if (turn !== undefined) turn.boarded = true;
  }
  if (t.together) {
    state.queue.push({ kind: "boarding_fight", defenderId: t.targetId, attackerIds: [...t.priority] });
  } else {
    for (const id of t.priority) state.queue.push({ kind: "boarding_fight", defenderId: t.targetId, attackerIds: [id] });
  }
}

export function teleport(ctx: Ctx, t: Teleport): void {
  const { state } = ctx;
  const turn = state.turnState.ships[t.shipId];
  if (turn !== undefined) turn.teleported = true;
  state.queue.push(
    { kind: "brace_offer", shipId: t.targetId, source: { kind: "ship", id: t.shipId } },
    { kind: "teleport_attack", shipId: t.shipId, targetId: t.targetId },
  );
}

// --- Work items

/** One boarding action: attackers (together) against a defender (§10.4). */
export function boardingFight(ctx: Ctx, defenderId: string, attackerIds: string[]): void {
  const { state } = ctx;
  const defender = getShip(state, defenderId);
  const attackers = attackerIds.map((id) => getShip(state, id)).filter((s) => s.status === "active");
  const first = attackers[0];
  if (defender.status !== "active" || first === undefined) {
    ctx.log("skipped", { item: "boarding_fight", defenderId, attackerIds });
    return;
  }

  const attVal = attackers.reduce((n, a) => n + boardingValue(a), 0);
  const defVal = boardingValue(defender) + turrets(defender); // the defender adds its turrets (p. 89)
  const attMod = ratio(attVal, defVal) + enemyCondition(ctx, defender) + factionMod(ctx, first);
  const defMod = ratio(defVal, attVal) + Math.max(...attackers.map((a) => enemyCondition(ctx, a))) + factionMod(ctx, defender); // T11
  const attRoll = ctx.d6();
  const defRoll = ctx.d6();
  const att = attRoll + attMod;
  const def = defRoll + defMod;
  const diff = Math.abs(att - def);
  const loser = diff === 0 ? null : att < def ? "attackers" : "defender";
  ctx.log("boarding", {
    defenderId,
    attackerIds: attackers.map((a) => a.id),
    values: { attackers: attVal, defender: defVal },
    modifiers: { attackers: attMod, defender: defMod },
    rolls: [attRoll, defRoll],
    totals: { attackers: att, defender: def },
    result: RESULTS[Math.min(diff, 5)] ?? "overwhelmed",
    loser,
    damage: diff,
  });

  if (loser === null) {
    joinGrapple(ctx, defender, attackers);
    return;
  }
  const [losers, winners] = loser === "attackers" ? [attackers, [defender]] : [[defender], attackers];
  boardingDamage(ctx, losers, diff);
  const [loserNeed, winnerNeed] = CRITS[Math.min(diff, 5)] ?? ["auto", "none"];
  // The Warmaster's Mark of Khorne: +1 to the critical rolls his side inflicts (R31).
  const khorne = (side: Ship[]): number => (side.some((s) => s.commander?.kind === "warmaster" && s.commander.marks.includes("khorne")) ? 1 : 0);
  const bonus = (b: number) => (b > 0 ? { bonus: b } : {});
  enqueueFront(state, [
    ...losers.map((s) => ({ kind: "boarding_critical" as const, shipId: s.id, need: loserNeed, ...bonus(khorne(winners)) })),
    ...winners.map((s) => ({ kind: "boarding_critical" as const, shipId: s.id, need: winnerNeed, ...bonus(khorne(losers)) })),
  ]);
}

/** Damage to the losing side, filling each ship before the next (T16). A ship boarded to 0 is a drifting hulk (R12). */
function boardingDamage(ctx: Ctx, ships: Ship[], points: number): void {
  let n = points;
  for (const ship of ships) {
    while (n > 0 && ship.damage < ship.profile.hits) {
      damagePoint(ctx, ship, false, "boarding");
      n -= 1;
    }
    if (ship.damage >= ship.profile.hits && ship.status === "active") {
      ship.status = "drifting_hulk";
      ship.specialOrder = null;
      const blastMarkerIds = [placeAtStem(ctx, ship)];
      leaveGrapple(ctx, ship);
      releaseCap(ctx, ship);
      ctx.log("boarded_hulk", { shipId: ship.id, blastMarkerIds });
    }
    if (n === 0) return;
  }
}

/** A draw: the fight's ships grapple, joining the defender's grapple if it has one. */
function joinGrapple(ctx: Ctx, defender: Ship, attackers: Ship[]): void {
  const attackerIds = [...(defender.grapple?.attackerIds ?? [])];
  for (const a of attackers) if (!attackerIds.includes(a.id)) attackerIds.push(a.id);
  for (const ship of [defender, ...attackerIds.map((id) => getShip(ctx.state, id))]) {
    ship.grapple = { defenderId: defender.id, attackerIds: [...attackerIds] };
  }
  ctx.log("grapple", { defenderId: defender.id, attackerIds });
}

/** One ship's critical check after a boarding fight (R11). Brace doesn't apply (T12). */
export function boardingCritical(ctx: Ctx, shipId: string, need: Need, bonus = 0): void {
  const ship = getShip(ctx.state, shipId);
  if (ship.status !== "active" || need === "none") return; // a ship at 0 makes no critical checks (R2)
  const rolls = need === "auto" ? [] : [ctx.d6()];
  const hit = need === "auto" || (rolls[0] ?? 0) + bonus >= need;
  ctx.log("boarding_critical", { shipId, need, rolls, critical: hit, ...(bonus > 0 ? { bonus } : {}) });
  if (!hit) return;
  critical(ctx, ship);
  if (ship.damage >= ship.profile.hits && ship.status === "active") catastrophic(ctx, ship); // p. 90
}

/** A teleport attack's Hit-and-Run (§10.5): a D6 read on the Critical Hits table; Brace saves on 4+. */
export function teleportAttack(ctx: Ctx, shipId: string, targetId: string): void {
  const target = getShip(ctx.state, targetId);
  if (target.status !== "active") {
    ctx.log("skipped", { item: "teleport_attack", shipId, targetId });
    return;
  }
  const roll = ctx.d6();
  if (roll === 1) {
    ctx.log("teleport", { shipId, targetId, rolls: [roll], result: "failed" });
    return;
  }
  if (isBraced(target)) {
    const save = ctx.d6();
    if (save >= 4) {
      ctx.log("teleport", { shipId, targetId, rolls: [roll], saveRolls: [save], result: "saved" });
      return;
    }
    ctx.log("teleport", { shipId, targetId, rolls: [roll], saveRolls: [save], result: "critical" });
  } else {
    ctx.log("teleport", { shipId, targetId, rolls: [roll], result: "critical" });
  }
  applyCritical(ctx, target, roll, [roll]);
  if (target.damage >= target.profile.hits && target.status === "active") catastrophic(ctx, target);
}
