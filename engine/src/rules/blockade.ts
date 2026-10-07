/**
 * Blockade Run (p. 133; state §4, §5, §11, N81–N89): the thirds the blockaders
 * deploy in, the runners' edge, and the runners' points for getting through.
 */
import { otherPlayer } from "../state/derived";
import type { GameState, PlayerId, Rect, Third } from "../state/types";

/** Each third of the table's length is this wide (state N82). */
export const THIRD_WIDTH = 60;

/** Blockaders keep their stems at least this far from the runners' edge (state N84). */
export const BLOCKADE_DEPTH = 60;

/** Where the runners deploy: within 15 cm of their edge, the bottom, facing the blockader's (state N83–N84). */
export const RUNNERS_ZONE = { x: 0, y: 0, width: 180, height: 15 } as const;

/** The blockader's edge, by its inward heading: the top (state N83). */
export const BLOCKADER_EDGE = 180;

/** Where a blockading unit in third `k` deploys (state §4). */
export const thirdRect = (k: Third): Rect => ({ x: k * THIRD_WIDTH, y: BLOCKADE_DEPTH, width: THIRD_WIDTH, height: 120 - BLOCKADE_DEPTH });

/** The third a D6 sends a unit to (state N86): 1–2 left, 3–4 centre, 5–6 right. */
export const thirdOf = (roll: number): Third => (roll <= 2 ? 0 : roll <= 4 ? 1 : 2);

/** Blockade Run's blockader, or null in any other scenario. */
export function blockader(state: GameState): PlayerId | null {
  const runners = state.scenario.attacker;
  return state.scenario.id === "blockade_run" && runners !== undefined ? otherPlayer(runners) : null;
}
