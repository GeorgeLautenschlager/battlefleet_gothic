import type { GameState, PlayerId } from "@bfg/engine";
import { playerClass, playerName } from "../players";

/** Online, when it's the other player's move. */
export function Waiting({ state, player }: { state: GameState; player: PlayerId }) {
  const deciding = state.pending.at(-1);
  const ship = deciding === undefined ? null : state.ships.find((s) => s.id === deciding.shipId);
  return (
    <p className={`waiting ${playerClass(player)}`} role="status">
      Waiting for {playerName(state, player)}
      {ship ? ` to decide whether ${ship.name} braces` : ""}…
    </p>
  );
}
