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
import { leaveGrapple } from "./grapple";
import { releaseCap } from "./cap";

export type DamageSource = {
  source: AttackSource;
  /** Where the attack comes from: places shield Blast Markers in the line of fire. */
  origin: Point;
  shieldable: boolean;
  braceable: boolean;
  /** For the log: "battery", "lance", "torpedo", "ram", "explosion"… */
  cause: string;
  /** false: shield hits place no Blast Markers (a minefield's, reducer R67). Default true. */
  markers?: boolean;
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
      const blastMarkerIds = src.markers === false ? [] : placeShieldBlastMarkers(ctx, target, absorbed, src.origin);
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
    if (target.damage >= target.profile.hits || target.status !== "active") break; // overkill is discarded (R2)
    damagePoint(ctx, target, true, src.cause);
  }
  if (target.damage >= target.profile.hits && target.status === "active") catastrophic(ctx, target);
}

/** One point of damage, with a critical check unless it's damage caused by a critical (p. 66). */
export function damagePoint(ctx: Ctx, ship: Ship, critCheck: boolean, cause: string): void {
  ship.damage += 1;
  ctx.log("damage", { shipId: ship.id, cause, damageAfter: ship.damage });
  if (lostLikeAnEscort(ship)) {
    // An escort is lost at 0 hits or on any critical (state N34): no Critical Hits table, no hulk.
    if (ship.damage >= ship.profile.hits || (critCheck && ctx.d6() === 6)) escortLost(ctx, ship, cause === "boarding" ? "boarding" : ship.damage >= ship.profile.hits ? "damage" : "critical");
    return;
  }
  if (critCheck && ship.damage < ship.profile.hits && ctx.d6() === 6) critical(ctx, ship);
}

/** Escorts, and Defence/1 platforms (state N97, reducer R58): lost at 0 hits or on any critical. */
export const lostLikeAnEscort = (ship: Ship): boolean => ship.profile.type === "escort" || (ship.profile.type === "defence" && ship.profile.hits === 1);

/** An escort reduced to 0 hits, or suffering a critical (state N34, reducer R33): destroyed, leaving a BM at its stem. */
export function escortLost(ctx: Ctx, ship: Ship, cause: "damage" | "critical" | "hit_and_run" | "boarding" | "fire_ship"): void {
  if (ship.status !== "active") return;
  const blastMarkerId = placeAtStem(ctx, ship, "escort_lost");
  releaseCap(ctx, ship);
  leaveGrapple(ctx, ship);
  ship.damage = ship.profile.hits;
  ship.status = "destroyed";
  ship.position = null;
  ship.heading = null;
  ship.specialOrder = null;
  ctx.log("escort_lost", { shipId: ship.id, cause, blastMarkerId });
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

/** The Defences Critical Hits table (p. 101, state N98). */
const DEFENCE_CRITICALS: Record<number, { kind: CriticalKind | "hull_breach" | "bulkhead_collapse"; applies: (s: Ship) => boolean }> = {
  2: { kind: "lances_damaged", applies: (s) => hasWeaponKind(s, "lance") },
  3: { kind: "lances_damaged", applies: (s) => hasWeaponKind(s, "lance") },
  4: { kind: "main_armament_damaged", applies: (s) => hasWeaponKind(s, "battery") },
  5: { kind: "ordnance_bays_hit", applies: (s) => hasWeaponKind(s, "torpedoes") || hasWeaponKind(s, "launch_bay") },
  6: { kind: "reactors_damaged", applies: () => true },
  7: { kind: "fire", applies: () => true },
  8: { kind: "orbit_lost", applies: () => true },
  9: { kind: "orbit_lost", applies: () => true },
  10: {
    kind: "shields_collapse",
    applies: (s) => s.profile.shields > 0 && !s.criticals.some((c) => c.kind === "shields_collapse"),
  },
  11: { kind: "hull_breach", applies: () => true },
  12: { kind: "bulkhead_collapse", applies: () => true },
};

const hasWeaponKind = (ship: Ship, kind: string): boolean => ship.profile.weapons.some((w) => w.kind === kind);

function hasWeaponAt(ship: Ship, location: string): boolean {
  return ship.profile.weapons.some((w) => w.location === location);
}

export function critical(ctx: Ctx, ship: Ship): void {
  if (lostLikeAnEscort(ship)) {
    escortLost(ctx, ship, "critical"); // no table to roll on (state N34)
    return;
  }
  const rolls = ctx.nD6(2);
  applyCritical(ctx, ship, sum(rolls), rolls);
}

/** A result on the Critical Hits table: 2D6, or a Hit-and-Run's single D6 read as the total (§6, §10.5). */
export function applyCritical(ctx: Ctx, ship: Ship, rolled: number, rolls: number[]): void {
  if (lostLikeAnEscort(ship)) {
    escortLost(ctx, ship, "critical"); // any critical destroys an escort (p. 67) or a Defence/1 (state N97)
    return;
  }
  // Stationary defences roll on the Defences Critical Hits table (p. 101, state N98, reducer R57).
  const table = ship.profile.type === "defence" ? DEFENCE_CRITICALS : CRITICALS;
  let applied = rolled;
  while (!(table[applied]?.applies(ship) ?? true)) applied += 1; // "next highest" (p. 67)
  const kind = table[applied]?.kind ?? "bulkhead_collapse"; // 12 always applies

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
    if (kind === "engine_room" || kind === "thrusters" || kind === "reactors_damaged" || kind === "orbit_lost") extra = 1;
  }
  ctx.log("critical", { shipId: ship.id, rolls, rolled, applied, kind, extraRolls });
  // A commander on a smashed bridge loses the re-rolls left (fleets book, p. 11; R30).
  if (kind === "bridge_smashed" && ship.commander !== undefined && ship.commander !== null && ship.commander.rerolls > 0) {
    ship.commander.rerolls = 0;
    ctx.log("rerolls_lost", { shipId: ship.id, reason: "bridge_smashed" });
  }

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
    leaveGrapple(ctx, ship);
    releaseCap(ctx, ship);
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
  leaveGrapple(ctx, ship);
  releaseCap(ctx, ship);
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

/** A blazing hulk re-rolls on the Catastrophic Damage table after its drift (§8.4): no extra BM (R4). */
export function rerollHulk(ctx: Ctx, hulk: Ship): void {
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
