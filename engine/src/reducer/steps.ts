/**
 * Step advancement and turn boundaries (transform spec §2.3, §2.5).
 *
 * The reducer moves on from a step when `stepComplete` says so (or the player
 * sends `end_step`). Housekeeping runs on *entering* a step, so it never runs twice.
 */
import { bmTouchesBase } from "../geometry/basic";
import { emptyTurnState } from "../state/newGame";
import { activePlayer, isHulk, novaCannonBarred, onTable, otherPlayer, score, victoryPoints, weaponDisabled } from "../state/derived";
import type { GameState, Ordnance, Phase, PlayerId, SetupStep, Step } from "../state/types";
import type { Ctx } from "./context";
import { anyTeleport, boardingsToFight } from "../rules/boarding";
import { grappledStayPut, grapplesFight } from "./boarding";
import { canLaunchCraft } from "../rules/craft";

const SETUP_ORDER: readonly SetupStep[] = [
  "roll_leadership",
  "roll_zones",
  "roll_deploy_order",
  "deploy",
  "roll_first_turn",
  "choose_first_turn",
];

const BATTLE_ORDER: readonly { phase: Phase; step: Step }[] = [
  { phase: "movement", step: "hulks_drift" },
  { phase: "movement", step: "move_ships" },
  { phase: "shooting", step: "direct_fire" },
  { phase: "shooting", step: "launch_ordnance" },
  { phase: "ordnance", step: "active_ordnance" },
  { phase: "ordnance", step: "inactive_ordnance" },
  { phase: "end", step: "boarding" },
  { phase: "end", step: "damage_control" },
  { phase: "end", step: "blast_marker_removal" },
];

const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

/** Blast Markers not touching any ship on the table: the ones the End Phase may remove (p. 88). */
export function removableBlastMarkers(state: GameState): string[] {
  const ships = state.ships.filter(onTable);
  return state.blastMarkers
    .filter((bm) => !ships.some((s) => s.position !== null && bmTouchesBase(bm.position, s.position, s.profile.baseSize)))
    .map((bm) => bm.id);
}

/** Ordnance that must move in an Ordnance step: everything but CAP fighters, who stay with their ship (transform §2.3). */
const toMove = (o: Ordnance): boolean => o.kind !== "attack_craft" || o.cap === null;

/** Whether the current step has nothing left to do (transform spec §2.3, "Complete when"). */
export function stepComplete(state: GameState): boolean {
  const { clock, setup, turnState } = state;
  if (clock.stage === "setup") {
    switch (clock.setupStep) {
      case "roll_leadership":
        return setup.leadershipRolled;
      case "roll_zones":
        return setup.zones !== null;
      case "roll_deploy_order":
        return setup.firstDeployer !== null;
      case "deploy":
        return state.ships.every((s) => s.status !== "undeployed");
      case "roll_first_turn":
        return setup.firstTurnChooser !== null;
      case "choose_first_turn":
        return setup.firstPlayer !== null;
      default:
        return false;
    }
  }
  if (clock.stage !== "battle") return false;

  const active = activePlayer(state);
  const mine = state.ships.filter((s) => s.owner === active);
  const shipTurn = (id: string) => turnState.ships[id];
  const canAct = (id: string) => shipTurn(id)?.disengage !== "failed";

  switch (clock.step) {
    case "hulks_drift":
      return mine.filter(isHulk).every((s) => shipTurn(s.id)?.drifted === true);
    case "move_ships":
      return state.activation === null && mine.filter((s) => s.status === "active").every((s) => shipTurn(s.id)?.moved === true);
    case "direct_fire":
      return !mine.some(
        (s) =>
          s.status === "active" &&
          canAct(s.id) &&
          s.profile.weapons.some(
            (w) =>
              (w.kind === "battery" || w.kind === "lance" || (w.kind === "nova_cannon" && novaCannonBarred(s) === null)) &&
              !(shipTurn(s.id)?.weaponsFired.includes(w.id) ?? false) &&
              !weaponDisabled(state, s, w),
          ),
      );
    case "launch_ordnance":
      return !mine.some(
        (s) =>
          s.status === "active" &&
          canAct(s.id) &&
          ((s.loaded.torpedoes === true &&
            s.profile.weapons.some(
              (w) => w.kind === "torpedoes" && !(shipTurn(s.id)?.weaponsFired.includes(w.id) ?? false) && !weaponDisabled(state, s, w),
            )) ||
            canLaunchCraft(state, s)),
      );
    case "active_ordnance":
      return state.ordnance.filter((o) => o.owner === active && toMove(o)).every((o) => turnState.ordnanceMoved.includes(o.id));
    case "inactive_ordnance":
      return state.ordnance.filter((o) => o.owner !== active && toMove(o)).every((o) => turnState.ordnanceMoved.includes(o.id));
    case "boarding":
      // Reducer §10.4: nothing left to fight and no teleport to make (or the player ends the step).
      return !state.meta.options.boarding || (boardingsToFight(state).length === 0 && !anyTeleport(state));
    case "damage_control":
      return state.ships.every(
        (s) => s.status !== "active" || !s.criticals.some((c) => !UNREPAIRABLE.has(c.kind)) || shipTurn(s.id)?.repaired === true,
      );
    case "blast_marker_removal":
      return turnState.blastMarkersRemoved || removableBlastMarkers(state).length === 0;
    default:
      return false;
  }
}

