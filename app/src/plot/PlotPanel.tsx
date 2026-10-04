import type { Plot } from "./usePlot";

const cm = (n: number) => `${Math.round(n * 10) / 10} cm`;

/** The plotter's side panel: progress, the engine's verdict, and the buttons. */
export function PlotPanel({ plot }: { plot: Plot }) {
  const { stats: st, verdict } = plot;
  const status =
    plot.path.length === 0
      ? { cls: "muted", text: "Click the table to plot a move." }
      : verdict.kind === "ok"
        ? { cls: "ok", text: "Legal move." }
        : { cls: verdict.kind, text: verdict.message };
  return (
    <div className="plotter">
      <dl className="plot-stats">
        <dt>Moved</dt>
        <dd>
          {cm(st.total)} <span className="muted">of {st.min === st.max ? cm(st.max) : `${cm(st.min)}–${cm(st.max)}`}</span>
        </dd>
        <dt>Turns</dt>
        <dd>
          {st.turnsUsed} / {st.turnsAllowed}
          {st.turnsUsed < st.turnsAllowed && !st.canTurnHere && (
            <span className="muted"> · next after {cm(Math.max(0, st.turnDistance - st.sinceTurn))}</span>
          )}
        </dd>
      </dl>
      <p className={`plot-status ${status.cls}`}>{status.text}</p>
      <p className="muted small">
        Click to head for the pointer, turning up to {plot.ship.profile.turns}° where a turn is allowed. Shift: straight ahead.
        Backspace steps back, Esc clears, Enter moves.
      </p>
      <div className="buttons">
        <button type="button" onClick={plot.fullAhead} disabled={st.total >= st.max}>
          Full ahead
        </button>
        <button type="button" onClick={plot.back} disabled={plot.path.length === 0}>
          Step back
        </button>
        <button type="button" onClick={plot.clear} disabled={plot.path.length === 0}>
          Clear
        </button>
        <label className="check">
          <input type="checkbox" checked={plot.disengage} onChange={(e) => plot.setDisengage(e.target.checked)} /> Disengage
        </label>
        <button type="button" className="primary" data-commit-move onClick={plot.commit} disabled={verdict.kind !== "ok"}>
          Move
        </button>
      </div>
    </div>
  );
}
