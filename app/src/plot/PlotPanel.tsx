import { useState } from "react";
import { typedStep } from "./plot";
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
        Click to head for the pointer; off the bow, it turns exactly where it may. Shift: straight. Backspace, Esc, Enter: step
        back, clear, move.
      </p>
      <StepEntry plot={plot} />
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

/** Exact steps by number: advance N cm, or turn N° to port or starboard. */
function StepEntry({ plot }: { plot: Plot }) {
  const [distance, setDistance] = useState("");
  const [degrees, setDegrees] = useState(String(plot.ship.profile.turns));
  const advance = typedStep("advance", Number(distance));
  const port = typedStep("port", Number(degrees));
  const starboard = typedStep("starboard", Number(degrees));
  const field = { type: "number", min: 0, step: "any", inputMode: "decimal" } as const;
  return (
    <div className="step-entry">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (advance !== null) {
            plot.add(advance);
            setDistance("");
          }
        }}
      >
        <input {...field} value={distance} onChange={(e) => setDistance(e.target.value)} aria-label="Advance distance in cm" placeholder="cm" />
        <button type="submit" disabled={advance === null}>
          Advance
        </button>
      </form>
      <div>
        <input {...field} value={degrees} onChange={(e) => setDegrees(e.target.value)} aria-label="Turn angle in degrees" placeholder="°" />
        <button type="button" aria-label="Turn to port" disabled={port === null} onClick={() => port !== null && plot.add(port)}>
          ⟲ Port
        </button>
        <button type="button" aria-label="Turn to starboard" disabled={starboard === null} onClick={() => starboard !== null && plot.add(starboard)}>
          Starboard ⟳
        </button>
      </div>
    </div>
  );
}
