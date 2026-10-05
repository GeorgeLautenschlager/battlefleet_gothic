/**
 * The validator (validator/SPEC.md): is one transform legal in one state?
 *
 * Pure and total. Checks run in the spec's order and the first failure wins.
 * It assumes the state satisfies the invariants (state spec §13).
 */
import { actor } from "../state/derived";
import type { GameState } from "../state/types";
import type { Transform, TransformType } from "../transforms/types";
import { malformedField } from "./schema";
import { OK, reject, type ValidationResult } from "./reasons";
import { checkDeclareOrder, checkDriftHulk, checkMove } from "./movement";
import { checkFire, checkLaunchTorpedoes } from "./shooting";
import { checkAnswerBrace, checkDeployShip, checkRemoveBlastMarkers, checkRepair } from "./other";
import { checkLaunchAttackCraft, checkMoveOrdnance, checkReleaseCap } from "./craft";
import { checkBoard, checkEndStep, checkTeleport } from "./boarding";

/** Where each transform is allowed (transform spec §3). answer_brace is gated by G3/G4 instead. */
const ALLOWED: Record<Exclude<TransformType, "answer_brace">, { stage: "setup" | "battle"; when: readonly string[] }> = {
  roll_leadership: { stage: "setup", when: ["roll_leadership"] },
  roll_zones: { stage: "setup", when: ["roll_zones"] },
  roll_deploy_order: { stage: "setup", when: ["roll_deploy_order"] },
  deploy_ship: { stage: "setup", when: ["deploy"] },
  roll_first_turn: { stage: "setup", when: ["roll_first_turn"] },
  choose_first_turn: { stage: "setup", when: ["choose_first_turn"] },
  drift_hulk: { stage: "battle", when: ["hulks_drift"] },
  declare_order: { stage: "battle", when: ["move_ships"] },
  move: { stage: "battle", when: ["move_ships"] },
  release_cap: { stage: "battle", when: ["move_ships"] },
  fire: { stage: "battle", when: ["direct_fire"] },
  launch_torpedoes: { stage: "battle", when: ["launch_ordnance"] },
  launch_attack_craft: { stage: "battle", when: ["launch_ordnance"] },
  end_step: { stage: "battle", when: ["direct_fire", "launch_ordnance", "boarding"] },
  move_ordnance: { stage: "battle", when: ["active_ordnance", "inactive_ordnance"] },
  repair: { stage: "battle", when: ["damage_control"] },
  remove_blast_markers: { stage: "battle", when: ["blast_marker_removal"] },
  board: { stage: "battle", when: ["boarding"] },
  teleport: { stage: "battle", when: ["boarding"] },
};

export function validate(state: GameState, input: unknown): ValidationResult {
  // G1: well-formed
  const field = malformedField(input);
  if (field !== null) return reject("MALFORMED", `Malformed transform at ${field}`, { field });
  const t = input as Transform;

  // G2: game not over
  if (state.clock.stage === "ended") return reject("GAME_OVER", "The game is over");

  // G3, G4: pending decisions come first
  const top = state.pending[state.pending.length - 1];
  if (top !== undefined && t.type !== "answer_brace") {
    return reject("PENDING_DECISION", "A Brace For Impact! decision must be answered first", { pendingId: top.id });
  }
  if (top === undefined && t.type === "answer_brace") {
    return reject("NO_PENDING_DECISION", "There is no decision to answer");
  }

  // G5: right player ("either" covers the roll_* steps and damage control)
  const expected = actor(state);
  if (expected !== "either" && t.player !== expected) {
    return reject("NOT_YOUR_TURN", `It's ${expected ?? "nobody"}'s move`, { expected });
  }

  // G6: right moment
  if (t.type !== "answer_brace") {
    const allowed = ALLOWED[t.type];
    const { stage, setupStep, step } = state.clock;
    const now = stage === "setup" ? setupStep : step;
    if (stage !== allowed.stage || now === null || !allowed.when.includes(now)) {
      return reject("WRONG_MOMENT", `${t.type} isn't allowed now (${stage} / ${now ?? "—"})`, {
        stage,
        setupStep,
        step,
      });
    }
  }

  switch (t.type) {
    case "roll_leadership":
    case "roll_zones":
    case "roll_deploy_order":
    case "roll_first_turn":
    case "choose_first_turn":
      return OK;
    case "end_step":
      return checkEndStep(state);
    case "deploy_ship":
      return checkDeployShip(state, t);
    case "drift_hulk":
      return checkDriftHulk(state, t);
    case "declare_order":
      return checkDeclareOrder(state, t);
    case "move":
      return checkMove(state, t);
    case "fire":
      return checkFire(state, t);
    case "launch_torpedoes":
      return checkLaunchTorpedoes(state, t);
    case "launch_attack_craft":
      return checkLaunchAttackCraft(state, t);
    case "release_cap":
      return checkReleaseCap(state, t);
    case "move_ordnance":
      return checkMoveOrdnance(state, t);
    case "answer_brace":
      return checkAnswerBrace(state, t);
    case "repair":
      return checkRepair(state, t);
    case "remove_blast_markers":
      return checkRemoveBlastMarkers(state, t);
    case "board":
      return checkBoard(state, t);
    case "teleport":
      return checkTeleport(state, t);
  }
}
