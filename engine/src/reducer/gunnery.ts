/** Direct fire (reducer spec §4): the Gunnery Table, column shifts, lances and hits. */
import { BM_RADIUS, LONG_RANGE, SHORT_RANGE } from "../geometry/constants";
import { eligibleAt, squadronTarget, tookFire, volleyAspect } from "../geometry/targeting";
import { approxLe, distance, quadrantsOfPoint, segmentTouchesCircle } from "../geometry/basic";
import { armourFacing, bmsInContact, effectiveStrength, gunneryColumn, halveUp, isCrippled, isHulk, onTable, squadronOf, type GunneryColumn } from "../state/derived";
import type { GameState, Point, Quadrant, Ship, Weapon, WorkItem } from "../state/types";
import type { Ctx } from "./context";
import { inflict } from "./damage";
import { placeMinefieldBlastMarkers } from "./blast";
import { minefields } from "../rules/minefields";
import { nearestPoint } from "../geometry/rect";

/** Gunnery Table (p. 62): dice by firepower 1–20, columns A–E. */
const GUNNERY: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 0, 0], [2, 1, 1, 1, 0], [3, 2, 2, 1, 1], [4, 3, 2, 1, 1], [5, 4, 3, 2, 1],
  [5, 4, 3, 2, 1], [6, 5, 4, 2, 1], [7, 6, 4, 3, 2], [8, 6, 5, 3, 2], [9, 7, 5, 4, 2],
  [10, 8, 6, 4, 2], [11, 8, 6, 4, 2], [12, 9, 7, 5, 3], [13, 10, 7, 5, 3], [14, 11, 8, 5, 3],
  [14, 11, 8, 6, 3], [15, 12, 9, 6, 3], [16, 13, 9, 6, 4], [17, 13, 10, 7, 4], [18, 14, 10, 7, 4],
];

const COLUMNS: readonly GunneryColumn[] = ["A", "B", "C", "D", "E"];

/** Dice for a firepower on a column. Above 20: look up 20 and the remainder and add them. */
export function gunnery(firepower: number, column: GunneryColumn): number {
  if (firepower <= 0) return 0;
  const c = COLUMNS.indexOf(column);
  if (firepower > 20) return gunnery(20, column) + gunnery(firepower - 20, column);
  return GUNNERY[firepower]?.[c] ?? 0;
}

/** Net column shift (+ = right, fewer dice): range bands, Blast Markers (p. 62, p. 69) and a targeting matrix (T64). */
export function columnShift(state: GameState, shooter: Ship, at: Point, target: Ship | null): number {
  const from = shooter.position as Point;
  const d = distance(from, at);
  let shift = 0;
  if (approxLe(d, SHORT_RANGE)) shift -= 1;
  else if (!approxLe(d, LONG_RANGE) && shooter.profile.traits?.noLongRangeShift !== true) shift += 1; // the Idolator ignores it (p. 281)
  const lineThroughBm = state.blastMarkers.some((bm) => segmentTouchesCircle(from, at, bm.position, BM_RADIUS));
  const contact = bmsInContact(state, shooter).length > 0 || (target !== null && bmsInContact(state, target).length > 0);
  if (lineThroughBm || contact) shift += 1;
  if (shooter.profile.traits?.targetingMatrix === true) shift -= 1;
  return shift;
}

function shifted(base: GunneryColumn, shift: number): GunneryColumn {
  const i = Math.min(4, Math.max(0, COLUMNS.indexOf(base) + shift));
  return COLUMNS[i] ?? base;
}

type DirectFire = Extract<WorkItem, { kind: "direct_fire" }>;

