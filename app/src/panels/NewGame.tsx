import { useState } from "react";
import type { PlayerId } from "@bfg/engine";
import { carriersAllowed, configProblem, defaultNames, MAX_SHIPS, type NewGameOptions, type Side } from "../game/config";
import { BattleFields, CountSelect, duplicates, DuplicateNames, FleetFields, FleetProblem, resize, RulesChecks } from "./FleetForm";

const PLAYERS: PlayerId[] = ["p1", "p2"];

const INITIAL: NewGameOptions = {
  p1: { name: "Player 1", fleet: "imperial_navy", ships: defaultNames("imperial_navy", 1) },
  p2: { name: "Player 2", fleet: "chaos", ships: defaultNames("chaos", 1) },
  ramming: true,
  boarding: true,
  carriers: false,
};

/** Hot-seat: Cruiser Clash (the same number of cruisers each) or a points battle (each side spends its points). */
export function NewGame({ onStart, onCancel, cancelLabel = "Cancel" }: { onStart: (o: NewGameOptions) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [o, setO] = useState<NewGameOptions>(INITIAL);
  const count = o.p1.ships.length;
  const points = o.forces?.kind === "points" ? o.forces.limit : null;
  const dupes = duplicates([...o.p1.ships, ...o.p2.ships]);
  const problem = dupes.length > 0 ? null : configProblem(o);

  const change = (p: PlayerId, patch: Partial<Side>) => {
    const next = { ...o, [p]: { ...o[p], ...patch } };
    // A new fleet brings its own default names; in a mirror match p2 takes the second half of the list.
    if (patch.fleet !== undefined && patch.fleet !== o[p].fleet) {
      const mirror = next.p1.fleet === next.p2.fleet;
      next.p1 = { ...next.p1, ships: defaultNames(next.p1.fleet, next.p1.ships.length), ...(p === "p1" ? { classes: [] } : {}) };
      next.p2 = { ...next.p2, ships: defaultNames(next.p2.fleet, next.p2.ships.length, mirror), ...(p === "p2" ? { classes: [] } : {}) };
    }
    setO(next);
  };
  const setCount = (n: number) => {
    const p1 = resize(o.p1.ships, o.p1.fleet, n, o.p2.ships);
    setO({ ...o, p1: { ...o.p1, ships: p1 }, p2: { ...o.p2, ships: resize(o.p2.ships, o.p2.fleet, n, p1) } });
  };

  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        if (dupes.length === 0 && problem === null) onStart(o);
      }}
    >
      <h2>Hot-seat</h2>
      <p className="muted">Two players on this device: pass it over when it says so.</p>
      <BattleFields
        value={o}
        onChange={(patch) => {
          // Back to Cruiser Clash: equal numbers again, the larger side trimmed to fit.
          const toClash = patch.forces?.kind !== "points" && points !== null;
          const n = Math.min(MAX_SHIPS, Math.max(o.p1.ships.length, o.p2.ships.length));
          setO(toClash ? { ...o, ...patch, p1: { ...o.p1, ships: resize(o.p1.ships, o.p1.fleet, n, o.p2.ships) }, p2: { ...o.p2, ships: resize(o.p2.ships, o.p2.fleet, n, o.p1.ships) } } : { ...o, ...patch });
        }}
      />
      {points === null && <CountSelect value={count} onChange={setCount} />}
      {PLAYERS.map((p) => (
        <FleetFields
          key={p}
          legend={p === "p1" ? "Player 1" : "Player 2"}
          className={p}
          side={o[p]}
          onChange={(patch) => change(p, patch)}
          dupes={dupes}
          carriers={carriersAllowed(o)}
          pointsLimit={points}
          taken={o[p === "p1" ? "p2" : "p1"].ships}
        />
      ))}
      <RulesChecks value={{ ...o, carriers: o.carriers === true }} onChange={(rules) => setO({ ...o, ...rules })} points={points !== null} />
      <DuplicateNames dupes={dupes} />
      <FleetProblem problem={problem} />
      <div className="buttons">
        <button type="submit" className="primary" disabled={dupes.length > 0 || problem !== null}>
          Start
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}
