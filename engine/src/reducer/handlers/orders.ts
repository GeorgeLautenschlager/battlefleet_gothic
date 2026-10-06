/** Special orders: declare_order (reducer §8.1) and answer_brace (§11). */
import { activePlayer, commandCheckLd, formation, getShip, inFormation, leadership, squadronOf } from "../../state/derived";
import { moveParameters } from "../../rules/move";
import type { Activation, ShipType } from "../../state/types";
import type { AnswerBrace, DeclareOrder } from "../../transforms/types";
import { sum, type Ctx } from "../context";
import { rerollableTest } from "../reroll";
import { startSquadronMove } from "../squadrons";

/** Size order for rams (p. 55): escort < cruiser < battleship (< defence). */
const SIZE: Record<ShipType, number> = { escort: 0, cruiser: 1, battleship: 2 };

/** Ram Leadership test dice: 3 vs a smaller target, 2 vs the same size, 1 vs a larger one. */
export function ramTestDice(rammer: ShipType, target: ShipType): number {
  const diff = SIZE[target] - SIZE[rammer];
  return diff < 0 ? 3 : diff === 0 ? 2 : 1;
}

export function declareOrder(ctx: Ctx, t: DeclareOrder): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const now = state.clock.playerTurn;

  // A ship in formation declares for its squadron (N38, T81): one check, the order for every member in formation.
  const sq = squadronOf(state, ship);
  const crew = sq !== undefined && inFormation(state, ship) ? formation(state, sq) : [ship];
  const target = commandCheckLd(state, ship);
  const check = rerollableTest(ctx, ship, 2, target, t.reroll === true, "command_check", (r) =>
    ctx.log("command_check", { shipId: ship.id, order: t.order, target, rolls: r.rolls, passed: r.passed, ...(crew.length > 1 && sq !== undefined ? { squadronId: sq.id } : {}) }),
  );

  let order: Activation["order"] = null;
  let aafExtra: number | null = null;
  let ram: Activation["ram"] = null;

  if (check.passed) {
    order = t.order;
    for (const s of crew) {
      s.specialOrder = { kind: t.order, issued: now, expires: { playerTurn: now + 2, at: "movement_start" }, replaced: null };
      if (t.order === "reload_ordnance") {
        for (const key of Object.keys(s.loaded) as (keyof typeof s.loaded)[]) s.loaded[key] = true;
      }
      if (s !== ship) ctx.log("order_set", { shipId: s.id, order: t.order });
    }
    if (t.order === "all_ahead_full") {
      if (t.ramTargetId !== undefined) {
        const victim = getShip(state, t.ramTargetId);
        const dice = ramTestDice(ship.profile.type, victim.profile.type);
        const ld = leadership(state, ship);
        const ramTest = rerollableTest(ctx, ship, dice, ld, t.reroll === true, "ram", (r) =>
          ctx.log("ram_test", { shipId: ship.id, targetId: victim.id, target: ld, rolls: r.rolls, passed: r.passed }),
        );
        ram = { targetId: victim.id, testPassed: ramTest.passed, resolved: false };
      }
      const rolls = ctx.nD6(ship.profile.traits?.allAheadFullDice ?? 4); // improved thrusters: 5D6 (state N10)
      aafExtra = sum(rolls);
      ctx.log("aaf_roll", { shipId: ship.id, rolls, extra: aafExtra });
    }
  } else {
    state.turnState.commandCheckFailed = true;
  }

  const activation: Activation = {
    kind: "move",
    shipId: ship.id,
    stage: "ordered",
    order,
    aafExtra,
    ram,
    maxDistance: 0,
    minDistance: 0,
    start: { position: { ...(ship.position ?? { x: 0, y: 0 }) }, heading: ship.heading ?? 0 },
    distanceMoved: 0,
    distanceSinceTurn: 0,
    turnsMade: 0,
    truncated: false,
    remainingPath: [],
    slowedByBlastMarkers: false,
    zeroShieldBMTestDone: false,
    disengage: false,
    boardTargetId: null,
  };
  if (startSquadronMove(ctx, ship, order, aafExtra) !== undefined && sq !== undefined) activation.squadronId = sq.id;
  const p = moveParameters(ship, activation);
  activation.maxDistance = p.maxIfBR;
  activation.minDistance = order === "all_ahead_full" ? p.d0 : p.minDistance;
  state.activation = activation;
}

export function answerBrace(ctx: Ctx, t: AnswerBrace): void {
  const { state } = ctx;
  const decision = state.pending.pop();
  if (decision === undefined) return; // unreachable after validation
  const ship = getShip(state, decision.shipId);

  if (!t.attempt) {
    ctx.log("brace_check", { shipId: ship.id, declined: true });
    return;
  }
  // A squadron braces together (N38): the answer covers every member in formation.
  const sq = squadronOf(state, ship);
  const crew = sq !== undefined && inFormation(state, ship) ? formation(state, sq) : [ship];
  const target = commandCheckLd(state, ship);
  const check = rerollableTest(ctx, ship, 2, target, t.reroll === true, "command_check", (r) =>
    ctx.log("brace_check", { shipId: ship.id, target, rolls: r.rolls, passed: r.passed }),
  );
  for (const s of crew) {
    if (check.passed) {
      // "Until the end of its next turn" (state §7.3).
      const now = state.clock.playerTurn;
      const ownTurn = activePlayer(state) === s.owner;
      s.specialOrder = {
        kind: "brace_for_impact",
        issued: now,
        expires: { playerTurn: ownTurn ? now + 2 : now + 1, at: "turn_end" },
        replaced: s.specialOrder?.kind ?? null,
      };
      if (s !== ship) ctx.log("order_set", { shipId: s.id, order: "brace_for_impact" });
    } else {
      // Can't try again against this source; doesn't lock the fleet's orders (state N4).
      state.turnState.braceFailures.push({ shipId: s.id, source: { ...decision.source } });
    }
  }
}
