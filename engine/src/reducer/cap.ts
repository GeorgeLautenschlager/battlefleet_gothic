/** Combat Air Patrol bookkeeping (reducer spec §7.5, §8.2): CAP rides with its ship, and is released when the ship goes. */
import type { GameState, Ship } from "../state/types";
import type { Ctx } from "./context";

/** Move the ship's CAP fighters to its stem (R21). */
export function syncCap(state: GameState, ship: Ship): void {
  if (ship.position === null) return;
  for (const o of state.ordnance) {
    if (o.kind === "attack_craft" && o.cap === ship.id) o.position = { ...ship.position };
  }
}

/** The ship stops being active: its CAP fighters stay where it was, as ordinary fighters (T30). */
export function releaseCap(ctx: Ctx, ship: Ship): void {
  const ids: string[] = [];
  for (const o of ctx.state.ordnance) {
    if (o.kind === "attack_craft" && o.cap === ship.id) {
      o.cap = null;
      ids.push(o.id);
    }
  }
  if (ids.length > 0) ctx.log("cap_released", { shipId: ship.id, ordnanceIds: ids, reason: "ship_lost" });
}
