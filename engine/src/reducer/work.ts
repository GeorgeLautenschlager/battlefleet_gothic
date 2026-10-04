/**
 * Work items (reducer spec §11): everything still to resolve lives in
 * state.queue and runs front first. Follow-ups are inserted at the front.
 */
import { getShip } from "../state/derived";
import type { AttackSource, GameState, Ship, WorkItem } from "../state/types";
import { NotImplementedError, type Ctx } from "./context";

/** Insert items at the front of the queue, in the order they should run. */
export function enqueueFront(state: GameState, items: WorkItem[]): void {
  state.queue.unshift(...items);
}

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
    default:
      throw new NotImplementedError(`reducer: work item "${item.kind}" arrives in a later PR`);
  }
}

export { getShip };
