/** Blast Marker placement (reducer spec §5). */
import { asinDeg } from "../math/dmath";
import { BM_RADIUS, EPS } from "../geometry/constants";
import { baseRadius, distance, headingVector, tableBearing } from "../geometry/basic";
import type { BlastMarker, Minefield, Point, Ship } from "../state/types";
import { edgePoint, outwardNormal } from "../geometry/rect";
import type { Ctx } from "./context";

/** Two BMs overlap if their centres are closer than 2·BM_RADIUS − EPS. */
function overlapsAny(markers: readonly BlastMarker[], p: Point): boolean {
  return markers.some((bm) => distance(bm.position, p) < 2 * BM_RADIUS - EPS);
}

function at(centre: Point, bearing: number, radius: number): Point {
  const dir = headingVector(bearing);
  return { x: centre.x + radius * dir.x, y: centre.y + radius * dir.y };
}

function add(ctx: Ctx, position: Point, cause: BlastMarker["cause"]): string {
  const id = ctx.newId("bm");
  ctx.state.blastMarkers.push({ id, position, placed: ctx.state.clock.playerTurn, cause });
  return id;
}

/**
 * Slots on the ring touching a base, starting at `theta0` and fanning out
 * alternately: θ0, θ0+δ, θ0−δ, θ0+2δ, … while |kδ| ≤ 180° (§5.1).
 */
function ringSlots(stem: Point, ship: Ship, theta0: number): Point[] {
  const rho = baseRadius(ship.profile.baseSize) + BM_RADIUS;
  const delta = 2 * asinDeg(BM_RADIUS / rho);
  const slots = [at(stem, theta0, rho)];
  for (let k = 1; k * delta <= 180 + EPS; k++) {
    slots.push(at(stem, theta0 + k * delta, rho), at(stem, theta0 - k * delta, rho));
  }
  return slots;
}

/** First free slot from `slots`, or the first slot itself (stacked) if none is free. */
function placeInSlots(ctx: Ctx, slots: readonly Point[], cause: BlastMarker["cause"]): string {
  const free = slots.find((p) => !overlapsAny(ctx.state.blastMarkers, p));
  return add(ctx, free ?? (slots[0] as Point), cause);
}

/** One BM per shield hit, fanned around the target from the line of fire (§5.1). */
export function placeShieldBlastMarkers(ctx: Ctx, target: Ship, n: number, origin: Point): string[] {
  const stem = target.position as Point;
  const theta0 = distance(stem, origin) < EPS ? 0 : tableBearing(stem, origin);
  const slots = ringSlots(stem, target, theta0);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(placeInSlots(ctx, slots, "shield_hit"));
  return ids;
}

/** An explosion's cluster: one at the centre, then rings outward, clockwise from 0° (§5.2). */
export function placeCluster(ctx: Ctx, centre: Point, n: number): string[] {
  const ids: string[] = [];
  if (n <= 0) return ids;
  ids.push(add(ctx, { ...centre }, "explosion"));
  for (let k = 1; ids.length < n; k++) {
    const radius = 2 * k * BM_RADIUS;
    const delta = 2 * asinDeg(1 / (2 * k));
    for (let j = 0; j * delta < 360 - EPS && ids.length < n; j++) {
      const p = at(centre, j * delta, radius);
      if (!overlapsAny(ctx.state.blastMarkers, p)) ids.push(add(ctx, p, "explosion"));
    }
  }
  return ids;
}

/** A new hulk's single BM, on its stem (§5.3); or a lost escort's (state N34). */
export function placeAtStem(ctx: Ctx, ship: Ship, cause: BlastMarker["cause"] = "hulk"): string {
  return add(ctx, { ...(ship.position as Point) }, cause);
}

/** A drifting hulk's BM, trailing it (§5.3). */
export function placeTrailing(ctx: Ctx, hulk: Ship): string {
  const stem = hulk.position as Point;
  return placeInSlots(ctx, ringSlots(stem, hulk, (hulk.heading ?? 0) + 180), "hulk");
}

/** Hits on a minefield: BMs touching its edge where it faces the shooter, fanned along that side (§5.4). */
export function placeMinefieldBlastMarkers(ctx: Ctx, field: Minefield, n: number, from: Point): string[] {
  const p0 = edgePoint(field.rect, from);
  const out = outwardNormal(field.rect, p0, from);
  const along = { x: out.y, y: -out.x }; // the normal turned 90° clockwise
  const slots: Point[] = [];
  for (let k = 0; k <= 20; k++) {
    for (const sign of k === 0 ? [0] : [1, -1]) {
      const s = sign * k * 2 * BM_RADIUS;
      slots.push({ x: p0.x + out.x * BM_RADIUS + along.x * s, y: p0.y + out.y * BM_RADIUS + along.y * s });
    }
  }
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(placeInSlots(ctx, slots, "minefield"));
  return ids;
}

/** A single BM exactly where it's put: a nova cannon shell that touched nothing (§5.3). */
export function placeAt(ctx: Ctx, position: Point, cause: BlastMarker["cause"]): string {
  return add(ctx, { ...position }, cause);
}
