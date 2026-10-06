/** Direct fire (reducer spec §4): the Gunnery Table, column shifts, lances and hits. */
import { BM_RADIUS, LONG_RANGE, SHORT_RANGE } from "../geometry/constants";
import { approxLe, distance, segmentTouchesCircle } from "../geometry/basic";
import { bmsInContact, effectiveStrength, gunneryColumn, onTable, type GunneryColumn } from "../state/derived";
import type { GameState, Point, Quadrant, Ship, Weapon, WorkItem } from "../state/types";
import type { Ctx } from "./context";
import { inflict } from "./damage";

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
  else if (!approxLe(d, LONG_RANGE)) shift += 1;
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
  const live = targetShip !== undefined ? onTable(targetShip) : targetSalvo !== undefined;
  if (shooter === undefined || weapon === undefined || shooter.status !== "active" || !live) {
    ctx.log("skipped", { item: "direct_fire", shooterId: item.shooterId, targetId: item.target.id });
    return;
  }
  const at = targetShip !== undefined ? (targetShip.position as Point) : (targetSalvo?.position as Point);
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

