/** Leaving a grapple (reducer spec §7.4): whenever a ship stops being active. */
import type { Ship } from "../state/types";
import type { Ctx } from "./context";

export function leaveGrapple(ctx: Ctx, ship: Ship): void {
  const g = ship.grapple;
  if (g === null) return;
  ship.grapple = null;
  const members = ctx.state.ships.filter((s) => s.id !== ship.id && (s.id === g.defenderId || g.attackerIds.includes(s.id)));
  const rest = g.attackerIds.filter((id) => id !== ship.id);
  if (ship.id === g.defenderId || rest.length === 0) {
    for (const m of members) m.grapple = null;
    ctx.log("grapple_ended", { defenderId: g.defenderId, shipId: ship.id });
    return;
  }
  for (const m of members) m.grapple = { defenderId: g.defenderId, attackerIds: [...rest] };
}
