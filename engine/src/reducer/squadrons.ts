/**
 * Squadron bookkeeping (reducer spec §8.1, §8.2; state §7.5, N37–N41): starting
 * a squadron's move, the ships still to move in it, and what happens when its
 * last member has moved.
 */
import { approxLe, distance } from "../geometry/basic";
import { formation, getShip, inFormation, onTable, squadronLd, squadronOf } from "../state/derived";
import type { OrderKind, Point, Ship, ShipSquadron } from "../state/types";
import type { Ctx } from "./context";
import { releaseCap } from "./cap";
import { rerollableTest } from "./reroll";

/**
 * The squadron a ship moves with, if it starts or joins a squadron's move:
 * its own squadron's move in progress, or a new one when it's in formation.
 */
export function startSquadronMove(ctx: Ctx, ship: Ship, order: OrderKind | null, aafExtra: number | null): ShipSquadron | undefined {
  const { state } = ctx;
  const sq = squadronOf(state, ship);
  if (sq === undefined) return undefined;
  const sm = state.turnState.squadronMove ?? null;
  if (sm !== null) return sm.squadronId === sq.id && sm.members.includes(ship.id) ? sq : undefined;
  if (!inFormation(state, ship)) return undefined; // a stray moves alone (N36)
  state.turnState.squadronMove = { squadronId: sq.id, order, aafExtra, members: formation(state, sq).map((s) => s.id), disengage: null };
  return sq;
}

/** Members of the squadron's move still to go: active and not yet moved. */
export function stillToMove(ctx: Ctx): Ship[] {
  const sm = ctx.state.turnState.squadronMove ?? null;
  if (sm === null) return [];
  return sm.members.map((id) => getShip(ctx.state, id)).filter((s) => s.status === "active" && ctx.state.turnState.ships[s.id]?.moved !== true);
}

/**
 * After a member's move (§8.2 finish_move step 5): an escort leaving the table
 * sets `disengaging`; a capital member that failed its test leaves; and once
 * nobody is left to move, an escort squadron takes its one disengage test.
 */
export function afterSquadronMember(ctx: Ctx, ship: Ship, failedTest: boolean, reroll: boolean): void {
  const { state } = ctx;
  const sm = state.turnState.squadronMove ?? null;
  const sq = squadronOf(state, ship);
  if (sq === undefined) return;
  if (sq.type === "escort" && ship.status === "disengaged") sq.disengaging = true;
  if (sq.type === "capital" && failedTest) {
    sq.shipIds = sq.shipIds.filter((id) => id !== ship.id); // for good (p. 56)
    ctx.log("left_squadron", { shipId: ship.id, squadronId: sq.id });
  }
  if (sm === null || sm.squadronId !== sq.id || stillToMove(ctx).length > 0) return;
  if (sq.type === "escort" && (sm.disengage === true || sq.disengaging)) escortSquadronDisengage(ctx, sq, sm.members, reroll);
  state.turnState.squadronMove = null;
}

/** An escort squadron's one disengage test (N41, R39): BMs and enemies near any member, each counted once. */
function escortSquadronDisengage(ctx: Ctx, sq: ShipSquadron, memberIds: string[], reroll: boolean): void {
  const { state } = ctx;
  const members = memberIds.map((id) => getShip(state, id)).filter((s) => s.status === "active");
  const lead = members[0];
  if (lead === undefined) return;
  const near = (p: Point, d: number) => members.some((m) => approxLe(distance(m.position as Point, p), d));
  const bms = state.blastMarkers.filter((bm) => near(bm.position, 5)).length;
  const enemies =
    state.ships.filter((s) => s.owner !== sq.owner && onTable(s) && s.position !== null && near(s.position, 15)).length +
    state.ordnance.filter((o) => o.owner !== sq.owner && near(o.position, 15)).length;
  const target = squadronLd(state, sq) + bms - enemies;
  const test = rerollableTest(ctx, lead, 2, target, reroll, "disengage", (r) =>
    ctx.log("disengage_test", { shipId: lead.id, squadronId: sq.id, target, rolls: r.rolls, passed: r.passed }),
  );
  if (test.passed) sq.disengaging = true;
  for (const m of members) {
    if (test.passed) {
      releaseCap(ctx, m);
      m.status = "disengaged";
      m.position = null;
      m.heading = null;
      m.specialOrder = null;
      ctx.log("disengaged", { shipId: m.id, reason: "test" });
    } else {
      const entry = state.turnState.ships[m.id];
      if (entry !== undefined) entry.disengage = "failed";
    }
  }
}
