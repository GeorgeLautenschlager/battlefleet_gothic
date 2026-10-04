/**
 * The damage pipeline (reducer spec §3), criticals (§6) and catastrophic damage (§7).
 *
 * inflict never pauses for a decision: anything that might need one (an
 * explosion's hits) is enqueued at the front of the work queue.
 */
import { approxLe, distance } from "../geometry/basic";
import { isBraced, isHulk, onTable, shieldCapacity } from "../state/derived";
import type { AttackSource, CriticalKind, Point, Ship } from "../state/types";
import { sum, type Ctx } from "./context";
import { placeAtStem, placeCluster, placeShieldBlastMarkers } from "./blast";
import { enqueueFront } from "./queue";

export type DamageSource = {
  source: AttackSource;
  /** Where the attack comes from: places shield Blast Markers in the line of fire. */
  origin: Point;
  shieldable: boolean;
  braceable: boolean;
  /** For the log: "battery", "lance", "torpedo", "ram", "explosion"… */
  cause: string;
};

/** Every way of hurting a ship ends here (§3). */
export function inflict(ctx: Ctx, target: Ship, hits: number, src: DamageSource): void {
  if (hits <= 0 || !onTable(target)) return;
  if (isHulk(target)) {
    hulkHit(ctx, target, src);
    return;
  }
  let remaining = hits;
  if (src.shieldable) {
    const absorbed = Math.min(remaining, shieldCapacity(ctx.state, target));
    if (absorbed > 0) {
      const blastMarkerIds = placeShieldBlastMarkers(ctx, target, absorbed, src.origin);
      ctx.log("shields", { shipId: target.id, absorbed, blastMarkerIds });
      remaining -= absorbed;
    }
  }
  if (remaining > 0 && src.braceable && isBraced(target)) {
    const rolls = ctx.nD6(remaining);
    const saved = rolls.filter((r) => r >= 4).length; // 4+ save (p. 66)
    ctx.log("brace_saves", { shipId: target.id, rolls, saved });
    remaining -= saved;
  }
  for (let i = 0; i < remaining; i++) {
    if (target.damage >= target.profile.hits) break; // overkill is discarded (R2)
    damagePoint(ctx, target, true, src.cause);
  }
  if (target.damage >= target.profile.hits && target.status === "active") catastrophic(ctx, target);
}

/** One point of damage, with a critical check unless it's damage caused by a critical (p. 66). */
export function damagePoint(ctx: Ctx, ship: Ship, critCheck: boolean, cause: string): void {
  ship.damage += 1;
  ctx.log("damage", { shipId: ship.id, cause, damageAfter: ship.damage });
  if (critCheck && ship.damage < ship.profile.hits && ctx.d6() === 6) critical(ctx, ship);
}

// --- Criticals (§6)

const CRITICALS: Record<number, { kind: CriticalKind | "hull_breach" | "bulkhead_collapse"; applies: (s: Ship) => boolean }> = {
  2: { kind: "dorsal_armament", applies: (s) => hasWeaponAt(s, "dorsal") },
  3: { kind: "starboard_armament", applies: (s) => hasWeaponAt(s, "starboard") },
  4: { kind: "port_armament", applies: (s) => hasWeaponAt(s, "port") },
  5: { kind: "prow_armament", applies: (s) => hasWeaponAt(s, "prow") },
  6: { kind: "engine_room", applies: () => true },
  7: { kind: "fire", applies: () => true },
  8: { kind: "thrusters", applies: () => true },
  9: { kind: "bridge_smashed", applies: (s) => !s.criticals.some((c) => c.kind === "bridge_smashed") },
  10: {
    kind: "shields_collapse",
    applies: (s) => s.profile.shields > 0 && !s.criticals.some((c) => c.kind === "shields_collapse"),
  },
  11: { kind: "hull_breach", applies: () => true },
  12: { kind: "bulkhead_collapse", applies: () => true },
};

function hasWeaponAt(ship: Ship, location: string): boolean {
  return ship.profile.weapons.some((w) => w.location === location);
}

export function critical(ctx: Ctx, ship: Ship): void {
  const rolls = ctx.nD6(2);
  const rolled = sum(rolls);
  let applied = rolled;
  while (!(CRITICALS[applied]?.applies(ship) ?? true)) applied += 1; // "next highest" (p. 67)
  const kind = CRITICALS[applied]?.kind ?? "bulkhead_collapse"; // 12 always applies

  let extra = 0;
  let extraRolls: number[] = [];
  if (kind === "hull_breach") {
    const roll = ctx.d6();
    extraRolls = [roll];
    extra = Math.ceil(roll / 2); // D3
  } else if (kind === "bulkhead_collapse") {
    const roll = ctx.d6();
    extraRolls = [roll];
    extra = roll;
  } else {
    ship.criticals.push({ id: ctx.newId("crit"), kind, playerTurn: ctx.state.clock.playerTurn });
    if (kind === "engine_room" || kind === "thrusters") extra = 1;
  }
  ctx.log("critical", { shipId: ship.id, rolls, rolled, applied, kind, extraRolls });

  for (let i = 0; i < extra; i++) {
    if (ship.damage >= ship.profile.hits) break;
    damagePoint(ctx, ship, false, "critical");
  }
}