/** Work item: resolve one weapon's shot, after any brace decision (§4.1–4.3). */
export function resolveDirectFire(ctx: Ctx, item: DirectFire): void {
  const { state } = ctx;
  const shooter = state.ships.find((s) => s.id === item.shooterId);
  const weapon = shooter?.profile.weapons.find((w) => w.id === item.weaponId);
  const targetShip = item.target.kind === "ship" ? state.ships.find((s) => s.id === item.target.id) : undefined;
  const targetSalvo = item.target.kind === "ordnance" ? state.ordnance.find((o) => o.id === item.target.id) : undefined;
  const targetField = item.target.kind === "minefield" ? minefields(state).find((f) => f.id === item.target.id) : undefined;
  const live = targetShip !== undefined ? onTable(targetShip) : targetSalvo !== undefined || targetField !== undefined;
  if (shooter === undefined || weapon === undefined || shooter.status !== "active" || !live) {
    ctx.log("skipped", { item: "direct_fire", shooterId: item.shooterId, targetId: item.target.id });
    return;
  }
  // By or at a squadron (§4.5): the volley's dice are pooled, and hits go to its members one at a time.
  const members = targetShip !== undefined ? squadronTarget(state, targetShip) : null;
  if (targetShip !== undefined && (members !== null || (item.withShips ?? []).length > 0)) {
    resolveVolley(ctx, item, shooter, weapon, members ?? [targetShip]);
    return;
  }
  const at =
    targetShip !== undefined
      ? (targetShip.position as Point)
      : targetField !== undefined
        ? nearestPoint(targetField.rect, shooter.position as Point)
        : (targetSalvo?.position as Point);
  const lockOn = shooter.specialOrder?.kind === "lock_on";
  const source = { kind: "ship" as const, id: shooter.id };

  // A combined volley's batteries add their effective firepower (T32); older saves have no combineWith.
  const combined = (item.combineWith ?? []).map((id) => shooter.profile.weapons.find((w) => w.id === id)).filter((w) => w !== undefined);
  const firepower = [weapon, ...combined].reduce((n, w) => n + effectiveStrength(shooter, w), 0);
  const { hits, need, rolls, rerolls, column, shift } = rollToHit(ctx, shooter, weapon, firepower, at, targetShip ?? null, item.aspect, lockOn);
  ctx.log("attack", {
    source,
    targetId: item.target.id,
    weapon: weapon.kind,
    ...(combined.length > 0 ? { weaponIds: [weapon.id, ...combined.map((w) => w.id)], firepower } : {}),
    ...(column !== null ? { column, shifts: shift } : {}),
    need,
    rolls,
    rerolls,
    hits,
  });

  if (targetField !== undefined) {
    // Each hit on a minefield places a Blast Marker at its edge facing the shooter (state N119, reducer §5.4).
    if (hits > 0) {
      const blastMarkerIds = placeMinefieldBlastMarkers(ctx, targetField, hits, shooter.position as Point);
      ctx.log("minefield_hit", { minefieldId: targetField.id, hits, blastMarkerIds });
    }
    return;
  }
  if (targetSalvo !== undefined) {
    if (hits > 0) {
      state.ordnance = state.ordnance.filter((o) => o.id !== targetSalvo.id);
      ctx.log("ordnance_removed", { ordnanceId: targetSalvo.id, reason: "shot" });
    }
    return;
  }
  if (targetShip !== undefined) {
    inflict(ctx, targetShip, hits, {
      source,
      origin: { ...(shooter.position as Point) },
      shieldable: true,
      braceable: true,
      cause: weapon.kind,
    });
  }
}

function rollToHit(
  ctx: Ctx,
  shooter: Ship,
  weapon: Weapon,
  strength: number,
  at: Point,
  target: Ship | null,
  aspect: Quadrant | null,
  lockOn: boolean,
): { hits: number; need: number; rolls: number[]; rerolls: number[]; column: GunneryColumn | null; shift: number } {
  let dice: number;
  let need: number;
  let column: GunneryColumn | null = null;
  let shift = 0;
  if (weapon.kind === "lance") {
    dice = strength;
    need = target === null ? 6 : 4; // armour ignored; 6s against ordnance (p. 60, p. 75)
  } else {
    shift = columnShift(ctx.state, shooter, at, target);
    column = shifted(target === null ? "E" : gunneryColumn(target, aspect ?? "front"), shift);
    dice = gunnery(strength, column);
    need = target === null ? 6 : target.profile.armour[aspect ?? "front"];
  }
  const rolls = ctx.nD6(dice);
  let hits = rolls.filter((r) => r >= need).length;
  let rerolls: number[] = [];
  if (lockOn) {
    rerolls = ctx.nD6(dice - hits); // Lock On: re-roll the misses, straight after (p. 63)
    hits += rerolls.filter((r) => r >= need).length;
  }
  return { hits, need, rolls, rerolls, column, shift };
}


// --- By and at squadrons (reducer §4.5, T83–T88, R34–R38)

/** The quadrant a ship shows from a point: on a boundary, the one on the leftmost column (V16). */
function easiest(ship: Ship, from: Point): Quadrant {
  const qs = quadrantsOfPoint(ship.position as Point, ship.heading as number, from);
  return [...qs].sort((a, b) => COLUMNS.indexOf(gunneryColumn(ship, a)) - COLUMNS.indexOf(gunneryColumn(ship, b)))[0] ?? "front";
}

const HALVING_ORDERS = ["all_ahead_full", "come_to_new_heading", "burn_retros", "brace_for_impact"];

/** A ship's strength without the halving for orders: an escort squadron halves its total instead (p. 99, T88). */
function strengthForSquadron(ship: Ship, weapon: Weapon, escortSquadron: boolean): number {
  if (!escortSquadron) return effectiveStrength(ship, weapon);
  return isCrippled(ship) ? halveUp(weapon.strength) : weapon.strength;
}

