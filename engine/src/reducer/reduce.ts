/**
 * The reducer (reducer/SPEC.md): apply one validated transform, then settle.
 *
 * reduce never mutates its input: it works on a deep copy. Handlers usually
 * just enqueue work; settle() drains the queue, stops at pending decisions,
 * ends the game when a fleet is gone, and advances completed steps.
 */
import { cloneJson } from "../state/json";
import type { GameState } from "../state/types";
import type { Transform } from "../transforms/types";
import { Ctx } from "./context";
import { chooseAlert, chooseFacing, chooseFirstTurn, chooseFormation, chooseSetup, deployShip, rollDeployOrder, rollFirstTurn, rollLeadership, rollSetup, rollZones } from "./handlers/setup";
import { answerBrace, declareOrder } from "./handlers/orders";
import { removeBlastMarkers, repair } from "./handlers/end";
import { fire } from "./handlers/fire";
import { fireNovaCannon } from "./nova";
import { driftHulk, move } from "./movement";
import { launchTorpedoes, moveOrdnance } from "./torpedoes";
import { advanceStep, eliminatedSide, endGame, stepComplete } from "./steps";
import { runWorkItem } from "./work";
import { board, teleport } from "./boarding";
import { launchAttackCraft, moveAttackCraft, releaseCapOrder } from "./craft";
import { arrive } from "./reserves";
import { detonate, moveMine, placeDefence } from "./defences";

export function reduce(state: GameState, transform: Transform): GameState {
  const ctx = new Ctx(cloneJson(state));
  ctx.actor = transform.player;
  handle(ctx, transform);
  settle(ctx);
  return ctx.state;
}

/**
 * Test seam: reduce with scripted dice instead of the state's RNG. Throws if the
 * reducer draws more or fewer dice than scripted, so tests pin the draw order.
 * Not exported from the package.
 */
export function reduceWithDice(state: GameState, transform: Transform, dice: readonly number[]): GameState {
  const ctx = new Ctx(cloneJson(state), [...dice]);
  ctx.actor = transform.player;
  handle(ctx, transform);
  settle(ctx);
  if (ctx.unusedScript.length > 0) {
    throw new Error(`scripted dice left over: ${ctx.unusedScript.join(", ")} (the reducer drew fewer dice than expected)`);
  }
  return ctx.state;
}

function handle(ctx: Ctx, t: Transform): void {
  switch (t.type) {
    case "roll_leadership":
      return rollLeadership(ctx);
    case "roll_zones":
      return rollZones(ctx);
    case "choose_formation":
      return chooseFormation(ctx, t);
    case "roll_setup":
      return rollSetup(ctx);
    case "choose_setup":
      return chooseSetup(ctx, t);
    case "choose_facing":
      return chooseFacing(ctx, t);
    case "choose_alert":
      return chooseAlert(ctx, t);
    case "roll_deploy_order":
      return rollDeployOrder(ctx);
    case "deploy_ship":
      return deployShip(ctx, t);
    case "place_defence":
      return placeDefence(ctx, t);
    case "detonate":
      return detonate(ctx, t);
    case "roll_first_turn":
      return rollFirstTurn(ctx);
    case "choose_first_turn":
      return chooseFirstTurn(ctx, t);
    case "declare_order":
      return declareOrder(ctx, t);
    case "answer_brace":
      return answerBrace(ctx, t);
    case "end_step":
      ctx.log("end_step", { step: ctx.state.clock.step });
      return advanceStep(ctx);
    case "repair":
      return repair(ctx, t);
    case "remove_blast_markers":
      return removeBlastMarkers(ctx, t);
    case "fire":
      return fire(ctx, t);
    case "fire_nova_cannon":
      return fireNovaCannon(ctx, t);
    case "drift_hulk":
      return driftHulk(ctx, t.shipId);
    case "move":
      return move(ctx, t);
    case "launch_torpedoes":
      return launchTorpedoes(ctx, t);
    case "move_ordnance":
      switch (ctx.state.ordnance.find((o) => o.id === t.ordnanceId)?.kind) {
        case "attack_craft":
          return moveAttackCraft(ctx, t);
        case "orbital_mine":
          return moveMine(ctx, t.ordnanceId);
        default:
          return moveOrdnance(ctx, t.ordnanceId);
      }
    case "launch_attack_craft":
      return launchAttackCraft(ctx, t);
    case "release_cap":
      return releaseCapOrder(ctx, t);
    case "arrive":
      return arrive(ctx, t);
    case "board":
      return board(ctx, t);
    case "teleport":
      return teleport(ctx, t);
  }
}

/** Reducer spec §1.2. */
function settle(ctx: Ctx): void {
  const { state } = ctx;
  for (;;) {
    while (state.pending.length === 0 && state.queue.length > 0) {
      const item = state.queue.shift();
      if (item !== undefined) runWorkItem(ctx, item);
    }
    if (state.pending.length > 0) return;
    if (state.clock.stage === "battle" && eliminatedSide(state) !== null) {
      endGame(ctx, "fleet_eliminated");
      return;
    }
    if (state.clock.stage !== "ended" && stepComplete(state)) {
      advanceStep(ctx);
      continue;
    }
    return;
  }
}
