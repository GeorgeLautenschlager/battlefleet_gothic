/** End Phase: repair (reducer §10.1) and remove_blast_markers (§10.3). */
import { bmsInContact, getShip, remainingHits } from "../../state/derived";
import type { RemoveBlastMarkers, Repair } from "../../transforms/types";
import type { Ctx } from "../context";

export function repair(ctx: Ctx, t: Repair): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  let dice = remainingHits(ship);
  if (bmsInContact(state, ship).length > 0) dice = Math.ceil(dice / 2); // p. 88
  const rolls = ctx.nD6(dice);
  const sixes = rolls.filter((r) => r === 6).length;
  const repaired = t.priority.slice(0, sixes);
  ship.criticals = ship.criticals.filter((c) => !repaired.includes(c.id));
  const entry = state.turnState.ships[ship.id];
  if (entry !== undefined) entry.repaired = true;
  ctx.log("repair", { shipId: ship.id, rolls, repaired });
}

export function removeBlastMarkers(ctx: Ctx, t: RemoveBlastMarkers): void {
  const { state } = ctx;
  const roll = ctx.d6();
  const removed = t.priority.slice(0, roll);
  state.blastMarkers = state.blastMarkers.filter((bm) => !removed.includes(bm.id));
  state.turnState.blastMarkersRemoved = true;
  ctx.log("bm_removal", { rolls: [roll], removed });
}
