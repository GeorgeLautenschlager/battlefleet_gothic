import { actor, roundOf, type GameState } from "@bfg/engine";
import { playerClass, playerName } from "../players";

const words = (s: string) => s.replaceAll("_", " ");
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where the game is, and whose move it is. */
export function ClockBar({ state }: { state: GameState }) {
  const { clock } = state;
  const who = actor(state);
  let where: string;
  if (clock.stage === "setup") where = `Setup · ${sentence(words(clock.setupStep ?? ""))}`;
  else if (clock.stage === "ended") where = "Game over";
  else where = `Round ${roundOf(clock.playerTurn)} of ${state.scenario.maxRounds} · ${sentence(words(clock.phase ?? ""))} · ${words(clock.step ?? "")}`;

  return (
    <div className="clock">
      <span className="where">{where}</span>
      {who === "p1" || who === "p2" ? (
        <span className={`actor ${playerClass(who)}`}>{playerName(state, who)} to act</span>
      ) : who === "either" ? (
        <span className="actor">either player</span>
      ) : null}
    </div>
  );
}
