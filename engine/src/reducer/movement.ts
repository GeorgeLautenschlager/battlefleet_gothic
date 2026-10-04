/**
 * Movement (reducer spec §8): executing a ship's path with its contact events,
 * rams, the 0-shield Blast Marker roll, finishing a move, and drifting hulks.
 */
import { BM_RADIUS, BM_SLOWDOWN, EPS } from "../geometry/constants";
import { approxGe, approxLe, baseRadius, distance, headingVector, norm } from "../geometry/basic";
import { exitT, sweptCircleVsCircle, sweptCircleVsSegment } from "../geometry/sweep";
import { moveParameters } from "../rules/move";
import {
  armourFacing,
  facingQuadrants,
  getShip,
  isHulk,
  leadership,
  maxShields,
  onTable,
  roundOf,
} from "../state/derived";
import { cloneJson } from "../state/json";
import type { Activation, GameState, Point, Ship, TorpedoSalvo, WorkItem } from "../state/types";
import type { Move } from "../transforms/types";
import { sum, type Ctx } from "./context";
import { placeTrailing } from "./blast";
import { inflict, rerollHulk } from "./damage";
import { enqueueFront } from "./queue";

// --- The move transform (§8.1)

export function move(ctx: Ctx, t: Move): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  if (state.activation === null) state.activation = newActivation(ship);
  const a = state.activation;
  a.stage = "moving";
  a.remainingPath = cloneJson(t.path);
  a.disengage = t.disengage;
  state.queue.push({ kind: "continue_move" });
}

/** An activation for a ship moving without a declared order. */
function newActivation(ship: Ship): Activation {
  const p = moveParameters(ship, null);
  return {
    kind: "move",
    shipId: ship.id,
    stage: "ordered",
    order: null,
    aafExtra: null,
    ram: null,
    maxDistance: p.maxIfBR,
    minDistance: p.minDistance,
    start: { position: { ...(ship.position as Point) }, heading: ship.heading as number },
    distanceMoved: 0,
    distanceSinceTurn: 0,
    turnsMade: 0,
    truncated: false,
    remainingPath: [],
    slowedByBlastMarkers: false,
    zeroShieldBMTestDone: false,
    disengage: false,
  };
}

// --- Contact events along a leg

type Event =
  | { kind: "exit"; t: number }
  | { kind: "ram"; t: number; targetId: string }
  | { kind: "salvo"; t: number; ordnanceId: string }
  | { kind: "blast_marker"; t: number };

const EVENT_ORDER: Record<Event["kind"], number> = { exit: 0, ram: 1, salvo: 2, blast_marker: 3 };

/** The earliest event; ties (within EPS) go by kind in spec order, then by creation order. */
function earliest(events: Event[]): Event | null {
  let best: Event | null = null;
  for (const e of events) {
    if (best === null || e.t < best.t - EPS || (Math.abs(e.t - best.t) <= EPS && EVENT_ORDER[e.kind] < EVENT_ORDER[best.kind])) {
      best = e;
    }
  }
  return best;
}

/** The two ends of a salvo's segment, perpendicular to its heading. */
export function salvoEnds(salvo: TorpedoSalvo): [Point, Point] {
  const across = headingVector(salvo.heading + 90);
  const half = salvo.width / 2;
  return [
    { x: salvo.position.x - half * across.x, y: salvo.position.y - half * across.y },
    { x: salvo.position.x + half * across.x, y: salvo.position.y + half * across.y },
  ];
}

/**
 * Whether a salvo may attack this ship now: not its own launcher in the launch
 * turn (T4), and not a ship it has already attacked this round (p. 77).
 */
export function salvoMayAttack(state: GameState, salvo: TorpedoSalvo, ship: Ship): boolean {
  if (salvo.launchedBy === ship.id && salvo.launched === state.clock.playerTurn) return false;
  const round = roundOf(state.clock.playerTurn);
  return !salvo.attacks.some((x) => x.targetId === ship.id && x.round === round);
}

