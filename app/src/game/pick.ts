/** Several ships a side: which one the player is deploying or moving next. */
import { partlyDeployedSquadron, type GameState, type PlayerId, type Ship } from "@bfg/engine";

/** The ship the player picked, if it's still a candidate; otherwise the first candidate. */
export function pick<T extends { id: string }>(candidates: T[], focus: string | null): T | undefined {
  return candidates.find((s) => s.id === focus) ?? candidates[0];
}

/** Ships the player may deploy next: a part-deployed squadron's members first (transform T80). */
export function undeployed(state: GameState, player: PlayerId): Ship[] {
  const partial = partlyDeployedSquadron(state, player);
  return state.ships.filter((s) => s.owner === player && s.status === "undeployed" && (partial === undefined || partial.shipIds.includes(s.id)));
}
