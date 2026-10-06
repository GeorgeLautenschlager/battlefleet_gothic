/** Leadership-style tests a fleet commander re-roll may repeat (reducer §2.2, transform §2.7). */
import { rerollFor } from "../state/derived";
import type { Ship } from "../state/types";
import type { Ctx } from "./context";

export type RerollableTest = "command_check" | "priority" | "disengage" | "ram";
type Result = { rolls: number[]; passed: boolean };

/**
 * Take a test; `logFirst` logs it as usual. If it failed and the transform
 * asked for a re-roll, spend one from `rerollFor(ship)` and roll the same dice
 * again: the second result stands (R32). Returns the result that counts.
 */
export function rerollableTest(
  ctx: Ctx,
  ship: Ship,
  dice: number,
  target: number,
  reroll: boolean,
  test: RerollableTest,
  logFirst: (r: Result) => void,
): Result {
  const first = ctx.test(dice, target);
  logFirst(first);
  if (first.passed || !reroll) return first;
  const from = rerollFor(ctx.state, ship);
  if (from === undefined || from.commander === undefined || from.commander === null) return first;
  from.commander.rerolls -= 1;
  const again = ctx.test(dice, target);
  ctx.log("reroll", { shipId: ship.id, commanderShipId: from.id, test, rolls: again.rolls, passed: again.passed });
  return again;
}