/** Salvo contacts for a base moving `length` cm from (position, heading). */
function salvoEvents(state: GameState, ship: Ship, position: Point, heading: number, length: number): Event[] {
  const radius = baseRadius(ship.profile.baseSize);
  const out: Event[] = [];
  for (const salvo of state.ordnance) {
    if (!salvoMayAttack(state, salvo, ship)) continue;
    const [a, b] = salvoEnds(salvo);
    const t = sweptCircleVsSegment(position, heading, length, radius, a, b);
    if (t !== null) out.push({ kind: "salvo", t, ordnanceId: salvo.id });
  }
  return out;
}

function shipEvents(state: GameState, ship: Ship, a: Activation, length: number): Event[] {
  const position = ship.position as Point;
  const heading = ship.heading as number;
  const radius = baseRadius(ship.profile.baseSize);
  const events: Event[] = [];

  const exit = exitT(position, heading, length, state.table);
  if (exit !== null) events.push({ kind: "exit", t: exit });

  if (a.ram !== null && a.ram.testPassed && !a.ram.resolved) {
    const target = state.ships.find((s) => s.id === a.ram?.targetId);
    if (target !== undefined && onTable(target) && target.position !== null) {
      const t = sweptCircleVsCircle(position, heading, length, radius, target.position, baseRadius(target.profile.baseSize));
      if (t !== null) events.push({ kind: "ram", t, targetId: target.id });
    }
  }

  events.push(...salvoEvents(state, ship, position, heading, length));

  if (!a.slowedByBlastMarkers) {
    for (const bm of state.blastMarkers) {
      const t = sweptCircleVsCircle(position, heading, length, radius, bm.position, BM_RADIUS);
      if (t !== null) events.push({ kind: "blast_marker", t });
    }
  }
  return events;
}

function advance(ship: Ship, d: number): void {
  const dir = headingVector(ship.heading as number);
  const p = ship.position as Point;
  ship.position = { x: p.x + d * dir.x, y: p.y + d * dir.y };
}

// --- continue_move (§8.2)

/** Turn legality against the ship's *current* state (validator checks 7–9). */
function turnStillLegal(ship: Ship, a: Activation, degrees: number): boolean {
  const p = moveParameters(ship, a);
  if (!approxLe(Math.abs(degrees), ship.profile.turns)) return false;
  if (a.turnsMade >= p.turnsAllowed) return false;
  const exempt = p.order === "burn_retros" && a.distanceSinceTurn === 0;
  return exempt || approxGe(a.distanceSinceTurn, p.turnDistance);
}

export function continueMove(ctx: Ctx): void {
  const { state } = ctx;
  const a = state.activation;
  const ship = a === null ? undefined : state.ships.find((s) => s.id === a.shipId);
  if (a === null || ship === undefined) {
    ctx.log("skipped", { item: "continue_move" });
    return;
  }

  while (a.remainingPath.length > 0 && ship.status === "active") {
    const step = a.remainingPath[0];
    if (step === undefined) break;

    if (step.kind === "turn") {
      if (!turnStillLegal(ship, a, step.degrees)) {
        a.remainingPath = [];
        a.truncated = true;
        break;
      }
      ship.heading = norm((ship.heading as number) + step.degrees);
      a.turnsMade += 1;
      a.distanceSinceTurn = 0;
      a.remainingPath.shift();
      continue;
    }

    const allowed = a.maxDistance - a.distanceMoved;
    if (allowed <= EPS) {
      a.remainingPath = [];
      a.truncated = true;
      break;
    }
    const length = Math.min(step.distance, allowed);
    const event = earliest(shipEvents(state, ship, a, length));

    if (event === null) {
      travel(ship, a, length);
      step.distance -= length;
      if (step.distance <= EPS) a.remainingPath.shift();
      else {
        a.truncated = true;
        a.remainingPath = [];
      }
      continue;
    }

    travel(ship, a, event.t);
    step.distance -= event.t;
    if (step.distance <= EPS) a.remainingPath.shift();
    const items = handleEvent(ctx, ship, a, event);
    if (items.length > 0) {
      enqueueFront(state, [...items, { kind: "continue_move" }]);
      return; // the queue runs the event, then this again
    }
  }
  finishMove(ctx, ship, a);
}

function travel(ship: Ship, a: Activation, d: number): void {
  advance(ship, d);
  a.distanceMoved += d;
  a.distanceSinceTurn += d;
}

