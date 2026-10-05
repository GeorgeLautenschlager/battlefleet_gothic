import { useState } from "react";
import type { PlayerId } from "@bfg/engine";
import { defaultNames, FLEETS, MAX_SHIPS, shipClass, type Fleet, type NewGameOptions, type Side } from "../game/config";

const PLAYERS: PlayerId[] = ["p1", "p2"];

function withDefaults(o: NewGameOptions, n: number): NewGameOptions {
  const mirror = o.p1.fleet === o.p2.fleet;
  return {
    ...o,
    p1: { ...o.p1, ships: defaultNames(o.p1.fleet, n) },
    p2: { ...o.p2, ships: defaultNames(o.p2.fleet, n, mirror) },
  };
}

const INITIAL: NewGameOptions = withDefaults(
  { p1: { name: "Player 1", fleet: "imperial_navy", ships: [] }, p2: { name: "Player 2", fleet: "chaos", ships: [] }, ramming: true },
  1,
);

/** Every ship name used more than once (names are how the log and the cards tell ships apart). */
function duplicates(o: NewGameOptions): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of [...o.p1.ships, ...o.p2.ships].map((s) => s.trim())) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  return [...dupes];
}

/** Hot-seat Cruiser Clash: each side picks a fleet; both field the same number of cruisers. */
export function NewGame({ onStart, onCancel, cancelLabel = "Cancel" }: { onStart: (o: NewGameOptions) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [o, setO] = useState<NewGameOptions>(INITIAL);
  const count = o.p1.ships.length;
  const dupes = duplicates(o);

  const setSide = (p: PlayerId, patch: Partial<Side>) => setO({ ...o, [p]: { ...o[p], ...patch } });
  const setFleet = (p: PlayerId, fleet: Fleet) => setO(withDefaults({ ...o, [p]: { ...o[p], fleet } }, count));
  const setCount = (n: number) => {
    // Keep the names already typed; new ships get defaults nobody is using yet.
    const resized = withDefaults(o, MAX_SHIPS * 2);
    const used = new Set([...o.p1.ships, ...o.p2.ships]);
    const grow = (p: PlayerId) => {
      const extra = resized[p].ships.filter((s) => !used.has(s));
      const ships = o[p].ships.slice(0, n);
      while (ships.length < n) ships.push(extra.shift() ?? `Ship ${ships.length + 1}`);
      ships.forEach((s) => used.add(s));
      return ships;
    };
    const p1 = grow("p1");
    setO({ ...o, p1: { ...o.p1, ships: p1 }, p2: { ...o.p2, ships: grow("p2") } });
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
      <label>
        Cruisers a side
        <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {Array.from({ length: MAX_SHIPS }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      {PLAYERS.map((p) => {
        const side = o[p];
        const profile = shipClass(side.fleet);
        return (
          <fieldset key={p} className={p}>
            <legend>
              {p === "p1" ? "Player 1" : "Player 2"} · {FLEETS[side.fleet].name}
            </legend>
            <label>
              Commander
              <input value={side.name} onChange={(e) => setSide(p, { name: e.target.value })} required maxLength={40} />
            </label>
            <label>
              Fleet
              <select value={side.fleet} onChange={(e) => setFleet(p, e.target.value as Fleet)}>
                {(Object.keys(FLEETS) as Fleet[]).map((f) => (
                  <option key={f} value={f}>
                    {FLEETS[f].name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              {count} × {profile.className}, {profile.points} pts each · {count * profile.points} pts
            </p>
            {side.ships.map((name, i) => (
              <label key={i}>
                {count === 1 ? "Ship name" : `Ship ${i + 1}`}
                <input
                  value={name}
                  onChange={(e) => setSide(p, { ships: side.ships.map((s, j) => (j === i ? e.target.value : s)) })}
                  required
                  maxLength={40}
                  aria-invalid={dupes.includes(name.trim())}
                />
              </label>
            ))}
          </fieldset>
        );
      })}
      <label className="check">
        <input type="checkbox" checked={o.ramming} onChange={(e) => setO({ ...o, ramming: e.target.checked })} />
        Ramming (optional rule, pp. 55–56)
      </label>
      {dupes.length > 0 && <p className="rejection">Every ship needs its own name ({dupes.join(", ")}).</p>}
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
