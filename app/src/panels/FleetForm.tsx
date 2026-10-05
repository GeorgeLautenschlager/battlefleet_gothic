/** Pieces of the fleet forms: hot-seat New game, Online, and the online lobby's join. */
import { carrierClass, classIds, defaultNames, FLEETS, MAX_SHIPS, profileOf, type Fleet, type Side } from "../game/config";

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

export type Rules = { ramming: boolean; boarding: boolean; carriers: boolean };

/** The game's rule switches: ramming (pp. 55–56), boarding with teleport attacks (pp. 89–92), and carriers (p. 129). */
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
      <label className="check">
        <input type="checkbox" checked={value.carriers} onChange={(e) => onChange({ ...value, carriers: e.target.checked })} />
        One carrier each, over the points cap (p. 129)
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
  /** The game allows one carrier each (p. 129). */
  carriers?: boolean;
};

/** "2 × Lunar class cruiser, 1 × Dictator class cruiser · 580 pts" */
function fleetSummary(side: Side, carriers: boolean): string {
  const counts = new Map<string, { n: number; points: number }>();
  for (const id of classIds(side, carriers)) {
    const p = profileOf(id);
    const c = counts.get(p.className) ?? { n: 0, points: p.points };
    counts.set(p.className, { ...c, n: c.n + 1 });
  }
  const total = [...counts.values()].reduce((t, c) => t + c.n * c.points, 0);
  return `${[...counts].map(([name, c]) => `${c.n} × ${name} (${c.points} pts)`).join(", ")} · ${total} pts`;
}

/** One side: commander, fleet, its carrier if allowed, and a name per ship. */
export function FleetFields({ legend, className, side, onChange, dupes, carriers = false }: FieldsProps) {
  const count = side.ships.length;
  const carrier = carrierClass(side.fleet);
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
      {carriers && (
        <label className="check">
          <input type="checkbox" checked={side.carrier === true} onChange={(e) => onChange({ carrier: e.target.checked })} />
          Bring a carrier: {side.ships[0]?.trim() || "ship 1"} is a {carrier.className}
        </label>
      )}
      <p className="muted small">{fleetSummary(side, carriers)}</p>
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