/** One volley by and/or at a squadron: columns per firing ship, armour and nearness from the lead, hits one at a time. */
function resolveVolley(ctx: Ctx, item: DirectFire, lead: Ship, weapon: Weapon, members: Ship[]): void {
  const { state } = ctx;
  const source = { kind: "ship" as const, id: lead.id };
  const from = lead.position as Point;
  const volley: { ship: Ship; weapon: Weapon }[] = [
    { ship: lead, weapon },
    ...(item.combineWith ?? []).flatMap((id) => lead.profile.weapons.filter((w) => w.id === id).map((w) => ({ ship: lead, weapon: w }))),
    ...(item.withShips ?? []).flatMap((e) => {
      const mate = state.ships.find((s) => s.id === e.shipId);
      if (mate === undefined || mate.status !== "active") return [];
      return e.weaponIds.flatMap((id) => mate.profile.weapons.filter((w) => w.id === id).map((w) => ({ ship: mate, weapon: w })));
    }),
  ];
  const live = members.filter((m) => onTable(m) && m.position !== null);
  const engaged = tookFire(state, volley, live);
  const squadron = members.length > 1 || squadronTarget(state, members[0] as Ship) !== null;
  const aspect = squadron ? volleyAspect(lead, engaged, item.targetAspect) : null;
  const eligible = aspect !== null ? eligibleAt(lead, engaged, aspect) : engaged;
  const shooterSq = squadronOf(state, lead);
  const escortSquadron = shooterSq?.type === "escort" && (item.withShips ?? []).length > 0;
  const halving = escortSquadron && HALVING_ORDERS.includes(lead.specialOrder?.kind ?? "");
  const lockOn = lead.specialOrder?.kind === "lock_on";
  const facing = (m: Ship): number => armourFacing(m, from).armour;
  const near = (a: Ship, b: Ship) => distance(from, a.position as Point) - distance(from, b.position as Point) || members.indexOf(a) - members.indexOf(b);

  let rolls: number[] = [];
  let rerolls: number[] = [];
  let need = 4;
  const columns: { column: GunneryColumn; firepower: number; dice: number }[] = [];
  if (weapon.kind === "lance") {
    let str = volley.reduce((n, v) => n + strengthForSquadron(v.ship, v.weapon, escortSquadron), 0);
    if (halving) str = halveUp(str);
    rolls = ctx.nD6(str);
  } else {
    // Each firing ship's batteries on its own column: its range and Blast Markers to the eligible member nearest it (R35).
    for (const ship of [...new Set(volley.map((v) => v.ship))]) {
      const fp = volley.filter((v) => v.ship === ship).reduce((n, v) => n + strengthForSquadron(ship, v.weapon, escortSquadron), 0);
      const pos = ship.position as Point;
      const nearest = [...eligible].sort((a, b) => distance(pos, a.position as Point) - distance(pos, b.position as Point))[0];
      if (nearest === undefined) continue;
      // At a squadron, every ship fires at the chosen aspect (T85); at a single ship, each at the aspect it sees (p. 99).
      const seen = ship === lead && item.aspect !== null ? item.aspect : easiest(nearest, pos);
      const quadrant: Quadrant = aspect === null ? seen : aspect === "closing" ? "front" : aspect === "moving_away" ? "rear" : "left";
      const column = shifted(gunneryColumn(nearest, quadrant), columnShift(state, ship, nearest.position as Point, nearest));
      const group = columns.find((c) => c.column === column);
      if (group === undefined) columns.push({ column, firepower: fp, dice: 0 });
      else group.firepower += fp;
    }
    for (const c of columns) c.dice = gunnery(halving ? halveUp(c.firepower) : c.firepower, c.column); // halved per column (R36)
    need = Math.min(7, ...eligible.map(facing));
    rolls = ctx.nD6(columns.reduce((n, c) => n + c.dice, 0));
  }
  let hitting = rolls.filter((r) => r >= need);
  if (lockOn) {
    rerolls = ctx.nD6(rolls.length - hitting.length); // Lock On: re-roll the misses (p. 63)
    hitting = [...hitting, ...rerolls.filter((r) => r >= need)];
  }
  // Allocation (T87, R37): batteries lowest roll first, each to the nearest eligible member it can hurt; lances nearest first.
  const order = weapon.kind === "lance" ? hitting : [...hitting].sort((a, b) => a - b);
  const allocation: { roll: number; shipId: string | null }[] = [];
  ctx.log("attack", {
    source,
    targetId: item.target.id,
    weapon: weapon.kind,
    shooterIds: [...new Set(volley.map((v) => v.ship.id))],
    ...(volley.length > 1 ? { weaponIds: volley.map((v) => v.weapon.id) } : {}),
    ...(weapon.kind === "battery" ? { columns } : {}),
    ...(squadron ? { targetIds: eligible.map((m) => m.id), targetAspect: aspect } : {}),
    need,
    rolls,
    rerolls,
    hits: hitting.length,
  });
  for (const roll of order) {
    const candidates = eligible.filter((m) => m.status === "active" && (weapon.kind === "lance" || facing(m) <= roll)).sort(near);
    const hulks = eligible.filter((m) => isHulk(m)).sort(near); // a lone target that's a hulk still takes its hits (§7.3)
    const target = candidates[0] ?? (squadron ? undefined : hulks[0]);
    allocation.push({ roll, shipId: target?.id ?? null });
    if (target === undefined) continue; // lost (R38)
    inflict(ctx, target, 1, { source, origin: { ...from }, shieldable: true, braceable: true, cause: weapon.kind });
  }
  if (allocation.length > 0) ctx.log("allocation", { source, allocation });
}
