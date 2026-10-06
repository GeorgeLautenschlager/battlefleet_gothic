/**
 * Work items (reducer spec §11): everything still to resolve lives in
 * state.queue and runs front first. Follow-ups are inserted at the front.
 */
import { getShip } from "../state/derived";
import type { AttackSource, GameState, Ship, WorkItem } from "../state/types";
import type { Ctx } from "./context";
import { explosionHit, fireDamage } from "./damage";
import { resolveDirectFire } from "./gunnery";
import { continueMove, hulkDrift, ram, zeroShieldBm } from "./movement";
import { ordnanceMove, torpedoAttack, torpedoHit } from "./torpedoes";
import { boardingCritical, boardingFight, teleportAttack } from "./boarding";
import { craftAttack, craftMeetsShip, hitAndRun } from "./craft";
import { novaCannon, novaHit } from "./nova";

export { enqueueFront } from "./queue";

const sameSource = (a: AttackSource, b: AttackSource): boolean => a.kind === b.kind && a.id === b.id;

/** Transform spec §2.6: active, not already braced, and no failed brace against this source. */
export function canBrace(state: GameState, ship: Ship, source: AttackSource): boolean {
  return (
    ship.status === "active" &&
    ship.specialOrder?.kind !== "brace_for_impact" &&
    !state.turnState.braceFailures.some((f) => f.shipId === ship.id && sameSource(f.source, source))
  );
}

export function runWorkItem(ctx: Ctx, item: WorkItem): void {
  switch (item.kind) {
    case "brace_offer": {
      const ship = ctx.state.ships.find((s) => s.id === item.shipId);
      if (ship === undefined || !canBrace(ctx.state, ship, item.source)) return;
      const id = ctx.newId("pend");
      ctx.state.pending.push({ id, kind: "brace", player: ship.owner, shipId: ship.id, source: item.source });
      ctx.log("brace_offer", { pendingId: id, shipId: ship.id, source: item.source });
      return;
    }
    case "direct_fire":
      return resolveDirectFire(ctx, item);
    case "explosion_hit":
      return explosionHit(ctx, item.shipId, item.centre, item.strength, item.targetId);
    case "fire_damage":
      return fireDamage(ctx, item.shipId);
    case "continue_move":
      return continueMove(ctx);
    case "ram":
      return ram(ctx, item.rammerId, item.targetId);
    case "zero_shield_bm":
      return zeroShieldBm(ctx, item.shipId);
    case "hulk_drift":
      return hulkDrift(ctx, item.shipId, item.distance, item.travelled);
    case "ordnance_move":
      return ordnanceMove(ctx, item.ordnanceId, item.travelled, item.bmTested);
    case "torpedo_attack":
      return torpedoAttack(ctx, item.ordnanceId, item.targetId, item.bmTested);
    case "torpedo_hit":
      return torpedoHit(ctx, item.ordnanceId, item.targetId);
    case "boarding_fight":
      return boardingFight(ctx, item.defenderId, item.attackerIds);
    case "boarding_critical":
      return boardingCritical(ctx, item.shipId, item.need);
    case "teleport_attack":
      return teleportAttack(ctx, item.shipId, item.targetId);
    case "craft_meets_ship":
      return craftMeetsShip(ctx, item.ordnanceId, item.targetId, item.bmTested);
    case "craft_attack":
      return craftAttack(ctx, item.ordnanceId, item.targetId);
    case "hit_and_run":
      return hitAndRun(ctx, item.ordnanceId, item.targetId);
    case "nova_cannon":
      return novaCannon(ctx, item);
    case "nova_hit":
      return novaHit(ctx, item);
  }
}

export { getShip };
