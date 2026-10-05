/** Pieces of the fleet forms: hot-seat New game, Online, and the online lobby's join. */
import { defaultNames, FLEETS, MAX_SHIPS, shipClass, type Fleet, type Side } from "../game/config";

/** Every name used more than once (names are how the log and the cards tell ships apart). */
export function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of names.map((s) => s.trim())) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  return [...dupes];
}

/**
 * `ships` resized to `n`: names already typed stay; new ships get default
 * names for `fleet` that aren't in `taken` (or already in the list).
 */
export function resize(ships: string[], fleet: Fleet, n: number, taken: string[] = []): string[] {
  const used = new Set([...taken, ...ships]);
  const spare = [...defaultNames(fleet, MAX_SHIPS), ...defaultNames(fleet, MAX_SHIPS, true)].filter((s) => !used.has(s));
  const out = ships.slice(0, n);
  while (out.length < n) out.push(spare.shift() ?? `Ship ${out.length + 1}`);
  return out;
}

export function CountSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label>
      Cruisers a side
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: MAX_SHIPS }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
    </label>
  );
}

export type Rules = { ramming: boolean; boarding: boolean };

/** The game's rule switches: ramming (optional, pp. 55–56) and boarding with teleport attacks (pp. 89–92). */
export function RulesChecks({ value, onChange }: { value: Rules; onChange: (rules: Rules) => void }) {
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={value.ramming} onChange={(e) => onChange({ ...value, ramming: e.target.checked })} />
        Ramming (optional rule, pp. 55–56)
      </label>
      <label className="check">
        <input type="checkbox" checked={value.boarding} onChange={(e) => onChange({ ...value, boarding: e.target.checked })} />
        Boarding and teleport attacks (pp. 89–92)
      </label>
    </>
  );
}

type FieldsProps = {
  legend: string;
  /** CSS class for the player's colour. */
  className: string;
  side: Side;
  onChange: (patch: Partial<Side>) => void;
  /** Names to flag as clashing. */
  dupes: string[];
};

/** One side: commander, fleet, and a name per ship. */
export function FleetFields({ legend, className, side, onChange, dupes }: FieldsProps) {
  const count = side.ships.length;
  const profile = shipClass(side.fleet);
  return (
    <fieldset className={className}>
      <legend>
        {legend} · {FLEETS[side.fleet].name}
      </legend>
      <label>
        Commander
        <input value={side.name} onChange={(e) => onChange({ name: e.target.value })} required maxLength={40} />
      </label>
      <label>
        Fleet
        <select value={side.fleet} onChange={(e) => onChange({ fleet: e.target.value as Fleet })}>
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
            onChange={(e) => onChange({ ships: side.ships.map((s, j) => (j === i ? e.target.value : s)) })}
            required
            maxLength={40}
            aria-invalid={dupes.includes(name.trim())}
          />
        </label>
      ))}
    </fieldset>
  );
}

export function DuplicateNames({ dupes }: { dupes: string[] }) {
  return dupes.length > 0 ? <p className="rejection">Every ship needs its own name ({dupes.join(", ")}).</p> : null;
}