/** Leave the current step for the next one, running boundary housekeeping. */
export function advanceStep(ctx: Ctx): void {
  ctx.housekeeping(() => {
    const { state } = ctx;
    const { clock } = state;
    if (clock.stage === "setup") {
      const i = SETUP_ORDER.indexOf(clock.setupStep as SetupStep);
      const next = SETUP_ORDER[i + 1];
      if (next === undefined) {
        startBattle(ctx);
      } else {
        clock.setupStep = next;
        ctx.log("step", { setupStep: next });
      }
      return;
    }
    const i = BATTLE_ORDER.findIndex((s) => s.step === clock.step);
    const next = BATTLE_ORDER[i + 1];
    if (next === undefined) endPlayerTurn(ctx);
    else enterStep(ctx, next.phase, next.step);
  });
}

function enterStep(ctx: Ctx, phase: Phase, step: Step): void {
  const { state } = ctx;
  state.clock.phase = phase;
  state.clock.step = step;
  ctx.log("step", { phase, step });
  switch (step) {
    case "move_ships":
      grappledStayPut(ctx);
      break;
    case "boarding":
      grapplesFight(ctx);
      break;
    case "active_ordnance":
    case "inactive_ordnance":
      state.turnState.ordnanceMoved = [];
      break;
    case "blast_marker_removal":
      // Fires burn: each of the active player's ships with fires (transform §4.6, state N6).
      for (const ship of state.ships) {
        if (ship.owner === activePlayer(state) && ship.status === "active" && ship.criticals.some((c) => c.kind === "fire")) {
          state.queue.push({ kind: "fire_damage", shipId: ship.id });
        }
      }
      break;
    default:
      break;
  }
}

/** Leaving choose_first_turn: the battle begins (transform §2.5). */
function startBattle(ctx: Ctx): void {
  const { clock } = ctx.state;
  clock.stage = "battle";
  clock.setupStep = null;
  ctx.log("battle_start", { firstPlayer: ctx.state.setup.firstPlayer });
  startPlayerTurn(ctx, 1);
}

function startPlayerTurn(ctx: Ctx, playerTurn: number): void {
  const { state } = ctx;
  state.clock.playerTurn = playerTurn;
  state.turnState = emptyTurnState(playerTurn, state.ships);
  const player = activePlayer(state);
  ctx.log("turn_start", { round: Math.ceil(playerTurn / 2), player });
  // The active player's orders from their last turn expire now (p. 51).
  for (const ship of state.ships) {
    const order = ship.specialOrder;
    if (ship.owner === player && order !== null && order.expires.at === "movement_start" && order.expires.playerTurn <= playerTurn) {
      ship.specialOrder = null;
      ctx.log("order_expired", { shipId: ship.id, order: order.kind });
    }
  }
  enterStep(ctx, "movement", "hulks_drift");
}

/** Leaving blast_marker_removal: Brace expiries, then the next turn or the end of the game. */
function endPlayerTurn(ctx: Ctx): void {
  const { state } = ctx;
  const now = state.clock.playerTurn;
  for (const ship of state.ships) {
    const order = ship.specialOrder;
    if (order !== null && order.expires.at === "turn_end" && order.expires.playerTurn === now) {
      ship.specialOrder = null;
      ctx.log("order_expired", { shipId: ship.id, order: order.kind });
    }
  }
  if (now >= 2 * state.scenario.maxRounds) endGame(ctx, "rounds_complete");
  else startPlayerTurn(ctx, now + 1);
}

/** A side with no active ship left: the game ends at once (state D6). */
export function eliminatedSide(state: GameState): PlayerId | null {
  for (const player of ["p1", "p2"] as const) {
    if (!state.ships.some((s) => s.owner === player && s.status === "active")) return player;
  }
  return null;
}

export function endGame(ctx: Ctx, reason: "rounds_complete" | "fleet_eliminated"): void {
  ctx.housekeeping(() => {
    const { state } = ctx;
    const scores = { p1: score(state, "p1"), p2: score(state, "p2") };
    const winner = scores.p1 === scores.p2 ? null : scores.p1 > scores.p2 ? "p1" : otherPlayer("p1");
    state.result = { reason, scores, winner };
    state.activation = null;
    state.clock = { ...state.clock, stage: "ended", setupStep: null, phase: null, step: null };
    if (state.scenario.scoring === "victory_points") {
      const breakdown = { p1: victoryPoints(state, "p1"), p2: victoryPoints(state, "p2") };
      const plain = (v: ReturnType<typeof victoryPoints>) => ({ ships: v.ships.map((x) => ({ ...x })), field: v.field });
      ctx.log("game_end", { reason, scores, winner, scoring: "victory_points", breakdown: { p1: plain(breakdown.p1), p2: plain(breakdown.p2) } });
    } else {
      ctx.log("game_end", { reason, scores, winner });
    }
  });
}
