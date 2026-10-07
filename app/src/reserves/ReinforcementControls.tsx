import { reserves, squadronOf, type GameState, type PlayerId, type Ship, type Transform } from "@bfg/engine";
import { Act } from "../controls/Act";
import { reserveUnits } from "./arrival";

/** Facing on arrival, relative to straight in: + is to starboard. */
const TURNS = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
const turnLabel = (t: number) => (t === 0 ? "Straight in" : `${Math.abs(t)}° to ${t > 0 ? "starboard" : "port"}`);

type Props = {
  state: GameState;
  player: PlayerId;
  /** The first ship of the unit picked to arrive, or null. */
  chosen: string | null;
  onChoose: (id: string | null) => void;
  turn: number;
  onTurn: (degrees: number) => void;
  onApply: (t: Transform) => void;
};

const unitName = (state: GameState, unit: Ship[]): string => {
  const first = unit[0];
  if (first === undefined) return "";
  const sq = squadronOf(state, first);
  return sq !== undefined && unit.length > 1 ? `${sq.name} (${unit.length} ships)` : first.name;
};

/** The Bait's reinforcements (transform §4.2): pick a unit, then click an entry edge on the table to bring it on. */
export function ReinforcementControls({ state, player, chosen, onChoose, turn, onTurn, onApply }: Props) {
  const units = reserveUnits(state, player);
  if (units.length === 0) return null;
  // The Raiders' raiders all move on now, from any edge (state N60); The Bait's reinforcements may wait.
  const mayWait = reserves.reservesMayWait(state);
  const surpriseAttack = state.scenario.id === "surprise_attack";
  return (
    <div className="ship-controls reinforcements">
      <h3>{mayWait ? "Reinforcements" : surpriseAttack ? "Attackers moving on" : "Raiders moving on"}</h3>
      <p className="muted small">
        {mayWait
          ? "Pick a ship or squadron, then click the lit table edge to bring it on. It arrives facing in, and then moves like any other ship this turn."
          : surpriseAttack
          ? state.setup.surpriseAttack?.entryEdge === null
            ? "Every attacker moves on this turn, all from one table edge: the first ship you bring on picks it. Pick a ship or squadron, then click a table edge."
            : "Every attacker moves on this turn, from the lit edge. Pick a ship or squadron, then click it; it then moves like any other ship."
          : "Every raider moves on this turn. Pick a ship or squadron, then click any table edge to bring it on; it then moves like any other ship."}
      </p>
      <div className="buttons">
        {units.map((unit) => {
          const id = unit[0]?.id ?? "";
          const on = unit.some((s) => s.id === chosen);
          return (
            <button key={id} type="button" className={on ? "primary" : ""} aria-pressed={on} onClick={() => onChoose(on ? null : id)}>
              {on ? "Bringing on" : "Bring on"} {unitName(state, unit)}
            </button>
          );
        })}
      </div>
      <label>
        Facing
        <select value={turn} onChange={(e) => onTurn(Number(e.target.value))}>
          {TURNS.map((t) => (
            <option key={t} value={t}>
              {turnLabel(t)}
            </option>
          ))}
        </select>
      </label>
      {mayWait && (
        <Act state={state} transform={{ type: "end_step", player }} onApply={onApply}>
          Leave the rest waiting
        </Act>
      )}
    </div>
  );
}