// --- Catastrophic damage (§7)

/** An active ship has just reached 0 hits. */
export function catastrophic(ctx: Ctx, ship: Ship): void {
  const rolls = ctx.nD6(2);
  const result = sum(rolls);
  resolveCatastrophic(ctx, ship, rolls, result, true);
}

function resolveCatastrophic(ctx: Ctx, ship: Ship, rolls: number[], result: number, placeHulkMarker: boolean): void {
  if (result <= 8) {
    ship.status = result <= 6 ? "drifting_hulk" : "blazing_hulk";
    ship.specialOrder = null;
    const blastMarkerIds = placeHulkMarker ? [placeAtStem(ctx, ship)] : [];
    ctx.log("catastrophic", { shipId: ship.id, rolls, result, outcome: ship.status, blastMarkerIds });
    return;
  }
  const hits = ship.profile.hits;
  const strength = result === 12 ? hits : Math.ceil(hits / 2);
  explode(ctx, ship, rolls, result, strength);
}

/** Plasma Drive Overload (9–11) or Warp Drive Implosion (12): lance shots at every ship in range (§7.2). */
function explode(ctx: Ctx, ship: Ship, rolls: number[], result: number, strength: number): void {
  const radiusRolls = ctx.nD6(3);
  const radius = sum(radiusRolls);
  const centre = ship.position as Point;
  ship.status = "destroyed";
  ship.position = null;
  ship.heading = null;
  ship.specialOrder = null;
  const blastMarkerIds = placeCluster(ctx, centre, strength);
  ctx.log("catastrophic", {
    shipId: ship.id,
    rolls,
    result,
    outcome: result === 12 ? "warp_drive_implosion" : "plasma_drive_overload",
    blastMarkerIds,
    radiusRolls,
    radius,
  });

  const source: AttackSource = { kind: "explosion", id: ship.id };
  const targets = ctx.state.ships.filter((s) => onTable(s) && s.position !== null && approxLe(distance(s.position, centre), radius)); // R9, V2
  enqueueFront(
    ctx.state,
    targets.flatMap((t) => [
      { kind: "brace_offer" as const, shipId: t.id, source },
      { kind: "explosion_hit" as const, shipId: ship.id, centre: { ...centre }, strength, targetId: t.id },
    ]),
  );
}

/** Hits on a hulk: no damage, but one catastrophic re-roll per source per player turn (§7.3, R3, R4). */
function hulkHit(ctx: Ctx, hulk: Ship, src: DamageSource): void {
  const rolled = ctx.state.turnState.hulkRolls;
  if (rolled.some((r) => r.hulkId === hulk.id && r.source.kind === src.source.kind && r.source.id === src.source.id)) return;
  rolled.push({ hulkId: hulk.id, source: { ...src.source } });
  const rolls = ctx.nD6(2);
  resolveCatastrophic(ctx, hulk, rolls, sum(rolls), false);
}

/** Work item: one explosion's lance shots at one ship (§7.2). */
export function explosionHit(ctx: Ctx, explodingId: string, centre: Point, strength: number, targetId: string): void {
  const target = ctx.state.ships.find((s) => s.id === targetId);
  if (target === undefined || !onTable(target)) {
    ctx.log("skipped", { item: "explosion_hit", targetId });
    return;
  }
  const rolls = ctx.nD6(strength);
  const hits = rolls.filter((r) => r >= 4).length;
  ctx.log("attack", { source: { kind: "explosion", id: explodingId }, targetId, weapon: "explosion", need: 4, rolls, rerolls: [], hits });
  inflict(ctx, target, hits, {
    source: { kind: "explosion", id: explodingId },
    origin: centre,
    shieldable: true,
    braceable: true,
    cause: "explosion",
  });
}

/** Work item: a ship's fires burn in its owner's End Phase (§10.2, state N6). */
export function fireDamage(ctx: Ctx, shipId: string): void {
  const ship = ctx.state.ships.find((s) => s.id === shipId);
  if (ship === undefined || ship.status !== "active") {
    ctx.log("skipped", { item: "fire_damage", shipId });
    return;
  }
  const fires = ship.criticals.filter((c) => c.kind === "fire").length;
  ctx.log("fire_damage", { shipId, fires });
  for (let i = 0; i < fires; i++) {
    if (ship.damage >= ship.profile.hits) break;
    damagePoint(ctx, ship, false, "fire");
  }
  if (ship.damage >= ship.profile.hits) catastrophic(ctx, ship);
}
