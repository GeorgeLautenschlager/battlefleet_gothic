/** Reserves arriving (reducer spec §8.1, transform §4.2). */
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
  ctx.log("arrive", {
    player: t.player,
    ships: t.placements.map((p) => ({ shipId: p.shipId, position: { ...p.position }, heading: p.heading })),
  });
}