/** Resolve an event in place, or return the work items it needs. */
function handleEvent(ctx: Ctx, ship: Ship, a: Activation, event: Event): WorkItem[] {
  switch (event.kind) {
    case "exit":
      ship.status = "disengaged";
      ship.position = null;
      ship.heading = null;
      ship.specialOrder = null;
      ctx.log("disengaged", { shipId: ship.id, reason: "table_edge" });
      return [];
    case "ram":
      return [
        { kind: "brace_offer", shipId: event.targetId, source: { kind: "ship", id: ship.id } },
        { kind: "brace_offer", shipId: ship.id, source: { kind: "ship", id: event.targetId } },
        { kind: "ram", rammerId: ship.id, targetId: event.targetId },
      ];
    case "salvo":
      return [{ kind: "torpedo_attack", ordnanceId: event.ordnanceId, targetId: ship.id, bmTested: false }];
    case "blast_marker": {
      a.slowedByBlastMarkers = true;
      a.maxDistance -= BM_SLOWDOWN; // p. 69, once per move
      const items: WorkItem[] = [];
      if (maxShields(ship) === 0 && !a.zeroShieldBMTestDone) {
        a.zeroShieldBMTestDone = true;
        items.push({ kind: "brace_offer", shipId: ship.id, source: { kind: "ship", id: ship.id } }, { kind: "zero_shield_bm", shipId: ship.id });
      }
      // All Ahead Full can't slow down: a BM met in its last 5 cm stops it there (p. 69, V4).
      if (a.order === "all_ahead_full" && event.t > EPS && approxGe(a.distanceMoved, a.maxDistance - BM_SLOWDOWN)) {
        a.remainingPath = [];
      }
      ctx.log("blast_marker_contact", { shipId: ship.id, distance: a.distanceMoved, maxDistance: a.maxDistance });
      return items;
    }
  }
}

/** §8.2 finish_move: lastMove, the disengage test, and close the activation. */
function finishMove(ctx: Ctx, ship: Ship, a: Activation): void {
  const { state } = ctx;
  if (ship.status === "active") {
    ship.lastMove = { playerTurn: state.clock.playerTurn, distance: a.distanceMoved };
    if (a.disengage) disengageTest(ctx, ship);
  }
  const entry = state.turnState.ships[ship.id];
  if (entry !== undefined) entry.moved = true;
  ctx.log("move", {
    shipId: ship.id,
    from: { ...a.start.position },
    to: ship.position === null ? null : { ...ship.position },
    distance: a.distanceMoved,
    truncated: a.truncated,
  });
  state.activation = null;
}

/** Leadership + 1 per BM within 5 cm − 1 per enemy ship or salvo within 15 cm (p. 56, T5). */
function disengageTest(ctx: Ctx, ship: Ship): void {
  const { state } = ctx;
  const stem = ship.position as Point;
  const bms = state.blastMarkers.filter((bm) => approxLe(distance(stem, bm.position), 5)).length;
  const enemies =
    state.ships.filter((s) => s.owner !== ship.owner && onTable(s) && s.position !== null && approxLe(distance(stem, s.position), 15)).length +
    state.ordnance.filter((o) => o.owner !== ship.owner && approxLe(distance(stem, o.position), 15)).length;
  const target = leadership(ship) + bms - enemies;
  const test = ctx.test(2, target);
  ctx.log("disengage_test", { shipId: ship.id, target, rolls: test.rolls, passed: test.passed });
  if (test.passed) {
    ship.status = "disengaged";
    ship.position = null;
    ship.heading = null;
    ship.specialOrder = null;
    ctx.log("disengaged", { shipId: ship.id, reason: "test" });
  } else {
    const entry = state.turnState.ships[ship.id];
    if (entry !== undefined) entry.disengage = "failed";
  }
}

// --- Rams (§8.3)

