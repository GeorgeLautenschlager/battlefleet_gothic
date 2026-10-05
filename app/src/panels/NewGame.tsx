import { useState } from "react";
import type { PlayerId } from "@bfg/engine";
import { defaultNames, type NewGameOptions, type Side } from "../game/config";
import { CountSelect, duplicates, DuplicateNames, FleetFields, RammingCheck, resize } from "./FleetForm";

const PLAYERS: PlayerId[] = ["p1", "p2"];

const INITIAL: NewGameOptions = {
  p1: { name: "Player 1", fleet: "imperial_navy", ships: defaultNames("imperial_navy", 1) },
  p2: { name: "Player 2", fleet: "chaos", ships: defaultNames("chaos", 1) },
  ramming: true,
};

/** Hot-seat Cruiser Clash: each side picks a fleet; both field the same number of cruisers. */
export function NewGame({ onStart, onCancel, cancelLabel = "Cancel" }: { onStart: (o: NewGameOptions) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [o, setO] = useState<NewGameOptions>(INITIAL);
  const count = o.p1.ships.length;
  const dupes = duplicates([...o.p1.ships, ...o.p2.ships]);

  const change = (p: PlayerId, patch: Partial<Side>) => {
    const next = { ...o, [p]: { ...o[p], ...patch } };
    // A new fleet brings its own default names; in a mirror match p2 takes the second half of the list.
    if (patch.fleet !== undefined && patch.fleet !== o[p].fleet) {
      const mirror = next.p1.fleet === next.p2.fleet;
      next.p1 = { ...next.p1, ships: defaultNames(next.p1.fleet, count) };
      next.p2 = { ...next.p2, ships: defaultNames(next.p2.fleet, count, mirror) };
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
        if (dupes.length === 0) onStart(o);
      }}
    >
      <h2>Hot-seat</h2>
      <p className="muted">Cruiser Clash on this device: up to four cruisers a side, the same number each. Pass it over when it says so.</p>
      <CountSelect value={count} onChange={setCount} />
      {PLAYERS.map((p) => (
        <FleetFields key={p} legend={p === "p1" ? "Player 1" : "Player 2"} className={p} side={o[p]} onChange={(patch) => change(p, patch)} dupes={dupes} />
      ))}
      <RammingCheck value={o.ramming} onChange={(ramming) => setO({ ...o, ramming })} />
      <DuplicateNames dupes={dupes} />
      <div className="buttons">
        <button type="submit" className="primary" disabled={dupes.length > 0}>
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
