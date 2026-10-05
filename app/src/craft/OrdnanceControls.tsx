import { actor, type GameState, type TorpedoSalvo, type Transform } from "@bfg/engine";
import { Act } from "../controls/Act";
import { movableWaves, waveName } from "./craft";
import type { CraftPlot } from "./useCraftPlot";

type Props = {
  state: GameState;
  plot: CraftPlot | null;
  onApply: (t: Transform) => void;
  onHighlight: (ids: string[]) => void;
  /** Pick the wave to fly next. */
  onFocus: (id: string) => void;
};

const cm = (n: number) => `${Math.round(n * 10) / 10} cm`;

/** Ordnance steps: torpedoes move by themselves; attack craft fly along waypoints clicked on the table. */
export function OrdnanceControls({ state, plot, onApply, onHighlight, onFocus }: Props) {
  const mover = actor(state);
  if (mover !== "p1" && mover !== "p2") return null;
  const salvos = state.ordnance.filter(
    (o): o is TorpedoSalvo => o.kind === "torpedo_salvo" && o.owner === mover && !state.turnState.ordnanceMoved.includes(o.id),
  );
  const waves = movableWaves(state);
  const hover = (id: string) => ({ onPointerEnter: () => onHighlight([id]), onPointerLeave: () => onHighlight([]) });
  const onCap = waves.filter((w) => w.cap !== null);
  return (
    <>
      {salvos.length > 0 && (
        <div className="buttons">
          {salvos.map((o) => (
            <span key={o.id} {...hover(o.id)}>
              <Act state={state} transform={{ type: "move_ordnance", player: mover, ordnanceId: o.id }} onApply={onApply} primary>
                Move {state.ships.find((s) => s.id === o.launchedBy)?.name ?? "torpedoes"}'s torpedoes ({o.strength})
              </Act>
            </span>
          ))}
        </div>
      )}
      {waves.length > 1 && (
        <div className="picker" role="group" aria-label="Fly which attack craft">
          <span className="muted small">Fly:</span>
          {waves.map((w) => (
            <button
              key={w.id}
              type="button"
              {...hover(w.id)}
              aria-pressed={w.id === plot?.wave.id}
              className={w.id === plot?.wave.id ? "selected" : undefined}
              onClick={() => onFocus(w.id)}
            >
              {waveName(state, w)}
              {w.cap !== null && " (CAP)"}
            </button>
          ))}
        </div>
      )}
      {onCap.length > 0 && <p className="muted small">CAP fighters may leave CAP now, before your other ordnance moves; otherwise they stay with their ship.</p>}
      {plot !== null && (
        <div className="ship-controls">
          <h3>{waveName(state, plot.wave)}</h3>
          <p className="muted small">
            Click the table to add waypoints: {cm(plot.used)} of {cm(plot.speed)}. A wave stops at the first enemy ship it touches and attacks it.
          </p>
          <div className="buttons">
            <Act state={state} transform={plot.fly()} onApply={onApply} primary showReason>
              {plot.path.length === 0 ? "Stay put" : "Fly"}
            </Act>
            {plot.capShips.map((s) => (
              <Act key={s.id} state={state} transform={plot.fly(s.id)} onApply={onApply}>
                Fly CAP over {s.name}
              </Act>
            ))}
            <button type="button" onClick={plot.back} disabled={plot.path.length === 0}>
              Undo waypoint
            </button>
            <button type="button" onClick={plot.clear} disabled={plot.path.length === 0}>
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}