export function ram(ctx: Ctx, rammerId: string, targetId: string): void {
  const { state } = ctx;
  const a = state.activation;
  if (a?.ram !== null && a?.ram !== undefined && a.ram.targetId === targetId) a.ram.resolved = true;
  const rammer = state.ships.find((s) => s.id === rammerId);
  const target = state.ships.find((s) => s.id === targetId);
  if (rammer === undefined || target === undefined || rammer.status !== "active" || !onTable(target)) {
    ctx.log("skipped", { item: "ram", rammerId, targetId });
    return;
  }
  const from = rammer.position as Point;
  const headOn = facingQuadrants(target, from).includes("front"); // T7
  const facing = armourFacing(target, from); // lower armour on a boundary (R7)
  const rRolls = ctx.nD6(rammer.profile.hits);
  const rHits = rRolls.filter((r) => r >= facing.armour).length;
  const tDice = isHulk(target) ? 0 : headOn ? target.profile.hits : Math.ceil(target.profile.hits / 2); // R5
  const tRolls = ctx.nD6(tDice);
  const tHits = tRolls.filter((r) => r >= rammer.profile.armour.front).length;
  ctx.log("ram", {
    rammerId, targetId, headOn, facing: facing.quadrant,
    rammerRolls: rRolls, rammerHits: rHits, targetRolls: tRolls, targetHits: tHits,
  });
  const targetAt = { ...(target.position as Point) };
  inflict(ctx, target, rHits, { source: { kind: "ship", id: rammer.id }, origin: { ...from }, shieldable: false, braceable: true, cause: "ram" });
  inflict(ctx, rammer, tHits, { source: { kind: "ship", id: target.id }, origin: targetAt, shieldable: false, braceable: true, cause: "ram" });
}

/** A 0-shield ship moving through Blast Markers: 1 damage on a 6 (p. 69). */
export function zeroShieldBm(ctx: Ctx, shipId: string): void {
  const ship = ctx.state.ships.find((s) => s.id === shipId);
  if (ship === undefined || ship.status !== "active") {
    ctx.log("skipped", { item: "zero_shield_bm", shipId });
    return;
  }
  const roll = ctx.d6();
  ctx.log("bm_test", { entityId: ship.id, rolls: [roll], effect: roll === 6 ? "damage" : "none" });
  if (roll === 6) {
    inflict(ctx, ship, 1, {
      source: { kind: "ship", id: ship.id },
      origin: { ...(ship.position as Point) },
      shieldable: false,
      braceable: true,
      cause: "blast_marker",
    });
  }
}

// --- Drifting hulks (§8.4)

export function driftHulk(ctx: Ctx, shipId: string): void {
  const rolls = ctx.nD6(4);
  const d = sum(rolls);
  ctx.log("hulk_drift", { shipId, rolls, distance: d });
  ctx.state.queue.push({ kind: "hulk_drift", shipId, distance: d, travelled: 0 });
}

export function hulkDrift(ctx: Ctx, shipId: string, distanceTotal: number, travelledSoFar: number): void {
  const { state } = ctx;
  const hulk = state.ships.find((s) => s.id === shipId);
  const entry = state.turnState.ships[shipId];
  if (hulk === undefined || !isHulk(hulk)) {
    if (entry !== undefined) entry.drifted = true;
    ctx.log("skipped", { item: "hulk_drift", shipId });
    return;
  }
  let travelled = travelledSoFar;
  while (travelled < distanceTotal - EPS) {
    const remaining = distanceTotal - travelled;
    const position = hulk.position as Point;
    const heading = hulk.heading as number;
    const events: Event[] = [];
    const exit = exitT(position, heading, remaining, state.table);
    if (exit !== null) events.push({ kind: "exit", t: exit });
    events.push(...salvoEvents(state, hulk, position, heading, remaining));
    const event = earliest(events);
    if (event === null) {
      advance(hulk, remaining);
      travelled = distanceTotal;
      break;
    }
    advance(hulk, event.t);
    travelled += event.t;
    if (event.kind === "exit") {
      hulk.status = "destroyed";
      hulk.position = null;
      hulk.heading = null;
      ctx.log("hulk_lost", { shipId, reason: "table_edge" });
      break;
    }
    if (event.kind === "salvo") {
      enqueueFront(state, [
        { kind: "torpedo_attack", ordnanceId: event.ordnanceId, targetId: hulk.id, bmTested: false },
        { kind: "hulk_drift", shipId, distance: distanceTotal, travelled },
      ]);
      return;
    }
  }
  if (isHulk(hulk)) {
    placeTrailing(ctx, hulk);
    if (hulk.status === "blazing_hulk") rerollHulk(ctx, hulk);
  }
  if (entry !== undefined) entry.drifted = true;
}
