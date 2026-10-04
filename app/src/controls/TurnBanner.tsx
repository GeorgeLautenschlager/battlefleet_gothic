import { actor, type GameState } from "@bfg/engine";
import { playerClass, playerName } from "../players";

/** Hot-seat: who should be holding the device right now. */
export function TurnBanner({ state }: { state: GameState }) {
  if (state.clock.stage === "ended") return null;
  const who = actor(state);
  if (who === "p1" || who === "p2") {
    const faction = who === "p1" ? "Imperial Navy" : "Chaos";
    return (
      <div className={`banner ${playerClass(who)}`}>
        <strong>{playerName(state, who)}</strong> <span>· {faction}</span>
      </div>
    );
  }
  if (who === "either") return <div className="banner">Either player</div>;
  return null;
}
