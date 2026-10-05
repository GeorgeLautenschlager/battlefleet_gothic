/** Several ships a side: which one the player is deploying or moving next. */
import type { GameState, PlayerId, Ship } from "@bfg/engine";

/** The ship the player picked, if it's still a candidate; otherwise the first candidate. */
export function pick<T extends { id: string }>(candidates: T[], focus: string | null): T | undefined {
  return candidates.find((s) => s.id === focus) ?? candidates[0];
}

export const undeployed = (state: GameState, player: PlayerId): Ship[] =>
  state.ships.filter((s) => s.owner === player && s.status === "undeployed");
