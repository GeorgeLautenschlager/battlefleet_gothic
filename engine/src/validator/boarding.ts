/** Boarding-step checks (validator spec §4.6): board, teleport, and end_step in the boarding step. */
import { boardingsToFight, teleportProblem } from "../rules/boarding";
import type { GameState } from "../state/types";
import type { Board, Teleport } from "../transforms/types";
import { isResult, ownActiveShip } from "./movement";
import { priorityProblem } from "./other";
import { OK, reject, type ValidationResult } from "./reasons";

export function checkBoard(state: GameState, t: Board): ValidationResult {
  const target = state.ships.find((s) => s.id === t.targetId);
  if (target === undefined) return reject("UNKNOWN_TARGET", `No ship ${t.targetId}`, { targetId: t.targetId });
  const group = boardingsToFight(state).find((g) => g.targetId === target.id);
  if (group === undefined) {
    return reject("NO_BOARDING_DECLARED", `Nobody is boarding ${target.name}`, { targetId: target.id });
  }
  return priorityProblem(t.priority, group.shipIds);
}

export function checkTeleport(state: GameState, t: Teleport): ValidationResult {
  const ship = ownActiveShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  return teleportProblem(state, ship, t.targetId);
}

/** end_step in the boarding step: declared boarding actions must be fought first. */
export function checkEndStep(state: GameState): ValidationResult {
  if (state.clock.step !== "boarding") return OK;
  const left = boardingsToFight(state);
  if (left.length === 0) return OK;
  return reject("BOARDING_UNRESOLVED", "Fight the declared boarding actions first", { targetIds: left.map((g) => g.targetId) });
}
