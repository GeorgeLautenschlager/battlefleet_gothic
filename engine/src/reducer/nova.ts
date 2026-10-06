/**
 * The nova cannon (reducer spec §4.4, transform §4.3): brace offers to every
 * ship the worst scatter could reach, then the scatter, then the hits.
 */
import { approxLe, distance, headingVector, segmentTouchesCircle } from "../geometry/basic";
import { NOVA_HOLE_RADIUS, NOVA_RADIUS } from "../geometry/constants";
import { novaRange, templateTouchesShip } from "../geometry/targeting";
import { baseRadius } from "../geometry/basic";
import { getShip, isSalvo, onTable } from "../state/derived";
import type { GameState, Ordnance, Point, Ship, WorkItem } from "../state/types";
import type { FireNovaCannon } from "../transforms/types";
import { waveRadius } from "../rules/craft";
import { sum, type Ctx } from "./context";
import { inflict } from "./damage";
import { placeAt } from "./blast";
import { enqueueFront } from "./queue";

/** Scatter dice from the range to the template's near edge (p. 63, T43). */
export function novaScatterDice(range: number): 1 | 2 | 3 {
  return approxLe(range, 45) ? 1 : approxLe(range, 60) ? 2 : 3;
}

/** Every active ship whose base the template could touch after the longest scatter: the enemy's first (T41). */
export function novaBraceShips(state: GameState, shooter: Ship, aim: Point, dice: number): Ship[] {
  const reach = NOVA_RADIUS + 6 * dice;
  const inReach = (s: Ship): boolean =>
    s.status === "active" && s.position !== null && approxLe(distance(aim, s.position), reach + baseRadius(s.profile.baseSize));
  const enemy = state.ships.filter((s) => s.owner !== shooter.owner && inReach(s));
  const own = state.ships.filter((s) => s.owner === shooter.owner && inReach(s));
  return [...enemy, ...own];
}

/** Ordnance touching the template centred at `centre`: a salvo's segment, or a wave's footprint (CAP included, T45). */
export function novaTouchesOrdnance(o: Ordnance, centre: Point): boolean {
  if (isSalvo(o)) {
    const half = headingVector(o.heading + 90);
    const w = o.width / 2;
    const a = { x: o.position.x - w * half.x, y: o.position.y - w * half.y };
    const b = { x: o.position.x + w * half.x, y: o.position.y + w * half.y };
    return segmentTouchesCircle(a, b, centre, NOVA_RADIUS);
  }
  return approxLe(distance(centre, o.position), NOVA_RADIUS + waveRadius(o));
}

export function fireNovaCannon(ctx: Ctx, t: FireNovaCannon): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const entry = state.turnState.ships[ship.id];
  if (entry === undefined) return; // unreachable after validation
  entry.weaponsFired.push(t.weaponId);
  const aim = { ...t.aim };
  const dice = novaScatterDice(novaRange(ship, aim));
  const source = { kind: "ship" as const, id: ship.id };
  for (const s of novaBraceShips(state, ship, aim, dice)) state.queue.push({ kind: "brace_offer", shipId: s.id, source });
  state.queue.push({ kind: "nova_cannon", shooterId: ship.id, weaponId: t.weaponId, aim, dice });
}

/** The `nova_cannon` work item: scatter, then what the template touches where it lands. */
export function novaCannon(ctx: Ctx, item: Extract<WorkItem, { kind: "nova_cannon" }>): void {
  const { state } = ctx;
  const shooter = getShip(state, item.shooterId);
  const origin = { ...(shooter.position ?? item.aim) };
  const rolls: number[] = [];

  // Scatter (T42, R29): 1–2 is a hit; otherwise 2D6 for one of 36 bearings, then the distance dice.
  const scatterDie = ctx.d6();
  rolls.push(scatterDie);
  let centre: Point = { ...item.aim };
  let scatter: "hit" | { bearing: number; distance: number } = "hit";
  if (scatterDie > 2) {
    const direction = ctx.nD6(2);
    const bearing = 60 * ((direction[0] as number) - 1) + 10 * ((direction[1] as number) - 1);
    const distanceRolls = ctx.nD6(item.dice);
    const moved = sum(distanceRolls);
    rolls.push(...direction, ...distanceRolls);
    const dir = headingVector(bearing);
    centre = { x: item.aim.x + moved * dir.x, y: item.aim.y + moved * dir.y };
    scatter = { bearing, distance: moved };
  }

  const ordnanceIds = state.ordnance.filter((o) => novaTouchesOrdnance(o, centre)).map((o) => o.id);
  const struck = state.ships.filter((s) => onTable(s) && templateTouchesShip(centre, s, NOVA_RADIUS));
  // The hole's D6 for every ship under it, before any damage (R27).
  const ships = struck.map((s) => {
    const hole = templateTouchesShip(centre, s, NOVA_HOLE_RADIUS);
    const hits = hole ? ctx.d6() : 1;
    if (hole) rolls.push(hits);
    return { shipId: s.id, hole, hits };
  });

  for (const id of ordnanceIds) {
    state.ordnance = state.ordnance.filter((o) => o.id !== id);
    ctx.log("ordnance_removed", { ordnanceId: id, reason: "nova_cannon" });
  }
  const onTheTable = centre.x >= 0 && centre.x <= state.table.width && centre.y >= 0 && centre.y <= state.table.height;
  const blastMarkerId = struck.length === 0 && ordnanceIds.length === 0 && onTheTable ? placeAt(ctx, centre, "nova_miss") : null;
  const range = novaRange(shooter, item.aim);
  ctx.log("nova_cannon", {
    shipId: shooter.id,
    weaponId: item.weaponId,
    aim: item.aim,
    range,
    dice: item.dice,
    rolls,
    scatter,
    centre,
    ships,
    ordnanceIds,
    blastMarkerId,
  });

  // Ship by ship, each one's catastrophic damage before the next (R28).
  enqueueFront(
    state,
    ships.map((s) => ({ kind: "nova_hit" as const, shooterId: shooter.id, shipId: s.shipId, hits: s.hits, origin })),
  );
}

/** The `nova_hit` work item: automatic hits, shieldable and braceable (§3). */
export function novaHit(ctx: Ctx, item: Extract<WorkItem, { kind: "nova_hit" }>): void {
  const ship = ctx.state.ships.find((s) => s.id === item.shipId);
  if (ship === undefined || !onTable(ship)) {
    ctx.log("skipped", { item: "nova_hit", shipId: item.shipId });
    return;
  }
  inflict(ctx, ship, item.hits, {
    source: { kind: "ship", id: item.shooterId },
    origin: item.origin,
    shieldable: true,
    braceable: true,
    cause: "nova_cannon",
  });
}
