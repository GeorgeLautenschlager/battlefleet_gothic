/** Reserves arriving (reducer spec §8.1, transform §4.2). */
import { arrivalEdge } from "../rules/reserves";
import type { Arrive } from "../transforms/types";
import type { Ctx } from "./context";
import { getShip } from "./work";

/** Bring one unit on along its entry edge. No dice; the ships are unmoved and must still move (T97). */
export function arrive(ctx: Ctx, t: Arrive): void {
  for (const p of t.placements) {
    const ship = getShip(ctx.state, p.shipId);
    ship.status = "active";
    ship.position = { ...p.position };
    ship.heading = p.heading;
  }
  // Surprise Attack: the first arrival picks the attackers' one edge (state N76, R53).
  const surprise = ctx.state.setup.surpriseAttack;
  const first = t.placements[0];
  if (surprise !== undefined && surprise.entryEdge === null && first !== undefined) surprise.entryEdge = arrivalEdge(ctx.state, first);
  ctx.log("arrive", {
    player: t.player,
    ships: t.placements.map((p) => ({ shipId: p.shipId, position: { ...p.position }, heading: p.heading })),
  });
}
